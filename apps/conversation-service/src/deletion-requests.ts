/**
 * A student asking, in the chat, for a document to be deleted (ADR-0148 §10).
 *
 * Vahid, 2026-09-27: *"'Delete my CV' as a conversational request needs to
 * work the way a person would say it, not one magic phrase. 'Delete my CV',
 * 'remove that document', 'get rid of everything you have on me' should all
 * land."* So this reads families of words rather than a phrase: a verb that
 * means removal, and an object that says how much — one named kind of
 * document, "that document", or everything.
 *
 * Deterministic, and said so: it is a reader of phrasings with tests over
 * them, not a model's reading. A sentence it does not read is answered as
 * whatever else the message was — an interview answer, or nothing — and the
 * student can say it again more plainly. It never reads a NEGATED request
 * ("don't delete my CV") as one.
 */
import type { DocumentType } from "@askimate/aas-domain";

export type DeletionRequest =
  /** Every document held. */
  | { readonly scope: "all" }
  /** Every held document of one kind. */
  | { readonly scope: "type"; readonly documentType: DocumentType }
  /** "That document" — the one, where one is held; a question where more are. */
  | { readonly scope: "one" };

/**
 * What a message that MENTIONS deletion reads as (row 98, P237). Vahid:
 * *"A message about deletion must never reach the interview as an answer to a
 * question about a job title."* So a sentence about deletion is one of these,
 * and never an answer:
 */
export type DeletionReading =
  | DeletionRequest
  /** Deletion is mentioned and the reader cannot tell what of: a question back, never a guess. */
  | { readonly scope: "unclear" }
  /** Deletion is mentioned and NOT asked for — a negation, or a person saying what they did. */
  | { readonly scope: "not_a_request" };

declare const STUDENT_ANSWER: unique symbol;
/**
 * A student's message that is NOT about deletion, and so may be read as an
 * answer. Minted by `readStudentMessage` alone: the interview path takes this
 * and not a string, which is what makes "a deletion-shaped message is handled
 * or asked about, never passed along" structural rather than a matter of
 * remembering the check (row 98).
 */
export type StudentAnswer = string & { readonly [STUDENT_ANSWER]: true };

/** One reading of a student's message: about deletion, or an answer. Nothing is both, and nothing is neither. */
export function readStudentMessage(text: string): { readonly kind: "deletion"; readonly reading: DeletionReading } | { readonly kind: "answer"; readonly answer: StudentAnswer } {
  const reading = readDeletionRequest(text);
  return reading === null ? { kind: "answer", answer: text as StudentAnswer } : { kind: "deletion", reading };
}

const REMOVAL_VERBS = [
  "delete",
  "remove",
  "erase",
  "wipe",
  "destroy",
  "discard",
  "drop",
  "scrap",
  "trash",
  "bin",
  "get rid of",
  "got rid of",
  "getting rid of",
  "take down",
  "throw away",
  "throw out",
  "clear out",
  "clear",
  "purge",
  "forget",
  "unsend",
  "withdraw",
  "stop holding",
  "stop keeping",
  "don't keep",
  "do not keep",
  "dont keep",
  "don't hold",
  "do not hold",
];

/** The kinds a person names, and the words they use for each. */
const TYPE_WORDS: readonly (readonly [DocumentType, readonly string[]])[] = [
  ["cv", ["cv", "resume", "curriculum vitae"]],
  ["passport", ["passport"]],
  ["academic_transcript", ["transcript", "transcripts", "academic transcript"]],
  ["degree_certificate", ["degree certificate", "degree"]],
  ["english_test_certificate", ["ielts", "english test", "english certificate", "language certificate", "language test"]],
  ["personal_statement", ["personal statement", "statement"]],
  ["reference_letter", ["reference", "reference letter", "references"]],
  ["birth_certificate", ["birth certificate"]],
  ["bank_statement", ["bank statement", "bank statements"]],
  ["sponsorship_letter", ["sponsorship letter", "sponsor letter"]],
  ["parental_consent", ["parental consent", "consent form"]],
  ["guardianship_document", ["guardianship document", "guardianship"]],
  ["visa_document", ["visa", "visa document"]],
];

