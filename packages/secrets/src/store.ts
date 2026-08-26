/**
 * The ephemeral secret store: the one place a password exists, and the only
 * way to spend it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26:
 *
 *   *"Create a SecretHandle and useSecret(handle, callback). Do not expose
 *   getSecret(handle)."*
 *
 *   *"Single-use, short TTL, encrypted/in-memory, destroyed after use and
 *   after expiry, never persisted to profile, never in events/audit/logs/
 *   traces/screenshots/videos."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── There is no getter, and that is the whole design ──────────────────────
 *
 * `getSecret(handle): string` would be one line and it would undo everything.
 * Once a plaintext string is in a caller's scope it is in their stack traces,
 * their closures, their error objects and whatever they pass it to next — and
 * "the caller promises to be careful" is not a property a system has, it is a
 * hope a system holds.
 *
 * So the only route is `use(claim, consumer, task)`. The secret is passed to
 * `task` and never returned. That does not make it impossible for a task to
 * keep a copy — `(secret) => secret` is valid code and no type system stops it
 * — but it moves the problem from "everywhere a string can go" to "the small,
 * countable, reviewable set of call sites that pass a callback here". That is
 * the same reasoning as `EphemeralCredential.useTo`, and it is deliberate that
 * the two look alike.
 *
 * ── Destroyed BEFORE the callback runs ────────────────────────────────────
 *
 * `use` removes the entry from the store first, then calls the task. Not
 * afterwards, and not in a `finally`. Three things follow from the order:
 *
 *   • a task that throws still consumed the secret — a failed login attempt is
 *     a spent password, not a retryable one
 *   • a task that re-enters `use` with the same handle finds nothing
 *   • two concurrent consumptions cannot both succeed, because the removal
 *     happens synchronously before the first `await` boundary
 *
 * The third is the one that would be a real bug. `await store.use(...)` twice
 * without awaiting between them is exactly the shape a retry loop takes.
 *
 * ── What "in memory" means here, and what it does not ─────────────────────
 *
 * Vahid: *"No production AWS infrastructure. In-memory implementation behind a
 * port."* So `SecretStore` is the port and `InMemorySecretStore` is the only
 * implementation. A future adapter over a KMS-backed store implements the same
 * interface; nothing above it changes.
 *
 * The honest limit: a secret held in a JavaScript string cannot be wiped.
 * Dropping the reference makes it unreachable and eligible for collection, but
 * the bytes may sit in the heap until the collector runs, and a heap dump
 * taken in that window would contain them. This is a property of the runtime,
 * not of this code, and no in-process JavaScript design avoids it. What IS
 * avoided is every route that survives the process: nothing here writes to
 * disk, to a log, to an event, or to any structure that outlives the tick.
 */

import { randomBytes } from "node:crypto";

import type { AuditSafeText, StudentId } from "@askimate/aas-domain";
import { auditLabel, auditRef } from "@askimate/aas-domain";

import type {
  SecretClaim,
  SecretHandle,
  SecretLifecycle,
  SecretPurpose,
  SecretRequestId,
  SecretTarget,
} from "./handle.js";
import type { SecretPrompt, SecretRequest, SecretRequestRefusal } from "./request.js";
import { buildSecretPrompt } from "./request.js";

// ───────────────────────────────────────────────────────────────────────────
// The consumer's proof
// ───────────────────────────────────────────────────────────────────────────

/**
 * Something that has established it cannot capture what it is given.
 *
 * Vahid: *"Automation consumes it only through the sensitive browser context
 * already implemented. The normal Playwright traced context must never
 * receive it."*
 *
 * The store cannot see a browser context, and packages may not depend on apps,
 * so the check is inverted: the consumer asserts, and the store demands the
 * assertion. `apps/browser-runner` implements `confirmNoDiagnosticCapture` by
 * calling `tracingIsForbidden(context)` against the live context — a real
 * runtime check against the object that would do the leaking, not a flag.
 *
 * **What this does and does not prove.** A caller could write a consumer that
 * returns `true` and lies. What it cannot do is *forget*: there is no default,
 * no optional parameter and no overload without one, so a call that has not
 * thought about capture does not compile. Every implementation is a named type
 * in a file a reviewer can find, and there is a boundary test that the traced
 * path has none.
 */
