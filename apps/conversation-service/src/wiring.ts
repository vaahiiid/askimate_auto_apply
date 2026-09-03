/**
 * Building a run driver from a connection string and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Two processes need one: the Conversation Service, which advances a run when
 * a student acts, and the Background Worker, which advances it when nobody is
 * watching (ADR-0052). They must build the SAME driver — a worker that wired a
 * different set of stores would be a second implementation of how a case moves,
 * which is what ADR-0041 exists to prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So the wiring lives here, once, and both entry points call it. It is also the
 * reason `apps/worker` depends on this package rather than assembling a driver
 * of its own.
 */

import type { Pool } from "pg";

import { loadCatalogueDirectory, type DeployedCatalogueEntry } from "@askimate/aas-catalogue";

import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { PostgresInterventionStore } from "@askimate/aas-case-store/postgres-interventions";
import { DeterministicModelClient } from "@askimate/aas-llm";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";

import { ApplicationBindingStore } from "./application-store.js";
import { ConversationEventStore } from "./event-store.js";
import { PostgresConfirmedProfileStore } from "./profile-store.js";
import { RunDriver } from "./run-driver.js";
import type { ApplicationCatalogue, CatalogueEntry } from "./run-driver.js";
import type { SecureRequestOpener } from "./secure-requests.js";
import { WorkLeaseStore } from "./work-store.js";

/**
 * The gated TEST portal, as a catalogue.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOT A PRODUCTION CATALOGUE, and `AAS_CATALOGUE=fixtures` is refused when
 * `NODE_ENV=production` precisely so this cannot reach a real student.
 *
 * There is no production adapter because there is nowhere to load a reviewed
 * blueprint FROM: no parser exists for one, and building a loader that accepts
 * arbitrary JSON would mint reviewed artefacts nobody reviewed — which is what
 * ADR-0004 and ADR-0009 exist to prevent. `docs/deployables.md` records it as
 * one of the two things that still block production, and it is its own phase.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function fixtureCatalogue(portalOrigin?: string): ApplicationCatalogue {
  const entry: CatalogueEntry = {
    blueprint: GATED_PORTAL_BLUEPRINT,
    mappingSet: GATED_PORTAL_MAPPING_SET,
    requiredDocuments: [],
    institutionRef: "inst-gated",
    courseRef: "course-msc-controlled",
    intakeRef: "2026-09",
    ...(portalOrigin === undefined ? {} : { portalOrigin }),
    portalAuthentication: {
      portalHost: "gated.portal.test",
      discoveryRunId: "run-gated-1",
      observedAt: new Date("2026-08-30T09:00:00Z"),
      applicantChoosesPassword: true,
      portalIssuesCredential: false,
      passwordlessAvailable: false,
      emailVerificationRequired: false,
      mfaOrOtpRequired: false,
      captchaPresent: false,
      passwordResetAvailable: true,
      credentialsCanBeHandedBack: true,
    },
    passwordDelivery: "askimate_secure_channel",
  };
  return { find: (id) => Promise.resolve(id === "bp-gated-portal" ? entry : null) };
}

/**
 * The catalogue a deployment actually serves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Here, beside `buildRunDriver`, for the reason that function is here: the
 * Conversation Service and the Worker must serve the SAME catalogue. A worker
 * advancing a run against a blueprint the service would not offer is the
 * second opinion ADR-0041 exists to prevent — and with P20 it would be worse
 * than a disagreement, because one of the two would be running an artefact
 * whose approval the other could not find.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Throws on failure, and the message lists EVERY problem. This is called from
 * a composition root during startup, where a process that cannot build a
 * trustworthy catalogue must refuse to start rather than serve a smaller one
 * (ADR-0055).
 */
export async function resolveCatalogue(input: {
  readonly source: "fixtures" | "registry";
  readonly directory?: string;
  readonly portalOrigins?: Readonly<Record<string, string>>;
}): Promise<ApplicationCatalogue> {
  if (input.source === "fixtures") {
    // A single origin override is meaningful here because the fixture serves
    // exactly one blueprint.
    return fixtureCatalogue(input.portalOrigins?.["bp-gated-portal"]);
  }

  if (input.directory === undefined) {
    throw new Error("AAS_CATALOGUE=registry needs AAS_CATALOGUE_DIR; nothing else can supply one");
  }

  const load = await loadCatalogueDirectory({
    directory: input.directory,
    ...(input.portalOrigins === undefined ? {} : { portalOrigins: input.portalOrigins }),
  });
  if (!load.ok) {
    throw new Error(
      `the catalogue at ${input.directory} cannot be served:\n` +
        load.problems.map((problem) => `  ${problem.source}: ${problem.detail}`).join("\n"),
    );
  }
  return load.catalogue;
}

/**
 * COMPILE-TIME: what the catalogue package produces is what the driver needs.
 *
 * `packages/catalogue` must not import from an app, so it cannot reference
 * `CatalogueEntry` directly — it rebuilds the shape and this assignment is what
 * keeps the two honest. A field added to one and not the other fails here,
 * which is the only place both are in scope.
 */
const _entryShapesAgree: (entry: DeployedCatalogueEntry) => CatalogueEntry = (entry) => entry;
void _entryShapesAgree;

export interface DriverWiring {
  readonly pool: Pool;
  readonly catalogue: ApplicationCatalogue;
  readonly secureRequests: SecureRequestOpener;
  /**
   * The trusted email-verification state (ADR-0056).
   *
   * Threaded through here so the Conversation Service and the Worker build the
   * SAME driver — a worker that advanced a run past a secure step the service
   * would have refused would be the second opinion ADR-0041 forbids.
   */
  readonly identities?: { verificationOf(studentId: string): Promise<boolean | null> };
  readonly now: () => Date;
}

/** The conversation event store, which both the driver and the app need. */
export function conversationStore(pool: Pool): ConversationEventStore {
  return new ConversationEventStore(pool);
}

export function buildRunDriver(wiring: DriverWiring, store: ConversationEventStore): RunDriver {
  return new RunDriver({
    stores: {
      cases: new PostgresCaseStore(wiring.pool),
      runs: new PostgresWorkflowRunStore(wiring.pool),
    },
    bindings: new ApplicationBindingStore(wiring.pool),
    catalogue: wiring.catalogue,
    // The interview's model. `DeterministicModelClient` is what a deployment
    // without Bedrock credentials gets, and it is honest about being a fixed
    // script rather than a model — which is why the catalogue, not this, is the
    // thing that refuses to run in production.
    model: new DeterministicModelClient(),
    profiles: new PostgresConfirmedProfileStore(wiring.pool),
    conversations: store,
    secureRequests: wiring.secureRequests,
    ...(wiring.identities === undefined ? {} : { identities: wiring.identities }),
    leases: new WorkLeaseStore(wiring.pool),
    interventions: new PostgresInterventionStore(wiring.pool),
    now: wiring.now,
  });
}
