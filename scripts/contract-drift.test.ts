/**
 * The contract package and the domain must name the same things.
 *
 * ── Why this test lives in scripts/ rather than in either package ─────────
 *
 * It is a claim about the SEAM between `@askimate/aas-contracts` and
 * `@askimate/aas-secrets`, and putting it inside either one would require that
 * package to depend on the other.
 *
 * For the contract package specifically that is forbidden, and the boundary
 * check in `check-boundaries.ts` enforces it: the wire contract is consumed by
 * two services and two browser bundles, one of which is the secure control. A
 * dependency there is a dependency in all four. The first version of this
 * assertion lived in `contracts.test.ts` and imported the secrets package
 * without declaring it — which worked only because pnpm hoists, and which is an
 * undeclared dependency wearing a passing test's clothes.
 *
 * ── What the duplication is for ───────────────────────────────────────────
 *
 * `packages/contracts` declares the lifecycle words itself rather than
 * re-exporting them, and that is deliberate. Importing `@askimate/aas-secrets`
 * as a VALUE drags `InMemorySecretStore` — the object that actually holds
 * plaintext — toward any browser bundle that touches the module. Measured, not
 * hypothetical: esbuild refused to build the Phase D client with
 * `Could not resolve "node:crypto"` when exactly that import was tried.
 *
 * So the words are written twice on purpose, and this is the test that makes
 * writing them twice safe.
 */

import { describe, expect, it } from "vitest";

import { SECRET_LIFECYCLES } from "@askimate/aas-contracts";
import { SECRET_LIFECYCLE, canTransition, isTerminalLifecycle } from "@askimate/aas-secrets";
import type { SecretLifecycle } from "@askimate/aas-secrets";

describe("the wire vocabulary and the domain do not drift", () => {
  it("names the same lifecycle words, in both directions", () => {
    expect([...SECRET_LIFECYCLES].sort()).toEqual([...SECRET_LIFECYCLE].sort());
  });

  it("agrees on which words are terminal", () => {
    // The contract calls a request "settled" on exactly the words the domain
    // calls terminal. If the domain made one non-terminal, a client would keep
    // a composer released against a request the server considered live.
    const domainTerminal = SECRET_LIFECYCLE.filter((word) => isTerminalLifecycle(word)).sort();
    expect(domainTerminal).toEqual(["secret_cancelled", "secret_consumed", "secret_expired"]);
  });

  it("keeps cancellation reachable only from a request nobody has answered", () => {
    // ADR-0032, checked at the seam rather than only inside the domain: once a
    // handle exists the automation may already be spending it, and a
    // cancellation racing a consumption would be a lie in one direction.
    expect(canTransition("secret_requested", "secret_cancelled")).toBe(true);
    expect(canTransition("secret_received", "secret_cancelled")).toBe(false);
  });

  it("has a compile-time bridge, so a domain rename cannot pass silently", () => {
    // The runtime checks above compare VALUES. This asserts the TYPES line up
    // too: if the domain renamed a member, the assignment below would fail to
    // compile even before a test ran.
    const bridge: readonly SecretLifecycle[] = SECRET_LIFECYCLES;
    expect(bridge.length).toBe(SECRET_LIFECYCLE.length);
  });
});
