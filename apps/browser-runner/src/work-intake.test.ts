/**
 * The runner asks for work, does it, and says how it went.
 *
 * Against a REAL `node:http` server rather than a stubbed `fetch`, because the
 * things worth proving here are HTTP facts: that `204` means "nothing to do"
 * rather than an error, that a refused report is not retried into a loop, and
 * that the service certificate is on every request. A stubbed fetch would prove
 * the code calls a function.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ClaimedWork } from "@askimate/aas-contracts";

import { httpWorkIntake, runOneTurn, type WorkIntake, type WorkPerformer } from "./work-intake.js";

const HANDLE = `sh_${"b".repeat(32)}`;

const WORK: ClaimedWork = {
  leaseId: "wl_1",
  expiresAt: "2026-08-31T10:02:00.000Z",
  runId: "run_case_1_1",
  caseId: "case_1",
  studentRef: "11111111-1111-1111-1111-111111111111",
  kind: "create_account",
  portalHost: "gated.portal.test",
  email: "niloofar@example.test",
  approach: "student_chosen",
  secretHandle: HANDLE,
  registration: {
    url: "https://gated.portal.test/register",
    emailLocator: { strategy: "label", value: "Email address" },
    passwordLocators: [
      { strategy: "name", value: "password" },
      { strategy: "name", value: "password_confirm" },
    ],
    submitLocator: { strategy: "role", value: "button:Create account" },
  },
};

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly cert: string | undefined;
  readonly body: string;
}

let server: Server;
let baseUrl: string;
let received: Recorded[] = [];
/** What the next claim answers: a work item, or nothing. */
let offer: ClaimedWork | null = null;
/** Whether the next report is accepted. */
let acceptReports = true;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        cert: request.headers["x-service-cert"] as string | undefined,
        body,
      });
      if ((request.url ?? "").endsWith("/work/claims")) {
        if (offer === null) {
          response.writeHead(204).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(offer));
        return;
      }
      if ((request.url ?? "").includes("/report")) {
        response.writeHead(acceptReports ? 204 : 403).end();
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function intake(): WorkIntake {
  received = [];
  return httpWorkIntake({ baseUrl, holder: "runner-under-test", serviceToken: "runner-cert" });
}

describe("claiming work over the internal API", () => {
  it("reads a 204 as 'nothing to do', not as a failure", async () => {
    offer = null;
    const claimed = await intake().claim();
    expect(claimed).toBeNull();
    // It DID ask — a null that came from never calling would pass an assertion
    // about the answer while proving nothing about the poll.
    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe("POST");
  });

  it("presents its service certificate on every request", async () => {
    offer = WORK;
    const client = intake();
    await client.claim();
    await client.report(WORK.runId, { leaseId: WORK.leaseId, outcome: "succeeded" });
    expect(received).toHaveLength(2);
    for (const call of received) expect(call.cert).toBe("runner-cert");
  });

  it("names itself, so an operator can see which runner holds a run", async () => {
    offer = WORK;
    const client = intake();
    await client.claim();
    expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({
      holder: "runner-under-test",
    });
  });

  it("refuses a work item the plane had no business sending", async () => {
    // The parser rebuilds field by field, so a plane that answered with an
    // extra field has nowhere to put it — and one that answered with a
    // malformed handle is refused outright rather than passed to the fill agent.
    offer = { ...WORK, secretHandle: "not-a-handle" };
    expect(await intake().claim()).toBeNull();

    offer = { ...WORK, kind: "submit_application" as ClaimedWork["kind"] };
    expect(await intake().claim(), "there is no work kind that submits").toBeNull();
  });

  it("survives a plane that is not there", async () => {
    const unreachable = httpWorkIntake({
      baseUrl: "http://127.0.0.1:1",
      holder: "runner-under-test",
    });
    // A quiet null. A poll against a plane that is restarting must not take the
    // runner down with it.
    expect(await unreachable.claim()).toBeNull();
    expect(await unreachable.report("run_1", { leaseId: "wl_1", outcome: "succeeded" })).toBe(
      false,
    );
  });
});

describe("one turn of the loop", () => {
  it("does nothing at all when there is nothing to do", async () => {
    offer = null;
    let asked = 0;
    const perform: WorkPerformer = () => {
      asked += 1;
      return Promise.resolve({ kind: "succeeded" as const });
    };
    expect(await runOneTurn(intake(), perform)).toEqual({ kind: "idle" });
    expect(asked, "an idle poll must not open a browser").toBe(0);
  });

  it("performs the work it was given, and reports how it went", async () => {
    offer = WORK;
    acceptReports = true;
    const seen: ClaimedWork[] = [];
    const result = await runOneTurn(intake(), (work) => {
      seen.push(work);
      return Promise.resolve({ kind: "succeeded" });
    });
    expect(seen).toEqual([WORK]);
    expect(result).toEqual({
      kind: "worked",
      runId: WORK.runId,
      report: { leaseId: WORK.leaseId, outcome: "succeeded" },
    });
    const report = received.find((call) => call.url.includes("/report"));
    expect(JSON.parse(report?.body ?? "{}")).toEqual({
      leaseId: "wl_1",
      outcome: "succeeded",
    });
  });

  it("reports a THROWN performer as uncertain, never as a clean failure", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property this phase turns on. A performer that throws means this
    // process does not know what the browser managed before it stopped —
    // possibly an account exists on a real university's portal. `failed` would
    // claim nothing happened out there, which is a claim about somebody else's
    // database that this system is not entitled to make.
    // ═══════════════════════════════════════════════════════════════════
    offer = WORK;
    acceptReports = true;
    const result = await runOneTurn(intake(), () => {
      throw new Error("the browser died holding niloofar@example.test's session");
    });
    expect(result).toEqual({
      kind: "worked",
      runId: WORK.runId,
      report: { leaseId: WORK.leaseId, outcome: "uncertain", failure: "runner_fault" },
    });

    // And the thrown error's text — which came from a page and a session — is
    // nowhere on the wire. There is no field it could go in, which is why.
    const report = received.find((call) => call.url.includes("/report"));
    expect(report?.body).not.toContain("niloofar");
    expect(report?.body).not.toContain("browser died");
  });

  it("does not swallow the work when the plane refuses the report", async () => {
    offer = WORK;
    acceptReports = false;
    const result = await runOneTurn(intake(), () =>
      Promise.resolve({ kind: "failed", failure: "portal_drift" }),
    );
    // Named, so a caller can log it and a lease that was taken over is visible.
    // Silently returning `worked` would hide a runner that had been superseded
    // mid-action and kept going.
    expect(result).toEqual({ kind: "report_refused", runId: WORK.runId });
    acceptReports = true;
  });

  it("claims ONE unit of work per turn", async () => {
    offer = WORK;
    await runOneTurn(intake(), () => Promise.resolve({ kind: "succeeded" }));
    const claims = received.filter((call) => call.url.endsWith("/work/claims"));
    // A batch would mean holding leases on work this runner had not started,
    // and stranding every one of those runs for the lease duration if it died.
    expect(claims).toHaveLength(1);
  });
});
