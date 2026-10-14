/**
 * A person records that a student's application was submitted by hand on the
 * portal (ADR-0159 O10, P307).
 *
 *   pnpm run submission-by-hand <caseId> --by <name> --at <time> --observed
 *   pnpm run submission-by-hand <caseId> --by <name> --at <time> --stated
 *
 * `--at` is when it was submitted, a full time with its zone, written in the
 * zone it happened in (2026-10-14T00:30:00+01:00): the date you type is the
 * date the student is told (P308). `--observed` means you saw the portal say so,
 * `--stated` that someone told you. Neither has a default: the record is a
 * fact a person established, and a default would be this script choosing it.
 *
 * Recording it tells the student, once, and from then on the run fills
 * nothing more on the portal, the press path refuses the case, and the
 * account is handed back. It does not resolve a stop that holds the run:
 * the command names any, and resolving one (`pnpm run interventions resolve`)
 * lets the hand-back start. `--by` is asserted, not authenticated, on the
 * terms of a review (ADR-0048 §3). This script calls the service's internal
 * route and never opens the database: the service is the one writer.
 */

import { parseArgs } from "node:util";

const SERVICE = process.env["AAS_CONVERSATION_URL"] ?? "http://127.0.0.1:4000";
const CERT = process.env["AAS_SERVICE_CERT"];

const USAGE =
  "Usage: submission-by-hand <caseId> --by <name> --at <time in its own zone, e.g. 2026-10-14T00:30:00+01:00> --observed | --stated\n" +
  "The date you type is the date the student is told.";
const FULL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [caseId, ...rest] = process.argv.slice(2);
if (caseId === undefined || caseId.startsWith("--")) fail(USAGE);
const { values } = parseArgs({
  args: rest,
  options: {
    by: { type: "string" },
    at: { type: "string" },
    observed: { type: "boolean" },
    stated: { type: "boolean" },
  },
  strict: true,
});
const by = values.by;
if (by === undefined || by.trim().length === 0) fail("--by is required: the record says who made it.");
/**
 * A date that exists, in a zone some place keeps: from twelve hours behind UTC
 * to fourteen ahead (the P308 review). A JavaScript date rolls 30 February
 * forward to 2 March and parses -20:00; the service refuses both as well.
 */
function isRealZonedTime(time: string): boolean {
  const day = time.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toISOString().slice(0, 10) !== day) return false;
  const zone = /([+-])(\d{2}):(\d{2})$/u.exec(time);
  if (zone === null) return true;
  const minutes = (Number(zone[2]) * 60 + Number(zone[3])) * (zone[1] === "-" ? -1 : 1);
  return minutes >= -12 * 60 && minutes <= 14 * 60;
}

const at = values.at;
if (at === undefined || !FULL_TIME.test(at) || Number.isNaN(new Date(at).getTime()) || !isRealZonedTime(at)) {
  fail(
    "--at is required, as a full time with its zone, such as 2026-10-14T00:30:00+01:00: when it was\n" +
      "submitted, in the zone it happened in, on a date that exists, with an offset from -12:00 to\n" +
      "+14:00. The date you type is the date the student is told.",
  );
}
const observed = values.observed === true;
const stated = values.stated === true;
if (observed === stated) fail("Say exactly one of --observed (you saw the portal say so) or --stated (someone told you).");

if (CERT === undefined || CERT.length === 0) {
  fail(
    "AAS_SERVICE_CERT is not set.\n\n" +
      "This command talks to the Conversation Service's internal plane, which is what keeps\n" +
      "the service the only writer (ADR-0048). Set AAS_SERVICE_CERT, and AAS_CONVERSATION_URL\n" +
      `if the service is not at ${SERVICE}.`,
  );
}

const response = await fetch(`${SERVICE}/internal/v1/cases/${encodeURIComponent(caseId)}/submission-by-hand`, {
  method: "POST",
  headers: { "x-service-cert": CERT, "Content-Type": "application/json" },
  body: JSON.stringify({ recordedBy: by, submittedAt: at, source: observed ? "observed" : "stated" }),
});
const body: unknown = await response.json().catch(() => null);
if (!response.ok) {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["code"] : undefined;
  const code = typeof raw === "string" ? raw : String(response.status);
  if (code === "not_found") fail(`No case ${caseId}. Nothing was recorded.`);
  if (code === "work_in_flight") {
    fail(
      "A runner is working on this application now, and nothing was recorded.\n\n" +
        "The page it is on may still be saved. Record it once the runner has reported, or its\n" +
        "lease has run out (a few minutes).",
    );
  }
  if (code === "validation_failed") {
    fail(
      "The service refused this record, and recorded nothing.\n\n" +
        "The causes it answers this for: --at is after now; a different submission by hand is\n" +
        "already recorded on this case; or the case has ended. Two records that disagree are a\n" +
        "question for a person, not a correction: read the case before recording anything else.",
    );
  }
  fail(`The service refused: ${code}`);
}
const answer = body as { recordedNow?: boolean; heldBy?: string[]; told?: boolean; submittedOn?: string } | null;
process.stdout.write(
  answer?.recordedNow === true
    ? `Recorded on ${caseId}. Nothing more will be filled in on it.\n`
    : `Already recorded on ${caseId} with these facts. Nothing new was written.\n`,
);
process.stdout.write(
  answer?.told === true
    ? `The student has been told, in the conversation, once, that they submitted it on ${answer.submittedOn ?? "?"}.\n`
    : "The student has NOT been told: no conversation or entry is bound to this case. Tell them yourself.\n",
);
const held = answer?.heldBy ?? [];
if (held.length > 0) {
  process.stdout.write(
    `\nThe run is still held by ${held.join(", ")}. The account is handed back once that is resolved:\n` +
      "  pnpm run interventions resolve <id> --specialist <your-name> ... (see pnpm run interventions)\n",
  );
}
