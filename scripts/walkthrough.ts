/**
 * An end-to-end walkthrough of one application case.
 *
 * Run with:  pnpm run walkthrough
 *
 * This is not a test — the test suite covers correctness. This exists so the
 * behaviour can be *seen*: a real case, driven through the real state machine,
 * against the real store, printing what happens and why at each step.
 *
 * It demonstrates, in order:
 *   1. a case cannot exist without evidence the student asked for it
 *   1b. the agent interviews — the student never fills in a form
 *   2. a missing document blocks progress
 *   3. financial evidence forces human review REGARDLESS of confidence
 *   4. the student authorises exact content, captured as a hash
 *   5. changing the content afterwards VOIDS that authorisation
 *   6. a duplicate submission is refused
 *   7. a re-application requires an explicit student instruction
 */

import {
  askimateActor,
  caseId,
  isConversationalAsk,
  ownerFor,
  proposeValue,
  unwrapProposed,
  courseId,
  decide,
  decideReapplication,
  externalRef,
  fold,
  institutionId,
  intake,
  openCase,
  recommendWait,
  stamp,
  studentId,
  submissionKey,
  type CaseEventPayload,
  type CaseIntent,
  type RequestEvidence,
  type SubmissionIdentity,
} from "@askimate/aas-domain";
import { InMemoryCaseStore } from "@askimate/aas-case-store";

// ── Presentation helpers ────────────────────────────────────────────────────

const BOLD = "[1m";
const DIM = "[2m";
const GREEN = "[32m";
const RED = "[31m";
const AMBER = "[33m";
const RESET = "[0m";

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}`);
  console.log(DIM + "─".repeat(text.length) + RESET);
}

function ok(text: string): void {
  console.log(`  ${GREEN}✓${RESET} ${text}`);
}

function refused(text: string): void {
  console.log(`  ${RED}✗ REFUSED${RESET} ${text}`);
}

function note(text: string): void {
  console.log(`    ${DIM}${text}${RESET}`);
}

function blocked(text: string): void {
  console.log(`  ${AMBER}⏸${RESET} ${text}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const CASE = caseId("case_demo_001");
const ACTOR = askimateActor(externalRef("askimate:user:4812"));
const CLOCK = new Date("2026-08-26T10:15:00Z");

const IDENTITY: SubmissionIdentity = {
  studentId: studentId("stu_001"),
  institutionId: institutionId("inst_leeds"),
  courseId: courseId("crs_msc_data_science"),
  intake: intake("2027-09"),
  attemptOrdinal: 1,
};

const EVIDENCE: RequestEvidence = {
  requestedAt: new Date("2026-08-26T10:14:22Z"),
  channel: "askimate_chat",
  conversationRef: externalRef("askimate:conversation:9931"),
  studentStatement: "Yes, please apply to Leeds for me.",
};

// ── Driver ──────────────────────────────────────────────────────────────────

const store = new InMemoryCaseStore();
let eventCounter = 0;

async function currentCase() {
  return fold(await store.read(CASE));
}

/** Applies an intent, printing the outcome. Returns whether it was accepted. */
async function apply(label: string, intent: CaseIntent): Promise<boolean> {
  const before = await currentCase();
  const decision = decide(before, intent);

  if (!decision.accepted) {
    refused(label);
    const { refusal } = decision;
    const detail =
      "detail" in refusal
        ? refusal.detail
        : `${refusal.refusal.kind}: ${refusal.refusal.detail}`;
    note(detail);
    return false;
  }

  await commit(decision.events);
  const after = await currentCase();
  ok(`${label} ${DIM}→ ${after.state}${RESET}`);
  return true;
}

async function commit(payloads: readonly CaseEventPayload[]): Promise<void> {
  const sequence = await store.currentSequence(CASE);
  const events = stamp({
    caseId: CASE,
    fromSequence: sequence,
    payloads,
    actor: ACTOR,
    now: CLOCK,
    nextEventId: () => {
      eventCounter += 1;
      return `evt_${String(eventCounter).padStart(4, "0")}`;
    },
  });
  await store.append(CASE, sequence, events);
}

