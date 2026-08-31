/**
 * `withSecret` — the only sanctioned writer of `RunState.secret`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `RunState.secret` has existed since the secret channel was designed, and
 * until P1 nothing could write it. What matters about the writer is not that it
 * assigns a field — it is that it REFUSES: a run state that resurrected a spent
 * handle would hand it to an automation that then tried to spend it again, and
 * the vault would refuse, and a student would be asked for a password they had
 * already given.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { studentId } from "@askimate/aas-domain";
import { newInterview } from "@askimate/aas-interview";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import { emptyProfile } from "@askimate/aas-profile";
import type { SecretHandle, SecretRequestId } from "@askimate/aas-secrets";

import { IllegalSecretTransitionError, beginRun, withSecret } from "./run.js";
import type { RunState } from "./run.js";

const NOW = new Date("2026-08-31T10:00:00Z");
const STUDENT = studentId("student-1");
const REQUEST = `sr_${"a".repeat(32)}` as SecretRequestId;
const OTHER_REQUEST = `sr_${"b".repeat(32)}` as SecretRequestId;
const HANDLE = `sh_${"c".repeat(32)}` as SecretHandle;

function fresh(): RunState {
  const profile = emptyProfile(STUDENT, NOW);
  return beginRun({
    inputs: {
      caseId: "case-1",
      studentRef: STUDENT,
      blueprint: FIXTURE_BLUEPRINT,
      mappingSet: FIXTURE_MAPPING_SET,
      documents: new Map(),
    },
    profile,
    interview: newInterview({
      studentRef: STUDENT,
      profile,
      requiredFields: [],
      requiredDocuments: [],
    }),
  });
}

describe("recording where a student's password has got to", () => {
  it("records the request, with no handle, and does not mutate the run it was given", () => {
    const before = fresh();
    const after = withSecret(before, { requestId: REQUEST, lifecycle: "secret_requested" });

    expect(after.secret).toEqual({ requestId: REQUEST, lifecycle: "secret_requested" });
    // Immutability, asserted rather than assumed: every other transition helper
    // returns a new state, and a caller holding the old one must still see it.
    expect(before.secret).toBeUndefined();
    expect(after).not.toBe(before);
  });

  it("carries four words and an opaque handle, and has nowhere to put a password", () => {
    const state = withSecret(
      withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" }),
      { requestId: REQUEST, lifecycle: "secret_received", handle: HANDLE },
    );
    expect(Object.keys(state.secret ?? {}).sort()).toEqual(["handle", "lifecycle", "requestId"]);
    // The handle reveals nothing: `sh_` plus randomness, derived from nothing.
    expect(state.secret?.handle).toMatch(/^sh_[0-9a-f]{32}$/);
  });

  it("walks the lifecycle the secure plane publishes", () => {
    let state = withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" });
    state = withSecret(state, { requestId: REQUEST, lifecycle: "secret_received", handle: HANDLE });
    state = withSecret(state, { requestId: REQUEST, lifecycle: "secret_consumed", handle: HANDLE });
    expect(state.secret?.lifecycle).toBe("secret_consumed");
  });

  it("REFUSES to move out of a settled secret", () => {
    // Nothing leads out of `secret_consumed`. Single-use is the vault's
    // property; this is what stops run state disagreeing with it.
    const spent = withSecret(
      withSecret(
        withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" }),
        { requestId: REQUEST, lifecycle: "secret_received", handle: HANDLE },
      ),
      { requestId: REQUEST, lifecycle: "secret_consumed", handle: HANDLE },
    );

    expect(() =>
      withSecret(spent, { requestId: REQUEST, lifecycle: "secret_received", handle: HANDLE }),
    ).toThrow(IllegalSecretTransitionError);
  });

  it("accepts the SAME word twice, because deliveries are at-least-once", () => {
    // The lifecycle arrives through a transactional outbox that retries until
    // the conversation plane confirms. A duplicate delivery must be a no-op,
    // not an error, or a retry would break a run that is perfectly fine.
    const once = withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" });
    const twice = withSecret(once, { requestId: REQUEST, lifecycle: "secret_requested" });
    expect(twice.secret).toEqual(once.secret);
  });

  it("REFUSES a second request while the first is still live", () => {
    // A run has one open secure step at a time. Replacing a live
    // `secret_requested` would abandon a box the student may be typing into.
    const open = withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" });
    expect(() =>
      withSecret(open, { requestId: OTHER_REQUEST, lifecycle: "secret_requested" }),
    ).toThrow(IllegalSecretTransitionError);
  });

  it("ALLOWS a second request once the first has expired", () => {
    // The one case `secretStepFor` re-opens on. A student whose five minutes
    // ran out is asked again, and the new request is a different one.
    const expired = withSecret(
      withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" }),
      { requestId: REQUEST, lifecycle: "secret_expired" },
    );
    const reopened = withSecret(expired, {
      requestId: OTHER_REQUEST,
      lifecycle: "secret_requested",
    });
    expect(reopened.secret).toEqual({
      requestId: OTHER_REQUEST,
      lifecycle: "secret_requested",
    });
  });

  it("REFUSES a handle before the student has answered", () => {
    // The same rule the secure plane's own schema states as
    // `a_handle_means_it_was_answered`. A handle at `secret_requested`
    // describes something that has not happened.
    expect(() =>
      withSecret(fresh(), {
        requestId: REQUEST,
        lifecycle: "secret_requested",
        handle: HANDLE,
      }),
    ).toThrow(IllegalSecretTransitionError);
  });

  it("names both ends of a refused move, so the error says what went wrong", () => {
    const open = withSecret(fresh(), { requestId: REQUEST, lifecycle: "secret_requested" });
    try {
      withSecret(open, { requestId: REQUEST, lifecycle: "secret_requested", handle: HANDLE });
      expect.unreachable("the transition should have been refused");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IllegalSecretTransitionError);
      const refusal = error as IllegalSecretTransitionError;
      expect(refusal.from).toBe("secret_requested");
      expect(refusal.to).toBe("secret_requested");
      // The message explains the RULE. It never quotes a value, because there
      // is no value here to quote — which is the point of the whole design.
      expect(refusal.message).toContain("a_handle_means_it_was_answered");
    }
  });
});
