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
  student_handoff: "It's over to you on the university's website for a moment.",
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

/** Every sentence the line can be, for the test that reads them all. */
export const EVERY_SENTENCE: readonly string[] = [
  ...Object.values(STEP_WORDS),
  ...Object.values(STATUS_WORDS).flatMap((sentence) => (sentence === null ? [] : [sentence])),
];