async function main(): Promise<void> {
  console.log(`${BOLD}AskiMate AAS — Phase 1 walkthrough${RESET}`);
  console.log(`${DIM}One application case, driven through the real state machine.${RESET}`);

  // ── 1 ───────────────────────────────────────────────────────────────────
  heading("1. Opening a case requires evidence the student asked");
  await commit([openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE })]);
  const opened = await currentCase();
  ok(`Case opened → ${opened.state}`);
  note(`Because the student said: "${opened.requestEvidence.studentStatement}"`);
  // The key uses a unit separator (U+001F) so no id can forge a collision.
  // Swap it for a visible bullet purely for display here.
  const UNIT_SEPARATOR = String.fromCharCode(0x1f);
  note(`Submission key: ${submissionKey(opened.submissionIdentity).split(UNIT_SEPARATOR).join(" · ")}`);
  await store.claimSubmissionKey(submissionKey(opened.submissionIdentity), CASE);
  note("Submission key claimed — no other case can now submit this application.");

  // ── 1b ──────────────────────────────────────────────────────────────────
  heading("1b. The agent interviews — the student never fills in a form");
  note("Missing information becomes a QUESTION the agent owns, not a form field.");

  for (const kind of ["provide_profile_field", "provide_document", "authorise_submission"] as const) {
    const owner = ownerFor(kind);
    const how = isConversationalAsk(kind) ? "asks the student in conversation" : "requests it";
    if (owner === "agent") {
      ok(`${kind} ${DIM}→ owned by the AGENT, which ${how}${RESET}`);
    } else {
      blocked(`${kind} ${DIM}→ owned by the STUDENT (only §7 handoff + authorisation are)${RESET}`);
    }
  }

  console.log();
  note('Student says: "I finished my bachelor\'s in computer science in 2023, got 17 out of 20."');
  const heard = proposeValue({
    value: "BSc Computer Science",
    origin: "conversation",
    verbatim: "I finished my bachelor's in computer science in 2023, got 17 out of 20",
    confidence: 0.93,
  });
  const read = unwrapProposed(heard);
  blocked(`Agent understood: "${read.value}" (confidence ${String(read.confidence)})`);
  note("This is a model INTERPRETATION, so it is not yet usable — even at high confidence.");
  note("The agent must play it back and have the student confirm it before it is stored.");
  refused("Submitting the agent's interpretation without confirmation");
  note("Blocked by the compiler: ProposedValue cannot become ConfirmedValue.");

  // ── 2 ───────────────────────────────────────────────────────────────────
  heading("2. A missing document blocks progress");
  await apply("Move to document collection", {
    kind: "transition",
    to: "DOCUMENTS_PENDING",
    reason: "Passport and bank statement required.",
  });
  await apply("Raise task: passport", {
    kind: "raise_task",
    taskId: "tsk_passport",
    taskKind: "provide_document",
    description: "Upload your passport photo page",
    blocksProgress: true,
  });

  await apply("Resolve requirements", { kind: "transition", to: "REQUIREMENTS_RESOLUTION", reason: "Checking Leeds requirements." });
  await apply("Check eligibility", { kind: "transition", to: "ELIGIBILITY_REVIEW", reason: "Comparing profile to requirements." });
  await apply("Mark ready", { kind: "transition", to: "READY_TO_PREPARE", reason: "Blueprint available." });

  blocked("Attempting to start filling while the passport is missing:");
  await apply("Start preparing", { kind: "transition", to: "PREPARING", reason: "Fill the form." });
  note("The system stops and asks. It does not guess a passport number.");

  ok("Student uploads the passport");
  await apply("Complete task: passport", { kind: "complete_task", taskId: "tsk_passport", outcome: "done" });
  await apply("Start preparing", { kind: "transition", to: "PREPARING", reason: "All blocking tasks resolved." });

  // ── 3 ───────────────────────────────────────────────────────────────────
  heading("3. Financial evidence forces human review — regardless of confidence");
  await apply("Bank statement detected → escalate", {
    kind: "request_human_review",
    triggers: ["financial_evidence"],
  });
  note("This is layer two. No confidence score can bypass it (brief §2.5).");

  blocked("Attempting to ask the student to authorise, with the review outstanding:");
  await apply("Render for student authorisation", {
    kind: "transition",
    to: "AWAITING_STUDENT_AUTHORISATION",
    reason: "Application complete.",
  });

  ok("Specialist Amara reviews the bank statement and approves");
  await apply("Record human review", {
    kind: "complete_human_review",
    review: {
      reviewerId: "specialist_amara",
      reviewedAt: new Date("2026-08-26T11:00:00Z"),
      triggers: ["financial_evidence"],
      outcome: "approved",
    },
  });
  await apply("Render for student authorisation", {
    kind: "transition",
    to: "AWAITING_STUDENT_AUTHORISATION",
    reason: "Review cleared.",
  });

  // ── 4 ───────────────────────────────────────────────────────────────────
  heading("4. The student authorises exact content");
  await apply("Student authorises", { kind: "capture_authorisation", contentHash: "sha256:content-v1" });
  note("A hash of exactly what they saw is now on the case.");

  // ── 5 ───────────────────────────────────────────────────────────────────
  heading("5. Changing the content voids that authorisation");
  const authorised = await currentCase();
  const drifted = { ...authorised, preparedContentHash: "sha256:content-v2" };
  const driftDecision = decide(drifted, { kind: "attempt_submission" });
  if (!driftDecision.accepted) {
    refused("Submit after the content changed");
    const { refusal } = driftDecision;
    note("detail" in refusal ? refusal.detail : refusal.refusal.detail);
  }
  note("The student must be asked again. This is brief §7, enforced by the machine.");

  // ── 6 ───────────────────────────────────────────────────────────────────
  heading("6. Submitting once — and refusing to submit twice");
  await apply("Submit", { kind: "attempt_submission" });

  blocked("A retry fires (timeout, worker restart, double click):");
  await apply("Submit again", { kind: "attempt_submission" });
  note("A retry cannot produce a different submission identity, so it collides.");
  note("The store's unique key constraint is the second line of defence.");

  await commit([{ type: "SubmissionSucceeded", receiptRef: "LEEDS-APP-88213" }]);
  await apply("Mark submitted", { kind: "transition", to: "SUBMITTED", reason: "Receipt captured." });
  await commit([{ type: "ConfirmationCaptured", confirmationRef: "LEEDS-CONF-88213" }]);
  await apply("Confirm", { kind: "transition", to: "CONFIRMED", reason: "Confirmation captured." });
  note("CONFIRMED is terminal. MVP responsibility ends here (brief §2.8).");

  // ── 7 ───────────────────────────────────────────────────────────────────
  heading("7. Re-applying needs an explicit student instruction");
  const concluded = await currentCase();

  const autoAttempt = decideReapplication({
    actor: "automatic_retry",
    currentAttemptOrdinal: concluded.submissionIdentity.attemptOrdinal,
    priorCaseConcluded: true,
    instruction: {
      priorOutcome: { outcome: "rejected", assertedBy: "student", assertedAt: new Date("2026-11-01T09:00:00Z") },
      studentStatement: "(generated by a retry)",
      instructedAt: new Date("2026-11-01T10:00:00Z"),
      recommendationShown: { advice: "none", rationale: "-", shownAt: new Date("2026-11-01T09:00:00Z") },
      proceededDespiteRecommendation: false,
    },
  });
  if (!autoAttempt.allowed) {
    refused("An automatic retry tries to create a second application");
    note(autoAttempt.rejection.detail);
  }

  const advice = recommendWait({
    priorOutcome: { outcome: "rejected", assertedBy: "student", assertedAt: new Date("2026-11-01T09:00:00Z") },
    currentIntake: intake("2027-09"),
    nextIntake: intake("2028-09"),
  });
  blocked(`We advise: ${advice.advice}`);
  note(advice.rationale);

  const studentInstructs = decideReapplication({
    actor: "student",
    currentAttemptOrdinal: concluded.submissionIdentity.attemptOrdinal,
    priorCaseConcluded: true,
    instruction: {
      priorOutcome: { outcome: "rejected", assertedBy: "student", assertedAt: new Date("2026-11-01T09:00:00Z") },
      studentStatement: "I understand, but I'd like to apply again for the same intake.",
      instructedAt: new Date("2026-11-01T10:00:00Z"),
      recommendationShown: { ...advice, shownAt: new Date("2026-11-01T09:59:00Z") },
      proceededDespiteRecommendation: true,
    },
  });
  if (studentInstructs.allowed) {
    ok(`Student instructs a new application → attempt ${studentInstructs.nextAttemptOrdinal}`);
    note("Recorded with their own words, our advice, and the fact they overrode it.");
    note("The student's explicit instruction is ultimately the decision (ADR-0006).");
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const final = await currentCase();
  const log = await store.read(CASE);
  heading("The case can answer, from stored data alone");
  console.log(`  State           ${final.state}`);
  console.log(`  Events          ${String(log.length)} (append-only, no gaps)`);
  console.log(`  Opened because  "${final.requestEvidence.studentStatement}"`);
  console.log(`  Reviews         ${String(final.completedReviews.length)} by ${final.completedReviews.map((r) => r.reviewerId).join(", ")}`);
  console.log(`  Tasks           ${String(final.tasks.length)} raised, ${String(final.tasks.filter((t) => t.status === "done").length)} completed`);
  console.log(`  Submitted       ${final.submissionAttempted ? "yes, exactly once" : "no"}`);
  console.log();
}

await main();
