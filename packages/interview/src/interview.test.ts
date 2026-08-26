/**
 * Interview capability tests.
 *
 * The capability returns WHAT TO SAY. It renders nothing — AskiMate Chat
 * presents it in the conversation the student is already having (ADR-0015).
 */

import { describe, expect, it } from "vitest";

import { studentId, unwrapConfirmed, provenanceOf, isFieldUnavailable } from "@askimate/aas-domain";
import { DeterministicModelClient, MeteredModelClient } from "@askimate/aas-llm";
import type { ProfileFieldKey } from "@askimate/aas-profile";
import { emptyProfile, resolveField } from "@askimate/aas-profile";

import type { InterviewState } from "./interview.js";
import {
  MAX_ATTEMPTS_PER_FIELD,
  newInterview,
  nextAction,
  receiveAnswer,
  receiveConfirmation,
  recordDocument,
} from "./interview.js";

const NOW = new Date("2026-08-26T12:00:00Z");
const model = new DeterministicModelClient();

const REQUIRED: readonly ProfileFieldKey[] = [
  "identity.given_name",
  "identity.family_name",
  "identity.date_of_birth",
  "contact.email",
];

function start(fields: readonly ProfileFieldKey[] = REQUIRED, documents: readonly string[] = []): InterviewState {
  return newInterview({
    studentRef: "askimate:user:4812",
    profile: emptyProfile(studentId("stu_001"), NOW),
    requiredFields: fields,
    requiredDocuments: documents,
  });
}

describe("one question at a time", () => {
  it("asks for a single field, not a list", async () => {
    // A list of questions is a form. The whole point is that this is not one.
    const action = await nextAction(start(), model);

    expect(action.kind).toBe("ask");
    if (action.kind === "ask") {
      expect(action.fieldKey).toBe("identity.given_name");
      expect(action.say).toContain("first name");
      // The question explains itself rather than demanding out of nowhere.
      expect(action.say).toContain("passport");
    }
  });

  it("explains why it needs the answer", async () => {
    const action = await nextAction(start(["contact.email"]), model);
    if (action.kind === "ask") {
      expect(action.say).toContain("your own personal email");
    }
  });

  it("rephrases on a second attempt rather than repeating verbatim", async () => {
    const first = await nextAction(start(), model);
    const afterFailure = await receiveAnswer(start(), "identity.given_name", "12345", model);
    const second = await nextAction(afterFailure.state, model);

    expect(first.kind).toBe("ask");
    expect(second.kind).toBe("ask");
    if (first.kind === "ask" && second.kind === "ask") {
      expect(second.say).not.toBe(first.say);
      expect(second.say).toContain("didn't quite catch");
    }
  });
});

describe("nothing enters the profile unconfirmed", () => {
  it("holds an understood answer as PENDING, not stored", async () => {
    const outcome = await receiveAnswer(start(), "identity.given_name", "Reza", model);
    expect(outcome.kind).toBe("understood");

    // The value is understood but NOT in the profile.
    expect(isFieldUnavailable(resolveField(outcome.state.profile, "identity.given_name"))).toBe(true);
  });

  it("plays the reading back for confirmation, deterministically", async () => {
    const outcome = await receiveAnswer(start(), "identity.given_name", "Reza", model);
    const action = await nextAction(outcome.state, model);

    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      // The student sees what they said AND what was understood.
      expect(action.say).toContain("Reza");
      expect(action.say).toContain("Is that right?");
    }
  });

  it("stores the value ONLY after the student agrees", async () => {
    const heard = await receiveAnswer(start(), "identity.given_name", "Reza", model);
    const confirmed = receiveConfirmation(heard.state, { agreed: true }, NOW);

    expect(confirmed.kind).toBe("confirmed");
    const resolution = resolveField(confirmed.state.profile, "identity.given_name");
    expect(isFieldUnavailable(resolution)).toBe(false);
    if (!isFieldUnavailable(resolution)) {
      expect(unwrapConfirmed(resolution)).toBe("Reza");
      expect(provenanceOf(resolution).source).toBe("student_stated");
      // The student's own words are kept alongside the value.
      expect(provenanceOf(resolution).sourceExcerpt).toBe("Reza");
    }
  });

  it("stores the CORRECTION when the student says the reading was wrong", async () => {
    const heard = await receiveAnswer(start(), "identity.given_name", "Rezza", model);
    const corrected = receiveConfirmation(heard.state, { agreed: false, correction: "Reza" }, NOW);

    expect(corrected.kind).toBe("corrected");
    const resolution = resolveField(corrected.state.profile, "identity.given_name");
    if (!isFieldUnavailable(resolution)) {
      expect(unwrapConfirmed(resolution)).toBe("Reza");
      expect(provenanceOf(resolution).source).toBe("student_corrected");
    }
  });

  it("does NOT store the original when a correction cannot be read", async () => {
    // The worst available outcome would be the student saying "no" and being
    // overruled because their correction was unparseable.
    const heard = await receiveAnswer(start(), "identity.date_of_birth", "1999-04-02", model);
    const bad = receiveConfirmation(heard.state, { agreed: false, correction: "sometime in the 90s" }, NOW);

    expect(bad.kind).toBe("not_understood");
    expect(isFieldUnavailable(resolveField(bad.state.profile, "identity.date_of_birth"))).toBe(true);
  });

  it("stores nothing when the student rejects with no correction", async () => {
    const heard = await receiveAnswer(start(), "identity.given_name", "Rezza", model);
    const rejected = receiveConfirmation(heard.state, { agreed: false }, NOW);

    expect(rejected.kind).toBe("declined");
    expect(isFieldUnavailable(resolveField(rejected.state.profile, "identity.given_name"))).toBe(true);
  });
});

