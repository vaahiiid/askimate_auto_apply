/**
 * The whole chain, end to end, against a replay of a discovered portal.
 *
 *   pnpm run end-to-end
 *
 * ── What this run actually does ───────────────────────────────────────────
 *
 *   1. DISCOVERS a portal read-only, capturing every page to disk
 *   2. A specialist REVIEWS the draft blueprint          (stubbed — see below)
 *   3. REPLAYS the captured pages from a local server
 *   4. INTERVIEWS the student in conversation            (scripted replies)
 *   5. PLANS the fill, before any browser is opened
 *   6. VALIDATES it against the portal's own recorded rules
 *   7. PREVIEWS exactly what will be submitted, and hashes it
 *   8. CAPTURES the student's authorisation
 *   9. FILLS the portal
 *  10. STOPS
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * The portal here is a local fixture standing in for a real one, and the
 * replay is static HTML with no server behind it. This proves the chain runs
 * and that the guards hold. It does not prove any real university would accept
 * the application, and a run against a replay must never be described as a
 * real end-to-end application.
 *
 * Two steps are stubbed and are marked in the output as stubs:
 *
 *   • the specialist's blueprint review — a human does this
 *   • the specialist's mapping review — two humans do this
 *
 * Both are stubbed because they are decisions, not code. Everything else here
 * is the real implementation.
 */

import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import {
  PlaywrightDiscoverySession,
  PlaywrightPreparationSession,
  draftBlueprintFrom,
  startReplayServer,
} from "@askimate/aas-browser-runner";
import {
  DISCLOSURE_ACTIVITY,
  authoriseDisclosure,
  determineLawfulBasis,
  renderDisclosureRequest,
  type DisclosureAuthorisation,
  type LawfulBasisDetermination,
} from "@askimate/aas-disclosure";
import { describeRedacted, isFieldUnavailable, studentId } from "@askimate/aas-domain";
import {
  newInterview,
  receiveAnswer,
  receiveConfirmation,
  recordDocument,
} from "@askimate/aas-interview";
import type { InterviewState } from "@askimate/aas-interview";
import { DeterministicModelClient, MeteredModelClient } from "@askimate/aas-llm";
import { checkUsable } from "@askimate/aas-mapping";
import type { MappingSet } from "@askimate/aas-mapping";
import { executePlan, beginRun, markFilled, nextStep, requiredFieldsFor, withAuthorisation, withProfile } from "@askimate/aas-orchestrator";
import type { RunState } from "@askimate/aas-orchestrator";
import { InMemoryAuthorisationLedger } from "@askimate/aas-preparation";
import type { PreviewDocument } from "@askimate/aas-preparation";
import { emptyProfile, resolveField } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";

const DIM = "[2m";
const BOLD = "[1m";
const BLUE = "[36m";
const GREEN = "[32m";
const AMBER = "[33m";
const RESET = "[0m";

const NOW = new Date("2026-08-26T12:00:00Z");
const STUDENT = studentId("student-demo");
const CASE_ID = "case-demo-1";

const PASSPORT: PreviewDocument = {
  documentId: "doc-passport-1",
  filename: "passport.pdf",
  contentHash: "sha256:fixture-passport",
};

const PASSPORT_BYTES = new TextEncoder().encode("%PDF-1.4 fixture passport");

/**
 * The lawful basis for sending a document to a university.
 *
 * Determined by a named person, with reasoning, and due for review — because
 * this is a determination, not a constant. Stubbed here as the specialist
 * reviews are: it is a decision, not code.
 */
function disclosureBasis(): LawfulBasisDetermination {
  const check = determineLawfulBasis(
    {
      determinationId: "lb-disclose-demo",
      activity: {
        activity: DISCLOSURE_ACTIVITY,
        purpose: "Send supporting documents to the university the student is applying to.",
        documentTypes: ["passport"],
      },
      article6: "contract",
      requiresStudentAuthorisation: true,
      determinedBy: "dpo-demo",
      determinedAt: NOW,
      reasoning:
        "Necessary to perform the service the student asked for. Specific authorisation is " +
        "still taken because the destination is a third party.",
      reviewBy: new Date("2027-08-26T00:00:00Z"),
    },
    NOW,
  );
  if (!check.valid) throw new Error(`lawful basis invalid: ${check.refusal.kind}`);
  return check.determination;
}

