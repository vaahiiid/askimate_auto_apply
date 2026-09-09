/**
 * The document transport: the gates run before a single byte is accepted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B4 has been open since the document boundary was drawn (ADR-0067 §8):
 * *"There is no route, no schema and no client surface by which a student
 * could supply a document."* Every policy blocker in front of it is answered
 * — B5 (ADR-0078), B1's eleven periods, B2's four determinations (ADR-0087),
 * and the two that followed (ADR-0088, ADR-0089).
 *
 * These run against the REAL router, over a real HTTP server, with the real
 * retention schedule shape and the real B2 register. What they check is the
 * property the two-step exchange exists for:
 *
 *     A REFUSAL ARRIVES BEFORE THE BYTES DO.
 *
 * No database. The document routes never touch `ConversationEventStore`, so
 * the store is a stub — stated here rather than left for a reader to wonder
 * about, because a stub that stood in for something the code under test DID
 * use would make every result meaningless.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Server } from "node:http";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";

import { b2Register } from "@askimate/aas-disclosure";
import type { RetentionSchedule } from "@askimate/aas-domain";

import { createConversationRoutes } from "./routes.js";
import type { ConversationEventStore } from "./event-store.js";
import { InMemoryDocumentIntakePort, assertDocumentStoreIsDurable } from "./document-intake-store.js";

/**
 * Ports are taken from the kernel (`listen(0)`), not chosen. This file used to
 * listen on 45617 and 45618 — inside Linux's ephemeral range (32768–60999),
 * which is where the kernel hands out SOURCE ports to every outbound
 * connection the rest of the suite makes to Postgres, Redis and its own
 * servers. On 2026-09-09 CI run #143 lost that race: `listen(45618)` failed
 * with EADDRINUSE, `listening` never fired, and the test timed out. Every
 * other test file in the repository sits below 32768; this one now asks
 * rather than assumes.
 */
function portOf(listening: Server): number {
  const address = listening.address();
  if (address === null || typeof address === "string") throw new Error("server has no TCP port");
  return address.port;
}

let BASE = "";
const NOW = new Date("2026-09-08T12:00:00Z");
const CONVERSATION = "conv_transport";
const STUDENT = "stu_transport";

/** A passport, held for reuse — B1 row 1's shape (ADR-0078). */
const SCHEDULE: RetentionSchedule = {
  version: "test-transport",
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
        statement: "Test fixture. Held for reuse across applications (ADR-0078).",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-09-01T00:00:00Z"),
        reliesOnLegalClaims: false,
      },
      reviewBy: new Date("2027-09-01T00:00:00Z"),
    },
    // B1 row 5, as the real schedule has it: a policy exists, and no storage
    // determination ever will (ADR-0088). Present so the decided-against
    // refusal is reachable — retention runs first, and without this row the
    // pair would be refused for the wrong reason.
    {
      documentType: "other",
      purpose: "audit_evidence",
      trigger: "case_concluded",
      retainForDays: 2190,
      action: "anonymise",
      erasureBehaviour: "redact_contents",
      policyReference: "AAS-RET-B1-05",
      basis: {
        kind: "policy_decision",
        statement: "Test fixture mirroring B1 row 5. The audit record holds no bytes.",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-09-07T00:00:00Z"),
        reliesOnLegalClaims: true,
      },
      reviewBy: new Date("2027-09-07T00:00:00Z"),
    },
  ],
  unresolved: [],
  determinations: [],
  obligations: [],
};

const PDF = Buffer.from("%PDF-1.7\nthis is a test passport scan, and it is not a real one.\n");
const PDF_HASH = createHash("sha256").update(PDF).digest("hex");

let server: Server;
let documents: InMemoryDocumentIntakePort;

