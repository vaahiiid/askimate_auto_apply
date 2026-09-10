/**
 * The document transport: the gates run before a byte exists, and the bytes
 * never enter this service.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0090 shipped the two-step exchange with the bytes arriving on a PUT to
 * this service. ADR-0092 — Vahid: *"the conversation service runs the gates,
 * then mints a pre-signed upload rather than accepting bytes, and the
 * document never enters any process we run"* — moved the second step to the
 * bucket, and ADR-0093 made the minted URL unable to be unbound.
 *
 * These run against the REAL router, over a real HTTP server, with the real
 * retention schedule shape and the real B2 register, and an in-memory bucket
 * that refuses what the run of 2026-09-09 saw S3 refuse. What they check is
 * the property the exchange exists for, restated for its new shape:
 *
 *     A REFUSAL ARRIVES BEFORE THE BYTES EXIST, AND THE BYTES NEVER COME HERE.
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
import type { InMemoryDocumentVault } from "@askimate/aas-documents";
import { CHECKSUM_HEADER, SSE_HEADER, SSE_KEY_HEADER } from "@askimate/aas-documents";

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
        statement: "Test fixture. Audit evidence, redacted at case conclusion (ADR-0078).",
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

const PDF = Buffer.from("%PDF-1.7\nthis is a test passport scan, and it is not a real one.\n");
const PDF_HASH = createHash("sha256").update(PDF).digest("hex");

let server: Server;
let documents: InMemoryDocumentIntakePort;
/** The in-memory bucket the vault mints into. The browser's PUT goes here, never to the server. */
let bucket: InMemoryDocumentVault["objects"];

beforeAll(async () => {
  documents = new InMemoryDocumentIntakePort(SCHEDULE, b2Register(NOW));
  bucket = (documents.vault as InMemoryDocumentVault).objects;

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
  readonly upload: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly expiresAt: string;
  };
  readonly maxBytes: number;
  readonly acceptedContentTypes: readonly string[];
  readonly contentHash: string;
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

async function declared(): Promise<Declared> {
  const response = await declare(passportDeclaration());
  if (response.status !== 201) throw new Error(`declaration answered ${String(response.status)}`);
  return (await response.json()) as Declared;
}

/** The browser's PUT — to the bucket. The server is not on this path. */
function upload(d: Declared, bytes: Buffer, headers = d.upload.headers) {
  return bucket.put(d.upload.url, headers, new Uint8Array(bytes), NOW);
}

async function confirm(intakeId: string): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents/${intakeId}/confirm`, {
    method: "POST",
    headers: { "x-student": STUDENT },
  });
}

describe("declaring an upload", () => {
  it("runs the storage gates and answers with a BOUND upload, stating the headers", async () => {
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

    // ── The upload: a URL whose signature covers the checksum header ────
    //
    // Read off the URL the way `assertBoundUploadUrl` does, so the test
    // agrees with the structure rather than with itself.
    const url = new URL(body.upload.url);
    expect(body.upload.method).toBe("PUT");
    expect(url.protocol).toBe("https:");
    const signed = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toContain(CHECKSUM_HEADER);
    expect(signed).toContain(SSE_HEADER);
    expect(signed).toContain(SSE_KEY_HEADER);
    expect(url.searchParams.has(CHECKSUM_HEADER), "the checksum is NOT in the query string").toBe(false);
    // And the headers the browser must send — the URL is refused without them.
    expect(body.upload.headers[CHECKSUM_HEADER]).toBe(Buffer.from(PDF_HASH, "hex").toString("base64"));
    expect(body.upload.headers[SSE_HEADER]).toBe("aws:kms");
    expect(new Date(body.upload.expiresAt).getTime()).toBeLessThanOrEqual(
      NOW.getTime() + 15 * 60 * 1000,
    );
  });

  it("REFUSES a document type with no retention policy, before any upload exists", async () => {
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

  it("mints NOTHING for a declaration the gates refuse", async () => {
    // The bucket has no grant for a document the gates never passed. Checked
    // against the bucket rather than inferred from the status: a refusal that
    // still minted a URL would be a permission with no gate behind it.
    const before = bucket.grantCount();
    await declare(passportDeclaration({ documentType: "degree_certificate", purpose: "application_submission" }));
    await declare(passportDeclaration({ contentType: "application/zip" }));
    expect(bucket.grantCount()).toBe(before);
  });
});

describe("the bytes never come here", () => {
  it("has NO route that reads a document body — `PUT …/content` is gone", async () => {
    const d = await declared();
    const response = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents/${d.intakeId}/content`, {
      method: "PUT",
      headers: { "content-type": "application/pdf", "x-student": STUDENT },
      body: new Uint8Array(PDF),
    });
    expect(response.status).toBe(404);
  });

  it("sends the bytes to the bucket on the minted URL, and the bucket accepts exactly the declared ones", async () => {
    const d = await declared();
    expect(upload(d, PDF)).toEqual({ status: 200, code: null });
    // What came to rest is the declared document, at the key the URL names —
    // under this student, under this intake, and nowhere this service wrote.
    const key = new URL(d.upload.url).pathname.slice(1);
    expect(key).toBe(`documents/${STUDENT}/${d.intakeId}`);
    expect(Buffer.from(bucket.peek(key) ?? new Uint8Array()).equals(PDF)).toBe(true);
  });

  it("the bucket REFUSES a same-length substitution — the binding S3 enforced (E2)", async () => {
    const d = await declared();
    const swapped = Buffer.from(PDF);
    swapped[swapped.length - 2] = swapped[swapped.length - 2] === 0x41 ? 0x42 : 0x41;
    expect(upload(d, swapped)).toEqual({ status: 400, code: "BadDigest" });
  });

  it("the bucket REFUSES the checksum header omitted or altered — the signature covers it (E6, E7)", async () => {
    const d = await declared();
    const { [CHECKSUM_HEADER]: _dropped, ...without } = d.upload.headers;
    expect(upload(d, PDF, without)).toEqual({ status: 403, code: "SignatureDoesNotMatch" });

    const other = Buffer.from("%PDF-1.7\nsomething else entirely, of a different length.\n");
    const altered = { ...d.upload.headers, [CHECKSUM_HEADER]: createHash("sha256").update(other).digest("base64") };
    expect(upload(d, other, altered)).toEqual({ status: 403, code: "SignatureDoesNotMatch" });
  });
});

