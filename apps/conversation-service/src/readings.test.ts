/**
 * The CV reader's two routes: the certificate, the lease in the body, and the
 * driver's answers mapped to the published codes (ADR-0148 §9, P246).
 *
 * The driver's own behaviour is proved against Postgres in
 * `run-driver.test.ts`; this file proves the ROUTES.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";

import type { ClaimedReading, ReadingReport } from "@askimate/aas-contracts";

import type { ConversationEventStore } from "./event-store.js";
import type { RunCoordinator } from "./routes.js";
import { createConversationRoutes } from "./routes.js";

function portOf(listening: Server): number {
  const address = listening.address();
  if (address === null || typeof address === "string") throw new Error("server has no TCP port");
  return address.port;
}

const CLAIMED: ClaimedReading = {
  leaseId: "rl_1",
  expiresAt: "2026-09-28T20:05:00Z",
  documentId: "01JQDOC0000000000000000001",
  conversationId: "01JBXQ8Z9WKTQ6M4H2NPX23701",
  documentType: "cv",
  contentType: "application/pdf",
  contentHash: "b".repeat(64),
  retrieval: { url: "https://vault.test/cv", method: "GET", expiresAt: "2026-09-28T20:01:00Z" },
};

let server: Server;
let BASE = "";
let claimAnswer: ClaimedReading | null = CLAIMED;
let reportAnswer = true;
const asked: unknown[] = [];

beforeAll(async () => {
  const runs = {
    claimReading: (input: unknown) => {
      asked.push({ claim: input });
      return Promise.resolve(claimAnswer);
    },
    reportReading: (input: unknown) => {
      asked.push({ report: input });
      return Promise.resolve(reportAnswer);
    },
  } as unknown as RunCoordinator;
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(
    createConversationRoutes({
      store: {} as unknown as ConversationEventStore,
      authenticate: () => null,
      authorise: () => Promise.resolve(false),
      authoriseService: (req) => req.header("x-service-cert") === "reader",
      runs,
      now: () => new Date("2026-09-28T20:00:00Z"),
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  BASE = `http://127.0.0.1:${String(portOf(server))}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown, cert = "reader"): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-service-cert": cert }, body: JSON.stringify(body) });
}

describe("POST /internal/v1/readings/claims", () => {
  it("leases a document to the reader, uncacheable, with the lease seconds clamped by the plane", async () => {
    claimAnswer = CLAIMED;
    const response = await post("/internal/v1/readings/claims", { holder: "reader-1", leaseSeconds: 100_000 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(CLAIMED);
    expect(asked.at(-1)).toEqual({ claim: { holder: "reader-1", leaseSeconds: 600 } });
  });

  it("answers 204 when nothing waits — a successful poll", async () => {
    claimAnswer = null;
    const response = await post("/internal/v1/readings/claims", { holder: "reader-1" });
    expect(response.status).toBe(204);
    expect(asked.at(-1)).toEqual({ claim: { holder: "reader-1", leaseSeconds: 300 } });
  });

  it("REFUSES without the certificate, before the driver is asked, and a body without a holder", async () => {
    const before = asked.length;
    expect((await post("/internal/v1/readings/claims", { holder: "reader-1" }, "runner")).status).toBe(403);
    expect(asked.length).toBe(before);
    const bad = await post("/internal/v1/readings/claims", {});
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { pointers: string[] }).pointers).toEqual(["/holder"]);
  });
});

describe("POST /internal/v1/readings/:documentId/report", () => {
  const READ: ReadingReport = {
    leaseId: "rl_1",
    outcome: "read",
    lists: [{ fieldKey: "education.prior_qualifications", entries: [{ index: 1, fields: { subject: "Computer science" }, spans: { subject: "Subject: Computer science" }, confidence: 0.9, toAsk: ["countryCode"] }], dropped: 0 }],
  };

  it("records a report, passing the document id from the path and the lease from the body", async () => {
    reportAnswer = true;
    const response = await post("/internal/v1/readings/01JQDOC0000000000000000001/report", READ);
    expect(response.status).toBe(204);
    expect(asked.at(-1)).toEqual({ report: { documentId: "01JQDOC0000000000000000001", report: READ } });
  });

  it("answers 403 when the driver says the caller does not hold the lease", async () => {
    reportAnswer = false;
    expect((await post("/internal/v1/readings/01JQDOC0000000000000000001/report", READ)).status).toBe(403);
  });

  it("REFUSES a half-written report, naming the fields, before the driver is asked", async () => {
    const before = asked.length;
    for (const body of [
      { leaseId: "rl_1", outcome: "read" },
      { leaseId: "rl_1", outcome: "failed" },
      { leaseId: "rl_1", outcome: "read", lists: [], failure: "unreadable" },
      { leaseId: "rl_1", outcome: "read", lists: [{ fieldKey: "employment.history", entries: [{ index: 1, fields: { position: "x" }, spans: {}, confidence: 1, toAsk: [] }], dropped: 0 }] },
    ]) {
      const response = await post("/internal/v1/readings/01JQDOC0000000000000000001/report", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { pointers: string[] }).pointers).toEqual(["/leaseId", "/outcome", "/lists"]);
    }
    expect(asked.length).toBe(before);
  });
});