const EVERYTHING = [
  "everything",
  "all my documents",
  "all of my documents",
  "all the documents",
  "all documents",
  "all my files",
  "all of my files",
  "all the files",
  "all files",
  "all my uploads",
  "all of my uploads",
  "all my data",
  "all of my data",
  "all my information",
  "my documents",
  "my files",
  "my uploads",
  "the documents",
  "the files",
  "what you have on me",
  "what you hold on me",
  "what you have of mine",
  "what you hold for me",
  "what you have about me",
  "what you've got on me",
  "what you got on me",
];

const ONE = [
  "that document",
  "this document",
  "the document",
  "that file",
  "this file",
  "the file",
  "that upload",
  "the upload",
  "my upload",
  "my document",
  "my file",
  "the one i uploaded",
  "the one i just uploaded",
  "the one i sent",
  "the one i just sent",
  "what i uploaded",
  "what i just uploaded",
  "what i sent you",
  "what i just sent you",
  "what i sent",
  "the last one",
  "it",
];

const NEGATIONS = [/\b(don'?t|do not|never|please don'?t|not)\s+(?:\w+\s+){0,2}?(delete|remove|erase|wipe|destroy|discard|drop|get rid of|take down|throw away|purge|forget)\b/];

function normalised(text: string): string {
  return text
    .toLowerCase()
    // "résumé" reads as "resume": JavaScript's \b is ASCII-only, and an accent
    // is not a reason to miss a request.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the sentence says about deletion, or `null` when it does not mention
 * deletion at all — and only then may it be read as an answer.
 */
export function readDeletionRequest(text: string): DeletionReading | null {
  const said = normalised(text);
  if (said.length === 0) return null;
  // Any form of the verb: delete, deleted, deleting, deletes — or the noun.
  const verb = REMOVAL_VERBS.find((candidate) => new RegExp(`\\b${candidate.replace(/'/g, "'?")}(?:d|ed|s|ing)?\\b`).test(said));
  const mentions = verb !== undefined || /\b(deletion|deletions|removal|erasure)\b/.test(said);
  if (!mentions) return null;
  // "don't keep my CV" is a removal verb by itself; every other negation of a
  // removal verb is a request NOT to — said back, never passed along.
  const negated = NEGATIONS.some((pattern) => pattern.test(said)) && !/\b(don'?t|do not|dont)\s+(keep|hold)\b/.test(said);
  if (negated) return { scope: "not_a_request" };
  // "I removed the typo" is a person saying what they did, not asking.
  if (/\bi(?:'ve| have| just| already)? (?:deleted|removed|erased|wiped|discarded|dropped|scrapped|cleared)\b/.test(said)) return { scope: "not_a_request" };
  if (verb === undefined) return { scope: "unclear" };

  // What the verb is about, in the order a wider claim beats a narrower one:
  // everything, then a kind of document, then "that document".
  const has = (phrase: string): boolean => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "u").test(said);
  if (EVERYTHING.some(has) && !TYPE_WORDS.some(([, words]) => words.some(has))) return { scope: "all" };
  const typed = TYPE_WORDS.find(([, words]) => words.some(has));
  if (typed !== undefined) return { scope: "type", documentType: typed[0] };
  if (EVERYTHING.some(has)) return { scope: "all" };
  if (ONE.some(has)) return { scope: "one" };
  // Deletion, of something this reader cannot name: asked about, never guessed,
  // never an answer (row 98).
  return { scope: "unclear" };
}

/**
 * A request to USE the uploaded CV — "actually, use my CV", "fill it in from
 * my CV", "read my CV" — or not to: "don't use my CV", "I'd rather tell you"
 * (P251, ADR-0151). `true`, `false`, or `null` when the message is not about
 * that. Deterministic, like the deletion reader above; a negated use is a no.
 */
export function readUseRequest(text: string): boolean | null {
  const said = normalised(text);
  if (said.length === 0) return null;
  const document = /\b(cv|resume|curriculum vitae|the document|what i uploaded|the file)\b/.test(said);
  if (!document) return null;
  const use = /\b(use|read|take|fill (?:it |them |this |that )?in from|go from|work from|get (?:it |them )?from|pull (?:it |them )?from)\b/.test(said);
  if (!use) return null;
  const negated = /\b(don'?t|do not|dont|never|rather not|no need to|without)\b/.test(said);
  return !negated;
}