export interface SecretConsumer {
  /** Named so an audit line can say who spent it without saying what. */
  readonly name: AuditSafeText;
  /**
   * Checked at the moment of consumption, against the live thing.
   *
   * Returning `false` refuses the consumption. Throwing is treated as `false`
   * — a check that cannot complete has not passed.
   */
  confirmNoDiagnosticCapture(): boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Outcomes
// ───────────────────────────────────────────────────────────────────────────

export type SecretUnavailable =
  /** No such handle. Also what a spent handle looks like — deliberately. */
  | { readonly kind: "unknown_handle"; readonly detail: string }
  | { readonly kind: "expired"; readonly detail: string }
  | { readonly kind: "wrong_student"; readonly detail: string }
  | { readonly kind: "wrong_purpose"; readonly detail: string }
  | { readonly kind: "wrong_target"; readonly detail: string }
  | { readonly kind: "consumer_may_capture"; readonly detail: string };

export type SecretUse<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly reason: SecretUnavailable };

/** What a caller may know about a request without knowing the secret. */
export interface SecretStatus {
  readonly requestId: SecretRequestId;
  readonly lifecycle: SecretLifecycle;
  readonly purpose: SecretPurpose;
  readonly portalHost: string;
  readonly expiresAt: Date;
  /**
   * Present once the student has typed something.
   *
   * The handle is safe to hold, log and show a model — it refers to a secret
   * and contains nothing of it.
   */
  readonly handle?: SecretHandle;
}

// ───────────────────────────────────────────────────────────────────────────
// The port
// ───────────────────────────────────────────────────────────────────────────

/**
 * The store.
 *
 * Note the shape of the interface as much as its contents: `request` and
 * `statusOf` are the model-facing half, `submit` belongs to the secure
 * endpoint, and `use` belongs to the automation. **No method returns a
 * plaintext secret.**
 */
export interface SecretStore {
  /** Opens a request. Returns the prompt the chat must render. */
  request(
    input: SecretRequest,
    now: Date,
    observedRules?: readonly string[],
  ): { readonly ok: true; readonly prompt: SecretPrompt } | { readonly ok: false; readonly refusal: SecretRequestRefusal };

  /**
   * Receives what the student typed, from the secure control ONLY.
   *
   * Returns a handle. The plaintext argument dies with this call frame.
   */
  submit(
    requestId: SecretRequestId,
    secret: string,
    now: Date,
  ): { readonly ok: true; readonly handle: SecretHandle } | { readonly ok: false; readonly reason: SubmitRefusal };

  /** Spends it. Single-use; the entry is gone before `task` runs. */
  use<T>(
    claim: SecretClaim,
    consumer: SecretConsumer,
    task: (secret: string) => T | Promise<T>,
    now: Date,
  ): Promise<SecretUse<T>>;

  /** Everything a caller may know without knowing the secret. */
  statusOf(requestId: SecretRequestId): SecretStatus | null;

  /** Destroys everything past its TTL. Idempotent; returns how many went. */
  sweep(now: Date): number;

  /** Destroys one, unspent. What "the student changed their mind" looks like. */
  discard(requestId: SecretRequestId): void;
}

export type SubmitRefusal =
  | { readonly kind: "unknown_request"; readonly detail: string }
  | { readonly kind: "expired"; readonly detail: string }
  | { readonly kind: "already_submitted"; readonly detail: string }
  | { readonly kind: "empty"; readonly detail: string };

// ───────────────────────────────────────────────────────────────────────────
// The entry
// ───────────────────────────────────────────────────────────────────────────

/**
 * One request, and possibly one secret.
 *
 * A class with a `#private` field rather than an object with a property,
 * because `{...entry}`, `JSON.stringify(entry)` and `console.log(entry)` are
 * all things people write without thinking, and a `#` field survives all
 * three. The three serialisation routes are overridden as well, so even a
 * deliberate attempt writes the redaction.
 */
const REDACTED = "[secret — held for minutes, never logged, never retrievable]";

class SecretEntry {
  #secret: string | null = null;
  #lifecycle: SecretLifecycle = "secret_requested";
  #handle: SecretHandle | null = null;

  public constructor(
    public readonly requestId: SecretRequestId,
    public readonly studentRef: StudentId,
    public readonly purpose: SecretPurpose,
    public readonly target: SecretTarget,
    public readonly expiresAt: Date,
  ) {}

  public get lifecycle(): SecretLifecycle {
    return this.#lifecycle;
  }

  public get handle(): SecretHandle | null {
    return this.#handle;
  }

  public receive(secret: string, handle: SecretHandle): void {
    this.#secret = secret;
    this.#handle = handle;
    this.#lifecycle = "secret_received";
  }

