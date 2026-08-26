/**
 * A password that no person ever chose, that exists for minutes, and that
 * cannot be written down.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"AskiMate should never become the long-term credential
 * holder for a student's university account… The password should be
 * automatically generated as a strong random credential. Ideally, the
 * generated password should never be exposed to a human operator… Never log
 * it, put it into events, traces, screenshots, backups, analytics or ordinary
 * application storage. Never make it retrievable by an AskiMate operator."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The obvious implementation is a string on the case record, and it is wrong
 * in a way that is very hard to undo. A string gets logged. It gets serialised
 * into an event. It appears in an error message, a stack trace, a Playwright
 * trace, a support ticket, a database backup — and every one of those is a
 * copy of a live credential to a real person's university account, sitting
 * somewhere nobody is thinking about.
 *
 * So this is not a string. It is an object that:
 *
 *   • **generates its own secret and has no other constructor.** There is no
 *     `create({ secret })`. A password a person chose — typed into a config
 *     file, pasted into an issue, picked because it was memorable — cannot
 *     enter the system, because there is no function that accepts one.
 *   • hands the secret to a **callback**, never to a variable in the caller's
 *     scope, so the ordinary way of using it leaves no copy behind
 *   • redacts itself in every serialisation route JavaScript offers —
 *     `toJSON`, `toString`, and Node's inspect
 *   • expires, and destroys the secret at expiry rather than merely refusing
 *   • can be destroyed explicitly, and is destroyed at handover
 *   • is not `Brand<string>`, because a branded string is still a string and
 *     `JSON.stringify` would happily write it out
 *
 * ── What this does NOT claim ──────────────────────────────────────────────
 *
 * The secret exists in memory while it is alive, and `useTo` passes it to a
 * function that could keep it. That is unavoidable — something has to type it
 * into a login form, and no type system prevents a callback from being
 * `(secret) => secret`. What is removed is the ACCIDENTAL copy: the one nobody
 * decided to make. `useTo` is conspicuous at the call site, its call sites are
 * countable, and every one of them is reviewable.
 *
 * It also does not claim to be an AskiMate operator's problem solved. An
 * operator with a debugger attached to the process can read anything. The
 * claim is narrower and still worth having: **nothing an operator can reach
 * through the product — a record, a log, an event, a trace, an export —
 * contains it.**
 */

import { randomInt } from "node:crypto";

/** Why a credential could not be used. */
export type CredentialUnavailable =
  | { readonly kind: "expired"; readonly detail: string }
  | { readonly kind: "destroyed"; readonly detail: string };

const REDACTED = "[temporary credential — generated, never logged, never retrievable]";

/**
 * What the portal demands of a password.
 *
 * **Observed, not assumed.** `observedFrom` is required and must say where the
 * rule came from — a discovery capture, a portal error message, the portal's
 * own stated policy. We generate well above any realistic policy anyway; the
 * point of this type is that a *narrowing* constraint (a maximum length, a
 * restricted character set) is a claim about the portal and has to be
 * evidenced like any other.
 */
export interface PasswordPolicy {
  readonly minLength?: number;
  /** Some portals cap length. A cap we invented would silently weaken every credential. */
  readonly maxLength?: number;
  /** Characters the portal rejects, if any were observed being rejected. */
  readonly excludedCharacters?: string;
  /** Where this rule was observed. Free text, and it must not be empty. */
  readonly observedFrom: string;
}

/**
 * The alphabet.
 *
 * Unambiguous ASCII plus punctuation that portals reliably accept. No `O/0`,
 * `l/1/I` — not for human legibility, since no human reads this, but because a
 * portal that echoes a credential into a support email should not produce one
 * that gets mistyped back. Deliberately excludes quotes, backslash, angle
 * brackets and backtick, which are the characters most likely to be mangled by
 * a form, a shell or an HTML escape somewhere in a portal's stack.
 */
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "!#$%*+-=?@^_";

/** Long enough that the length is never the interesting part of the analysis. */
const DEFAULT_LENGTH = 40;
/** Below this we would be generating something worth attacking. */
const FLOOR_LENGTH = 16;

/**
 * A single-purpose, short-lived, machine-generated credential.
 *
 * Created for account creation, used to complete the application, and
 * destroyed at handover. It is never the student's chosen password — they set
 * that themselves through the portal's own reset flow, which reaches their own
 * email and which this system never sees.
 */
export class EphemeralCredential {
  #secret: string | null;
  readonly #expiresAt: Date;
  readonly #purpose: string;
  #useCount = 0;

  private constructor(secret: string, expiresAt: Date, purpose: string) {
    this.#secret = secret;
    this.#expiresAt = expiresAt;
    this.#purpose = purpose;
  }

  /**
   * Mints a credential by generating one.
   *
   * **This is the only constructor, and it takes no secret.** That is the
   * point of the class rather than an implementation detail: there is no way
   * for a password that a human chose, or that was stored anywhere, or that
   * the student uses elsewhere, to become an `EphemeralCredential`.
   *
   * `expiresAt` is required and has no default. A credential with an
   * open-ended life is the thing this class exists to prevent, and a default
   * would be a decision made by whoever wrote the default rather than by
   * whoever is responsible for the account.
   */
  public static generate(input: {
    readonly expiresAt: Date;
    /** What it is for, so an audit entry can say so without saying the secret. */
    readonly purpose: string;
    /** The portal's own rule, where one has been observed. */
    readonly policy?: PasswordPolicy;
  }): EphemeralCredential {
    if (input.purpose.trim().length === 0) {
      throw new Error(
        "A credential needs a stated purpose. It is the only thing about it that may be written " +
          "down, so it has to be worth reading.",
      );
    }
    return new EphemeralCredential(
      generateSecret(input.policy),
      input.expiresAt,
      input.purpose.trim(),
    );
  }