/** The student's specific authorisation to send this passport to this university. */
function passportDisclosure(portalHost: string): DisclosureAuthorisation {
  const request = {
    disclosureId: "disc-demo-1",
    subject: {
      documentId: PASSPORT.documentId,
      documentType: "passport",
      contentHash: PASSPORT.contentHash,
      caseId: CASE_ID,
      requestedFor: "Identity verification",
    },
    destination: { institutionName: "Example University", portalHost },
    determination: disclosureBasis(),
  } as const;

  const check = authoriseDisclosure({
    ...request,
    studentAuthorisation: {
      studentRef: STUDENT,
      presentedText: renderDisclosureRequest(request),
      authorisedAt: NOW,
      method: "chat_affirmation",
    },
  });
  if (!check.authorised) throw new Error(`disclosure refused: ${check.refusal.kind}`);
  return check.authorisation;
}

/** Scripted student replies. Awkward ones included, as in the interview demo. */
const SCRIPT: Partial<Record<ProfileFieldKey, string[]>> = {
  "identity.given_name": ["Niloofar"],
  "identity.family_name": ["Hosseini"],
  // Refused first — 02/04 is April 2nd here and February 4th in America.
  "identity.date_of_birth": ["02/04/1999", "2 April 1999"],
  "identity.nationality": ["Iranian"],
};

const used = new Map<string, number>();

function reply(fieldKey: ProfileFieldKey): string {
  const options = SCRIPT[fieldKey] ?? ["(no scripted answer)"];
  const index = Math.min(used.get(fieldKey) ?? 0, options.length - 1);
  used.set(fieldKey, index + 1);
  return options[index] ?? "";
}

function heading(step: string, title: string): void {
  console.log(`\n${BOLD}${step}  ${title}${RESET}\n${DIM}${"─".repeat(72)}${RESET}`);
}

function stub(what: string): void {
  console.log(`  ${AMBER}STUB${RESET}  ${what}`);
}

/** Serves the fixture portal, standing in for a real one. */
async function startFixturePortal(): Promise<{ server: Server; baseUrl: string }> {
  const html = await readFile(
    join(import.meta.dirname, "..", "apps", "browser-runner", "fixtures", "preparation-form.html"),
    "utf8",
  );
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });
  return { server, baseUrl };
}

