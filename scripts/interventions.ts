/**
 * The operator's specialist queue (ADR-0048).
 *
 *   pnpm run interventions                 what is waiting
 *   pnpm run interventions resolve <id> …  record an adjudication
 *
 * ── This script does NOT open the database ───────────────────────────────
 *
 * It calls the Conversation Service's internal routes, and that is the whole
 * point of the shape ADR-0048 chose. A CLI writing the store directly would be
 * a SECOND WRITER: every invariant the service enforces would need enforcing
 * here too, and would eventually be enforced in only one of them. This
 * repository has already had two models of one thing come apart — ADR-0041
 * exists because of it — and ADR-0045 turned on the same principle.
 *
 * So the interface is a CLI and the writer is still the service.
 *
 * ── Who is allowed to run this ───────────────────────────────────────────
 *
 * Whoever holds `AAS_SERVICE_CERT`. `--specialist` is therefore ASSERTED, not
 * authenticated: the record is honest about who claimed to resolve a case, not
 * proof of who did.
 *
 * Vahid approved that for the current single-operator model, 2026-09-01, and
 * named exactly what ends it:
 *
 *   "The moment we introduce multiple specialists, authenticated individual
 *   identity becomes a required architectural capability, not a deferred
 *   cosmetic improvement."
 *
 * The condition is a second specialist existing at all. The banner below says
 * so at the point somebody is about to type their own name, because that is
 * where it will actually be read.
 */

import { parseArgs } from "node:util";

const SERVICE = process.env["AAS_CONVERSATION_URL"] ?? "http://127.0.0.1:4000";
const CERT = process.env["AAS_SERVICE_CERT"];

interface OpenIntervention {
  readonly interventionId: string;
  readonly runId: string;
  readonly studentRef: string;
  readonly priority: string;
  readonly reason: string;
  readonly action: string;
  readonly target: string;
  readonly portal: string;
  readonly phase: string;
  readonly encountered: string;
  readonly expected: string;
  readonly raisedAt: string;
  readonly announced: boolean;
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
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["code"]
        : undefined;
    const code = typeof raw === "string" ? raw : String(response.status);
    if (code === "intervention_already_resolved") {
      fail(
        "Already resolved.\n\n" +
          "Somebody adjudicated this before you, and your answer was NOT recorded — deliberately.\n" +
          "Two specialists reaching different conclusions about whether an account exists is\n" +
          "evidence, not noise to be tidied away by keeping the later one. Read the case, and if\n" +
          "you disagree with what is recorded, raise it rather than re-submitting.",
      );
    }
    fail(`The service refused: ${code}`);
  }
  return body;
}

/**
 * How long it has been waiting, for a human reading the list.
 *
 * `now` is passed in rather than read here, because the repository's lint rule
 * forbids the ambient clock — a rule that exists so date-dependent behaviour
 * stays testable. It is only cosmetic in this one place, and the rule is right
 * that "only cosmetic" is how the exceptions start.
 */
function ageOf(raisedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(raisedAt).getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${String(hours)}h` : `${String(Math.floor(hours / 24))}d`;
}

async function list(now: Date): Promise<void> {
  const body = await call("/internal/v1/interventions");
  const open = (body as { interventions?: OpenIntervention[] } | null)?.interventions ?? [];

  if (open.length === 0) {
    process.stdout.write("Nothing is waiting for a specialist.\n");
    return;
  }

  process.stdout.write(`${String(open.length)} waiting for a specialist:\n\n`);
  for (const item of open) {
    process.stdout.write(
      `  ${item.interventionId}   [${item.priority}]  waiting ${ageOf(item.raisedAt, now)}\n` +
        `    run       ${item.runId}  (student ${item.studentRef})\n` +
        `    stuck on  ${item.action} against ${item.target}\n` +
        `    portal    ${item.portal}   phase ${item.phase}\n` +
        `    student   ${item.announced ? "has been told it is paused" : "HAS NOT BEEN TOLD"}\n` +
        `    what      ${item.encountered}\n\n`,
    );
  }
  process.stdout.write(
    "To resolve one, OPEN THE PORTAL AND LOOK first. The only question that matters is\n" +
      "whether the action actually happened:\n\n" +
      "  pnpm run interventions resolve <id> \\\n" +
      "      --specialist <your-name> --did-happen|--did-not-happen \\\n" +
      '      --actions "what you did" --resolution "what worked"\n\n',
  );
}

async function resolve(argv: readonly string[]): Promise<void> {
  const id = argv[0];
  if (id === undefined || id.startsWith("--")) fail("Usage: interventions resolve <id> …");

  const { values } = parseArgs({
    args: [...argv.slice(1)],
    options: {
      specialist: { type: "string" },
      actions: { type: "string" },
      resolution: { type: "string" },
      "did-happen": { type: "boolean" },
      "did-not-happen": { type: "boolean" },
      abandon: { type: "boolean" },
      scope: { type: "string", default: "this_case_only" },
      kind: { type: "string", default: "guidance" },
      signature: { type: "string" },
    },
    strict: true,
  });

  const specialist = values.specialist;
  const actions = values.actions;
  const resolution = values.resolution;
  if (specialist === undefined || actions === undefined || resolution === undefined) {
    fail("--specialist, --actions and --resolution are all required.");
  }

  // The one question `assessIntent` could not answer. It has no default,
  // deliberately: a default here would be this script guessing at the exact
  // thing a person was asked to go and look at.
  const happened = values["did-happen"] === true;
  const notHappened = values["did-not-happen"] === true;
  if (happened === notHappened) {
    fail(
      "Say exactly one of --did-happen or --did-not-happen.\n\n" +
        "This is the whole question. The run stopped because nothing could establish whether\n" +
        `the action landed; you looked, so you can. There is no default, because a default here\n` +
        "would be this script guessing at the thing you were asked to check.",
    );
  }

  process.stderr.write(
    `\nRecording this as ${specialist}. That name is asserted, not authenticated: this command\n` +
      "is admitted on the service credential, so the record says who CLAIMED to resolve it.\n" +
      "That is acceptable while exactly one person holds that credential. The moment a second\n" +
      "specialist exists, authenticated individual identity is required (ADR-0048 §3).\n\n",
  );

  const body = await call(`/internal/v1/interventions/${encodeURIComponent(id)}/resolution`, {
    method: "POST",
    body: JSON.stringify({
      specialistId: specialist,
      actionsTaken: actions,
      resolution,
      outcome: values.abandon === true ? "abandon" : "resume",
      didHappen: happened,
      scope: values.scope,
      kind: values.kind,
      signature: values.signature ?? resolution.slice(0, 120),
    }),
  });

  const resolved = (body as { intervention?: OpenIntervention } | null)?.intervention;
  process.stdout.write(
    `Recorded against ${resolved?.interventionId ?? id}.\n\n` +
      (values.abandon === true
        ? "The run is abandoned. The student has NOT been told it is moving again, because it\nis not.\n"
        : "The run is back in the pool, and the student has been told. It picks up from where\n" +
          "the intent ledger says it got to — not from the beginning, and not from anything\n" +
          "you just typed: a resolution carries no position (ADR-0048 §5).\n"),
  );
}

const [command, ...rest] = process.argv.slice(2);
if (command === undefined || command === "list") {
  // eslint-disable-next-line no-restricted-syntax -- run boundary, as in retention-status.ts
  const now = new Date();
  await list(now);
} else if (command === "resolve") {
  await resolve(rest);
} else {
  fail(`Unknown command "${command}". Use "list" (the default) or "resolve".`);
}
