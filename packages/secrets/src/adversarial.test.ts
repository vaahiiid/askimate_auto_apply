/**
 * Hunting one marker through every route a value can escape by.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"Add adversarial tests proving the password never
 * appears in: model messages, conversation state, orchestration state, logs,
 * events, audit records, traces, trace archives, screenshots, videos, error
 * messages, generated reports, JSON serialisation, storage state."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The trace, screenshot, video and archive routes need a real browser and are
 * asserted against real artefacts in
 * `apps/browser-runner/src/secret-fill.test.ts`. This file covers everything
 * that is reachable without one, and it does it the same way: **take the
 * artefact and search it**, rather than asserting that our code did not
 * deliberately write the value.
 *
 * ── The lesson behind the shape of these tests ────────────────────────────
 *
 * The trace-leak investigation caught this repository writing every confirmed
 * value into `trace.trace`, and it was caught by scanning a file — not by
 * reading code, which had looked fine for weeks. So the assertions here are
 * on strings that came OUT of things: `JSON.stringify`, `String()`,
 * `util.inspect`, `error.stack`. If a route produces bytes, the bytes get
 * searched.
 */

import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { auditLabel, proposeValue, studentId } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";

import { InMemorySecretStore, describeSecretUse, isSecretHandle } from "./index.js";
import type { SecretClaim, SecretConsumer, SecretRequest } from "./index.js";

/**
 * The marker.
 *
 * Distinctive enough that a substring scan cannot miss it and cannot
 * false-positive, and shaped like a password a student would actually choose
 * under a portal policy demanding mixed case, a digit and a symbol.
 */
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";

const STUDENT = studentId("student-1");
const NOW = new Date("2026-08-26T10:00:00Z");
const TARGET = { host: "apply.example.ac.uk", caseRef: "case-1" } as const;

const REQUEST: SecretRequest = {
  studentRef: STUDENT,
  purpose: "portal_account_creation",
  target: TARGET,
  explanation: "I need a password to set up your application account.",
  singleUse: true,
  ttlSeconds: 300,
};

const SAFE: SecretConsumer = {
  name: auditLabel("test_consumer"),
  confirmNoDiagnosticCapture: () => true,
};

function armed(store: InMemorySecretStore): { claim: SecretClaim; requestId: string } {
  const opened = store.request(REQUEST, NOW);
  if (!opened.ok) expect.unreachable("should open");
  const submitted = store.submit(opened.prompt.requestId, MARKER, NOW);
  if (!submitted.ok) expect.unreachable("should accept");
  return {
    claim: {
      handle: submitted.handle,
      studentRef: STUDENT,
      purpose: "portal_account_creation",
      target: TARGET,
    },
    requestId: opened.prompt.requestId,
  };
}

/**
 * `JSON.stringify`, made safe for a scan.
 *
 * TypeScript types it as returning `string`, and it does not: `undefined`, a
 * function and a symbol all serialise to `undefined`, and it throws outright on
 * a circular structure. Both cases have to become the empty string rather than
 * the literal text "undefined" — a scan that searched the word "undefined" for
 * a marker would be scanning nothing and would not know it.
 */
function stringify(value: unknown, replacer?: (key: string, held: unknown) => unknown): string {
  try {
    const written: unknown =
      replacer === undefined ? JSON.stringify(value) : JSON.stringify(value, replacer);
    return typeof written === "string" ? written : "";
  } catch {
    return "";
  }
}

/** Every string a value could plausibly be dragged out through. */
function everyRouteOut(value: unknown): readonly string[] {
  const routes: string[] = [];
  routes.push(stringify(value));
  routes.push(String(value));
  routes.push(inspect(value, { depth: 10, showHidden: true, getters: true }));
  // The shape a structured logger produces: every own key, walked deeply.
  routes.push(stringify(value, (_key, held: unknown) => held));
  return routes;
}

