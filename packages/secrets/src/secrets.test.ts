/**
 * What the store does, and — mostly — what it refuses.
 *
 * The refusals are the interesting half. A secret store that hands out secrets
 * is easy; the tests worth writing are the ones that pin the six ways a
 * consumption must fail, because each of those is a real incident shape:
 * a handle spent twice, a handle spent late, a handle spent for the wrong
 * student, the wrong purpose, the wrong portal, or by something that could be
 * recording.
 */

import { describe, expect, it } from "vitest";

import { studentId, auditLabel } from "@askimate/aas-domain";

import {
  InMemorySecretStore,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  SECRET_LIFECYCLE,
  canTransition,
  describeSecretUse,
  isSecretHandle,
  isTerminalLifecycle,
  parseSecretHandle,
} from "./index.js";
import type { SecretClaim, SecretConsumer, SecretRequest } from "./index.js";

const STUDENT = studentId("student-1");
const OTHER_STUDENT = studentId("student-2");
const NOW = new Date("2026-08-26T10:00:00Z");
const later = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

const TARGET = { host: "apply.example.ac.uk", caseRef: "case-1" } as const;

const REQUEST: SecretRequest = {
  studentRef: STUDENT,
  purpose: "portal_account_creation",
  target: TARGET,
  explanation: "I need a password to set up your application account.",
  singleUse: true,
  ttlSeconds: 300,
};

/** A consumer that truthfully confirms it captures nothing. */
const SAFE: SecretConsumer = {
  name: auditLabel("test_consumer"),
  confirmNoDiagnosticCapture: () => true,
};

/** One that cannot confirm — what a traced Playwright context looks like. */
const RECORDING: SecretConsumer = {
  name: auditLabel("recording_consumer"),
  confirmNoDiagnosticCapture: () => false,
};

/** Opens a request and answers it. Returns everything a claim needs. */
function armed(
  store: InMemorySecretStore,
  secret: string,
  overrides: Partial<SecretRequest> = {},
): SecretClaim {
  const opened = store.request({ ...REQUEST, ...overrides }, NOW);
  if (!opened.ok) expect.unreachable(`request refused: ${opened.refusal.reason}`);
  const submitted = store.submit(opened.prompt.requestId, secret, NOW);
  if (!submitted.ok) expect.unreachable(`submit refused: ${submitted.reason.kind}`);
  return {
    handle: submitted.handle,
    studentRef: overrides.studentRef ?? STUDENT,
    purpose: overrides.purpose ?? "portal_account_creation",
    target: overrides.target ?? TARGET,
  };
}

// ───────────────────────────────────────────────────────────────────────────