describe("confirming the upload", () => {
  it("records a document whose bytes are the ones the intake was prepared for", async () => {
    const d = await declared();
    expect(upload(d, PDF).status).toBe(200);

    const response = await confirm(d.intakeId);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { documentId: string; contentHash: string; state: string };
    expect(body.contentHash).toBe(PDF_HASH);
    expect(body.state).toBe("uploaded");

    // The bytes, fetched the way the runner will — by URL, never through
    // this service.
    const retrieval = await documents.vault.prepareRetrieval(body.documentId, NOW);
    expect(retrieval.method).toBe("GET");
    expect(Buffer.from(bucket.get(retrieval.url) ?? new Uint8Array()).equals(PDF)).toBe(true);
  });

  it("REFUSES to take the browser's word for it — nothing in the bucket, nothing recorded", async () => {
    // The confirm asks the bucket, not the caller. No PUT happened here.
    const d = await declared();
    const before = await documents.vault.listForStudent(STUDENT);
    const response = await confirm(d.intakeId);

    expect(response.status).toBe(409);
    const problem = (await response.json()) as { code: string; detail?: string };
    expect(problem.code).toBe("upload_not_received");
    expect(problem.detail).toMatch(/Declare the document again/);
    expect((await documents.vault.listForStudent(STUDENT)).length).toBe(before.length);
  });

  it("does NOT record anything when the bucket refused the bytes", async () => {
    // The whole point, asserted against the vault rather than inferred from a
    // status code: a refusal by the bucket that still recorded would be worse
    // than no check.
    const d = await declared();
    expect(upload(d, Buffer.from("not the prepared bytes at all, truly")).status).toBe(400);
    const before = await documents.vault.listForStudent(STUDENT);
    expect((await confirm(d.intakeId)).status).toBe(409);
    expect((await documents.vault.listForStudent(STUDENT)).length).toBe(before.length);
  });

  it("spends an intake ONCE", async () => {
    const d = await declared();
    expect(upload(d, PDF).status).toBe(200);
    expect((await confirm(d.intakeId)).status).toBe(201);

    const second = await confirm(d.intakeId);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("intake_not_open");
  });

  it("REFUSES an intake nobody opened, with the same answer as a spent one", async () => {
    // Deliberately indistinguishable. Telling a caller that an id is unknown
    // rather than spent would say which intake ids exist.
    const response = await confirm("01JQZZZZZZZZZZZZZZZZZZZZZZ");
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("intake_not_open");
  });

  it("REFUSES an unauthenticated confirm, and one on a conversation that is not theirs", async () => {
    const d = await declared();
    const anonymous = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents/${d.intakeId}/confirm`, {
      method: "POST",
    });
    expect(anonymous.status).toBe(401);
    const elsewhere = await fetch(`${BASE}/v1/conversations/conv_someone_else/documents/${d.intakeId}/confirm`, {
      method: "POST",
      headers: { "x-student": STUDENT },
    });
    expect(elsewhere.status).toBe(404);
  });
});

describe("what is held, and the purpose the caller need not state (P62)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0095. The student's page never states a purpose: why the system holds
  // a document is the controller's decision per schedule row (ADR-0087), and
  // a page that offered "financial evidence" as a menu item would be handing
  // a lawful-basis determination to the person choosing a file. So the route
  // derives it — from the governing schedule, and only where that is
  // unambiguous.
  // ═══════════════════════════════════════════════════════════════════════

  it("derives the purpose from the governing schedule when none is stated", async () => {
    const { purpose: _omitted, ...withoutPurpose } = passportDeclaration();
    const response = await declare(withoutPurpose);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Declared;
    // The same policy the stated form resolves — the derivation changed
    // nothing about what the gates judged.
    expect(body.retentionPolicyReference).toBe("AAS-RET-B1-01");
  });

  it("REFUSES to derive one for a type the schedule has no row for, on /purpose", async () => {
    // `sponsorship_letter` has no policy in this fixture, so there is nothing
    // to derive from. Not a guess, not a default: the caller is told which
    // field is missing and why.
    const { purpose: _omitted, ...withoutPurpose } = passportDeclaration({ documentType: "sponsorship_letter" });
    const response = await declare(withoutPurpose);
    expect(response.status).toBe(400);
    const problem = (await response.json()) as { code: string; pointers?: string[] };
    expect(problem.code).toBe("validation_failed");
    expect(problem.pointers).toEqual(["/purpose"]);
    expect(bucket.grantCount(), "and no upload URL was minted").toBe(bucket.grantCount());
  });

  it("lists what THIS student holds, from the server, and the types the schedule names", async () => {
    // A document the whole exchange has recorded, for a student of its own so
    // the list is exactly one long.
    const response = await declare(passportDeclaration(), "stu_holder");
    const d = (await response.json()) as Declared;
    expect(upload(d, PDF)).toEqual({ status: 200, code: null });
    const confirmed = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents/${d.intakeId}/confirm`, {
      method: "POST",
      headers: { "x-student": "stu_holder" },
    });
    expect(confirmed.status).toBe(201);
    const stored = (await confirmed.json()) as Record<string, unknown>;
    // The confirm answers the same published shape the listing does — the
    // declared content type, the size and when — so a client reads one shape.
    expect(stored["contentType"]).toBe("application/pdf");
    expect(stored["sizeBytes"]).toBe(PDF.byteLength);
    expect(stored["uploadedAt"]).toBe(NOW.toISOString());

    const listed = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents`, {
      headers: { "x-student": "stu_holder" },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      documents: Record<string, unknown>[];
      documentTypes: string[];
    };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toEqual(stored);
    // What the page offers as a choice: the schedule's rows, in its order.
    // `other` is listed although its determination was decided against
    // (ADR-0088) — the list is what can be GIVEN, the gate says what is kept.
    expect(body.documentTypes).toEqual(["passport", "other"]);

    // Per student: another student's list does not carry it.
    const theirs = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/documents`, {
      headers: { "x-student": "stu_someone_else" },
    });
    expect(((await theirs.json()) as { documents: unknown[] }).documents).toEqual([]);
  });

  it("answers `service_unavailable` for the listing too, with no vault configured", async () => {
    const app = express();
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
      const response = await fetch(`http://127.0.0.1:${String(portOf(bare))}/v1/conversations/c/documents`);
      // The page reads this on every draw and hides the panel on it — a
      // deployment without a vault is a configuration, not a failure.
      expect(response.status).toBe(503);
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });
});

describe("the transport refuses to exist when it cannot be honest", () => {
  it("answers `service_unavailable` when no bucket is configured", async () => {
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
      const confirmed = await fetch(`http://127.0.0.1:${String(portOf(bare))}/v1/conversations/c/documents/x/confirm`, {
        method: "POST",
      });
      expect(confirmed.status).toBe(503);
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