beforeAll(async () => {
  documents = new InMemoryDocumentIntakePort(SCHEDULE, b2Register(NOW));

  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use(
    createConversationRoutes({
      // Never called by these routes. See the header.
      store: {} as unknown as ConversationEventStore,
      authenticate: (req) => {
        const id = req.header("x-student");
        return id === undefined ? null : { studentId: id };
      },
      authorise: (_caller, conversationId) => Promise.resolve(conversationId === CONVERSATION),
      documents,
      now: () => NOW,
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  BASE = `http://127.0.0.1:${String(portOf(server))}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Declared {
  readonly intakeId: string;
  readonly maxBytes: number;
  readonly acceptedContentTypes: readonly string[];
  readonly retentionPolicyReference: string;
}

async function declare(body: Record<string, unknown>, student = STUDENT): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-student": student },
    body: JSON.stringify(body),
  });
}

function passportDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    contentHash: PDF_HASH,
    sizeBytes: PDF.byteLength,
    ...overrides,
  };
}

async function send(
  intakeId: string,
  bytes: Buffer,
  contentType = "application/pdf",
): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents/${intakeId}/content`, {
    method: "PUT",
    headers: { "content-type": contentType, "x-student": STUDENT },
    body: new Uint8Array(bytes),
  });
}

describe("declaring an upload", () => {
  it("runs the storage gates and STATES the constraints", async () => {
    const response = await declare(passportDeclaration());
    expect(response.status).toBe(201);

    const body = (await response.json()) as Declared;
    expect(body.intakeId).toMatch(/^[0-9A-Z]{26}$/);
    // The retention policy the gate actually resolved, not a claim that one
    // exists. A client can put this in front of a person.
    expect(body.retentionPolicyReference).toBe("AAS-RET-B1-01");
    // Stated, not left for the client to guess and be refused about.
    expect(body.maxBytes).toBe(10 * 1024 * 1024);
    expect(body.acceptedContentTypes).toContain("application/pdf");
  });

  it("REFUSES a document type with no retention policy, before any body", async () => {
    // `degree_certificate` is inside determination 2's scope, so the lawful
    // basis is fine and the RETENTION policy is what is missing in this
    // fixture. The refusal is the gate's own words.
    const response = await declare(
      passportDeclaration({ documentType: "degree_certificate", purpose: "application_submission" }),
    );
    expect(response.status).toBe(403);
    const problem = (await response.json()) as { detail?: string };
    expect(problem.detail).toMatch(/retention policy/i);
  });

  it("REFUSES a purpose whose determination was decided against (ADR-0088)", async () => {
    // `other / audit_evidence` HAS a retention policy — B1 row 5 above — so
    // the retention gate opens and the lawful-basis side is what refuses. That
    // is the whole distinction: a decision, not an absence.
    const response = await declare(
      passportDeclaration({ documentType: "other", purpose: "audit_evidence" }),
    );
    expect(response.status).toBe(403);
    const problem = (await response.json()) as { detail?: string };
    expect(problem.detail).toMatch(/Do not close this by registering a determination/);
  });

  it("REFUSES `national_id` — the type does not exist any more (ADR-0089)", async () => {
    const response = await declare(passportDeclaration({ documentType: "national_id" }));
    expect(response.status).toBe(400);
    const problem = (await response.json()) as { pointers?: string[] };
    expect(problem.pointers).toEqual(["/documentType"]);
  });

  it("REFUSES a content type the document may not arrive as", async () => {
    const response = await declare(passportDeclaration({ contentType: "application/zip" }));
    expect(response.status).toBe(415);
  });

  it("REFUSES a declared size over the ceiling, so nobody waits for a doomed upload", async () => {
    const response = await declare(passportDeclaration({ sizeBytes: 40 * 1024 * 1024 }));
    expect(response.status).toBe(413);
    const problem = (await response.json()) as { detail?: string };
    expect(problem.detail).toMatch(/before it was sent/);
  });

  it("REFUSES an unauthenticated caller, and a conversation that is not theirs", async () => {
    const anonymous = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(passportDeclaration()),
    });
    expect(anonymous.status).toBe(401);

    const elsewhere = await fetch(`${BASE}/v1/conversations/conv_someone_else/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-student": STUDENT },
      body: JSON.stringify(passportDeclaration()),
    });
    // 404, never 403 — a 403 confirms the conversation exists.
    expect(elsewhere.status).toBe(404);
  });
});

describe("sending the bytes", () => {
  it("stores a document whose bytes are the ones the intake was prepared for", async () => {
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    const response = await send(declared.intakeId, PDF);
    expect(response.status).toBe(201);

    const body = (await response.json()) as { documentId: string; contentHash: string; state: string };
    expect(body.contentHash).toBe(PDF_HASH);
    expect(body.state).toBe("uploaded");

    const stored = await documents.vault.retrieve(body.documentId);
    expect(Buffer.from(stored).equals(PDF)).toBe(true);
  });

  it("REFUSES bytes that are not the ones the gates were run for", async () => {
    // ── The property the hash exists for ────────────────────────────────
    //
    // Without it, a student could declare a two-megabyte personal statement,
    // clear the gates for one, and send a passport. Every check upstream would
    // have been about a document that was never sent.
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    const different = Buffer.from("%PDF-1.7\nsomething else entirely, of a different length.\n");
    const response = await send(declared.intakeId, different);

    expect(response.status).toBe(422);
    const problem = (await response.json()) as { code: string; detail?: string };
    expect(problem.code).toBe("content_hash_mismatch");
    expect(problem.detail).toMatch(/Nothing is stored|different document/);
  });

  it("REFUSES the same length with different content", async () => {
    // The size check alone would pass this. The hash is what catches it, and
    // this is the case that proves the hash is doing work rather than the
    // length agreeing by luck.
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    const swapped = Buffer.from(PDF);
    swapped[swapped.length - 2] = swapped[swapped.length - 2] === 0x41 ? 0x42 : 0x41;
    const response = await send(declared.intakeId, swapped);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("content_hash_mismatch");
  });

  it("spends an intake ONCE", async () => {
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    expect((await send(declared.intakeId, PDF)).status).toBe(201);

    const second = await send(declared.intakeId, PDF);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("intake_not_open");
  });

  it("REFUSES an intake nobody opened, with the same answer as a spent one", async () => {
    // Deliberately indistinguishable. Telling a caller that an id is unknown
    // rather than spent would say which intake ids exist.
    const response = await send("01JQZZZZZZZZZZZZZZZZZZZZZZ", PDF);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("intake_not_open");
  });

  it("REFUSES a body whose Content-Type is not the one prepared for", async () => {
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    const response = await send(declared.intakeId, PDF, "image/png");
    expect(response.status).toBe(415);
  });

  it("does NOT store anything when the bytes are refused", async () => {
    // The whole point, asserted against the vault rather than inferred from a
    // status code: a refusal that still stored would be worse than no check.
    const declared = (await (await declare(passportDeclaration())).json()) as Declared;
    const before = await documents.vault.listForStudent(STUDENT);
    await send(declared.intakeId, Buffer.from("not the prepared bytes at all, truly"));
    const after = await documents.vault.listForStudent(STUDENT);
    expect(after.length).toBe(before.length);
  });
});

describe("the transport refuses to exist when it cannot be honest", () => {
  it("answers `service_unavailable` when no vault is configured", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      createConversationRoutes({
        store: {} as unknown as ConversationEventStore,
        authenticate: () => ({ studentId: STUDENT }),
        authorise: () => Promise.resolve(true),
        now: () => NOW,
      }),
    );
    const bare = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => bare.once("listening", () => resolve()));
    try {
      const response = await fetch(`http://127.0.0.1:${String(portOf(bare))}/v1/conversations/c/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(passportDeclaration()),
      });
      // A refusal, not a bypass. The same shape `targets` uses.
      expect(response.status).toBe(503);
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });

  it("REFUSES to start in production with an in-memory document store", () => {
    // ADR-0055's lesson, applied: ONE check, called at wiring time, and no
    // configuration check beside it that would make this one unreachable.
    expect(() => assertDocumentStoreIsDurable(documents, "production")).toThrow(
      /REFUSING TO START/,
    );
    expect(() => assertDocumentStoreIsDurable(documents, "development")).not.toThrow();
  });
});
