/**
 * Document metadata is durable — against a real database (ADR-0094).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Two stores over migration 0017: `document_intakes`, from which a confirm
 * TAKES an intake in one statement, and `documents`, which holds a record
 * and the object key its bytes rest under — and nothing that could hold the
 * bytes. Then the one durability check, with every combination it has to
 * tell apart.
 *
 * Skipped without a database, and `AAS_REQUIRE_DATABASE=1` makes a skip a
 * failure (P48's rule: CI runs these, and a suite that quietly skipped would
 * prove nothing about the table).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { b2Register } from "@askimate/aas-disclosure";
import type { RetentionSchedule } from "@askimate/aas-domain";
import type { DocumentRecord } from "@askimate/aas-documents";
import { INTAKE_TTL_MS, InMemoryDocumentVault, assertStorable, openIntake } from "@askimate/aas-documents";

import { MIGRATIONS_DIR } from "./index.js";
import {
  InMemoryDocumentIntakePort,
  PostgresDocumentIntakePort,
  assertDocumentStoreIsDurable,
} from "./document-intake-store.js";
import { InMemoryDocumentRecordStore, PostgresDocumentRecordStore } from "./document-record-store.js";
import { S3DocumentVault } from "./s3-document-vault.js";

const NOW = new Date("2026-09-09T16:00:00Z");
const KMS = "arn:aws:kms:eu-west-2:000000000000:key/00000000-0000-0000-0000-000000000000";
const BYTES = Buffer.from("%PDF-1.7\nnot a real passport.\n");
const HASH = createHash("sha256").update(BYTES).digest("hex");

const SCHEDULE: RetentionSchedule = {
  version: "test-durable",
  approvedAt: new Date("2026-09-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  effectiveFrom: new Date("2026-09-01T00:00:00Z"),
  policies: [
    {
      documentType: "passport",
      purpose: "identity_verification",
      trigger: "last_used",
      retainForDays: 365,
      action: "delete",
      erasureBehaviour: "full",
      policyReference: "AAS-RET-B1-01",
      basis: {
        kind: "policy_decision",
        statement: "Test fixture.",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-09-01T00:00:00Z"),
        reliesOnLegalClaims: false,
      },
      reviewBy: new Date("2027-09-01T00:00:00Z"),
    },
  ],
  unresolved: [],
  determinations: [],
  obligations: [],
};

/** A schedule that permits nothing — what a re-run gate sees after policy changed. */
const NOTHING: RetentionSchedule = { ...SCHEDULE, version: "test-nothing", policies: [] };

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the durable document stores");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let counter = 0;

function intake(now = NOW, studentId = "stu_durable") {
  counter += 1;
  return openIntake({
    intakeId: `01JQDURABLE${String(counter).padStart(15, "0")}`,
    conversationId: "conv_durable",
    upload: assertStorable({
      schedule: SCHEDULE,
      register: b2Register(now),
      upload: {
        studentId,
        documentType: "passport",
        purpose: "identity_verification",
        contentType: "application/pdf",
        sizeBytes: BYTES.byteLength,
        contentHash: HASH,
        dates: {},
      },
    }),
    contentType: "application/pdf",
    declaredSizeBytes: BYTES.byteLength,
    now,
  });
}

function record(documentId: string, studentId = "stu_durable"): DocumentRecord {
  return {
    documentId,
    studentId,
    documentType: "passport",
    purpose: "identity_verification",
    state: "uploaded",
    contentHash: HASH,
    contentType: "application/pdf",
    sizeBytes: BYTES.byteLength,
    uploadedAt: NOW,
    dates: {},
    retentionPolicyReference: "AAS-RET-B1-01",
    retentionTriggeredAt: null,
  };
}

