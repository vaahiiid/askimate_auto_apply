/**
 * Document fixtures.
 *
 * Written as labelled lines, which is what a PDF text layer or an OCR pass
 * actually produces from these documents — not as JSON. The point of testing
 * against text is that the grounding check has real text to check against.
 */

/** A passport data page, as its text layer reads. */
export const PASSPORT_TEXT = [
  "PASSPORT / PASSEPORT",
  "Type: P",
  "Country of issue: ISLAMIC REPUBLIC OF IRAN",
  "Passport No: K12345678",
  "Surname: HOSSEINI",
  "Given names: NILOOFAR",
  "Nationality: IRANIAN",
  "Date of birth: 02 APR 1999",
  "Sex: F",
  "Date of issue: 14 JUN 2021",
  "Date of expiry: 13 JUN 2031",
  "Authority: TEHRAN",
].join("\n");

/** An academic transcript. */
export const TRANSCRIPT_TEXT = [
  "AMIRKABIR UNIVERSITY OF TECHNOLOGY",
  "OFFICIAL ACADEMIC TRANSCRIPT",
  "",
  "Institution: Amirkabir University of Technology",
  "Country: Iran",
  "Award: Bachelor of Science",
  "Subject: Industrial Engineering",
  "Year of award: 2022",
  "Overall grade: 17.42",
  "Grading scale: 20-point scale",
  "",
  "This transcript is issued by the Office of the Registrar.",
].join("\n");

/** A bank statement. */
export const BANK_STATEMENT_TEXT = [
  "MELLAT BANK",
  "Account holder: NILOOFAR HOSSEINI",
  "Statement period from: 01 JUL 2026",
  "Statement period to: 31 JUL 2026",
  "Closing balance: 1,250,000,000 IRR",
].join("\n");

/** A passport whose expiry line is missing. */
export const PASSPORT_MISSING_EXPIRY = PASSPORT_TEXT.split("\n")
  .filter((line) => !line.startsWith("Date of expiry"))
  .join("\n");

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