function assertClean(label: string, value: unknown): void {
  for (const route of everyRouteOut(value)) {
    expect(route, `${label} leaked the marker`).not.toContain(MARKER);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The handle
// ───────────────────────────────────────────────────────────────────────────

describe("the handle, which the model is allowed to see", () => {
  it("contains nothing of the secret — not the value, not a prefix, not a hash", () => {
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    expect(claim.handle).not.toContain(MARKER);
    expect(claim.handle).not.toContain("SECRET");
    expect(claim.handle).not.toContain("123");
    // 32 hex characters of randomness. Nothing derived from the input, so two
    // students choosing the same password get unrelated handles.
    expect(claim.handle).toMatch(/^sh_[0-9a-f]{32}$/);
    expect(isSecretHandle(claim.handle)).toBe(true);
  });

  it("gives different handles to the same password", () => {
    // A handle derived from the value — even hashed — would let anyone holding
    // two handles tell whether two students chose the same password.
    const store = new InMemorySecretStore();
    const first = armed(store).claim.handle;
    const second = armed(store).claim.handle;
    expect(first).not.toBe(second);
  });

  it("cannot be spent twice, however it is copied around", async () => {
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    // Round-tripped through JSON, the way a handle would reach a queue, a
    // database row or a model's context and come back.
    const copied = JSON.parse(JSON.stringify(claim)) as SecretClaim;

    const first = await store.use(copied, SAFE, (secret) => secret === MARKER, NOW);
    expect(first.ok).toBe(true);

    const second = await store.use(claim, SAFE, () => true, NOW);
    expect(second.ok).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The store and everything it hands out
// ───────────────────────────────────────────────────────────────────────────

describe("nothing the store hands out contains the secret", () => {
  it("the store exposes NO state at all, which is the property that matters", () => {
    // ── Why this assertion is positive rather than "does not contain" ─────
    //
    // The first version of this test was `assertClean("the store", store)`,
    // and it was worthless. Deliberately regressing the store — making the
    // secret a public field and deleting every redaction override — left all
    // 46 tests passing, because `#entries` is a private field and Node cannot
    // see through one:
    //
    //     JSON.stringify(store)                        →  {}
    //     String(store)                                →  [object Object]
    //     inspect(store, {depth: 10, showHidden: true}) →  InMemorySecretStore {}
    //
    // A scan that a regression can walk past is not a proof. So the assertion
    // is the one a regression CANNOT walk past: the store must expose nothing.
    // Change `#entries` to `entries` — the ordinary refactor someone makes to
    // iterate them from a subclass — and `JSON.stringify` stops returning
    // `{}`, and this fails.
    const store = new InMemorySecretStore();
    armed(store);

    expect(JSON.stringify(store)).toBe("{}");
    expect(Object.keys(store)).toEqual([]);

    const shown = inspect(store, { depth: 10, showHidden: true, getters: true });
    expect(shown).not.toContain(MARKER);
    expect(shown).not.toContain("sh_");
    expect(shown).not.toContain("sr_");
    // Only the health-check getter, which counts and reveals nothing.
    expect(shown).toBe("InMemorySecretStore { [liveSecretCount]: [Getter: 1] }");
  });

  it("survives a structured-clone walk, which reaches further than JSON", () => {
    // `structuredClone` is how a value crosses a worker or a cache boundary,
    // and it walks the object graph differently from `JSON.stringify`. A class
    // instance with private state clones to a plain object holding whatever
    // was enumerable — so this is the same property, checked by a different
    // mechanism that does not share JSON's blind spots.
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    const cloned = structuredClone({ handle: claim.handle, state: { ...store } });
    assertClean("a structured clone", cloned);
    expect(JSON.stringify(cloned.state)).toBe("{}");
  });

  it("the prompt the chat renders", () => {
    const store = new InMemorySecretStore();
    const opened = store.request(REQUEST, NOW);
    if (!opened.ok) expect.unreachable("should open");
    // Rendered before the student types, so it CANNOT contain the secret —
    // asserted anyway, because "it cannot" is what everyone said about traces.
    store.submit(opened.prompt.requestId, MARKER, NOW);
    assertClean("the prompt", opened.prompt);
  });

  it("the status, which is what a case record would hold", () => {
    const store = new InMemorySecretStore();
    const { requestId } = armed(store);
    const status = store.statusOf(requestId as never);
    expect(status).not.toBeNull();
    assertClean("the status", status);
    // And it says the true thing about where the secret has got to.
    expect(status?.lifecycle).toBe("secret_received");
  });

  it("the audit line", () => {
    const store = new InMemorySecretStore();
    const { claim } = armed(store);
    assertClean(
      "the audit line",
      describeSecretUse({
        lifecycle: "secret_consumed",
        purpose: "portal_account_creation",
        handle: claim.handle,
        consumer: auditLabel("untraced_portal_fill"),
      }),
    );
  });

  it("every refusal reason, including the ones that compare the secret's binding", async () => {
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    const refusals = [
      await store.use({ ...claim, studentRef: studentId("other") }, SAFE, () => "x", NOW),
      await store.use({ ...claim, purpose: "portal_sign_in" }, SAFE, () => "x", NOW),
      await store.use(
        { ...claim, target: { host: "evil.example.com", caseRef: "case-1" } },
        SAFE,
        () => "x",
        NOW,
      ),
      await store.use(
        claim,
        { name: auditLabel("recording"), confirmNoDiagnosticCapture: () => false },
        () => "x",
        NOW,
      ),
      await store.use(claim, SAFE, () => "x", new Date(NOW.getTime() + 400_000)),
    ];
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      assertClean("a refusal", refusal);
    }
  });

  it("an error thrown INSIDE the callback, including its stack", async () => {
    // The nastiest realistic route. The callback holds the plaintext, so an
    // error it constructs is the one place a secret could be interpolated into
    // a message that then travels to a log, a ticket and a crash reporter.
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    const thrown = await store
      .use(
        claim,
        SAFE,
        (secret) => {
          // Deliberately a message about the secret — the shape a careless
          // error takes — but naming only its SHAPE, as the codebase requires.
          throw new Error(`the portal rejected a ${String(secret.length)}-character password`);
        },
        NOW,
      )
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    assertClean("the thrown error", thrown);
    assertClean("the stack", (thrown as Error).stack);
    expect((thrown as Error).message).toContain("32-character");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The state a case would persist
// ───────────────────────────────────────────────────────────────────────────

describe("orchestration state", () => {
  it("holds four words and a handle, and there is no field a password fits in", () => {
    const store = new InMemorySecretStore();
    const { claim, requestId } = armed(store);
    const status = store.statusOf(requestId as never);

    // What a RunState carries. Typed in the orchestrator; constructed here the
    // way the orchestrator constructs it.
    const persisted = {
      requestId,
      lifecycle: status?.lifecycle,
      handle: claim.handle,
    };

    assertClean("orchestration state", persisted);
    expect(JSON.stringify(persisted)).toContain(claim.handle);
    expect(JSON.stringify(persisted)).toContain("secret_received");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The type boundary
// ───────────────────────────────────────────────────────────────────────────

describe("a secret is not, and cannot become, application content", () => {
  it("a handle is not a ConfirmedValue, and there is no conversion", () => {
    const store = new InMemorySecretStore();
    const { claim } = armed(store);

    const confirmed: ConfirmedValue<string> = "not-a-real-one" as unknown as ConfirmedValue<string>;

    // @ts-expect-error — a SecretHandle is not a ConfirmedValue. If a
    // conversion is ever added this directive goes unused and CI fails, which
    // is the point: a password that could become a ConfirmedValue would enter
    // the profile and appear in the submission preview the student authorises.
    const bad: ConfirmedValue<string> = claim.handle;
    void bad;

    // @ts-expect-error — and not the other way either. A ConfirmedValue is
    // something a student read back and approved for a university form; it is
    // not a credential, and treating one as the other in either direction is
    // the mistake this pair of directives exists to prevent.
    const alsoBad: typeof claim.handle = confirmed;
    void alsoBad;

    expect(isSecretHandle(claim.handle)).toBe(true);
  });

  it("a plain string is not a handle — a password cannot be passed off as one", async () => {
    const store = new InMemorySecretStore();
    armed(store);

    // The accident the brand exists for: `use({ handle: password, ... })`,
    // where a variable holding the password got passed where the handle goes.
    // The directive sits on the property, not the declaration — TypeScript
    // reports the mismatch at the assignment inside the literal.
    const claim: SecretClaim = {
      // @ts-expect-error — the marker is a `string`, not a `SecretHandle`.
      handle: MARKER,
      studentRef: STUDENT,
      purpose: "portal_account_creation",
      target: TARGET,
    };

    // And at runtime it refuses too, because the store looks the handle up
    // rather than trusting it.
    const outcome = await store.use(claim, SAFE, () => "x", NOW);
    expect(outcome.ok).toBe(false);
  });

  it("a secret cannot be proposed as a profile value and confirmed into one", () => {
    // `proposeValue` is the only door into the profile, and it takes model or
    // conversation origins. Passing a password through it would put the
    // password in the interview transcript, the preview and the audit trail —
    // so the test is that the resulting object is a ProposedValue and there is
    // no path from it to a portal fill without a student confirming the
    // literal characters on screen.
    const proposed = proposeValue({
      value: MARKER,
      origin: "conversation",
      verbatim: MARKER,
      confidence: 0.99,
    });

    // @ts-expect-error — a ProposedValue is not a ConfirmedValue. Only the
    // profile's confirmation step mints one, against a student who saw the
    // value played back. A password played back on screen in a chat window is
    // the thing the secure control exists to avoid.
    const bad: ConfirmedValue<string> = proposed;
    void bad;

    expect(proposed.value).toBe(MARKER);
  });
});