function s3(records?: PostgresDocumentRecordStore | InMemoryDocumentRecordStore): S3DocumentVault {
  return new S3DocumentVault({
    client: new S3Client({
      region: "eu-west-2",
      credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "not-a-secret" },
    }),
    bucket: "never-contacted",
    kmsKeyId: KMS,
    ...(records === undefined ? {} : { records }),
  });
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_document_store WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_document_store");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_document_store";
  pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
  await migrate(pool, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

describe("migration 0017", () => {
  it("has NO column that could hold a document's contents", () => {
    // ADR-0092's property, asserted on the schema's text: metadata is here,
    // bytes are not, and there is no type in either table a byte could go in.
    const sql = readFileSync(join(MIGRATIONS_DIR, "0017_documents.sql"), "utf8").toLowerCase();
    expect(sql).not.toMatch(/\bbytea\b/);
    expect(sql).not.toMatch(/\bblob\b/);
    expect(sql).not.toMatch(/\bcontents?\s+(text|jsonb|bytea)/);
    expect(sql).toContain("create table document_intakes");
    expect(sql).toContain("create table documents");
  });
});

/** The port under a fixed clock. Every test here is about what happens, not when. */
function portAt(schedule: RetentionSchedule, now: Date): PostgresDocumentIntakePort {
  return new PostgresDocumentIntakePort(pool, schedule, b2Register(NOW), s3(), () => now);
}

describeIfDatabase("the intake store", () => {
  it("opens and takes an intake, and the gates re-run on take", async () => {
    const port = portAt(SCHEDULE, NOW);
    const opened = intake();
    await port.open(opened);

    const taken = await port.take("conv_durable", opened.intakeId);
    expect(taken).not.toBeNull();
    expect(taken?.declaredHash).toBe(HASH);
    expect(taken?.upload.policyReference).toBe("AAS-RET-B1-01");
    expect(taken?.openedAt.getTime()).toBe(opened.openedAt.getTime());
    expect(taken?.expiresAt.getTime()).toBe(opened.openedAt.getTime() + INTAKE_TTL_MS);
  });

  it("takes ONCE — a second take finds nothing", async () => {
    const port = portAt(SCHEDULE, NOW);
    const opened = intake();
    await port.open(opened);
    expect(await port.take("conv_durable", opened.intakeId)).not.toBeNull();
    expect(await port.take("conv_durable", opened.intakeId)).toBeNull();
  });

  it("gives an intake to exactly ONE of two concurrent takes", async () => {
    // The whole reason take is one DELETE … RETURNING rather than a read and
    // a delete. Two confirms racing for the same intake must not both record
    // a document.
    const port = portAt(SCHEDULE, NOW);
    const opened = intake();
    await port.open(opened);
    const results = await Promise.all([
      port.take("conv_durable", opened.intakeId),
      port.take("conv_durable", opened.intakeId),
      port.take("conv_durable", opened.intakeId),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("does NOT return an intake for another conversation, and does not spend it", async () => {
    const port = portAt(SCHEDULE, NOW);
    const opened = intake();
    await port.open(opened);
    expect(await port.take("conv_someone_else", opened.intakeId)).toBeNull();
    expect(await port.take("conv_durable", opened.intakeId)).not.toBeNull();
  });

  it("never returns an expired intake", async () => {
    // Opened at NOW; taken sixteen minutes later by the port's clock. The
    // DELETE takes the row regardless and the code refuses it as expired.
    const opened = intake(NOW);
    await portAt(SCHEDULE, NOW).open(opened);
    const later = portAt(SCHEDULE, new Date(NOW.getTime() + 16 * 60 * 1000));
    expect(await later.take("conv_durable", opened.intakeId)).toBeNull();
    // Gone, not merely hidden: a take at the original clock finds nothing either.
    expect(await portAt(SCHEDULE, NOW).take("conv_durable", opened.intakeId)).toBeNull();
  });

  it("REFUSES the take when the schedule in force no longer permits the document", async () => {
    // Declared under a schedule that permitted passports; confirmed under one
    // that permits nothing. The gates re-run and refuse, in the gate's own
    // words — and the intake is spent, because the permission it recorded is
    // no longer one anybody would grant.
    const declaring = portAt(SCHEDULE, NOW);
    const confirming = portAt(NOTHING, NOW);
    const opened = intake();
    await declaring.open(opened);
    await expect(confirming.take("conv_durable", opened.intakeId)).rejects.toThrow(/retention policy/i);
    expect(await declaring.take("conv_durable", opened.intakeId)).toBeNull();
  });

  it("stores no bytes, and the row says what the gates relied on", async () => {
    const port = portAt(SCHEDULE, NOW);
    const opened = intake();
    await port.open(opened);
    const rows = await pool.query<{ policy_reference: string; lawful_basis: unknown; content_hash: string }>(
      "SELECT policy_reference, lawful_basis, content_hash FROM document_intakes WHERE intake_id = $1",
      [opened.intakeId],
    );
    expect(rows.rows[0]?.policy_reference).toBe("AAS-RET-B1-01");
    expect(rows.rows[0]?.content_hash).toBe(HASH);
    expect(JSON.stringify(rows.rows[0]?.lawful_basis)).toContain("determination");
    expect(JSON.stringify(rows.rows[0])).not.toContain(BYTES.toString("base64"));
  });
});

describeIfDatabase("the record store", () => {
  it("round-trips a record and its object key", async () => {
    const store = new PostgresDocumentRecordStore(pool);
    const documentId = `01JQRECORD${String(++counter).padStart(16, "0")}`;
    await store.insert(record(documentId), "documents/stu_durable/x");
    const stored = await store.get(documentId);
    expect(stored?.record).toEqual(record(documentId));
    expect(stored?.objectKey).toBe("documents/stu_durable/x");
    expect(await store.get("01JQNOPE00000000000000000")).toBeNull();
  });

  it("REFUSES a second record with the same id", async () => {
    const store = new PostgresDocumentRecordStore(pool);
    const documentId = `01JQRECORD${String(++counter).padStart(16, "0")}`;
    await store.insert(record(documentId), "documents/stu_durable/y");
    await expect(store.insert(record(documentId), "documents/stu_durable/y")).rejects.toThrow();
  });

  it("lists by student, in upload order", async () => {
    const store = new PostgresDocumentRecordStore(pool);
    const student = `stu_list_${String(++counter)}`;
    const a = `01JQLIST00${String(++counter).padStart(16, "0")}`;
    const b = `01JQLIST00${String(++counter).padStart(16, "0")}`;
    await store.insert(record(a, student), "k/a");
    await store.insert({ ...record(b, student), uploadedAt: new Date(NOW.getTime() + 1000) }, "k/b");
    expect((await store.listForStudent(student)).map((r) => r.documentId)).toEqual([a, b]);
    expect(await store.listForStudent("stu_nobody")).toEqual([]);
  });

  it("updates state and the retention clock, and the purge is WHOLE in the schema", async () => {
    const store = new PostgresDocumentRecordStore(pool);
    const documentId = `01JQPURGE0${String(++counter).padStart(16, "0")}`;
    await store.insert(record(documentId), "k/p");

    await store.update({ ...record(documentId), retentionTriggeredAt: NOW }, null);
    expect((await store.get(documentId))?.record.retentionTriggeredAt).toEqual(NOW);

    // state='purged' without purged_at is refused by the CHECK — the record
    // cannot say purged while the row cannot say when.
    await expect(store.update({ ...record(documentId), state: "purged" }, null)).rejects.toThrow(
      /documents_purge_is_whole/,
    );
    await store.update({ ...record(documentId), state: "purged" }, NOW);
    const purged = await store.get(documentId);
    expect(purged?.record.state).toBe("purged");
    // The key survives the purge, for the audit.
    expect(purged?.objectKey).toBe("k/p");
    expect(purged?.record.contentHash).toBe(HASH);
  });

  it("REFUSES a hash that is not a SHA-256, and a record for nothing", async () => {
    const store = new PostgresDocumentRecordStore(pool);
    const documentId = `01JQBADHSH${String(++counter).padStart(16, "0")}`;
    await expect(store.insert({ ...record(documentId), contentHash: "sha256:abc" }, "k")).rejects.toThrow(
      /content_hash/,
    );
    await expect(store.update(record("01JQNOPE00000000000000000"), null)).rejects.toThrow(/no document/);
  });
});

describe("the one durability check", () => {
  const environment = "production";
  const registerNow = b2Register(NOW);

  it("refuses the in-memory intake port", () => {
    const port = new InMemoryDocumentIntakePort(SCHEDULE, registerNow);
    expect(() => assertDocumentStoreIsDurable(port, environment)).toThrow(/intake store is in memory/);
  });

  it("refuses a durable intake port over the in-memory vault", () => {
    const port = {
      schedule: SCHEDULE,
      register: registerNow,
      vault: new InMemoryDocumentVault(),
      open: () => Promise.resolve(),
      take: () => Promise.resolve(null),
    };
    expect(() => assertDocumentStoreIsDurable(port, environment)).toThrow(/vault is in memory/);
  });

  it("refuses an S3 vault whose metadata is in memory", () => {
    const port = {
      schedule: SCHEDULE,
      register: registerNow,
      vault: s3(new InMemoryDocumentRecordStore()),
      open: () => Promise.resolve(),
      take: () => Promise.resolve(null),
    };
    expect(() => assertDocumentStoreIsDurable(port, environment)).toThrow(/metadata store is in memory/);
  });

  it("accepts the durable combination, and accepts anything outside production", () => {
    const durable = {
      schedule: SCHEDULE,
      register: registerNow,
      vault: s3(new PostgresDocumentRecordStore({} as unknown as pg.Pool)),
      open: () => Promise.resolve(),
      take: () => Promise.resolve(null),
    };
    expect(() => assertDocumentStoreIsDurable(durable, environment)).not.toThrow();
    expect(() =>
      assertDocumentStoreIsDurable(new InMemoryDocumentIntakePort(SCHEDULE, registerNow), "development"),
    ).not.toThrow();
  });
});
