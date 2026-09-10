/**
 * The hand-over route: a closed set in, a closed set out.
 *
 * The driver's `documentForWork` is proved against Postgres in
 * `run-driver.test.ts`; this file proves the ROUTE — the service certificate,
 * the lease in the body, and that every one of the driver's refusals maps to
 * a published code with no sentence beside it (ADR-0098, ADR-0099).
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";

import type { WorkDocument } from "@askimate/aas-contracts";

import { createConversationRoutes } from "./routes.js";
import type { RunCoordinator } from "./routes.js";
import type { ConversationEventStore } from "./event-store.js";
import type { WorkDocumentRefusal } from "./run-driver.js";

function portOf(listening: Server): number {
  const address = listening.address();
  if (address === null || typeof address === "string") throw new Error("server has no TCP port");
  return address.port;
}

const HASH = "a".repeat(64);
const DOCUMENT: WorkDocument = {
  documentId: "01JQDOC0000000000000000001",
  documentType: "passport",
  contentHash: HASH,
  contentType: "application/pdf",
  retrieval: { url: "https://vault.test/x", method: "GET", expiresAt: "2026-09-10T09:01:00Z" },
  disclosure: {
    disclosureId: "disc_1",
    subject: { documentId: "01JQDOC0000000000000000001", documentType: "passport", contentHash: HASH, caseId: "case_1", requestedFor: "Upload your passport" },
    destination: { institutionName: "Example University", portalHost: "apply.example.test" },
    determinationId: "b2-3-disclose",
    studentAuthorisation: { studentRef: "stu", presentedText: "…", authorisedAt: "2026-09-10T09:00:00Z", method: "chat_affirmation" },
  },
};

let server: Server;
let BASE = "";
/** What the fake driver answers next, and what it was asked. */
let answer: { ok: true; document: WorkDocument } | { ok: false; refusal: WorkDocumentRefusal } = { ok: true, document: DOCUMENT };
const asked: unknown[] = [];

beforeAll(async () => {
  const runs = {
    documentForWork: (input: unknown) => {
      asked.push(input);
      return Promise.resolve(answer);
    },
  } as unknown as RunCoordinator;
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use(
    createConversationRoutes({
      store: {} as unknown as ConversationEventStore,
      authenticate: () => null,
      authorise: () => Promise.resolve(false),
      authoriseService: (req) => req.header("x-service-cert") === "runner",
      runs,
      now: () => new Date("2026-09-10T09:00:00Z"),
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  BASE = `http://127.0.0.1:${String(portOf(server))}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function ask(body: unknown, cert = "runner"): Promise<Response> {
  return fetch(`${BASE}/internal/v1/work/run_1/documents/passport`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-cert": cert },
    body: JSON.stringify(body),
  });
}

describe("POST /internal/v1/work/:runId/documents/:documentRef", () => {
  it("hands the document over, with the lease taken from the BODY", async () => {
    answer = { ok: true, document: DOCUMENT };
    const response = await ask({ leaseId: "wl_1", holder: "runner-a" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DOCUMENT);
    expect(asked.at(-1)).toEqual({ runId: "run_1", leaseId: "wl_1", holder: "runner-a", documentRef: "passport" });
  });

  it("REFUSES without the service certificate, before the driver is asked", async () => {
    const before = asked.length;
    const response = await ask({ leaseId: "wl_1", holder: "runner-a" }, "not-a-runner");
    expect(response.status).toBe(403);
    expect(asked.length).toBe(before);
  });

  it("REFUSES a body without the lease, naming the fields", async () => {
    const response = await ask({ holder: "runner-a" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { pointers: string[] }).pointers).toEqual(["/leaseId", "/holder"]);
  });

  it("maps every refusal of the driver's to a published code, and no sentence", async () => {
    const expected: Record<WorkDocumentRefusal, [number, string]> = {
      no_disclosure_port: [503, "service_unavailable"],
      not_holder: [403, "forbidden"],
      no_such_run: [404, "not_found"],
      not_executing: [403, "forbidden"],
      no_such_upload: [404, "not_found"],
      not_authorised: [403, "forbidden"],
      content_changed: [409, "content_changed"],
      disclosure_refused: [403, "forbidden"],
      transmission_refused: [403, "forbidden"],
    };
    for (const [refusal, [status, code]] of Object.entries(expected) as [WorkDocumentRefusal, [number, string]][]) {
      answer = { ok: false, refusal };
      const response = await ask({ leaseId: "wl_1", holder: "runner-a" });
      expect(response.status, refusal).toBe(status);
      const body = (await response.json()) as { code: string };
      expect(body.code, refusal).toBe(code);
      expect(body, refusal).not.toHaveProperty("detail");
    }
  });
});
