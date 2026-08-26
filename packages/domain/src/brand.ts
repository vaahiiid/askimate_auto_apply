/**
 * Branded-type machinery.
 *
 * This is the foundation of ADR-0004 — the mechanism that makes it a *compile
 * error* for model-generated text to reach a university form field, rather than
 * something a code reviewer has to catch.
 *
 * A brand is a phantom property that exists only in the type system. Two types
 * with different brands are structurally incompatible even when their runtime
 * representation is identical, so TypeScript refuses to substitute one for the
 * other. Nothing is added at runtime.
 */

declare const BRAND: unique symbol;

/** Attaches a compile-time-only tag to `T`. */
export type Brand<T, TTag extends string> = T & { readonly [BRAND]: TTag };

/**
 * Strips a brand. Deliberately NOT exported from the package index.
 *
 * Only a module that has *earned the right* to mint a branded value may import
 * this, and each such module documents why. If you find yourself reaching for
 * it to "just get the string out", you are about to defeat the control this
 * file exists to provide — pass the branded value along instead.
 */
export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;
