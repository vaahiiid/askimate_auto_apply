/**
 * A student's request to delete the details they confirmed, waiting for a
 * person (P275, row 130).
 *
 *   pnpm run deletion-requests                           what is waiting
 *   pnpm run deletion-requests close <id> --by <name> --deleted
 *   pnpm run deletion-requests close <id> --by <name> --declined --reason "…"
 *
 * The student was told: *"I will tell you here when it is done."* Closing
 * one is what tells them — the service writes the closing and the message,
 * as the one writer (ADR-0048); this script calls its internal routes and
 * never opens the database.
 *
 * What closing does NOT do: delete anything. The deletion itself (stage B,
 * row 130) is not built. `--deleted` is a person saying they have done it;
 * the student is told so in those words, and the record says who CLAIMED it
 * — `--by` is asserted, not authenticated, on the terms of an intervention's
 * specialist (ADR-0048 §3).
 */

import { parseArgs } from "node:util";

const SERVICE = process.env["AAS_CONVERSATION_URL"] ?? "http://127.0.0.1:4000";
const CERT = process.env["AAS_SERVICE_CERT"];

interface WireRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly studentId: string;
  readonly caseId: string;
  readonly raisedAt: string;
  readonly closed?: { readonly closedAt: string; readonly closedBy: string; readonly outcome: string; readonly reason?: string };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (CERT === undefined || CERT.length === 0) {
    fail(
      "AAS_SERVICE_CERT is not set.\n\n" +
        "This command talks to the Conversation Service's internal plane, which is what keeps\n" +
        "the service the only writer (ADR-0048). Set AAS_SERVICE_CERT, and AAS_CONVERSATION_URL\n" +
        `if the service is not at ${SERVICE}.`,
    );
  }
  const response = await fetch(`${SERVICE}${path}`, {
    ...init,
    headers: {
      "x-service-cert": CERT,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["code"] : undefined;
    fail(`The service refused: ${typeof raw === "string" ? raw : String(response.status)}`);
  }
  return body;
}

/** How long it has waited. `now` is passed in: the lint rule forbids the ambient clock below the run boundary. */
function ageOf(raisedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(raisedAt).getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${String(hours)}h` : `${String(Math.floor(hours / 24))}d`;
}

async function list(now: Date): Promise<void> {
  const body = await call("/internal/v1/deletion-requests");
  const open = (body as { requests?: WireRequest[] } | null)?.requests ?? [];
  if (open.length === 0) {
    process.stdout.write("No request to delete confirmed details is waiting.\n");
    return;
  }
  process.stdout.write(`${String(open.length)} waiting for a person:\n\n`);
  for (const request of open) {
    process.stdout.write(
      `  ${request.requestId}   waiting ${ageOf(request.raisedAt, now)}\n` +
        `    student       ${request.studentId}\n` +
        `    conversation  ${request.conversationId}   case ${request.caseId}\n\n`,
    );
  }
  process.stdout.write(
    "The student has been told what the university already has, and that a person has their\n" +
      "request. Read the conversation for what they asked. Then close it — which tells them:\n\n" +
      "  pnpm run deletion-requests close <id> --by <your-name> --deleted\n" +
      '  pnpm run deletion-requests close <id> --by <your-name> --declined --reason "why"\n\n' +
      "Closing deletes nothing. Do the deletion first; --deleted says you have.\n",
  );
}

async function close(argv: readonly string[]): Promise<void> {
  const id = argv[0];
  if (id === undefined || id.startsWith("--")) fail("Usage: deletion-requests close <id> --by <name> --deleted | --declined --reason \"…\"");
  const { values } = parseArgs({
    args: [...argv.slice(1)],
    options: {
      by: { type: "string" },
      deleted: { type: "boolean" },
      declined: { type: "boolean" },
      reason: { type: "string" },
    },
    strict: true,
  });
  const by = values.by;
  if (by === undefined || by.trim().length === 0) fail("--by is required: the record says who closed it.");
  const deleted = values.deleted === true;
  const declined = values.declined === true;
  // No default, for the reason `interventions resolve` has none: the student
  // is told which, and a default would be this script choosing what they read.
  if (deleted === declined) fail("Say exactly one of --deleted or --declined. The student is told which.");
  if (declined && (values.reason === undefined || values.reason.trim().length === 0)) {
    fail("--declined needs --reason. The student reads it, in your words.");
  }
  if (deleted && values.reason !== undefined) fail("--deleted takes no --reason: the student is told it is done, and nothing else.");

  const body = await call(`/internal/v1/deletion-requests/${encodeURIComponent(id)}/closure`, {
    method: "POST",
    body: JSON.stringify({ closedBy: by, outcome: deleted ? "deleted" : "declined", ...(declined ? { reason: values.reason } : {}) }),
  });
  const answer = body as { closedNow?: boolean; request?: WireRequest } | null;
  if (answer?.closedNow !== true) {
    const closed = answer?.request?.closed;
    fail(
      `Already closed${closed === undefined ? "" : ` by ${closed.closedBy} at ${closed.closedAt} (${closed.outcome})`}.\n\n` +
        "Your closing was NOT recorded, and the student was not told again.",
    );
  }
  process.stdout.write(`Closed ${id} as ${deleted ? "deleted" : "declined"}. The student has been told, in the conversation.\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === undefined || command === "list") {
  // eslint-disable-next-line no-restricted-syntax -- run boundary, as in interventions.ts
  const now = new Date();
  await list(now);
} else if (command === "close") {
  await close(rest);
} else {
  fail(`Unknown command "${command}". Use "list" (the default) or "close".`);
}
