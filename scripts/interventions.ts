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

import type { WireResolutionSaying } from "@askimate/aas-contracts";

const SERVICE = process.env["AAS_CONVERSATION_URL"] ?? "http://127.0.0.1:4000";
const CERT = process.env["AAS_SERVICE_CERT"];

interface OpenIntervention {
  readonly interventionId: string;
  readonly runId: string;
  readonly caseId: string;
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
    // P305, ADR-0160: a held page's stop is refused anything but an abandon
    // while its page is held. "validation_failed" alone would leave the
    // person who typed it guessing why.
    const pointers =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>)["pointers"] : undefined;
    if (
      code === "validation_failed" &&
      path.endsWith("/resolution") &&
      Array.isArray(pointers) &&
      pointers.includes("/outcome")
    ) {
      fail(
        "The service refused this outcome, and recorded nothing.\n\n" +
          "A stop whose reason is page_save_may_submit is for a page that is held (ADR-0160): it\n" +
          "is not known whether saving that page sends the application. While the page is held,\n" +
          "only --abandon is taken. The hold is lifted by deleting its line in\n" +
          "packages/catalogue/src/held-pages.ts, on Vahid's words, and restarting the service;\n" +
          "then resolve the stop again.\n\n" +
          "If the application was SUBMITTED by hand, record that first, and then resume: the run\n" +
          "fills nothing more and hands the account back (ADR-0159 O10):\n" +
          "  pnpm run submission-by-hand <caseId> --by <your-name> --at <time> --observed|--stated\n" +
          "If only the page was saved by hand, abandon instead: the case cannot record a page saved\n" +
          "by hand, and a resume would save the page a second time.",
      );
    }
    // P312: a resolution that failed partway may already be recorded and
    // the student may already have been told something. "Refused" would be a
    // claim this command cannot make.
    if (path.endsWith("/resolution") && response.status >= 500) {
      fail(
        `The service failed partway (${code}). Whether this resolution was recorded, and what the\n` +
          "student was told, is not known to this command. Run `pnpm run interventions` and read the\n" +
          "conversation before resolving again.",
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
        // P308: the case is what `pnpm run submission-by-hand` takes.
        `    case      ${item.caseId}\n` +
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

  const answered = body as { intervention?: OpenIntervention; said?: unknown } | null;
  const resolved = answered?.intervention;
  // P312, item 4. His words: "the CLI must say only what the student was
  // actually told." So it prints what the service says THIS resolution
  // appended to the student's conversation — each message by its event number
  // and kind, never its words — and nothing it would have to assume. What
  // it printed before was inferred from flags and the queue, and was wrong
  // for every path P290, P305, P306 and P307 added.
  const lines = [`Recorded against ${resolved?.interventionId ?? id}${values.abandon === true ? ", as an abandon" : ""}.`, ""];
  const said = answered?.said;
  if (!Array.isArray(said)) {
    lines.push("The service did not say what this resolution told the student; this command makes no claim about it.");
  } else if (said.length === 0) {
    lines.push("Nothing was said to the student by this resolution.");
  } else {
    lines.push(`Said to the student by this resolution (${String(said.length)} message${said.length === 1 ? "" : "s"}), in order:`);
    for (const item of said as readonly { ordinal?: unknown; about?: unknown }[]) {
      const about = typeof item.about === "string" ? item.about : "undescribed";
      const known = (DESCRIBED as Readonly<Record<string, string>>)[about];
      lines.push(`  event ${String(item.ordinal)}  ${known ?? `a message this command has no description for (${about})`}`);
    }
  }
  // Printed before anything else is asked of the service: what was recorded
  // and said must not be lost to a failure reading the list after it.
  process.stdout.write(`${lines.join("\n")}\n`);
  // A fact about the queue, not about the student: a stop open for this run
  // now, as the list reads after the resolution.
  if (resolved === undefined) return;
  try {
    const listed = await fetch(`${SERVICE}/internal/v1/interventions`, { headers: { "x-service-cert": CERT ?? "" } });
    const open = listed.ok ? ((await listed.json()) as { interventions?: OpenIntervention[] }).interventions : undefined;
    if (open === undefined) {
      process.stdout.write("\nThe list could not be read after the resolution.\n");
      return;
    }
    const again = open.find((item) => item.runId === resolved.runId && item.interventionId !== resolved.interventionId);
    if (again !== undefined) process.stdout.write(`\nOpen for this run now, as the list reads after the resolution: ${again.interventionId} (${again.target}).\n`);
  } catch {
    process.stdout.write("\nThe list could not be read after the resolution.\n");
  }
}

/**
 * What each kind of message a resolution can append says, in a sentence that
 * holds no student value (P312). The kinds are the contract's
 * `WIRE_RESOLUTION_SAYINGS`; a kind not here is printed with its name.
 */
const DESCRIBED: Readonly<Record<WireResolutionSaying, string>> = {
  moving_again: 'the "Good news" message: it is moving again, and picks up where it stopped',
  asked_again: "the interview's question, asked again",
  registration_asked_again: "that someone looked, so the registration e-mail question is asked again",
  registration_question: "the registration e-mail question (it names their address, so it is not printed here)",
  entry_choice_offer: 'the offer of the form\'s own list and its escape, opened with "Someone on the team has looked at your … application."',
  entry_choice_stands: "that someone looked, and that the choice of the form's list put to them before still stands",
  stopped_again: "the message of a stop: it cannot go on, and it is with a person again",
  held_page: "that it stopped before a held page, and a person has been asked",
  abandoned: "that a person stopped work on it, with what that leaves",
  undescribed: "a message the service could not say the kind of",
};

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
