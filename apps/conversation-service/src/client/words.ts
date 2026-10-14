/**
 * The words a student reads about where their application is (ADR-0147).
 *
 * Vahid, 2026-09-26, after his page read "specialist (running)" while the
 * interview was asking him questions: *"no internal word ever reaches a
 * student's screen. Not specialist, not escalated, not uncertain. If the run
 * is with a person, it says so in words a person would use."*
 *
 * Structural, as far as the code can express it:
 *
 *   - The tables below are typed over the CLOSED vocabularies the contract
 *     publishes (`RunStepKind`, `RunStatus`), exhaustively. A step or a status
 *     added to the contract without a sentence here fails the build, naming
 *     the one that has none. There is no default and no fall-through, because
 *     a default is where an internal word would leak from.
 *   - `StudentWords` is a branded string that only this module can mint, and
 *     the page's position line accepts nothing else. The run's own fields are
 *     never interpolated: the line is composed from these sentences alone.
 *   - `words.test.ts` proves no sentence contains a state name — any status,
 *     step or phase the contract knows, as written or with its underscores
 *     read as spaces — so the property holds over the whole table, not over
 *     the cases somebody thought to check.
 *
 * What it cannot express: that OTHER text on the page never carries a state
 * name. The transcript is the log's words and the refusals are mapped from a
 * closed set already; the position line was the one place a raw state was
 * written, and it is now the one place that cannot be.
 */
import type { RunStatus, RunStepKind } from "@askimate/aas-contracts";

declare const STUDENT_WORDS: unique symbol;
/** A sentence for a student. Minted here and nowhere else. */
export type StudentWords = string & { readonly [STUDENT_WORDS]: true };

const mint = (sentence: string): StudentWords => sentence as StudentWords;

/**
 * What is happening now, by the orchestrator's next step, in the student's
 * terms. Present tense, because the line describes the moment they are
 * looking at it.
 */
const STEP_WORDS = {
  interview: "I'm asking you a few questions so I can fill in your application.",
  // A person has the next move. The step's own name — specialist — is the
  // word Vahid saw, and it is not one.
  specialist: "Your application is with a member of the team. I will come back to you.",
  fix_content: "Something in your application needs putting right before it goes further. It is with a member of the team, and I will come back to you.",
  authorise: "Your application is ready for you to check and approve.",
  execute: "I'm entering your application on the university's website.",
  create_account: "I'm creating your account on the university's website.",
  request_secret: "I need your password for the university's website. Use the secure box; I never see what you type.",
  // P306: true of every handoff, the registration e-mail question included,
  // which asks about an inbox, not about the website.
  student_handoff: "I'm waiting for your answer to my last message before I go on.",
  ready_to_submit: "Your application is entered and ready for you to submit.",
  hand_over_account: "I'm handing your account on the university's website over to you.",
  sign_in: "I'm signing in to your account on the university's website.",
  consent_choice: "The university's website is asking about cookies. Your choice is below.",
} as const satisfies Record<RunStepKind, string>;

/**
 * A status that overrides the step: the run is not doing its next step, and
 * the student should read why. `running` is the one that defers to the step.
 */
const STATUS_WORDS = {
  running: null,
  suspended: "Your application is paused for a moment. I will carry on shortly.",
  // The two the driver names as waiting for a person (ADR-0048, ADR-0064).
  // Which step it stopped on is not the student's business, and reading it
  // as a prompt is exactly the mistake.
  uncertain: "Your application is with a member of the team. I will come back to you.",
  escalated: "Your application is with a member of the team. I will come back to you.",
  // ADR-0116: the student closed the password box. Stopped where it was, by
  // their choice, and read as such.
  stopped_by_student: "You closed the password box, so this is stopped where it was. Ask me to apply again when you want to carry on.",
  completed: "Your application is done here. There is nothing more for me to do on it.",
  abandoned: "This application has been set aside and will not go further.",
} as const satisfies Record<RunStatus, string | null>;

/** The position line: one sentence, a person's words, never a state name. */
export function positionLine(run: { readonly status: RunStatus; readonly step: RunStepKind }): StudentWords {
  const overriding = STATUS_WORDS[run.status];
  return mint(overriding ?? STEP_WORDS[run.step]);
}

/**
 * P308, Vahid's addition to D7 (2026-10-14): *"whatever the case's internal
 * state, what the student sees must say plainly that the application was
 * submitted, by them, on that date."* Once a person has recorded a submission
 * made by hand, the line opens with that sentence whatever the run's status,
 * and what follows is typed over every status, with no default.
 */
