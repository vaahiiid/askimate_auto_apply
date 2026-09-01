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

import {
  RUN_PHASES,
  RUN_STATUSES,
  RUN_STEP_KINDS,
  SECRET_LIFECYCLES,
  WIRE_RESOLUTION_OUTCOMES,
  WORK_APPROACHES,
  WORK_KINDS,
  parseWireResolutionOutcome,
} from "@askimate/aas-contracts";
import { AUTHENTICATION_APPROACHES } from "@askimate/aas-account";
import { RESOLUTION_OUTCOMES, WORKFLOW_PHASES, WORKFLOW_STATUSES } from "@askimate/aas-domain";
import type { RunStep } from "@askimate/aas-orchestrator";
import { phaseFor } from "@askimate/aas-orchestrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";

import {
  CREDENTIAL_PURPOSES,
  checkUsable,
  planFill,
  rehydratePlan,
  textOf,
  toStoredPlan,
} from "@askimate/aas-mapping";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { proposeValue, provenanceOf, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";
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

describe("the work vocabulary and the domain do not drift", () => {
  it("declares exactly the approaches the account domain has", () => {
    // Re-declared rather than imported, because `@askimate/aas-contracts` has
    // no dependencies and one here would be a dependency in the secure control
    // bundle too (ADR-0040). This is the price of that, paid here: two closed
    // sets, compared in both directions, so the duplication cannot drift.
    expect([...WORK_APPROACHES].sort()).toEqual([...AUTHENTICATION_APPROACHES].sort());
  });

  it("hands out every browser step the orchestrator can produce", () => {
    // ═══════════════════════════════════════════════════════════════════
    // This test used to assert the OPPOSITE for `execute` — that it was a
    // browser step deliberately withheld — and said in its own comment that the
    // phase resolving the gap would delete it in the same diff. ADR-0046 was
    // that decision, and this is that diff.
    //
    // What it asserts now is the invariant the gap made impossible: every step
    // that needs a browser is a kind of work that can be claimed. A new browser
    // step added without a work kind fails here rather than silently never
    // being done.
    // ═══════════════════════════════════════════════════════════════════
    expect([...WORK_KINDS].sort()).toEqual(["create_account", "execute"]);
    for (const kind of WORK_KINDS) {
      expect(RUN_STEP_KINDS, `${kind} is not a step the orchestrator produces`).toContain(kind);
    }
  });
});

describe("a plan survives the round trip to the runner and back", () => {
  it("loses nothing — not the value, and not the confirmation behind it", () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0046. `StoredFillPlan` and `TransportedPlan` are the same shape held
    // by two packages that may not depend on each other, and a real plan is
    // taken through both here. A field added to one and forgotten in the other
    // fails on the value, not on a list of names.
    // ═══════════════════════════════════════════════════════════════════
    const now = new Date("2026-08-31T10:00:00Z");
    const student = studentId("11111111-1111-1111-1111-111111111111");
    const confirmed = applyConfirmation({
      key: "identity.given_name",
      proposed: proposeValue({
        value: "Niloofar",
        origin: "conversation",
        verbatim: "my name is Niloofar",
        confidence: 1,
      }),
      confirmation: {
        studentRef: student,
        presentedText: "Is that right?",
        response: { kind: "accepted" },
        respondedAt: now,
      },
    });
    if (isDeclined(confirmed)) expect.unreachable("it should have been accepted");
    const profile = confirmField(emptyProfile(student, now), confirmed, now);

    const usable = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
    if (!usable.usable) expect.unreachable(`the gated mapping set should be usable`);
    const plan = planFill(GATED_PORTAL_BLUEPRINT, usable.mappingSet, profile);

    // A real plan against a real blueprint has blockers while the profile is
    // partial, so the round trip is checked on the instructions it DID produce.
    const transportable = {
      ...plan,
      uploads: [],
      handoffs: [],
      blockers: [],
    };
    const taken = toStoredPlan(transportable);
    if (!taken.ok) expect.unreachable(`a plan with no uploads is transportable`);
    expect(taken.plan.instructions.length).toBeGreaterThan(0);

    const back = rehydratePlan(taken.plan);
    expect(back.instructions).toHaveLength(transportable.instructions.length);

    for (const [at, instruction] of back.instructions.entries()) {
      const original = transportable.instructions[at];
      if (original === undefined) expect.unreachable("same length, same indices");
      expect(instruction.fieldRef).toBe(original.fieldRef);
      expect(instruction.locators).toEqual(original.locators);
      expect(textOf(instruction.value)).toBe(textOf(original.value));

      if (original.value.kind !== "confirmed") continue;
      if (instruction.value.kind !== "confirmed") {
        expect.unreachable("a confirmed value must come back confirmed");
      }
      // THE assertion. Not merely "the text survived" — the confirmation behind
      // it survived, which is what makes it a value the student agreed to rather
      // than one this system produced.
      expect(provenanceOf(instruction.value.value)).toEqual(
        provenanceOf(original.value.value),
      );
      expect(unwrapConfirmed(instruction.value.value)).toBe(
        unwrapConfirmed(original.value.value),
      );
    }
  });

  it("REFUSES a plan it cannot carry, rather than carrying part of it", () => {
    // A plan with its uploads dropped would report itself complete having
    // attached nothing, and the student would be told their application was
    // filled.
    const empty: Parameters<typeof toStoredPlan>[0] = {
      blueprintId: "bp",
      blueprintVersion: "1.0.0",
      mappingSetId: "ms",
      instructions: [],
      uploads: [
        { fieldRef: "passport", label: "Passport", documentRef: "doc-1", locators: [] },
      ],
      handoffs: [],
      credentials: [],
      blockers: [],
    };
    expect(toStoredPlan(empty)).toEqual({ ok: false, refusal: "has_uploads" });
    expect(toStoredPlan({ ...empty, uploads: [], blockers: [
      { kind: "no_mapping", fieldRef: "x", label: "X" },
    ] as never })).toEqual({ ok: false, refusal: "has_blockers" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The wire admits only what is implemented (ADR-0048 §4)
// ───────────────────────────────────────────────────────────────────────────

describe("resolution outcomes, on the wire and in the domain", () => {
  it("the wire's set is a STRICT SUBSET of the domain's", () => {
    // The domain models the decision ADR-0008 described, `route_fallback`
    // included. The wire admits only what is built. Keeping them as two lists
    // is deliberate — and this is the test that stops them drifting apart
    // silently in either direction.
    for (const outcome of WIRE_RESOLUTION_OUTCOMES) {
      expect(RESOLUTION_OUTCOMES, `the wire invented "${outcome}"`).toContain(outcome);
    }
    expect(WIRE_RESOLUTION_OUTCOMES.length).toBeLessThan(RESOLUTION_OUTCOMES.length);
  });

  it("names exactly what is NOT implemented, so building it is a deliberate act", () => {
    // The day route switching is built, this test is what notices the two
    // lists have to be reconciled — and ADR-0048 says that needs its own ADR
    // and a complete implementation, not an entry added here.
    const missing = RESOLUTION_OUTCOMES.filter(
      (outcome) => !(WIRE_RESOLUTION_OUTCOMES as readonly string[]).includes(outcome),
    );
    expect(missing).toEqual(["route_fallback"]);
  });

  it("the parser REFUSES the unimplemented one", () => {
    expect(parseWireResolutionOutcome("resume")).toBe("resume");
    expect(parseWireResolutionOutcome("abandon")).toBe("abandon");
    expect(parseWireResolutionOutcome("route_fallback")).toBeNull();
  });
});
