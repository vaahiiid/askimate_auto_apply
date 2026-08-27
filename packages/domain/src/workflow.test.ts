/**
 * The run model, and the one property that keeps a checkpoint from becoming a
 * second source of truth.
 *
 * The `@ts-expect-error` assertions here are the load-bearing ones. Rule 3 of
 * the approved architecture — *a checkpoint must NOT become a second competing
 * source of truth for business facts* — is enforced by `CheckpointValue`
 * admitting only primitives, and these prove it.
 *
 * Note the lesson from ADR-0004's amendment: a `@ts-expect-error` proves that
 * ONE illegal assignment is illegal, and nothing more. It cannot prove nobody
 * added an escape hatch elsewhere. The boundary check in
 * `scripts/check-boundaries.ts` is the other half, and both are needed.
 */

import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_SCHEMA_VERSION,
  CONSEQUENTIAL_ACTIONS,
  WORKFLOW_PHASES,
  WORKFLOW_STATUSES,
  assessIntent,
  beginCheckpoint,
  canTransitionStatus,
  idempotencyKeyFor,
  isReadableCheckpoint,
  isTerminalStatus,
  isVerifiable,
  runId,
} from "./workflow.js";
import type { CheckpointDetail, WorkflowCheckpoint } from "./workflow.js";
import { blueprintVersion } from "./ids.js";
import type { ConfirmedValue } from "./values.js";

const NOW = new Date("2026-08-27T10:00:00Z");
const VERSION = blueprintVersion("ulster-msc-ib-v3");
const RUN = runId("run_1");

// ───────────────────────────────────────────────────────────────────────────
// Rule 3, enforced by the type system
// ───────────────────────────────────────────────────────────────────────────