async function main(): Promise<void> {
  const model = new MeteredModelClient(new DeterministicModelClient());
  const workDir = await mkdtemp(join(tmpdir(), "aas-e2e-"));
  const captureDir = join(workDir, "capture");
  await mkdir(join(captureDir, "pages"), { recursive: true });

  const portal = await startFixturePortal();

  // ── 1. Discovery, read-only ─────────────────────────────────────────────
  heading("1", "Discovery — read-only, capturing every page");

  const discovery = await PlaywrightDiscoverySession.open({
    capability: "read_only",
    allowedHosts: ["127.0.0.1"],
    runId: "e2e-discovery",
    traceDir: join(workDir, "discovery-trace"),
    now: () => NOW,
  });

  await discovery.goto(`${portal.baseUrl}/apply`);
  const observation = await discovery.observe();
  await writeFile(join(captureDir, "pages", "001.html"), await discovery.html());
  await writeFile(
    join(captureDir, "pages", "index.json"),
    JSON.stringify(
      {
        runId: "e2e-discovery",
        capturedAt: NOW.toISOString(),
        pages: [{ url: observation.url, file: "pages/001.html", capturedAt: NOW.toISOString() }],
      },
      null,
      2,
    ),
  );
  await discovery.close();

  const fields = observation.forms.flatMap((form) => form.fields);
  console.log(`  ${GREEN}✓${RESET} observed ${String(fields.length)} fields on ${observation.url}`);
  console.log(`  ${DIM}${fields.map((f) => f.name ?? f.id ?? "?").join(", ")}${RESET}`);

  const draft = draftBlueprintFrom({
    blueprintId: "bp-e2e-fixture",
    institutionName: "Example University",
    courseName: "MSc Example Studies",
    intake: "September 2026",
    route: "direct_portal",
    observations: [observation],
    discoveryRunId: "e2e-discovery",
    discoveredAt: NOW,
    unobservedClaims: [],
    authenticationRequired: false,
    authenticationNotes: "The fixture has no login.",
  });
  console.log(`  ${GREEN}✓${RESET} draft blueprint — status ${BOLD}${draft.status}${RESET}`);

  // ── 2. Specialist review ────────────────────────────────────────────────
  heading("2", "Specialist review of the blueprint");
  stub("A human checks the draft against the real portal and marks it reviewed.");

  const blueprint: ApplicationBlueprint = {
    ...draft,
    status: "reviewed",
    provenance: { ...draft.provenance, reviewedBy: "specialist-a", reviewedAt: NOW },
  };
  console.log(`  ${GREEN}✓${RESET} blueprint status now ${BOLD}${blueprint.status}${RESET}`);

  // ── 3. Replay ───────────────────────────────────────────────────────────
  heading("3", "Replay — the captured pages, served locally");

  portal.server.close();
  const replay = await startReplayServer(captureDir);
  const replayUrl = replay.addressOf(observation.url);
  if (replayUrl === null) throw new Error("the captured page has no replay address");
  const replayHost = new URL(replayUrl).hostname;
  console.log(`  ${GREEN}✓${RESET} replaying at ${replayUrl}`);
  console.log(`  ${DIM}The live fixture is now shut down. Nothing beyond this point`);
  console.log(`  touches anything but saved HTML.${RESET}`);

  // ── 4. The mapping set ──────────────────────────────────────────────────
  heading("4", "Field mapping");
  stub("Two specialists author and review the mapping set.");

  const mappingSet: MappingSet = {
    mappingSetId: "map-e2e-fixture",
    version: "1.0.0",
    status: "reviewed",
    blueprintId: String(blueprint.blueprintId),
    blueprintVersion: blueprint.version,
    authoredBy: "specialist-a",
    reviewedBy: "specialist-b",
    authoredAt: NOW,
    reviewedAt: NOW,
    mappings: [
      {
        fieldRef: "given_name",
        source: { kind: "profile_field", fieldKey: "identity.given_name", format: { kind: "text" } },
      },
      {
        fieldRef: "family_name",
        source: {
          kind: "profile_field",
          fieldKey: "identity.family_name",
          format: { kind: "text" },
        },
      },
      {
        fieldRef: "date_of_birth",
        source: {
          kind: "profile_field",
          fieldKey: "identity.date_of_birth",
          // The portal's pattern attribute says DD/MM/YYYY.
          format: { kind: "date", pattern: "DD/MM/YYYY" },
        },
      },
      {
        fieldRef: "nationality",
        source: {
          kind: "profile_field",
          fieldKey: "identity.nationality",
          format: { kind: "option", options: { Iranian: "IR", British: "GB" } },
        },
      },
      { fieldRef: "passport", source: { kind: "document", documentRef: "passport" } },
      {
        fieldRef: "declaration",
        source: {
          kind: "student_handoff",
          reason: "A legal declaration. The student ticks this themselves (brief §7).",
        },
      },
    ],
  };

  const usable = checkUsable(mappingSet, blueprint);
  if (!usable.usable) throw new Error(`mapping set unusable: ${usable.refusal.detail}`);
  console.log(`  ${GREEN}✓${RESET} mapping set usable — reviewed by someone other than its author`);

  // ── 5. The run ──────────────────────────────────────────────────────────
  heading("5", "The conversation, and everything that follows");

  const documents = new Map<string, PreviewDocument>([["passport", PASSPORT]]);
  let profile = emptyProfile(STUDENT, NOW);
  let interview: InterviewState = newInterview({
    studentRef: STUDENT,
    profile,
    requiredFields: requiredFieldsFor(blueprint, usable.mappingSet),
    requiredDocuments: ["passport"],
  });

  let state: RunState = beginRun({
    inputs: {
      caseId: CASE_ID,
      studentRef: STUDENT,
      blueprint,
      mappingSet,
      documents,
    },
    profile,
    interview,
  });

  const ledger = new InMemoryAuthorisationLedger();
  let guard = 0;

  for (;;) {
    if (++guard > 60) throw new Error("the run did not converge");
    const step = await nextStep(state, model);

    if (step.kind === "interview") {
      const action = step.action;

      if (action.kind === "ask") {
        console.log(`  ${BLUE}AskiMate${RESET}  ${action.say}`);
        const said = reply(action.fieldKey);
        console.log(`  ${BLUE}Student ${RESET}  ${said}`);
        const outcome = await receiveAnswer(interview, action.fieldKey, said, model);
        interview = outcome.state;
        if (outcome.kind === "not_understood") {
          console.log(`  ${AMBER}·${RESET} ${DIM}${outcome.reason}${RESET}`);
        }
        state = withProfile(state, profile, interview);
        continue;
      }

      if (action.kind === "confirm") {
        console.log(`  ${BLUE}AskiMate${RESET}  ${action.say.replace(/\n/g, "\n            ")}`);
        console.log(`  ${BLUE}Student ${RESET}  Yes.`);
        const outcome = receiveConfirmation(interview, { agreed: true }, NOW);
        interview = outcome.state;
        profile = interview.profile;
        state = withProfile(state, profile, interview);
        continue;
      }

      if (action.kind === "request_document") {
        console.log(`  ${BLUE}AskiMate${RESET}  ${action.say}`);
        console.log(`  ${BLUE}Student ${RESET}  [uploads passport.pdf]`);
        interview = recordDocument(interview, action.documentType);
        state = withProfile(state, profile, interview);
        continue;
      }

      if (action.kind === "escalate") {
        console.log(`  ${AMBER}ESCALATE${RESET} ${action.reason}`);
        return;
      }

      // "complete" — the interview has nothing left, so the run moves on.
      state = withProfile(state, profile, interview);
      continue;
    }

    if (step.kind === "specialist") {
      console.log(`\n  ${AMBER}SPECIALIST${RESET}  ${step.reason}`);
      console.log(`  ${DIM}${step.detail}${RESET}`);
      return;
    }

    if (step.kind === "fix_content") {
      console.log(`\n  ${AMBER}FIX${RESET}  the portal would reject this:`);
      for (const violation of step.violations) console.log(`    ${violation.detail}`);
      return;
    }

    if (step.kind === "authorise") {
      heading("6", "What the student is asked to approve");
      console.log(
        step.presentedText
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      );
      console.log(`\n  ${BLUE}Student ${RESET}  Yes, submit that.`);
      const record = await ledger.record({
        authorisationId: "auth-1",
        caseId: CASE_ID,
        studentRef: STUDENT,
        preview: step.preview,
        authorisedAt: NOW,
      });
      state = withAuthorisation(state, record);
      continue;
    }

    if (step.kind === "execute") {
      heading("7", "Filling the portal");

      const session = await PlaywrightPreparationSession.open({
        capability: "fillable",
        allowedHosts: ["127.0.0.1"],
        runId: "e2e-preparation",
        traceDir: join(workDir, "preparation-trace"),
        now: () => NOW,
        // Nothing is clickable on this run: the fill does not need to advance a
        // page, and an empty allow-list is the strongest possible statement of
        // that.
        clickableControls: [],
      });

      try {
        await session.goto(replayUrl);
        const execution = await executePlan(
          session,
          step.plan,
          (ref) =>
            Promise.resolve(
              ref === "passport"
                ? {
                    documentId: PASSPORT.documentId,
                    contents: PASSPORT_BYTES,
                    contentHash: PASSPORT.contentHash,
                    // Not "the passport is in the vault" — the authority to
                    // send THIS file to THIS university for THIS reason.
                    authorisation: passportDisclosure(replayHost),
                  }
                : null,
            ),
          { portalHost: replayHost, withdrawals: [], now: NOW },
        );

        for (const outcome of execution.outcomes) {
          if (outcome.kind === "filled") {
            console.log(
              // The VALUE is never printed. This line used to print
              // `outcome.stored` — every confirmed answer, passport number
              // included, straight to stdout and into any CI log capturing it.
              `  ${GREEN}✓${RESET} ${outcome.fieldRef.padEnd(16)} ` +
                `${DIM}${describeRedacted(outcome.stored)}${RESET}`,
            );
          } else if (outcome.kind === "attached") {
            console.log(
              `  ${GREEN}✓${RESET} ${outcome.fieldRef.padEnd(16)} ${DIM}${outcome.documentId}${RESET}`,
            );
          } else {
            console.log(`  ${AMBER}✗${RESET} ${outcome.fieldRef}: ${outcome.error}`);
          }
        }

        for (const transmission of execution.transmissions) {
          console.log(
            `  ${DIM}sent  ${transmission.documentId} → ${transmission.institutionName} ` +
              `(${transmission.toHost})${RESET}`,
          );
        }

        for (const handoff of execution.handoffs) {
          console.log(`  ${AMBER}→${RESET} ${handoff.fieldRef.padEnd(16)} ${DIM}the student${RESET}`);
        }

        if (!execution.completed) {
          console.log(`\n  ${AMBER}The fill did not complete.${RESET}`);
          return;
        }
        state = markFilled(state);
      } finally {
        await session.close();
      }
      continue;
    }

    if (step.kind === "request_secret") {
      // Unreachable in this demo — the fixture portal needs no account, so no
      // password is ever asked for. Handled rather than ignored for the same
      // reason as the account steps below: falling through to "where this
      // stops" would report a completed application that had not happened.
      //
      // Note what is printed. The step carries metadata and an explanation,
      // and there is no field on it that could hold a password even if this
      // demo tried to print one.
      console.log(`\n  ${AMBER}PASSWORD${RESET}  ${step.say}`);
      console.log(
        `  ${DIM}secure control · ${step.request.purpose} · ${step.request.target.host} · ` +
          `single-use · ${String(step.request.ttlSeconds)}s${RESET}`,
      );
      return;
    }

    if (step.kind === "create_account" || step.kind === "student_handoff") {
      // The fixture portal has no login, so these are unreachable here. They
      // are handled rather than ignored because the REAL portal does, and a
      // demo that fell through to "where this stops" on an account step would
      // report a success it had not achieved.
      console.log(`\n  ${AMBER}ACCOUNT${RESET}  ${step.say}`);
      return;
    }

    if (step.kind === "hand_over_account") {
      console.log(`\n  ${AMBER}HANDOVER${RESET}  ${step.say}`);
      console.log(`  ${DIM}outstanding: ${step.outstanding.join(", ")}${RESET}`);
      return;
    }

    // ── The end ───────────────────────────────────────────────────────────
    heading("8", "Where this stops");
    console.log(`  ${GREEN}✓${RESET} The application is filled and authorised.`);
    console.log(`  ${DIM}Authorised content: ${step.contentHash}${RESET}`);
    console.log(
      `\n  ${BOLD}Nothing was submitted.${RESET} There is no code path from here to a\n` +
        `  submission: the session type has no submit method, and the click guard\n` +
        `  refuses a submission control. That is Phase 6, and it needs its own\n` +
        `  approval.\n`,
    );
    break;
  }

  // ── What it cost, and what it holds ────────────────────────────────────
  heading("9", "The record");

  const record = await ledger.currentFor(CASE_ID);
  console.log(`  Authorisation held      ${record === null ? "none" : record.authorisationId}`);
  console.log(`  Content hash            ${record?.contentHash ?? "—"}`);
  console.log(
    `  Preview text stored     ${String(record?.presentedText.length ?? 0)} characters, verbatim`,
  );

  const dob = resolveField(profile, "identity.date_of_birth");
  console.log(
    `  Date of birth in profile ${
      isFieldUnavailable(dob) ? "unavailable" : "confirmed by the student"
    }`,
  );

  const usage = model.usage;
  console.log(
    `\n  Model calls             ${String(usage.calls)}` +
      `\n  ${DIM}Tokens are estimated until a real client is wired in.${RESET}`,
  );
  console.log(`  Replay requests served  ${String(replay.requests.length)}`);

  await replay.stop();
}

await main();
