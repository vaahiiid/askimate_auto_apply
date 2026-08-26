/**
 * Tests for the task model.
 */

import { describe, expect, it } from "vitest";

import { taskId } from "./ids.js";
import type { Task, TaskKind } from "./tasks.js";
import {
  STUDENT_OWNED_KINDS,
  blockingTasks,
  blocksProgressByDefault,
  isConversationalAsk,
  isUnblocked,
  openTasks,
  ownerFor,
  sourceFor,
} from "./tasks.js";

const ALL_KINDS: readonly TaskKind[] = [
  "provide_profile_field",
  "provide_document",
  "confirm_extracted_data",
  "replace_expired_document",
  "resolve_conflict",
  "human_review",
  "complete_handoff",
  "authorise_submission",
  "revalidate_requirement",
];

function task(overrides: Partial<Task> & Pick<Task, "taskId">): Task {
  return {
    kind: "provide_document",
    owner: "agent",
    description: "Passport",
    blocksProgress: true,
    status: "open",
    raisedAt: new Date("2026-08-26T10:00:00Z"),
    ...overrides,
  };
}

describe("the student never fills in a form (ADR-0007)", () => {
  it("owns every information-gathering task with the AGENT, not the student", () => {
    // THE rule. The agent must obtain these by interviewing the student. They
    // are not work items handed to the student to complete.
    expect(ownerFor("provide_profile_field")).toBe("agent");
    expect(ownerFor("provide_document")).toBe("agent");
    expect(ownerFor("confirm_extracted_data")).toBe("agent");
    expect(ownerFor("replace_expired_document")).toBe("agent");
    expect(ownerFor("resolve_conflict")).toBe("agent");
    expect(ownerFor("revalidate_requirement")).toBe("agent");
  });

  it("allows EXACTLY two student-owned task kinds, and no more", () => {
    // The load-bearing invariant. If a future change makes a third kind
    // student-owned, this fails and forces the conversation — rather than the
    // product quietly drifting back towards making students fill in forms.
    expect([...STUDENT_OWNED_KINDS].sort()).toEqual(["authorise_submission", "complete_handoff"]);

    const studentOwned = ALL_KINDS.filter((kind) => ownerFor(kind) === "student");
    expect(studentOwned.sort()).toEqual(["authorise_submission", "complete_handoff"]);
  });

  it("keeps those two student-owned only because brief §7 requires them", () => {
    // A handoff is an action only the student can legitimately perform (MFA,
    // OTP, CAPTCHA, payment, a legal declaration) and must never be bypassed.
    expect(ownerFor("complete_handoff")).toBe("student");
    // Authorisation is REVIEWING what will be submitted, not completing it.
    expect(ownerFor("authorise_submission")).toBe("student");
  });

  it("sends review work to a specialist", () => {
    expect(ownerFor("human_review")).toBe("specialist");
  });

  it("routes every task kind to an owner", () => {
    for (const kind of ALL_KINDS) {
      expect(["agent", "specialist", "student"]).toContain(ownerFor(kind));
    }
  });
});

describe("where the agent obtains information", () => {
  it("asks the student in conversation for profile facts", () => {
    expect(sourceFor("provide_profile_field")).toBe("student_conversation");
    expect(sourceFor("resolve_conflict")).toBe("student_conversation");
    expect(isConversationalAsk("provide_profile_field")).toBe(true);
  });

  it("requests a document when a document is what is needed", () => {
    expect(sourceFor("provide_document")).toBe("student_document");
    expect(sourceFor("replace_expired_document")).toBe("student_document");
    expect(isConversationalAsk("provide_document")).toBe(false);
  });

  it("plays extracted facts back in conversation for confirmation", () => {
    // Extract-then-confirm happens in the interview, not on a form.
    expect(sourceFor("confirm_extracted_data")).toBe("student_conversation");
    expect(isConversationalAsk("confirm_extracted_data")).toBe(true);
  });

  it("looks requirement data up externally rather than asking the student", () => {
    expect(sourceFor("revalidate_requirement")).toBe("external_source");
  });

  it("gives every agent-owned task a source to obtain it from", () => {
    // An agent-owned task with no source would be one the agent has no defined
    // way to close.
    for (const kind of ALL_KINDS) {
      if (ownerFor(kind) === "agent") {
        expect(sourceFor(kind)).toBeDefined();
      }
    }
  });

  it("gives student- and specialist-owned tasks no information source", () => {
    expect(sourceFor("complete_handoff")).toBeUndefined();
    expect(sourceFor("authorise_submission")).toBeUndefined();
    expect(sourceFor("human_review")).toBeUndefined();
  });
});

describe("what blocks progress", () => {
  it("blocks on anything the application cannot be completed without", () => {
    expect(blocksProgressByDefault("provide_document")).toBe(true);
    expect(blocksProgressByDefault("authorise_submission")).toBe(true);
    expect(blocksProgressByDefault("resolve_conflict")).toBe(true);
  });

  it("does not block on requirement revalidation", () => {
    // Worth refreshing, but the case can keep preparing meanwhile.
    expect(blocksProgressByDefault("revalidate_requirement")).toBe(false);
  });
});

describe("task queries", () => {
  it("lists only open tasks", () => {
    const tasks = [
      task({ taskId: taskId("t1") }),
      task({ taskId: taskId("t2"), status: "done" }),
      task({ taskId: taskId("t3"), status: "cancelled" }),
    ];
    expect(openTasks(tasks).map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("lists only open AND blocking tasks", () => {
    const tasks = [
      task({ taskId: taskId("t1") }),
      task({ taskId: taskId("t2"), blocksProgress: false }),
      task({ taskId: taskId("t3"), status: "done" }),
    ];
    expect(blockingTasks(tasks).map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("reports unblocked when nothing open is blocking", () => {
    expect(isUnblocked([])).toBe(true);
    expect(isUnblocked([task({ taskId: taskId("t1"), status: "done" })])).toBe(true);
    expect(isUnblocked([task({ taskId: taskId("t1"), blocksProgress: false })])).toBe(true);
    expect(isUnblocked([task({ taskId: taskId("t1") })])).toBe(false);
  });

  it("treats a superseded task as not blocking", () => {
    expect(isUnblocked([task({ taskId: taskId("t1"), status: "superseded" })])).toBe(true);
  });
});
