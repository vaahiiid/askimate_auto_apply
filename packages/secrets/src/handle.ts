/**
 * The handle, the request, and the four words the rest of the system is
 * allowed to say about a password.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26:
 *
 *   *"The student must be able to provide a password through the existing
 *   AskiMate Chat experience, but the password must NEVER become part of the
 *   LLM conversation, model context, chat transcript, normal message payload,
 *   ConfirmedValue, profile, audit event, log, trace, screenshot, video, or
 *   diagnostic artefact."*
 *
 *   *"The secure endpoint returns only an opaque handle. The model may see the
 *   handle but MUST NOT have any capability to resolve the handle to
 *   plaintext."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a handle rather than a redacted string ────────────────────────────
 *
 * A redacted string is a string that has been redacted by something. The
 * redaction is a behaviour, and behaviours get bypassed: someone reads the
 * private field in a debugger, someone spreads the object, someone writes
 * `String(value)` in a template. A handle is different in kind — it contains
 * no plaintext to redact. `sh_7f3a…` is the whole value. Printing it, logging
 * it, putting it in an event, sending it to a model, pasting it into a ticket:
 * all harmless, because the plaintext it refers to lives somewhere the handle
 * gives no route to.
 *
 * That is the load-bearing property. The model may see a handle precisely
 * BECAUSE seeing one confers nothing.
 *
 * ── Why this is not `ConfirmedValue` ──────────────────────────────────────
 *
 * Vahid: *"It must NOT become a ConfirmedValue."* A `ConfirmedValue<string>`
 * is a string the student read back and approved, destined for a university
 * form and shown in the submission preview. A password is none of those
 * things — it is not application content, it must never appear in a preview,
 * and `unwrapConfirmed` would hand it out as a plain string to anyone holding
 * it. So the two types have no conversion in either direction, and there is a
 * compile-time test asserting that.
 */

import type { Brand, StudentId } from "@askimate/aas-domain";

// ───────────────────────────────────────────────────────────────────────────
// The handle
// ───────────────────────────────────────────────────────────────────────────

/**
 * An opaque reference to a secret held elsewhere.
 *
 * Contains no plaintext, no length, no hash of the secret, and nothing derived
 * from it. It is a random label, and the only thing that can turn it back into
 * a value is a store that holds the entry — which is not reachable from the
 * model side of the system (see the boundary rules in
 * `scripts/check-boundaries.ts`).
 */
export type SecretHandle = Brand<string, "SecretHandle">;

/** Format: `sh_` plus 32 lowercase hex characters. */
const HANDLE_PATTERN = /^sh_[0-9a-f]{32}$/;

