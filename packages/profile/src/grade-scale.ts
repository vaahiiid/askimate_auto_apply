/**
 * The scale a grade is on, as the student states it (P297).
 *
 * Vahid, 2026-10-12: *"Our own intake must record a grade and its scale
 * exactly as the student states them ("8.2 out of 10"). "GPA" must never be
 * silently read as out of 4. Fix this as a defect now, regardless of any
 * portal."*
 *
 * Until P297 the interview and the CV reader each read the scale through a
 * closed table of four tokens, and both tables took the bare word "gpa" to
 * `gpa_4`: a student who said "GPA" was stored as out of 4, and one who said
 * "CGPA out of 10" was refused three times and stopped for a person (row 146).
 * The word GPA names scales out of 4, 4.3, 5, 10 and 20; Sheffield's own list
 * holds "GPA 20".
 *
 * So the rule is now:
 *
 *   - words that are EXACTLY one of the phrases below are stored as its
 *     token, because each phrase names its maximum and a signed mapping keys
 *     on the token (Sheffield's GPA 20 and UK honours rows);
 *   - any other words that state a maximum are stored AS STATED, trimmed of
 *     the space around them and nothing else. A maximum is stated by "out of
 *     N", "N-point" or "N point", "/N", "scale of N", "N scale", "0 to N" or
 *     "0-N", "max N" or "maximum N" — N a number, or a number word from four
 *     to twenty, or a hundred — or by "percent", "percentage" or "%";
 *   - words that state no maximum ("GPA", "CGPA", "GPA 4", "4.0", "First") are
 *     refused, and the student is asked again: nothing here supplies one.
 *
 * `asStated` marks the reader for the model paths: the text a model returns
 * must be found in what the student said, or in the span the CV printed, so a
 * model cannot turn "GPA" into "GPA out of 4" on the student's behalf.
 */

/** The phrases kept as tokens. Each names its maximum; "gpa" and "gpa 4" do not (P297). */
export const GRADE_SCALE_PHRASES: Readonly<Record<string, string>> = {
  "uk honours": "uk_honours",
  "20-point": "twenty_point",
  "20 point": "twenty_point",
  "out of 20": "twenty_point",
  "gpa out of 4": "gpa_4",
  percentage: "percentage",
  "out of 100": "percentage",
};

/** A number as a maximum is said: digits, or a word from four to twenty, or a hundred. */
const N = String.raw`(?:\d+(?:[.,]\d+)?|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|(?:one |a )?hundred)`;
/** A maximum, stated, in each of the forms the header lists. */
const STATES_A_MAXIMUM = new RegExp(
  [
    String.raw`\bout of\s+${N}\b`,
    String.raw`\b${N}\s*-?\s*points?\b`,
    String.raw`\/\s*\d+(?:[.,]\d+)?\b`,
    String.raw`\bscale of\s+${N}\b`,
    String.raw`\b${N}\s*-?\s*scale\b`,
    String.raw`\b0\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?\b`,
    String.raw`\bmax(?:imum)?\s+(?:of\s+)?${N}\b`,
  ].join("|"),
  "i",
);
/** A scale that is its own maximum: a percentage. */
const STATES_A_PERCENTAGE = /\bper\s?cent(?:age)?\b|%/i;

/**
 * The words as a phrase of the table: case and runs of space set aside, and
 * a leading "on a" and a trailing "scale" too, which name no other maximum —
 * "on a 20-point scale" is the twenty-point scale the signed rows key on.
 */
function phraseOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^on an? /, "")
    .replace(/ (?:grading )?scale$/, "");
}

function read(raw: string): string | null {
  const token = GRADE_SCALE_PHRASES[phraseOf(raw)];
  if (token !== undefined) return token;
  const stated = raw.trim();
  if (stated.length === 0) return null;
  return STATES_A_MAXIMUM.test(stated) || STATES_A_PERCENTAGE.test(stated) ? stated : null;
}

/**
 * Reads a stated grade scale: its token, its words as stated, or `null`.
 *
 * `options` is the table, so the vocabulary audit sees every token it can
 * store and requires each to be shown in words (row 92); `asStated` asks the
 * model paths to hold the model's text to the student's own.
 */
export const readGradeScale: ((raw: string) => string | null) & {
  readonly options: Readonly<Record<string, string>>;
  readonly asStated: true;
} = Object.assign(read, { options: GRADE_SCALE_PHRASES, asStated: true as const });

/** The words the question and the CV reader use for what a scale must say. */
export const GRADE_SCALE_SHAPE =
  "the scale with its maximum, as stated, e.g. out of 10, out of 4, 20-point, UK honours, or percentage";