describe("a checkpoint holds POSITION, never FACTS", () => {
  it("accepts primitives", () => {
    const detail: CheckpointDetail = {
      pageIndex: 3,
      lastFieldRef: "given_name",
      awaitingStudent: true,
      previousAttempt: null,
    };
    expect(Object.keys(detail)).toHaveLength(4);
  });

  it("refuses a ConfirmedValue — the thing a student agreed to", () => {
    const confirmed = "Niloofar" as unknown as ConfirmedValue<string>;
    // @ts-expect-error — a ConfirmedValue is a business fact. It belongs in the
    // profile and, by reference, in the event log. A copy inside a checkpoint
    // would be a second source of truth for what the student agreed to, which
    // is exactly what rule 3 forbids.
    const detail: CheckpointDetail = { answer: confirmed };
    void detail;
  });

  it("refuses a nested object — the shape every fact arrives in", () => {
    // @ts-expect-error — nesting is how a fact gets in. `{ profile: {...} }`,
    // `{ document: {...} }`, `{ preview: {...} }` — all blocked by admitting
    // primitives only.
    const detail: CheckpointDetail = { profile: { givenName: "Niloofar" } };
    void detail;
  });

  it("refuses an array of anything but a primitive", () => {
    // @ts-expect-error — an array of objects is a nested object wearing a hat.
    const detail: CheckpointDetail = { entries: [{ key: "a" }] };
    void detail;
  });

  it("refuses a Date — because a Date in `detail` is almost always a fact", () => {
    // The checkpoint has exactly one timestamp, `capturedAt`, and it is about
    // the checkpoint. Any other date is when something HAPPENED, which is an
    // event.
    // @ts-expect-error — dates in `detail` are business facts.
    const detail: CheckpointDetail = { authorisedAt: NOW };
    void detail;
  });

  it("still records real position, so this is not passing by forbidding everything", () => {
    const checkpoint = beginCheckpoint({ blueprintVersion: VERSION, now: NOW });
    expect(checkpoint.phase).toBe("preparing_inputs");
    expect(checkpoint.fieldsCompleted).toEqual([]);
    expect(checkpoint.blueprintVersion).toBe(VERSION);
    expect(checkpoint.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Status
// ───────────────────────────────────────────────────────────────────────────

describe("run status", () => {
  it("has exactly the six states, and two are terminal", () => {
    expect([...WORKFLOW_STATUSES]).toEqual([
      "running",
      "suspended",
      "uncertain",
      "escalated",
      "completed",
      "abandoned",
    ]);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("abandoned")).toBe(true);
  });

  it("NEVER lets `uncertain` become `completed` without someone finding out", () => {
    // The single most important transition rule here. "We do not know whether
    // the account was created" cannot become "it worked" by any path that does
    // not involve verification (→ running) or a human (→ escalated).
    expect(canTransitionStatus("uncertain", "completed")).toBe(false);
    expect(canTransitionStatus("uncertain", "running")).toBe(true);
    expect(canTransitionStatus("uncertain", "escalated")).toBe(true);
  });

  it("does not let a terminal run start again", () => {
    for (const to of WORKFLOW_STATUSES) {
      expect(canTransitionStatus("completed", to), `completed → ${to}`).toBe(false);
      expect(canTransitionStatus("abandoned", to), `abandoned → ${to}`).toBe(false);
    }
  });

  it("lets a suspended run resume", () => {
    expect(canTransitionStatus("suspended", "running")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Consequential actions
// ───────────────────────────────────────────────────────────────────────────

describe("consequential actions", () => {
  it("names every action whose effect leaves this system", () => {
    expect([...CONSEQUENTIAL_ACTIONS]).toEqual([
      "create_portal_account",
      "attach_document",
      "advance_portal_page",
      "consume_secret",
      "submit_application",
    ]);
  });

  it("does NOT list filling a field, which is idempotent and verifiable", () => {
    expect(CONSEQUENTIAL_ACTIONS).not.toContain("fill_field");
  });

  it("knows which actions can be checked afterwards, and which cannot", () => {
    expect(isVerifiable("create_portal_account")).toBe(true);
    expect(isVerifiable("attach_document")).toBe(true);
    expect(isVerifiable("advance_portal_page")).toBe(true);
    // The hard ones. A spent handle leaves nothing to look at, and submission
    // is the most consequential act in the system.
    expect(isVerifiable("consume_secret")).toBe(false);
    expect(isVerifiable("submit_application")).toBe(false);
  });

  it("derives an idempotency key that survives a restart", () => {
    // Derived, never random. A random key regenerated after a crash would not
    // match the intent record written before it, and the whole mechanism would
    // silently do nothing.
    const first = idempotencyKeyFor({
      runId: RUN,
      action: "create_portal_account",
      target: "apply.example.ac.uk",
    });
    const again = idempotencyKeyFor({
      runId: RUN,
      action: "create_portal_account",
      target: "apply.example.ac.uk",
    });
    expect(first).toBe(again);

    expect(
      idempotencyKeyFor({ runId: RUN, action: "attach_document", target: "apply.example.ac.uk" }),
    ).not.toBe(first);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The intent verdict — where "just retry it" would live if it existed
// ───────────────────────────────────────────────────────────────────────────

describe("what a resume does about an unfinished action", () => {
  const intentFor = (action: Parameters<typeof isVerifiable>[0]) => ({
    idempotencyKey: idempotencyKeyFor({ runId: RUN, action, target: "apply.example.ac.uk" }),
    action,
    target: "apply.example.ac.uk",
    startedAt: NOW,
  });

  it("crash BEFORE the action: it provably did not happen", () => {
    expect(assessIntent({})).toEqual({ kind: "not_started" });
  });

  it("crash AFTER we recorded completion: do not repeat", () => {
    const verdict = assessIntent({
      intent: intentFor("create_portal_account"),
      completed: { outcome: "succeeded" },
    });
    expect(verdict).toEqual({ kind: "already_done", outcome: "succeeded" });
  });

  it("crash DURING a verifiable action: look before acting", () => {
    const verdict = assessIntent({ intent: intentFor("create_portal_account") });
    expect(verdict.kind).toBe("verify_first");
  });

  it("crash DURING an unverifiable action: ESCALATE, never repeat", () => {
    // The case the whole phase exists for. A secret may have been spent; there
    // is nothing to look at; repeating means asking a student for a second
    // password and possibly setting it on an account that already has one.
    const verdict = assessIntent({ intent: intentFor("consume_secret") });
    expect(verdict.kind).toBe("escalate");
    if (verdict.kind !== "escalate") return;
    expect(verdict.why).toContain("cannot be checked");
    expect(verdict.why).toContain("specialist");
  });

  it("has NO verdict that means retry — checked exhaustively", () => {
    // If someone adds a `{ kind: "retry" }` branch, this fails. The absence of
    // that branch IS the safety property, and an absence needs a test or it is
    // just a thing nobody has done yet.
    const kinds = new Set<string>();
    for (const action of CONSEQUENTIAL_ACTIONS) {
      kinds.add(assessIntent({ intent: intentFor(action) }).kind);
      kinds.add(
        assessIntent({ intent: intentFor(action), completed: { outcome: "succeeded" } }).kind,
      );
      kinds.add(assessIntent({}).kind);
    }
    expect([...kinds].sort()).toEqual(["already_done", "escalate", "not_started", "verify_first"]);
    expect(kinds.has("retry")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reading a checkpoint back
// ───────────────────────────────────────────────────────────────────────────

describe("a checkpoint from storage", () => {
  const valid: WorkflowCheckpoint = {
    schemaVersion: 1,
    phase: "filling",
    fieldsCompleted: ["given_name", "family_name"],
    blueprintVersion: VERSION,
    detail: { pageIndex: 2 },
    capturedAt: NOW,
  };

  it("is readable when this build wrote it", () => {
    expect(isReadableCheckpoint(valid)).toBe(true);
  });

  it("is DISCARDED when the schema version differs", () => {
    // Either direction. A checkpoint from a future build is as unreadable as
    // one from a past build, and guessing at either produces confident wrong
    // behaviour instead of an obvious restart.
    expect(isReadableCheckpoint({ ...valid, schemaVersion: 2 })).toBe(false);
    expect(isReadableCheckpoint({ ...valid, schemaVersion: 0 })).toBe(false);
    expect(isReadableCheckpoint({ ...valid, schemaVersion: "1" })).toBe(false);
  });

  it("is DISCARDED when it is corrupt", () => {
    for (const corrupt of [
      null,
      undefined,
      "not an object",
      42,
      {},
      { ...valid, phase: "inventing_things" },
      { ...valid, fieldsCompleted: "given_name" },
      { ...valid, fieldsCompleted: [1, 2] },
      { ...valid, capturedAt: "2026-08-27T10:00:00Z" },
      { ...valid, blueprintVersion: 3 },
    ]) {
      expect(isReadableCheckpoint(corrupt), JSON.stringify(corrupt)).toBe(false);
    }
  });

  it("names every phase the orchestrator actually has", () => {
    expect(WORKFLOW_PHASES).toContain("interviewing");
    expect(WORKFLOW_PHASES).toContain("awaiting_authorisation");
    expect(WORKFLOW_PHASES).toContain("filling");
    expect(WORKFLOW_PHASES).toHaveLength(10);
  });
});