  /**
   * Uses the secret, without letting it out.
   *
   * The secret is passed to `task` and the return value is `task`'s. The
   * ordinary use — `credential.useTo(now, "sign in", (secret) =>
   * page.fill("#password", secret))` — leaves no copy anywhere.
   *
   * Named to be conspicuous at the call site, and the call sites should stay
   * countable: account creation, first sign-in, and nothing else. Everything
   * after that is the student's own password, which this system does not have.
   */
  public useTo<T>(
    now: Date,
    task: string,
    use: (secret: string) => T,
  ):
    | { readonly ok: true; readonly result: T }
    | { readonly ok: false; readonly reason: CredentialUnavailable } {
    if (this.#secret === null) {
      return {
        ok: false,
        reason: {
          kind: "destroyed",
          detail:
            `The credential for "${this.#purpose}" was destroyed and cannot be recovered, so ` +
            `"${task}" cannot use it. Generating a new one means creating a new account or ` +
            `using the portal's own password reset — which is the student's to do.`,
        },
      };
    }
    if (now.getTime() >= this.#expiresAt.getTime()) {
      // Destroy on expiry rather than merely refusing, so a clock that later
      // goes backwards cannot resurrect it.
      this.#secret = null;
      return {
        ok: false,
        reason: {
          kind: "expired",
          detail:
            `The credential for "${this.#purpose}" expired at ` +
            `${this.#expiresAt.toISOString()} and has been destroyed, so "${task}" cannot use it.`,
        },
      };
    }

    this.#useCount += 1;
    return { ok: true, result: use(this.#secret) };
  }

  /**
   * Destroys it.
   *
   * Called by the handover, and idempotent — destroying an already-destroyed
   * credential is the desired state, not an error.
   */
  public destroy(): void {
    this.#secret = null;
  }

  public get destroyed(): boolean {
    return this.#secret === null;
  }

  public get expiresAt(): Date {
    return this.#expiresAt;
  }

  public get purpose(): string {
    return this.#purpose;
  }

  /** How many times it was used. An audit signal; a rising number is a smell. */
  public get useCount(): number {
    return this.#useCount;
  }

  // ── Every route out is closed ─────────────────────────────────────────

  /** `JSON.stringify` writes the redaction, not the secret. */
  public toJSON(): string {
    return REDACTED;
  }

  /** Template literals and string coercion write the redaction. */
  public toString(): string {
    return REDACTED;
  }

  /** `console.log` and `util.inspect` write the redaction. */
  public [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * Generates the secret.
 *
 * `randomInt` from `node:crypto` rather than `Math.random`, and rejection-free
 * — `randomInt(max)` is already uniform. One character is drawn from each
 * class first so a portal's "must contain a digit" rule is satisfied by
 * construction rather than by retrying until it happens, then the rest is
 * drawn from the whole alphabet and the result is shuffled.
 */
function generateSecret(policy?: PasswordPolicy): string {
  const excluded = new Set((policy?.excludedCharacters ?? "").split(""));
  const drop = (source: string): string =>
    source
      .split("")
      .filter((character) => !excluded.has(character))
      .join("");

  const classes = [LOWER, UPPER, DIGIT, SYMBOL].map(drop);
  if (classes.some((characters) => characters.length === 0)) {
    throw new Error(
      `The observed password policy (from ${policy?.observedFrom ?? "an unstated source"}) ` +
        `excludes an entire character class. That is a portal rule we cannot satisfy while still ` +
        `generating a strong credential — a specialist should look at it rather than the system ` +
        `quietly generating a weaker one.`,
    );
  }

  const alphabet = classes.join("");
  const length = lengthFor(policy);

  const characters = classes.map(pick);
  while (characters.length < length) characters.push(pick(alphabet));

  // Fisher–Yates, so the class-per-position seeding is not visible in the
  // output. Without it the first four characters would always be
  // lower/upper/digit/symbol in that order.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    const held = characters[index] as string;
    characters[index] = characters[swap] as string;
    characters[swap] = held;
  }

  return characters.join("");
}

function pick(source: string): string {
  return source.charAt(randomInt(source.length));
}

/**
 * How long to make it.
 *
 * A `maxLength` below the floor is refused rather than honoured. A portal that
 * genuinely caps passwords at twelve characters is a fact a specialist should
 * see and decide about — silently generating a twelve-character credential
 * because a config said so is how a weak credential gets created with nobody
 * ever having chosen to create one.
 */
function lengthFor(policy?: PasswordPolicy): number {
  const min = Math.max(policy?.minLength ?? 0, DEFAULT_LENGTH);
  const max = policy?.maxLength;

  if (max === undefined) return min;

  if (max < FLOOR_LENGTH) {
    throw new Error(
      `The observed password policy (from ${policy?.observedFrom ?? "an unstated source"}) caps ` +
        `passwords at ${String(max)} characters, below the ${String(FLOOR_LENGTH)}-character ` +
        `floor. Refusing to generate a weak credential silently. A specialist decides what to do ` +
        `about a portal like that.`,
    );
  }

  return Math.min(min, max);
}
