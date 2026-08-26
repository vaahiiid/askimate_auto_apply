/**
 * Tests for the task model.
 */

import { describe, expect, it } from "vitest";

import { taskId } from "./ids.js";
import type { Task, TaskKind } from "./tasks.js";
import { assigneeFor, blockingTasks, blocksProgressByDefault, isUnblocked, openTasks } from "./tasks.js";

function task(overrides: Partial<Task> & Pick<Task, "taskId">): Task {
  return {
    kind: "provide_document",
    assignee: "student",
    description: "Passport",
    blocksProgress: true,
    status: "open",
    raisedAt: new Date("2026-08-26T10:00:00Z"),
    ...overrides,
  };
}

describe("task routing", () => {
  it("sends student-facing work to the student", () => {
    expect(assigneeFor("provide_document")).toBe("student");
    expect(assigneeFor("confirm_extracted_data")).toBe("student");
    expect(assigneeFor("authorise_submission")).toBe("student");
  });

  it("sends review work to a specialist", () => {
    expect(assigneeFor("human_review")).toBe("specialist");
  });

  it("keeps requirement revalidation with the system", () => {
    expect(assigneeFor("revalidate_requirement")).toBe("system");
  });

  it("routes every task kind somewhere", () => {
    const kinds: readonly TaskKind[] = [
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
    for (const kind of kinds) {
      expect(["student", "specialist", "system"]).toContain(assigneeFor(kind));
    }
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