export function isSecretHandle(value: unknown): value is SecretHandle {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

/**
 * Parses a handle that came back from somewhere untyped — a JSON payload, a
 * stored orchestration state, a chat message.
 *
 * Returns null rather than throwing: a malformed handle is an ordinary thing
 * for a boundary to receive, not an exceptional one.
 */
export function parseSecretHandle(value: string): SecretHandle | null {
  return HANDLE_PATTERN.test(value) ? (value as SecretHandle) : null;
}

/**
 * The id of a REQUEST for a secret, distinct from the handle to the secret.
 *
 * The request exists from the moment the model asks; the handle exists only
 * once the student has actually typed something. Collapsing them into one id
 * would mean a handle existed while no secret did, and "does this handle
 * resolve" would stop being a question with a straight answer.
 */
export type SecretRequestId = Brand<string, "SecretRequestId">;

const REQUEST_PATTERN = /^sr_[0-9a-f]{32}$/;

export function isSecretRequestId(value: unknown): value is SecretRequestId {
  return typeof value === "string" && REQUEST_PATTERN.test(value);
}

export function parseSecretRequestId(value: string): SecretRequestId | null {
  return REQUEST_PATTERN.test(value) ? (value as SecretRequestId) : null;
}

// ───────────────────────────────────────────────────────────────────────────
// What a secret is FOR
// ───────────────────────────────────────────────────────────────────────────

/**
 * Why a secret is being asked for.
 *
 * A closed union, not free text. Free text would mean a new use for a
 * student's password could be introduced without anyone deciding to introduce
 * it — which is the exact failure mode this whole package exists to prevent.
 * Adding a member here is a reviewable change to a two-member list.
 */
export type SecretPurpose =
  /** Setting the password on a university portal account being created now. */
  | "portal_account_creation"
  /**
   * Signing in to an account the student already has, with a password they
   * already chose.
   *
   * Present because the alternative is worse: a student who already has a
   * portal account would otherwise have to be told to create a second one.
   * It is still a password reaching our automation, so it goes through
   * exactly the same channel and the same single-use destruction.
   */
  | "portal_sign_in";

/**
 * The purposes, as a value.
 *
 * Exists so `scripts/contract-drift.test.ts` can compare this closed set with
 * the published contract's enum. They currently DIFFER on one member, and that
 * test is where the divergence is recorded — adding a member here without
 * deciding about the contract fails there, which is where the decision belongs.
 */
export const SECRET_PURPOSES: readonly SecretPurpose[] = [
  "portal_account_creation",
  "portal_sign_in",
];

/**
 * Where the secret will be typed.
 *
 * Bound at request time and checked at consumption time. A handle minted for
 * `apply.example.ac.uk` cannot be spent on any other host, so a bug (or a
 * hostile blueprint) that pointed the automation somewhere else would fail
 * rather than post the student's password to it.
 */
export interface SecretTarget {
  /** The portal host the secret will be typed into, e.g. `apply.example.ac.uk`. */
  readonly host: string;
  /** Which case this belongs to, so one case's handle cannot be spent by another. */
  readonly caseRef: string;
}

/** Everything a consumption must match. All four, exactly. */
export interface SecretClaim {
  readonly handle: SecretHandle;
  readonly studentRef: StudentId;
  readonly purpose: SecretPurpose;
  readonly target: SecretTarget;
}

// ───────────────────────────────────────────────────────────────────────────
// The four words
// ───────────────────────────────────────────────────────────────────────────

/**
 * The ONLY vocabulary the orchestration state, the event log and the audit
 * trail have for a secret.
 *
 * Vahid: *"Orchestration state may contain secret_requested / secret_received
 * / secret_consumed / secret_expired — but NEVER the password itself."*
 *
 * These are the four. There is no `secret_value`, no `secret_length`, no
 * `secret_strength`; a length is a fact about the password and a strength
 * score is a fact derived from it, and neither belongs in a durable record.
 */
export type SecretLifecycle =
  /** The model asked; the student has not typed anything yet. */
  | "secret_requested"
  /** The student typed it into the secure control. A handle now exists. */
  | "secret_received"
  /** The automation spent it. The plaintext is gone. */
  | "secret_consumed"
  /** The TTL passed. The plaintext is gone. */
  | "secret_expired"
  /**
   * The student abandoned the step. The plaintext is gone.
   *
   * Distinct from `secret_expired` by ADR-0032. Identical to every guard —
   * both are terminal and both release the composer — and different to
   * everyone else who reads the log. The model should say "no problem, shall
   * we try another way?" to one and "that timed out, let me ask again" to the
   * other; product analytics should be able to tell an abandonment from a
   * latency problem; an incident review should not have to guess. Collapsing
   * them destroys the distinction at the only point where it is still
   * recoverable, which is the point of writing.
   */
  | "secret_cancelled";

export const SECRET_LIFECYCLE: readonly SecretLifecycle[] = [
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
];

/**
 * Which lifecycle moves are possible.
 *
 * Note what is absent: nothing leads OUT of `secret_consumed`, `secret_expired`
 * or `secret_cancelled`. All three are terminal, and that is what "single-use",
 * "expires" and "abandoned" mean when written as data rather than as a comment.
 *
 * Note also what is absent from `secret_received`: a student cannot cancel a
 * step they have already completed. Once a handle exists the automation may
 * already be spending it, and a cancellation that raced a consumption would be
 * a lie in one direction or the other. Expiry still applies, because time is
 * not a decision anyone makes.
 */
const NEXT: Readonly<Record<SecretLifecycle, readonly SecretLifecycle[]>> = {
  secret_requested: ["secret_received", "secret_expired", "secret_cancelled"],
  secret_received: ["secret_consumed", "secret_expired"],
  secret_consumed: [],
  secret_expired: [],
  secret_cancelled: [],
};

export function canTransition(from: SecretLifecycle, to: SecretLifecycle): boolean {
  return NEXT[from].includes(to);
}

export function isTerminalLifecycle(state: SecretLifecycle): boolean {
  return NEXT[state].length === 0;
}
