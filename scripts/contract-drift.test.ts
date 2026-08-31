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

import { RUN_PHASES, RUN_STATUSES, RUN_STEP_KINDS, SECRET_LIFECYCLES } from "@askimate/aas-contracts";
import { WORKFLOW_PHASES, WORKFLOW_STATUSES } from "@askimate/aas-domain";
import type { RunStep } from "@askimate/aas-orchestrator";
import { phaseFor } from "@askimate/aas-orchestrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";

import { CREDENTIAL_PURPOSES } from "@askimate/aas-mapping";
import { SECRET_LIFECYCLE, SECRET_PURPOSES, canTransition, isTerminalLifecycle } from "@askimate/aas-secrets";
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

// ───────────────────────────────────────────────────────────────────────────
// P1 — the run's vocabulary, written twice for the same reason
// ───────────────────────────────────────────────────────────────────────────

describe("the run's wire words and the domain's do not drift", () => {
  it("names the same workflow phases, in both directions", () => {
    expect([...RUN_PHASES].sort()).toEqual([...WORKFLOW_PHASES].sort());
  });

  it("names the same workflow statuses, in both directions", () => {
    expect([...RUN_STATUSES].sort()).toEqual([...WORKFLOW_STATUSES].sort());
  });

  it("names every step kind the orchestrator can decide on", () => {
    // `phaseFor` is a total mapping over `RunStep["kind"]` and TypeScript
    // enforces its exhaustiveness, so a step kind added to the orchestrator
    // without being added here fails to compile in this file before it fails
    // this assertion — which is the order that helps.
    const kinds: readonly RunStep["kind"][] = [
      "interview",
      "specialist",
      "fix_content",
      "authorise",
      "execute",
      "create_account",
      "request_secret",
      "student_handoff",
      "ready_to_submit",
      "hand_over_account",
    ];
    expect([...RUN_STEP_KINDS].sort()).toEqual([...kinds].sort());
  });

  it("maps every wire step kind onto a wire phase", () => {
    // The client is told a phase and a step. If the orchestrator could map a
    // step onto a phase the contract does not publish, a client would receive a
    // word its parser rejects — and `parseConversationRun` would answer null on
    // a perfectly legitimate run.
    for (const kind of RUN_STEP_KINDS) {
      const step = { kind } as RunStep;
      expect(RUN_PHASES, `step ${kind}`).toContain(phaseFor(step));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-0043 — the credential purposes, written twice for the same reason
// ───────────────────────────────────────────────────────────────────────────

describe("the credential purposes, and a drift between three closed sets", () => {
  /** The published contract's own enum, read from the document. */
  function contractPurposes(): readonly string[] {
    const spec = load(
      readFileSync(
        join(import.meta.dirname, "..", "packages", "contracts", "openapi", "secure.v1.yaml"),
        "utf8",
      ),
    ) as { components: { schemas: Record<string, { properties: Record<string, { enum: string[] }> }> } };
    return spec.components.schemas["OpenSecretRequest"]!.properties["purpose"]!.enum;
  }

  it("keeps CREDENTIAL_PURPOSES equal to the published contract's enum", () => {
    // `packages/mapping` must not depend on `@askimate/aas-secrets` — that
    // package holds the only plaintext in the system — so ADR-0043's list is
    // written twice. This is what makes writing it twice safe, and it compares
    // against the DOCUMENT rather than against a literal: the first version of
    // this test asserted the two words inline, which would have passed while
    // the contract said something else entirely.
    expect([...CREDENTIAL_PURPOSES].sort()).toEqual([...contractPurposes()].sort());
  });

  it("RECORDS the drift between the domain and the contract, rather than hiding it", () => {
    // ── A real finding, found by wiring the two together ─────────────────
    //
    //   domain   (`SecretPurpose`)          portal_account_creation | portal_sign_in
    //   contract (`OpenSecretRequest`)      portal_account_creation | portal_password_reset
    //
    // They share ONE member and differ on the other. Nothing reachable is
    // broken: `secretRequestFor` only ever asks for `portal_account_creation`,
    // which both accept, and the Run Driver refuses anything the contract does
    // not name (`purpose_not_supported`) rather than casting into it.
    //
    // This test exists so the divergence is a recorded fact with an owner
    // rather than a surprise. Adding a member to either side without deciding
    // about the other fails HERE, which is where the decision belongs.
    const domain = [...SECRET_PURPOSES].sort();
    const contract = [...contractPurposes()].sort();

    expect(domain, "the domain's purposes changed — decide about the contract").toEqual([
      "portal_account_creation",
      "portal_sign_in",
    ]);
    expect(contract, "the contract's purposes changed — decide about the domain").toEqual([
      "portal_account_creation",
      "portal_password_reset",
    ]);

    // The one they agree on is the only one a run can currently reach.
    const shared = domain.filter((purpose) => contract.includes(purpose));
    expect(shared).toEqual(["portal_account_creation"]);
  });
});