describe("evaluating whether an answer is sufficient", () => {
  it("rejects an unusable answer and counts the attempt", async () => {
    const outcome = await receiveAnswer(start(), "contact.email", "not an email", model);
    expect(outcome.kind).toBe("not_understood");
    expect(outcome.state.attempts.get("contact.email")).toBe(1);
  });

  it("treats 'I don't know' as an answer, not a parse failure", async () => {
    // Asking again in the same way would be badgering.
    const outcome = await receiveAnswer(start(), "contact.email", "I don't know", model);
    expect(outcome.kind).toBe("not_understood");
    if (outcome.kind === "not_understood") {
      expect(outcome.reason).toContain("does not know");
    }
  });

  it("REFUSES an ambiguous date rather than guessing", async () => {
    // 02/04/1999 is April 2nd in Britain and February 4th in America. Date of
    // birth drives minor detection, so a wrong reading has legal consequences.
    const outcome = await receiveAnswer(start(), "identity.date_of_birth", "02/04/1999", model);
    expect(outcome.kind).toBe("not_understood");
  });

  it("accepts unambiguous date forms", async () => {
    for (const spoken of ["1999-04-02", "2 April 1999", "2nd April 1999"]) {
      const outcome = await receiveAnswer(start(), "identity.date_of_birth", spoken, model);
      expect(outcome.kind).toBe("understood");
    }
  });

  it("refuses a two-word personal statement", async () => {
    const outcome = await receiveAnswer(start(["study.personal_statement"]), "study.personal_statement", "I like business", model);
    expect(outcome.kind).toBe("not_understood");
  });
});

describe("asking, and then escalating rather than guessing", () => {
  it("escalates after the attempt limit", async () => {
    // ADR-0007: "never make the student fill in a form" does not become "so
    // fill it in for them". When asking fails, a specialist looks at it.
    let state = start(["contact.email"]);
    for (let i = 0; i < MAX_ATTEMPTS_PER_FIELD; i += 1) {
      const outcome = await receiveAnswer(state, "contact.email", "nope", model);
      state = outcome.state;
    }

    const action = await nextAction(state, model);
    expect(action.kind).toBe("escalate");
    if (action.kind === "escalate") {
      expect(action.fieldKey).toBe("contact.email");
      expect(action.reason).toContain("specialist");
    }
  });

  it("escalates rather than improvising a question for an unknown field", async () => {
    const action = await nextAction(start(["finance.sponsor_name"]), model);
    expect(action.kind).toBe("escalate");
    if (action.kind === "escalate") {
      expect(action.reason).toContain("will not improvise");
    }
  });
});

describe("documents are requested in the conversation", () => {
  it("asks for an upload conversationally, not on a form", async () => {
    const action = await nextAction(start([], ["passport"]), model);
    expect(action.kind).toBe("request_document");
    if (action.kind === "request_document") {
      expect(action.documentType).toBe("passport");
      expect(action.say).toContain("passport");
    }
  });

  it("moves on once the document is collected", async () => {
    const withDoc = recordDocument(start([], ["passport"]), "passport");
    expect((await nextAction(withDoc, model)).kind).toBe("complete");
  });

  it("asks for fields before documents", async () => {
    // An upload request lands better once the agent knows who it is talking to.
    const action = await nextAction(start(["identity.given_name"], ["passport"]), model);
    expect(action.kind).toBe("ask");
  });
});

describe("a full conversation, end to end", () => {
  it("collects and confirms everything, then reports complete", async () => {
    const metered = new MeteredModelClient(new DeterministicModelClient());
    let state = start();

    const answers: Record<string, string> = {
      "identity.given_name": "Reza",
      "identity.family_name": "Hosseini",
      "identity.date_of_birth": "2 April 1999",
      "contact.email": "reza.hosseini@example.com",
    };

    const said: string[] = [];

    for (let turn = 0; turn < 40; turn += 1) {
      const action = await nextAction(state, metered);
      if (action.kind === "complete") break;

      expect(action.kind).not.toBe("escalate");

      if (action.kind === "ask") {
        said.push(action.say);
        const reply = answers[action.fieldKey];
        if (reply === undefined) throw new Error(`no scripted answer for ${action.fieldKey}`);
        const outcome = await receiveAnswer(state, action.fieldKey, reply, metered);
        state = outcome.state;
      } else if (action.kind === "confirm") {
        said.push(action.say);
        state = receiveConfirmation(state, { agreed: true }, NOW).state;
      }
    }

    expect((await nextAction(state, metered)).kind).toBe("complete");

    // Every required field is confirmed and readable.
    for (const key of REQUIRED) {
      expect(isFieldUnavailable(resolveField(state.profile, key))).toBe(false);
    }

    const dob = resolveField(state.profile, "identity.date_of_birth");
    if (!isFieldUnavailable(dob)) {
      expect(unwrapConfirmed(dob).toISOString().slice(0, 10)).toBe("1999-04-02");
    }

    // 4 fields × (question + playback) = 8 turns. The student was asked one
    // thing at a time and never shown a form.
    expect(said).toHaveLength(8);

    // And the run's model cost is measured, not estimated.
    expect(metered.usage.calls).toBeGreaterThan(0);
  });
});
