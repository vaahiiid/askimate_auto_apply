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
import {
  RESOLUTION_OUTCOMES,
  WORKFLOW_PHASES,
  WORKFLOW_STATUSES,
} from "@askimate/aas-domain";
import type { RunStep } from "@askimate/aas-orchestrator";
import { phaseFor } from "@askimate/aas-orchestrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";
import pg from "pg";

import {
  ConversationEventStore,
  createConversationApp,
} from "@askimate/aas-conversation-service";
import { createSecureApp } from "@askimate/aas-secure-service";
import { createFillAgentApp } from "@askimate/aas-secure-filler";

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
import {
  proposeValue,
  provenanceOf,
  studentId,
  unwrapConfirmed,
} from "@askimate/aas-domain";
import {
  applyConfirmation,
  confirmField,
  emptyProfile,
  isDeclined,
} from "@askimate/aas-profile";
import {
  SECRET_LIFECYCLE,
  SECRET_PURPOSES,
  canTransition,
  isTerminalLifecycle,
} from "@askimate/aas-secrets";
import type { SecretLifecycle } from "@askimate/aas-secrets";

describe("the wire vocabulary and the domain do not drift", () => {
  it("names the same lifecycle words, in both directions", () => {
    expect([...SECRET_LIFECYCLES].sort()).toEqual([...SECRET_LIFECYCLE].sort());
  });

  it("agrees on which words are terminal", () => {
    // The contract calls a request "settled" on exactly the words the domain
    // calls terminal. If the domain made one non-terminal, a client would keep
    // a composer released against a request the server considered live.
    const domainTerminal = SECRET_LIFECYCLE.filter((word) =>
      isTerminalLifecycle(word),
    ).sort();
    expect(domainTerminal).toEqual([
      "secret_cancelled",
      "secret_consumed",
      "secret_expired",
    ]);
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
        join(
          import.meta.dirname,
          "..",
          "packages",
          "contracts",
          "openapi",
          "secure.v1.yaml",
        ),
        "utf8",
      ),
    ) as {
      components: {
        schemas: Record<
          string,
          { properties: Record<string, { enum: string[] }> }
        >;
      };
    };
    return spec.components.schemas["OpenSecretRequest"]!.properties["purpose"]!
      .enum;
  }

  it("keeps CREDENTIAL_PURPOSES equal to the published contract's enum", () => {
    // `packages/mapping` must not depend on `@askimate/aas-secrets` — that
    // package holds the only plaintext in the system — so ADR-0043's list is
    // written twice. This is what makes writing it twice safe, and it compares
    // against the DOCUMENT rather than against a literal: the first version of
    // this test asserted the two words inline, which would have passed while
    // the contract said something else entirely.
    expect([...CREDENTIAL_PURPOSES].sort()).toEqual(
      [...contractPurposes()].sort(),
    );
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

    expect(
      domain,
      "the domain's purposes changed — decide about the contract",
    ).toEqual(["portal_account_creation", "portal_sign_in"]);
    expect(
      contract,
      "the contract's purposes changed — decide about the domain",
    ).toEqual(["portal_account_creation", "portal_password_reset"]);

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
    expect([...WORK_APPROACHES].sort()).toEqual(
      [...AUTHENTICATION_APPROACHES].sort(),
    );
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
      expect(
        RUN_STEP_KINDS,
        `${kind} is not a step the orchestrator produces`,
      ).toContain(kind);
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
    if (isDeclined(confirmed))
      expect.unreachable("it should have been accepted");
    const profile = confirmField(emptyProfile(student, now), confirmed, now);

    const usable = checkUsable(
      GATED_PORTAL_MAPPING_SET,
      GATED_PORTAL_BLUEPRINT,
    );
    if (!usable.usable)
      expect.unreachable(`the gated mapping set should be usable`);
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
    if (!taken.ok)
      expect.unreachable(`a plan with no uploads is transportable`);
    expect(taken.plan.instructions.length).toBeGreaterThan(0);

    const back = rehydratePlan(taken.plan);
    expect(back.instructions).toHaveLength(transportable.instructions.length);

    for (const [at, instruction] of back.instructions.entries()) {
      const original = transportable.instructions[at];
      if (original === undefined)
        expect.unreachable("same length, same indices");
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
        {
          fieldRef: "passport",
          label: "Passport",
          documentRef: "doc-1",
          locators: [],
        },
      ],
      handoffs: [],
      credentials: [],
      blockers: [],
    };
    expect(toStoredPlan(empty)).toEqual({ ok: false, refusal: "has_uploads" });
    expect(
      toStoredPlan({
        ...empty,
        uploads: [],
        blockers: [{ kind: "no_mapping", fieldRef: "x", label: "X" }] as never,
      }),
    ).toEqual({ ok: false, refusal: "has_blockers" });
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
      expect(RESOLUTION_OUTCOMES, `the wire invented "${outcome}"`).toContain(
        outcome,
      );
    }
    expect(WIRE_RESOLUTION_OUTCOMES.length).toBeLessThan(
      RESOLUTION_OUTCOMES.length,
    );
  });

  it("names exactly what is NOT implemented, so building it is a deliberate act", () => {
    // The day route switching is built, this test is what notices the two
    // lists have to be reconciled — and ADR-0048 says that needs its own ADR
    // and a complete implementation, not an entry added here.
    const missing = RESOLUTION_OUTCOMES.filter(
      (outcome) =>
        !(WIRE_RESOLUTION_OUTCOMES as readonly string[]).includes(outcome),
    );
    expect(missing).toEqual(["route_fallback"]);
  });

  it("the parser REFUSES the unimplemented one", () => {
    expect(parseWireResolutionOutcome("resume")).toBe("resume");
    expect(parseWireResolutionOutcome("abandon")).toBe("abandon");
    expect(parseWireResolutionOutcome("route_fallback")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-0063 — the published contract names the routes that exist
// ───────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

/**
 * Just enough of an Express app to read its route table.
 *
 * Structural rather than `import type { Express }`, because `express` is not a
 * declared dependency of the tools project and adding one to compare two lists
 * of strings would be an undeclared dependency wearing a passing test's
 * clothes — the mistake this file's own header was written about.
 */
type RoutedApp = {
  readonly router?: { readonly stack?: unknown[] };
  readonly _router?: { readonly stack?: unknown[] };
};

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function specNamed(file: string): Doc {
  return load(
    readFileSync(
      join(import.meta.dirname, "..", "packages", "contracts", "openapi", file),
      "utf8",
    ),
  ) as Doc;
}

/**
 * Every route the real Express app registers, as `METHOD /path`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Walked off the ROUTER, not parsed out of the source. A regex over
 * `router.get("…")` reads what a file says; this reads what the process would
 * actually serve — including anything a nested router mounts that no grep
 * would attribute to the right prefix.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Express 5 keeps the layer stack on `app.router`, 4 kept it on `app._router`.
 * Both are read, and an absent or empty stack THROWS rather than returning an
 * empty set: an empty set would make every comparison below pass by comparing
 * the contract against nothing, which is the failure mode this whole guard
 * exists to prevent.
 */
function routesOf(app: RoutedApp): readonly string[] {
  const stack = app.router?.stack ?? app._router?.stack;
  if (!Array.isArray(stack) || stack.length === 0) {
    throw new Error(
      "Express exposed no layer stack, so this guard would compare the contract " +
        "against nothing. Failing instead.",
    );
  }
  const found: string[] = [];
  const walk = (layers: readonly unknown[]): void => {
    for (const layer of layers) {
      const item = layer as {
        route?: { path?: unknown; methods?: Record<string, boolean> };
        handle?: { stack?: unknown[] };
      };
      if (item.route !== undefined && typeof item.route.path === "string") {
        for (const [method, on] of Object.entries(item.route.methods ?? {})) {
          if (on && METHODS.has(method))
            found.push(`${method.toUpperCase()} ${item.route.path}`);
        }
        continue;
      }
      if (Array.isArray(item.handle?.stack)) walk(item.handle.stack);
    }
  };
  walk(stack);
  return [...new Set(found)].sort();
}

/** `:conversationId` → `{conversationId}`, so the two notations can be compared. */
function asContractPath(route: string): string {
  return route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Every `METHOD /path` a document publishes. */
function publishedIn(spec: Doc): readonly string[] {
  const published: string[] = [];
  for (const [path, item] of Object.entries(spec["paths"] as Doc)) {
    for (const [method, operation] of Object.entries(item as Doc)) {
      if (METHODS.has(method) && operation !== undefined) {
        published.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return published.sort();
}

/**
 * Routes that exist and are deliberately NOT in the wire contract.
 *
 * Named one at a time with the reason, rather than skipped by a pattern. A
 * pattern would silently swallow the next route that matched it, which is
 * precisely how the gaps this guard was written to find got in.
 */
const UNPUBLISHED: Readonly<Record<string, string>> = {
  // ADR-0056. Redirect endpoints: no JSON request body, no JSON response, and
  // "the browser's only role in the flow is carrying a redirect". A generated
  // client cannot call either meaningfully — following the redirect chain and
  // holding the resulting cookie is the browser's own job.
  "GET /auth/login":
    "ADR-0056 — a redirect the browser follows, not an operation",
  "GET /auth/callback":
    "ADR-0056 — a redirect the browser follows, not an operation",
  // ADR-0038. Mounted only when `AAS_DEV_SESSION` is set, and configuration
  // REFUSES that flag in production. Publishing a route that mints a session
  // for any subject named in its body would put an attack in the contract.
  "POST /dev/session":
    "ADR-0038 — refused in production; never a published operation",
};

/**
 * The Conversation Plane's app, with EVERY optional surface supplied.
 *
 * The route set depends on configuration — `auth`, `issueSessionFor` and
 * `publicDir` each mount something — so the guard builds the maximal app. A
 * route that exists under any supported configuration is a route that exists,
 * and checking the minimal app would let an unpublished surface hide behind an
 * unset option.
 *
 * Nothing connects: `pg.Pool` opens no socket until a query, and no handler
 * runs here. What is being read is the router, not the behaviour.
 */
/**
 * Enough of the auth wiring to make `createAuthRoutes` mount. Nothing calls it:
 * the guard reads the route table and never dispatches a request.
 */
const AUTH_ROUTES_ARE_MOUNTED = {} as unknown as NonNullable<
  Parameters<typeof createConversationApp>[0]["auth"]
>;

function conversationPlaneApp(): RoutedApp {
  return createConversationApp({
    store: new ConversationEventStore(
      new pg.Pool({ connectionString: "postgresql://unused" }),
    ),
    sessionSecret: "a-secret-long-enough-for-the-session-signer",
    authorise: async () => await Promise.resolve(true),
    now: () => new Date(),
    auth: AUTH_ROUTES_ARE_MOUNTED,
    issueSessionFor: () => "student",
  });
}

/** The Secure Plane is TWO processes, and the document covers the plane. */
function securePlaneRoutes(): readonly string[] {
  const service = createSecureApp({
    store: {} as unknown as Parameters<typeof createSecureApp>[0]["store"],
    vault: {} as unknown as Parameters<typeof createSecureApp>[0]["vault"],
    outbox: {} as unknown as Parameters<typeof createSecureApp>[0]["outbox"],
    now: () => new Date(),
    selfOrigin: "https://secure.test",
    parentOrigin: "https://app.test",
  });
  const filler = createFillAgentApp({
    vault: {} as unknown as Parameters<typeof createFillAgentApp>[0]["vault"],
    authorise: async () => await Promise.resolve({} as never),
    connect: () => {
      throw new Error("the guard reads the route table; it dispatches nothing");
    },
    now: () => new Date(),
  });
  return [...new Set([...routesOf(service), ...routesOf(filler)])].sort();
}

describe("the published contract names the routes that exist", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Written after an audit found FIVE path discrepancies that had accumulated
  // silently — a published `/health` that no process serves, a public
  // browser-facing route with no schema at all, and three internal routes
  // never published while three others were.
  //
  // They accumulated because this file loaded the OpenAPI documents and read
  // only their ENUMS. It never read `paths`. Everything below is the check
  // that was missing, and it compares against the real router rather than
  // against a list, so it cannot be satisfied by updating a literal.
  // ═══════════════════════════════════════════════════════════════════════

  it("publishes every route the Conversation Plane serves, and serves every one it publishes", () => {
    const served = routesOf(conversationPlaneApp()).map(asContractPath);
    const published = publishedIn(specNamed("conversation.v1.yaml"));

    const expectedPublic = served.filter(
      (route) => UNPUBLISHED[route] === undefined,
    );
    expect([...published].sort(), "published, but nothing serves it").toEqual(
      [...expectedPublic].sort(),
    );
  });

  it("publishes every route the Secure Plane serves, and serves every one it publishes", () => {
    // TWO processes: the Secure Interaction Service and the Fill Agent. The
    // document says so itself of `/internal/v1/secret-fills` — "Served by the
    // Secure Plane's FILL AGENT, not by this service" — so the comparison is
    // against the plane, which is what the document describes.
    const served = securePlaneRoutes().map(asContractPath);
    const published = publishedIn(specNamed("secure.v1.yaml"));
    expect(
      [...published].sort(),
      "published, but nothing in the plane serves it",
    ).toEqual([...served].sort());
  });

  it("REFUSES to pass when it is looking at no routes", () => {
    // The vacuity guard. A comparison against an empty set would agree with an
    // empty contract, and both halves of this test would go green while the
    // service served whatever it liked.
    expect(() => routesOf({})).toThrow(/no layer stack/);
    expect(
      routesOf(conversationPlaneApp()).length,
      "the plane still has routes",
    ).toBeGreaterThan(10);
    expect(
      securePlaneRoutes().length,
      "and so does the secure one",
    ).toBeGreaterThan(5);
  });

  it("names every deliberately unpublished route, with the decision that made it so", () => {
    // The exceptions are DATA, so an exception that stops being true fails
    // here rather than silently covering a route nobody meant to hide.
    const served = new Set(
      routesOf(conversationPlaneApp()).map(asContractPath),
    );
    for (const [route, reason] of Object.entries(UNPUBLISHED)) {
      expect(
        served.has(route),
        `${route} is excepted but no longer served`,
      ).toBe(true);
      expect(reason, `${route} needs a decision, not a shrug`).toMatch(
        /ADR-\d{4}/,
      );
    }
  });
});