  /**
   * Hands the secret over and forgets it, in one indivisible step.
   *
   * There is no `peek`, and `take` cannot be called twice — the second call
   * returns null. Callers get one chance by construction rather than by
   * discipline.
   */
  public take(): string | null {
    const held = this.#secret;
    this.#secret = null;
    if (held !== null) this.#lifecycle = "secret_consumed";
    return held;
  }

  public expire(): void {
    this.#secret = null;
    this.#lifecycle = "secret_expired";
  }

  public toJSON(): string {
    return REDACTED;
  }
  public toString(): string {
    return REDACTED;
  }
  public [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The implementation
// ───────────────────────────────────────────────────────────────────────────

export class InMemorySecretStore implements SecretStore {
  readonly #entries = new Map<SecretRequestId, SecretEntry>();
  readonly #byHandle = new Map<SecretHandle, SecretRequestId>();

  public request(
    input: SecretRequest,
    now: Date,
    observedRules?: readonly string[],
  ):
    | { readonly ok: true; readonly prompt: SecretPrompt }
    | { readonly ok: false; readonly refusal: SecretRequestRefusal } {
    const requestId = `sr_${randomBytes(16).toString("hex")}` as SecretRequestId;
    const built = buildSecretPrompt({
      requestId,
      request: input,
      now,
      ...(observedRules === undefined ? {} : { observedRules }),
    });
    if (!built.ok) return built;

    this.#entries.set(
      requestId,
      new SecretEntry(requestId, input.studentRef, input.purpose, input.target, built.prompt.expiresAt),
    );
    return built;
  }

  public submit(
    requestId: SecretRequestId,
    secret: string,
    now: Date,
  ):
    | { readonly ok: true; readonly handle: SecretHandle }
    | { readonly ok: false; readonly reason: SubmitRefusal } {
    const entry = this.#entries.get(requestId);
    if (entry === undefined) {
      return {
        ok: false,
        reason: {
          kind: "unknown_request",
          detail:
            "No open request with that id. Either it was never opened, it was already answered, " +
            "or it expired and was destroyed.",
        },
      };
    }
    if (now.getTime() >= entry.expiresAt.getTime()) {
      this.#destroy(entry);
      return {
        ok: false,
        reason: {
          kind: "expired",
          detail:
            `The request expired at ${entry.expiresAt.toISOString()} and has been destroyed. ` +
            `The student needs a fresh prompt rather than a longer window on this one.`,
        },
      };
    }
    if (entry.lifecycle !== "secret_requested") {
      return {
        ok: false,
        reason: {
          kind: "already_submitted",
          detail:
            "That request has already been answered. A second submission would replace a secret " +
            "the automation may be about to spend, so it is refused rather than silently applied.",
        },
      };
    }
    if (secret.length === 0) {
      return {
        ok: false,
        reason: {
          kind: "empty",
          detail: "The secure control submitted nothing. The student has not typed a password yet.",
        },
      };
    }

    const handle = `sh_${randomBytes(16).toString("hex")}` as SecretHandle;
    entry.receive(secret, handle);
    this.#byHandle.set(handle, requestId);
    return { ok: true, handle };
  }

  public async use<T>(
    claim: SecretClaim,
    consumer: SecretConsumer,
    task: (secret: string) => T | Promise<T>,
    now: Date,
  ): Promise<SecretUse<T>> {
    const requestId = this.#byHandle.get(claim.handle);
    const entry = requestId === undefined ? undefined : this.#entries.get(requestId);

    // A spent handle and an invented one give the same answer on purpose. A
    // distinct "already used" reply would tell a caller that a handle was real,
    // which is a fact worth nothing to a legitimate caller and something to
    // anyone else.
    if (entry === undefined || entry.lifecycle !== "secret_received") {
      return {
        ok: false,
        reason: {
          kind: "unknown_handle",
          detail:
            "That handle does not refer to a secret this store holds. A handle is single-use, so " +
            "this is also what a handle that has already been spent looks like.",
        },
      };
    }
    if (now.getTime() >= entry.expiresAt.getTime()) {
      this.#destroy(entry);
      return {
        ok: false,
        reason: {
          kind: "expired",
          detail:
            `The secret expired at ${entry.expiresAt.toISOString()} and has been destroyed. ` +
            `Ask the student again rather than extending it.`,
        },
      };
    }
    if (entry.studentRef !== claim.studentRef) {
      return {
        ok: false,
        reason: {
          kind: "wrong_student",
          detail:
            "The handle belongs to a different student. Nothing about this is recoverable by " +
            "retrying — it means two cases have been crossed somewhere upstream.",
        },
      };
    }
    if (entry.purpose !== claim.purpose) {
      return {
        ok: false,
        reason: {
          kind: "wrong_purpose",
          detail:
            `The secret was given for "${entry.purpose}" and is being spent on ` +
            `"${claim.purpose}". A student agreed to one of those, not the other.`,
        },
      };
    }
    if (entry.target.host !== claim.target.host || entry.target.caseRef !== claim.target.caseRef) {
      return {
        ok: false,
        reason: {
          kind: "wrong_target",
          detail:
            `The secret is bound to ${entry.target.host} on case ${entry.target.caseRef} and is ` +
            `being spent against ${claim.target.host} on case ${claim.target.caseRef}. This is ` +
            `the check that stops a password being typed into the wrong site.`,
        },
      };
    }

    let safe = false;
    try {
      safe = consumer.confirmNoDiagnosticCapture();
    } catch {
      safe = false; // A check that could not complete has not passed.
    }
    if (!safe) {
      return {
        ok: false,
        reason: {
          kind: "consumer_may_capture",
          detail:
            "The consumer could not confirm it captures no diagnostics. Playwright writes typed " +
            "values verbatim into trace.trace, and a video of a login shows the keystrokes, so a " +
            "secret is never handed to a context that could be recording (ADR-0025).",
        },
      };
    }

    // ── The order matters ────────────────────────────────────────────────
    //
    // Taken and forgotten BEFORE the task runs, synchronously, with no await
    // between the lookup and the removal. A task that throws has still spent
    // it; a task that re-enters finds nothing; two concurrent calls cannot
    // both win.
    const secret = entry.take();
    this.#byHandle.delete(claim.handle);
    if (secret === null) {
      return {
        ok: false,
        reason: {
          kind: "unknown_handle",
          detail: "The secret was taken between the lookup and the spend. It is single-use.",
        },
      };
    }

    const result = await task(secret);
    return { ok: true, result };
  }

  public statusOf(requestId: SecretRequestId): SecretStatus | null {
    const entry = this.#entries.get(requestId);
    if (entry === undefined) return null;
    const handle = entry.handle;
    return {
      requestId: entry.requestId,
      lifecycle: entry.lifecycle,
      purpose: entry.purpose,
      portalHost: entry.target.host,
      expiresAt: entry.expiresAt,
      ...(handle === null || entry.lifecycle !== "secret_received" ? {} : { handle }),
    };
  }

  public sweep(now: Date): number {
    let destroyed = 0;
    for (const entry of this.#entries.values()) {
      if (entry.lifecycle === "secret_consumed" || entry.lifecycle === "secret_expired") continue;
      if (now.getTime() < entry.expiresAt.getTime()) continue;
      this.#destroy(entry);
      destroyed += 1;
    }
    return destroyed;
  }

  public discard(requestId: SecretRequestId): void {
    const entry = this.#entries.get(requestId);
    if (entry !== undefined) this.#destroy(entry);
  }

  /** How many entries still hold plaintext. For tests and for a health check. */
  public get liveSecretCount(): number {
    let live = 0;
    for (const entry of this.#entries.values()) {
      if (entry.lifecycle === "secret_received") live += 1;
    }
    return live;
  }

  #destroy(entry: SecretEntry): void {
    const handle = entry.handle;
    if (handle !== null) this.#byHandle.delete(handle);
    entry.expire();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The audit line
// ───────────────────────────────────────────────────────────────────────────

/**
 * What may be written down about a secret.
 *
 * Returns `AuditSafeText` values only, so the result can go straight into a
 * `RedactedDetail` and a raw string cannot be smuggled in beside it. Note that
 * the handle goes through `auditRef` — it is an opaque id, which is exactly
 * what `auditRef` is for, and it resolves to nothing outside the store.
 */
export function describeSecretUse(input: {
  readonly lifecycle: SecretLifecycle;
  readonly purpose: SecretPurpose;
  readonly handle?: SecretHandle;
  readonly consumer?: AuditSafeText;
}): Readonly<Record<string, AuditSafeText>> {
  const base: Record<string, AuditSafeText> = {
    lifecycle: auditRef(input.lifecycle),
    purpose: auditRef(input.purpose),
    channel: auditLabel("secure_control"),
  };
  if (input.handle !== undefined) base["handle"] = auditRef(input.handle);
  if (input.consumer !== undefined) base["consumer"] = input.consumer;
  return base;
}
