/**
 * A scripted conversation, for seeing the interview capability work.
 *
 *   pnpm run interview-demo
 *
 * ── What this is, and is not ─────────────────────────────────────────────
 *
 * This is a TEST DRIVER standing in for AskiMate Chat (ADR-0015). It is not a
 * product surface and never will be: the student's only surface is the
 * AskiMate conversation they are already in. This exists so the loop can be
 * exercised before that integration is built.
 *
 * The student's replies below are scripted, including deliberately awkward
 * ones — an ambiguous date, a misheard name — because the interesting
 * behaviour is what happens when an answer is NOT clean.
 */

import { studentId, isFieldUnavailable, provenanceOf, unwrapConfirmed } from "@askimate/aas-domain";
import { DeterministicModelClient, MeteredModelClient } from "@askimate/aas-llm";
import { emptyProfile, resolveField, FIELD_LABELS } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";
import {
  newInterview,
  nextAction,
  receiveAnswer,
  receiveConfirmation,
  recordDocument,
} from "@askimate/aas-interview";

const DIM = "[2m";
const BOLD = "[1m";
const BLUE = "[36m";
const GREEN = "[32m";
const AMBER = "[33m";
const RESET = "[0m";

const NOW = new Date("2026-08-26T12:00:00Z");

/** Scripted replies, in order, per field. Awkward answers included on purpose. */
const SCRIPT: Partial<Record<ProfileFieldKey, string[]>> = {
  "identity.given_name": ["Reza"],
  "identity.family_name": ["Hosseini"],
  // First reply is ambiguous — 02/04 is April 2nd here and February 4th in the
  // US. The agent must refuse it rather than pick one.
  "identity.date_of_birth": ["02/04/1999", "2 April 1999"],
  "identity.nationality": ["Iranian"],
  "contact.email": ["reza.hosseini@example.com"],
};

const used = new Map<string, number>();

function reply(fieldKey: ProfileFieldKey): string {
  const options = SCRIPT[fieldKey] ?? ["(no scripted answer)"];
  const index = Math.min(used.get(fieldKey) ?? 0, options.length - 1);
  used.set(fieldKey, index + 1);
  return options[index] ?? "";
}

function agent(text: string): void {
  console.log(`${BLUE}AskiMate${RESET}  ${text.replace(/\n/g, "\n          ")}`);
}
function student(text: string): void {
  console.log(`${BOLD}Student${RESET}   ${text}\n`);
}
function note(text: string): void {
  console.log(`${DIM}          ${text}${RESET}`);
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}Interview capability — scripted conversation${RESET}`);
  console.log(`${DIM}Ulster University Birmingham · MSc International Business · 2026-09${RESET}`);
  console.log(`${DIM}This is a test driver standing in for AskiMate Chat. Not a product surface.${RESET}\n`);

  const model = new MeteredModelClient(new DeterministicModelClient());

  let state = newInterview({
    studentRef: "askimate:user:4812",
    profile: emptyProfile(studentId("stu_001"), NOW),
    requiredFields: [
      "identity.given_name",
      "identity.family_name",
      "identity.date_of_birth",
      "identity.nationality",
      "contact.email",
    ],
    requiredDocuments: ["passport", "academic_transcript"],
  });

  for (let turn = 0; turn < 60; turn += 1) {
    const action = await nextAction(state, model);

    if (action.kind === "complete") {
      console.log(`${GREEN}✓ Everything the application needs has been collected and confirmed.${RESET}\n`);
      break;
    }

    if (action.kind === "escalate") {
      console.log(`${AMBER}⏸ Escalated to a specialist: ${action.reason}${RESET}\n`);
      break;
    }

    if (action.kind === "ask") {
      agent(action.say);
      const said = reply(action.fieldKey);
      student(said);
      const outcome = await receiveAnswer(state, action.fieldKey, said, model);
      state = outcome.state;
      if (outcome.kind === "not_understood") {
        note(`✗ not usable — ${outcome.reason}`);
        note(`  nothing stored; the agent will ask again`);
        console.log();
      }
      continue;
    }

    if (action.kind === "confirm") {
      agent(action.say);
      student("Yes, that's right.");
      state = receiveConfirmation(state, { agreed: true }, NOW).state;
      note(`✓ confirmed → written to the profile`);
      console.log();
      continue;
    }

    // Only `request_document` remains — the union is exhausted above.
    agent(action.say);
    student(`[uploads ${action.documentType}.pdf in the chat]`);
    state = recordDocument(state, action.documentType);
    note(`✓ received — extraction and confirmation follow the same rule`);
    console.log();
  }

  console.log(`${BOLD}Confirmed profile${RESET}`);
  console.log(`${DIM}────────────────${RESET}`);
  for (const key of state.requiredFields) {
    const resolution = resolveField(state.profile, key);
    if (isFieldUnavailable(resolution)) {
      console.log(`  ${AMBER}○${RESET} ${FIELD_LABELS[key]}: not collected`);
      continue;
    }
    const value = unwrapConfirmed(resolution);
    const rendered =
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    console.log(
      `  ${GREEN}●${RESET} ${FIELD_LABELS[key].padEnd(28)} ${rendered.padEnd(26)} ` +
        `${DIM}${provenanceOf(resolution).source}${RESET}`,
    );
  }
  console.log(`\n  Documents: ${state.collectedDocuments.join(", ")}`);
  console.log(
    `\n${DIM}  Model calls this run: ${String(model.usage.calls)} ` +
      `(~${String(model.usage.inputTokens + model.usage.outputTokens)} tokens est.)${RESET}`,
  );
  console.log(`${DIM}  Nothing was submitted. No portal was contacted.${RESET}\n`);
}

await main();