describe("asking for a secret", () => {
  it("returns a prompt for a dedicated control, not a chat message", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");

    // The discriminant a chat client checks before rendering. A client that
    // does not understand it must refuse rather than print the title as text.
    expect(opened.prompt.channel).toBe("secure_control");
    expect(opened.prompt.title).toBe("Create a password for your university application");
    expect(opened.prompt.requiresConfirmation).toBe(true);
    expect(opened.prompt.expiresAt).toEqual(later(300));
  });

  it("asks for a confirmation box on creation but not on sign-in", () => {
    // A typo when creating an account is an account nobody can get into. A
    // typo when signing in is a message from the portal, one second later.
    const store = new InMemorySecretStore();
    const signIn = store.request({ ...REQUEST, purpose: "portal_sign_in" }, NOW);
    if (!signIn.ok) expect.unreachable("should open");
    expect(signIn.prompt.requiresConfirmation).toBe(false);
    expect(signIn.prompt.title).toBe("Enter your university portal password");
  });

  it("shows only password rules that were actually observed", () => {
    const store = new InMemorySecretStore();
    const none = store.request(REQUEST, NOW);
    if (!none.ok) expect.unreachable("should open");
    // An invented rule is a small lie that makes a student pick a worse
    // password, so the default is to say nothing.
    expect(none.prompt.observedRules).toEqual([]);

    const observed = store.request(REQUEST, NOW, ["At least 8 characters"]);
    if (!observed.ok) expect.unreachable("should open");
    expect(observed.prompt.observedRules).toEqual(["At least 8 characters"]);
  });

  it("refuses a TTL longer than the ceiling", () => {
    const store = new InMemorySecretStore();
    const opened = store.request({ ...REQUEST, ttlSeconds: MAX_TTL_SECONDS + 1 }, NOW);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusal.reason).toBe("ttl_too_long");
  });

  it("refuses a TTL too short for a student to type twice", () => {
    const store = new InMemorySecretStore();
    const opened = store.request({ ...REQUEST, ttlSeconds: MIN_TTL_SECONDS - 1 }, NOW);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusal.reason).toBe("ttl_too_short");
  });

  it("refuses an unexplained password box", () => {
    const store = new InMemorySecretStore();
    const opened = store.request({ ...REQUEST, explanation: "   " }, NOW);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusal.reason).toBe("explanation_missing");
    // An unexplained password box in a chat window is indistinguishable from
    // a phishing attempt, and the refusal says so.
    expect(opened.refusal.detail).toContain("phishing");
  });

  it("refuses an explanation with a credential in it", () => {
    // The realistic path to this: a student typed a password into ordinary
    // chat, and the model echoed it back inside the explanation it wrote.
    const store = new InMemorySecretStore();
    const opened = store.request(
      { ...REQUEST, explanation: "Use Hunter2!xYz9 for your account" },
      NOW,
    );
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusal.reason).toBe("explanation_looks_like_a_password");
  });

  it("does not mistake a URL for a credential", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(
      { ...REQUEST, explanation: "See https://apply.example.ac.uk/Help?id=A1b2 for the rules" },
      NOW,
    );
    expect(opened.ok).toBe(true);
  });

  it("refuses a request with no target host to bind to", () => {
    const store = new InMemorySecretStore();
    const opened = store.request({ ...REQUEST, target: { host: "", caseRef: "case-1" } }, NOW);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusal.reason).toBe("target_host_missing");
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe("receiving what the student typed", () => {
  it("returns an opaque handle and nothing else", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    const submitted = store.submit(opened.prompt.requestId, "correct horse battery", NOW);
    if (!submitted.ok) expect.unreachable("should accept");

    expect(isSecretHandle(submitted.handle)).toBe(true);
    expect(submitted.handle).toMatch(/^sh_[0-9a-f]{32}$/);
    // Nothing about the secret is derivable from the handle: not its length,
    // not a hash, not a prefix.
    expect(submitted.handle).not.toContain("correct");
    expect(Object.keys(submitted)).toEqual(["ok", "handle"]);
  });

  it("refuses a second submission for the same request", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    store.submit(opened.prompt.requestId, "first", NOW);
    const second = store.submit(opened.prompt.requestId, "second", NOW);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    // Replacing a secret the automation may be a millisecond from spending is
    // worse than refusing.
    expect(second.reason.kind).toBe("already_submitted");
  });

  it("refuses an empty submission rather than storing one", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    const submitted = store.submit(opened.prompt.requestId, "", NOW);
    expect(submitted.ok).toBe(false);
    if (submitted.ok) return;
    expect(submitted.reason.kind).toBe("empty");
  });

  it("refuses a submission after the request expired, and destroys it", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    const submitted = store.submit(opened.prompt.requestId, "too late", later(301));
    expect(submitted.ok).toBe(false);
    if (submitted.ok) return;
    expect(submitted.reason.kind).toBe("expired");
    expect(store.statusOf(opened.prompt.requestId)?.lifecycle).toBe("secret_expired");
  });

  it("refuses a submission against an id nobody opened", () => {
    const store = new InMemorySecretStore();
    const invented = parseSecretHandle("sh_00000000000000000000000000000000");
    expect(invented).not.toBeNull();
    const submitted = store.submit(
      "sr_00000000000000000000000000000000" as never,
      "x",
      NOW,
    );
    expect(submitted.ok).toBe(false);
    if (submitted.ok) return;
    expect(submitted.reason.kind).toBe("unknown_request");
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe("spending it", () => {
  it("hands the plaintext to the callback and returns the callback's result", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");

    const outcome = await store.use(claim, SAFE, (secret) => secret.length, NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toBe("the-password".length);
  });

  it("destroys it before the callback runs, so a second spend finds nothing", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");

    // Re-entrant: the callback tries to spend the same handle again. This is
    // not contrived — it is the shape a retry inside an error handler takes.
    const inner = await new Promise<boolean>((resolve) => {
      void store.use(
        claim,
        SAFE,
        async () => {
          const again = await store.use(claim, SAFE, () => "second", NOW);
          resolve(again.ok);
        },
        NOW,
      );
    });
    expect(inner).toBe(false);
  });

  it("counts a throwing callback as spent — a failed login is a spent password", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");

    await expect(
      store.use(
        claim,
        SAFE,
        () => {
          throw new Error("the portal rejected it");
        },
        NOW,
      ),
    ).rejects.toThrow("the portal rejected it");

    const retry = await store.use(claim, SAFE, () => "retry", NOW);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.reason.kind).toBe("unknown_handle");
  });

  it("cannot be spent twice concurrently", async () => {
    // Two `use` calls started before either is awaited — the exact shape of a
    // parallel retry, and the one that would be a real bug.
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");

    const [first, second] = await Promise.all([
      store.use(claim, SAFE, () => "a", NOW),
      store.use(claim, SAFE, () => "b", NOW),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });

  it("refuses a handle that has expired, and destroys it", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(claim, SAFE, () => "x", later(301));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("expired");
    expect(store.liveSecretCount).toBe(0);
  });

  it("refuses a handle belonging to another student", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(
      { ...claim, studentRef: OTHER_STUDENT },
      SAFE,
      () => "x",
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("wrong_student");
  });

  it("refuses a handle given for a different purpose", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(
      { ...claim, purpose: "portal_sign_in" },
      SAFE,
      () => "x",
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("wrong_purpose");
  });

  it("refuses a handle bound to a different host — the wrong-site check", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(
      { ...claim, target: { host: "evil.example.com", caseRef: "case-1" } },
      SAFE,
      () => "x",
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("wrong_target");
  });

  it("refuses a handle bound to a different case", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(
      { ...claim, target: { host: TARGET.host, caseRef: "case-99" } },
      SAFE,
      () => "x",
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("wrong_target");
  });

  it("refuses a consumer that cannot confirm it captures nothing", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const outcome = await store.use(claim, RECORDING, () => "x", NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("consumer_may_capture");
    // And the secret is still there — a refused consumption is not a spend.
    expect(store.liveSecretCount).toBe(1);
  });

  it("treats a consumer whose check THROWS as unsafe", async () => {
    // A check that could not complete has not passed. The alternative — the
    // thrown error propagating out of `use` — would look like a bug rather
    // than a refusal, and would tempt someone to wrap the call in a try/catch
    // that carried on regardless.
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");

    const outcome = await store.use(
      claim,
      {
        name: auditLabel("broken_consumer"),
        confirmNoDiagnosticCapture: (): boolean => {
          throw new Error("context already closed");
        },
      },
      () => "x",
      NOW,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe("consumer_may_capture");
    // Refused, not spent.
    expect(store.liveSecretCount).toBe(1);
  });

  it("gives an invented handle and a spent handle the SAME answer", async () => {
    // Distinguishing them would tell a caller that a handle was once real,
    // which is worth nothing to a legitimate caller.
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    await store.use(claim, SAFE, () => "x", NOW);
    const spent = await store.use(claim, SAFE, () => "x", NOW);

    const invented = parseSecretHandle("sh_abcdef0123456789abcdef0123456789");
    expect(invented).not.toBeNull();
    const unknown = await store.use({ ...claim, handle: invented! }, SAFE, () => "x", NOW);

    expect(spent.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (spent.ok || unknown.ok) return;
    expect(spent.reason.kind).toBe(unknown.reason.kind);
    expect(spent.reason.detail).toBe(unknown.reason.detail);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe("expiry and disposal", () => {
  it("sweeps everything past its TTL", () => {
    const store = new InMemorySecretStore();
    armed(store, "one");
    armed(store, "two");
    expect(store.liveSecretCount).toBe(2);
    expect(store.sweep(later(301))).toBe(2);
    expect(store.liveSecretCount).toBe(0);
  });

  it("sweeps nothing that is still live, and is idempotent", () => {
    const store = new InMemorySecretStore();
    armed(store, "one");
    expect(store.sweep(later(10))).toBe(0);
    expect(store.sweep(later(301))).toBe(1);
    expect(store.sweep(later(302))).toBe(0);
  });

  it("discards one on request — the student changing their mind", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    store.submit(opened.prompt.requestId, "second thoughts", NOW);
    store.discard(opened.prompt.requestId);
    expect(store.statusOf(opened.prompt.requestId)?.lifecycle).toBe("secret_expired");
    expect(store.liveSecretCount).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe("what may be said about a secret", () => {
  it("has exactly four words, and two of them are terminal", () => {
    expect([...SECRET_LIFECYCLE]).toEqual([
      "secret_requested",
      "secret_received",
      "secret_consumed",
      "secret_expired",
    ]);
    expect(isTerminalLifecycle("secret_consumed")).toBe(true);
    expect(isTerminalLifecycle("secret_expired")).toBe(true);
    // Nothing leads out of either. That is what "single-use" and "expires"
    // mean when written as data rather than as a comment.
    expect(canTransition("secret_consumed", "secret_received")).toBe(false);
    expect(canTransition("secret_expired", "secret_received")).toBe(false);
  });

  it("walks requested → received → consumed and no other way", () => {
    expect(canTransition("secret_requested", "secret_received")).toBe(true);
    expect(canTransition("secret_received", "secret_consumed")).toBe(true);
    expect(canTransition("secret_requested", "secret_consumed")).toBe(false);
  });

  it("moves through the lifecycle as the secret is used", async () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    const id = opened.prompt.requestId;

    expect(store.statusOf(id)?.lifecycle).toBe("secret_requested");
    expect(store.statusOf(id)?.handle).toBeUndefined();

    const submitted = store.submit(id, "the-password", NOW);
    if (!submitted.ok) expect.unreachable("should accept");
    expect(store.statusOf(id)?.lifecycle).toBe("secret_received");
    expect(store.statusOf(id)?.handle).toBe(submitted.handle);

    await store.use(
      { handle: submitted.handle, studentRef: STUDENT, purpose: REQUEST.purpose, target: TARGET },
      SAFE,
      () => "x",
      NOW,
    );
    expect(store.statusOf(id)?.lifecycle).toBe("secret_consumed");
    // And the handle is gone from the status: it refers to nothing now.
    expect(store.statusOf(id)?.handle).toBeUndefined();
  });

  it("produces an audit line of marked text only", () => {
    const store = new InMemorySecretStore();
    const claim = armed(store, "the-password");
    const line = describeSecretUse({
      lifecycle: "secret_consumed",
      purpose: "portal_account_creation",
      handle: claim.handle,
      consumer: auditLabel("untraced_portal_fill"),
    });
    expect(line["lifecycle"]).toBe("secret_consumed");
    expect(line["channel"]).toBe("secure_control");
    expect(line["handle"]).toBe(claim.handle);
    expect(JSON.stringify(line)).not.toContain("the-password");
  });
});
