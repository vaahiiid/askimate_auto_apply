/**
 * A password that exists for minutes and cannot be written down.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"A temporary/initial password may be generated for the
 * purpose of creating the account… We must not permanently store the student's
 * password… We must NOT retain permanent control of the student's account."*
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
 *   • redacts itself in every serialisation route JavaScript offers —
 *     `toJSON`, `toString`, and Node's inspect
 *   • expires, and refuses to be read after that
 *   • can be destroyed explicitly, and is destroyed by the handover
 *   • is not `Brand<string>`, because a branded string is still a string and
 *     `JSON.stringify` would happily write it out
 *
 * ── What this does NOT claim ──────────────────────────────────────────────
 *
 * The secret exists in memory and can be read by anything with a reference and
 * a call to `reveal()`. That is unavoidable — something has to type it into a
 * login form. What this removes is the ACCIDENTAL copy: the one nobody
 * decided to make. `reveal()` is deliberately conspicuous, and the call sites
 * are countable.
 */

/** Why a credential could not be read. */
export type CredentialUnavailable =
  | { readonly kind: "expired"; readonly detail: string }
  | { readonly kind: "destroyed"; readonly detail: string };

const REDACTED = "[temporary credential — never logged]";

/**
 * A single-purpose, short-lived credential.
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
  #revealCount = 0;

  private constructor(secret: string, expiresAt: Date, purpose: string) {
    this.#secret = secret;
    this.#expiresAt = expiresAt;
    this.#purpose = purpose;
  }

  /**
   * Mints a credential that expires.
   *
   * `expiresAt` is required and has no default. A credential with an
   * open-ended life is the thing this class exists to prevent, and a default
   * would be a decision made by whoever wrote the default rather than by
   * whoever is responsible for the account.
   */
  public static create(input: {
    readonly secret: string;
    readonly expiresAt: Date;
    /** What it is for, so an audit entry can say so without saying the secret. */
    readonly purpose: string;
  }): EphemeralCredential {
    if (input.secret.length === 0) {
      throw new Error("An empty credential is not a credential.");
    }
    return new EphemeralCredential(input.secret, input.expiresAt, input.purpose);
  }

  /**
   * Reads the secret.
   *
   * Named to be conspicuous at the call site, and it should stay countable:
   * account creation, first login, and nothing else. Everything after that is
   * the student's own password, which this system does not have.
   */
  public reveal(now: Date): { readonly ok: true; readonly secret: string } | { readonly ok: false; readonly reason: CredentialUnavailable } {
    if (this.#secret === null) {
      return {
        ok: false,
        reason: {
          kind: "destroyed",
          detail: `The credential for "${this.#purpose}" was destroyed and cannot be recovered.`,
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
            `${this.#expiresAt.toISOString()} and has been destroyed.`,
        },
      };
    }

    this.#revealCount += 1;
    return { ok: true, secret: this.#secret };
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

  /** How many times it was read. An audit signal; a rising number is a smell. */
  public get revealCount(): number {
    return this.#revealCount;
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
