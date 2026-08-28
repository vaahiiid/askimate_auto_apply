/**
 * What the composer may do while a secure step is open.
 *
 * ── Typing is never blocked, and that is a type-level fact ────────────────
 *
 * `typing` is the literal `"live"`, not `"live" | "disabled"`. Disabling the
 * composer is safer in the narrow sense — a disabled input cannot receive a
 * password — and it is the modal freeze that breaks the one-continuous-
 * conversation requirement. The trade is deliberate and the residual risk is
 * stated in docs/composer-during-secure-turn.md §13.
 *
 * Making it a literal means "disable the composer" is not a value this
 * function can return. A future contributor who wants it has to change the
 * type, which is a conversation rather than a one-line edit.
 */

export interface ComposerPolicy {
  /** Always live. See above — the type is the argument. */
  readonly typing: "live";
  readonly send: "enabled" | "blocked";
  /**
   * Whether a draft may reach browser storage.
   *
   * Suspended while a step is open, because storage outlives the five-minute
   * TTL that governs everything else here: a mistyped password written to
   * localStorage would survive the request it was mistyped during.
   */
  readonly draftPersistence: "normal" | "suspended";
}

export function composerPolicy(state: { readonly awaitingSecret: boolean }): ComposerPolicy {
  return state.awaitingSecret
    ? { typing: "live", send: "blocked", draftPersistence: "suspended" }
    : { typing: "live", send: "enabled", draftPersistence: "normal" };
}