const SUBMITTED_TAIL = {
  // Not "your account": a record may come before any account exists (the
  // P308 review), and the hand-back, when there is one, says so in the chat.
  running: "What is left is closing it off here. Nothing more will be filled in or submitted.",
  suspended: "What is left is paused for a moment, and I will carry on shortly.",
  uncertain: "What is left of it is with a member of the team, and I will tell you when it is finished.",
  escalated: "What is left of it is with a member of the team, and I will tell you when it is finished.",
  stopped_by_student: "You closed the password box, so I stopped there. To close it off here, choose it below.",
  completed: "There is nothing more for me to do on it.",
  abandoned: "Stopping did not withdraw it, and there is nothing more for me to do on it.",
} as const satisfies Record<RunStatus, string>;

/** `YYYY-MM-DD` as stated, in words: "14 October 2026", the chat's own format. */
export function dayWords(on: string): string {
  const [y, m, d] = on.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The sentence every recorded-case surface on the page begins with (P308). */
function youSubmitted(on: string): string {
  return `You submitted your application on the university's website on ${dayWords(on)}.`;
}

/** The position line once a submission made by hand is recorded (P308). */
export function submittedLine(status: RunStatus, on: string): StudentWords {
  return mint(`${youSubmitted(on)} ${SUBMITTED_TAIL[status]}`);
}

/** Above the targets, when a student who stopped may choose again after a record (P308). */
export function submittedTargetsHeading(on: string): StudentWords {
  return mint(
    `${youSubmitted(on)} To close it off here, choose it below. Nothing will be filled in or submitted.`,
  );
}

/** The offer's heading and its button after a record (P308): not "apply". */
export const SUBMITTED_OFFER_HEADING: StudentWords = mint("The application you submitted");
export const SUBMITTED_OFFER_BUTTON: StudentWords = mint("Close it off here");

/** The own-acts heading after a record (P308): nothing is "before you submit" any more. */
export function submittedOwnActsHeading(on: string): StudentWords {
  return mint(
    `${youSubmitted(on)} I cannot tell whether these were attached before you did; if they were not, ` +
      `the university's admissions office can tell you how to send them.`,
  );
}

/** The stop button's label after a record (P308): stopping withdraws nothing. */
export const SUBMITTED_STOP_LABEL: StudentWords = mint("Stop here (this does not withdraw the application you submitted)");

/**
 * The stop's label, or `null` where there is nothing left to stop (ADR-0053):
 * a completed run (P307), and an abandoned one after a record, whose line has
 * just said so (the P308 review).
 */
export function stopLabelFor(status: RunStatus | undefined, submitted: { readonly on: string } | null): string | null {
  if (status === "completed") return null;
  if (submitted === null) return "Stop this application";
  return status === "abandoned" ? null : SUBMITTED_STOP_LABEL;
}

/**
 * What a student reads before handing over a CV (ADR-0148 §10, P236). Vahid's
 * sentence, said as written: it is about keeping the document and nothing
 * else — what they will be shown of what was read belongs to the moment it is
 * shown, not here. *"It makes a plain sentence about storage into a sentence
 * that is also selling."*
 *
 * Its last clause is his too (P277, row 128), 2026-10-03: *"we delete the
 * document; the record of our conversation keeps what was said in it,
 * including the lines of your CV I read back to you."* Without it, "that
 * deletes the document" read as if nothing of the CV stayed — and the log
 * keeps lines of it the student never confirmed.
 */
export const CV_UPLOAD_SENTENCE: StudentWords = mint(
  "Before you hand me your CV: I will keep it for one year from the last time I use it, and I will " +
    "read it only to fill in the sections of your applications that list your jobs and qualifications. " +
    "You can tell me to delete it at any time, just by saying so here. That deletes the document, or all " +
    "of your documents if you ask for that; the details you have already confirmed stay unless you ask " +
    "for those too, and the record of our conversation keeps what was said in it, including the lines of your CV I read back to you.",
);

/**
 * P290, ADR-0155: the line while the student is offered a choice from the
 * form's own list. The run stands on the step a person would otherwise take
 * (`specialist`, still `running`), and saying "with a member of the team"
 * beside a choice that is theirs would be untrue twice: nobody else has it,
 * and nothing comes back until they press.
 */
export const CHOOSING_LINE: StudentWords = mint(
  "Your application is waiting for you: their form's list does not hold one of your answers, and the choice below is yours.",
);

/** Every sentence the line can be, for the test that reads them all. */
export const EVERY_SENTENCE: readonly string[] = [
  CHOOSING_LINE,
  ...Object.values(STEP_WORDS),
  ...Object.values(STATUS_WORDS).flatMap((sentence) => (sentence === null ? [] : [sentence])),
  // P308: every recorded-case line, with a date standing in for the stated one.
  ...(Object.keys(SUBMITTED_TAIL) as RunStatus[]).map((status) => submittedLine(status, "2026-10-14")),
  submittedTargetsHeading("2026-10-14"),
  SUBMITTED_OFFER_HEADING,
  SUBMITTED_OFFER_BUTTON,
  submittedOwnActsHeading("2026-10-14"),
  SUBMITTED_STOP_LABEL,
];
