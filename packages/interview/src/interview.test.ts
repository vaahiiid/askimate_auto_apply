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
import { PROFILE_FIELD_KEYS, emptyProfile, resolveField } from "@askimate/aas-profile";

import type { FieldSpec, ScalarFieldSpec } from "./field-specs.js";
import { FIELD_SPECS, isComposite } from "./field-specs.js";
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

/** The spec for a field answered in one utterance, narrowed for the parser tests. */
/** Every spec, at one type, so a rule can be held over all of them at once. */
function allSpecs(): readonly (readonly [string, FieldSpec<unknown>])[] {
  const entries: readonly (readonly [string, FieldSpec<unknown>])[] = Object.entries(FIELD_SPECS);
  return entries;
}

function scalarSpec(key: ProfileFieldKey): ScalarFieldSpec<unknown> {
  const spec: FieldSpec<unknown> | undefined = FIELD_SPECS[key];
  if (spec === undefined) return expect.unreachable(`${key} has no spec`);
  if (isComposite(spec)) return expect.unreachable(`${key} is a composite, not a scalar`);
  return spec;
}
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

  it("ASKS for a scalar field it could not ask for before (P191)", async () => {
    // The mirror of the test below, and the one that proves the phase did
    // something: before P191 this field escalated with "will not improvise".
    const action = await nextAction(start(["residence.in_uk_now"]), model);
    expect(action.kind).toBe("ask");
  });

  it("escalates rather than improvising a question for an unknown field", async () => {
    // This test has moved twice, each time to a field that still has no
    // question: `finance.sponsor_name` gained one in P191, `contact.address`
    // in P192. `education.highest_qualification` is a `Qualification` — the
    // shape of one entry of the list-valued class Vahid held pending his read
    // of Part 2 — so giving it parts would settle what he reserved.
    const action = await nextAction(start(["education.highest_qualification"]), model);
    expect(action.kind).toBe("escalate");
    if (action.kind === "escalate") {
      expect(action.reason).toContain("will not improvise");
    }
  });
});

/**
 * P192 — a field whose value has several parts.
 *
 * Twelve of the registry's fields are one value each and P191 gave them
 * questions. Six are NOT: an address has six parts, a passport is a statement
 * or three facts, a language test carries a record of component scores. A
 * `parse` that takes one utterance and returns a whole `Address` would have to
 * invent the parts the student did not say — which is the rule Vahid stated on
 * 2026-09-23, generalising from the money parser: *"a value the student did not
 * state is never supplied by us, however obvious the default looks from where
 * we sit."*
 *
 * So the interview asks part by part, and the student confirms ONCE, at the end,
 * against the whole value — because the whole value is what enters the profile.
 */
describe("a field with several parts is asked part by part (P192)", () => {
  it("asks the first part of a composite rather than the whole thing at once", async () => {
    const action = await nextAction(start(["identity.passport"]), model);
    expect(action.kind).toBe("ask");
    if (action.kind === "ask") {
      expect(action.fieldKey).toBe("identity.passport");
      expect(action.partKey, "the ask names which part it is asking for").toBe("kind");
    }
  });

  it("asks nothing further once the student says they have none, and confirms the statement (ADR-0117)", async () => {
    // *"a student who does not have a thing has three empty values and nothing
    // anywhere saying why. Fold them."* The `none` arm ends the questioning:
    // asking for a number after that would be asking for something the student
    // has just said does not exist.
    const outcome = await receiveAnswer(start(["identity.passport"]), "identity.passport", "I don't have one", model);
    expect(outcome.kind).toBe("understood");
    const next = await nextAction(outcome.state, model);
    expect(next.kind, "all applicable parts answered, so it confirms").toBe("confirm");
    if (next.kind === "confirm") expect(next.say).toContain("none");
  });

  it("walks the parts of a held passport, in order, and confirms only at the end", async () => {
    let state = start(["identity.passport"]);
    const answers: readonly [string, string][] = [
      ["kind", "yes I have one"],
      ["number", "X12345678"],
      ["expiry", "2031-04-02"],
      ["issuingCountry", "Iran"],
    ];
    for (const [partKey, utterance] of answers) {
      const action = await nextAction(state, model);
      expect(action.kind, `before ${partKey}`).toBe("ask");
      if (action.kind === "ask") expect(action.partKey, "the parts are asked in order").toBe(partKey);
      const outcome = await receiveAnswer(state, "identity.passport", utterance, model);
      expect(outcome.kind, partKey).toBe("understood");
      state = outcome.state;
    }
    const done = await nextAction(state, model);
    expect(done.kind, "one confirmation, for the whole value").toBe("confirm");

    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "identity.passport");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual({
      kind: "held",
      number: "X12345678",
      expiry: new Date("2031-04-02T00:00:00Z"),
      issuingCountry: "Iran",
    });
  });

  it("refuses a part it cannot read, and does not move on (P192)", async () => {
    // The same rule as every other parser: an expiry of "next year" is null,
    // not a guess, and the part is asked again rather than skipped.
    let state = start(["identity.passport"]);
    state = (await receiveAnswer(state, "identity.passport", "yes", model)).state;
    state = (await receiveAnswer(state, "identity.passport", "X12345678", model)).state;
    const bad = await receiveAnswer(state, "identity.passport", "sometime next year", model);
    expect(bad.kind).toBe("not_understood");
    const again = await nextAction(bad.state, model);
    expect(again.kind).toBe("ask");
    if (again.kind === "ask") expect(again.partKey, "still on the expiry").toBe("expiry");
  });

  it("carries an optional part that the student leaves out, rather than inventing one", async () => {
    // `Address.line2` and `region` are optional in the registry. A student who
    // skips them gets an address without them — never a line invented to fill
    // the shape.
    let state = start(["contact.address"]);
    for (const utterance of ["12 Valiasr Street", "-", "Tehran", "-", "1966733411", "IR"]) {
      const outcome = await receiveAnswer(state, "contact.address", utterance, model);
      expect(outcome.kind, utterance).toBe("understood");
      state = outcome.state;
    }
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const address = resolveField(confirmed.state.profile, "contact.address");
    if (isFieldUnavailable(address)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(address)).toEqual({
      line1: "12 Valiasr Street",
      city: "Tehran",
      postalCode: "1966733411",
      countryCode: "IR",
    });
  });

  it("escalates on a composite field it has no parts for, exactly as for a scalar", async () => {
    // `education.highest_qualification` is a Qualification — the same shape as
    // one entry of the list-valued class Vahid held pending his read of Part 2.
    // Giving it parts here would settle the entry shape he reserved, so it has
    // none, and the interview stops rather than improvising.
    const action = await nextAction(start(["education.highest_qualification"]), model);
    expect(action.kind).toBe("escalate");
    if (action.kind === "escalate") expect(action.reason).toContain("will not improvise");
  });
});

/**
 * P197 — the three remaining composites.
 *
 * The machinery is P192's. What is new here is three shapes it had not met: a
 * record whose keys the student supplies, seven independent claims, and a
 * `none` arm with five optional parts behind it.
 */
describe("the three remaining composites (P197)", () => {
  it("asks for a language test part by part, and never infers a component from the overall", () => {
    // Vahid's rule, applied to the part that most invites breaking it: an
    // IELTS 7.5 overall says NOTHING about the listening score, and a system
    // that filled one in from the other would be inventing a number that goes
    // on an application.
    const spec = FIELD_SPECS["education.english_language_test"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite");
    expect(spec.parts.map((part) => part.partKey)).toEqual([
      "test", "overallScore", "componentScores", "testDate", "certificateNumber",
    ]);

    const components = spec.parts.find((part) => part.partKey === "componentScores");
    if (components === undefined) return expect.unreachable("componentScores is a part");
    expect(components.parse("Listening 7.5, Reading 8, Writing 6.5, Speaking 7")).toEqual({
      Listening: "7.5", Reading: "8", Writing: "6.5", Speaking: "7",
    });
    // A bare overall is not a set of components, and must not become one.
    for (const refused of ["7.5", "good", "", "Listening"]) {
      expect(components.parse(refused), refused).toBeNull();
    }
  });

  it("keeps a score as the certificate writes it, rather than making it a number", () => {
    // IELTS 7.5, TOEFL 102, PTE 65 — three scales. Parsing to a number would
    // turn 7.5 and 102 into the same kind of thing and lose what `7.5` means.
    const spec = FIELD_SPECS["education.english_language_test"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite");
    const overall = spec.parts.find((part) => part.partKey === "overallScore");
    if (overall === undefined) return expect.unreachable("overallScore is a part");
    for (const kept of ["7.5", "102", "65", "B2"]) expect(overall.parse(kept), kept).toBe(kept);
    expect(overall.parse("   ")).toBeNull();
  });

  it("asks all SEVEN uk_status claims, one at a time, and derives none of them (ADR-0115)", async () => {
    // *"The history is what they remembered; the answer is what they claim."*
    // `british_passport` is not read off `identity.passport.issuingCountry`,
    // and `eu_passport` is not read off nationality: both are signed at the
    // bottom of an application.
    const spec = FIELD_SPECS["immigration.uk_status"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite");
    expect(spec.parts.map((part) => part.partKey)).toEqual([
      "british_passport", "indefinite_leave", "refugee_status", "migrant_worker",
      "spouse_of_uk_citizen", "eu_passport", "spouse_of_eu_citizen",
    ]);
    // Every one is a yes-or-no with no lean: a hedge is asked again.
    for (const part of spec.parts) {
      expect(part.parse("yes"), part.partKey).toBe(true);
      expect(part.parse("no"), part.partKey).toBe(false);
      expect(part.parse("I think so"), part.partKey).toBeNull();
      expect(part.optional, `${part.partKey} is not optional`).not.toBe(true);
    }

    let state = start(["immigration.uk_status"]);
    for (const answer of ["no", "no", "no", "yes", "no", "no", "no"]) {
      const outcome = await receiveAnswer(state, "immigration.uk_status", answer, model);
      expect(outcome.kind, answer).toBe("understood");
      state = outcome.state;
    }
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "immigration.uk_status");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual({
      british_passport: false, indefinite_leave: false, refugee_status: false,
      migrant_worker: true, spouse_of_uk_citizen: false, eu_passport: false,
      spouse_of_eu_citizen: false,
    });
  });

  it("ends uk_study at 'none' without asking the five questions behind it (ADR-0117)", async () => {
    const outcome = await receiveAnswer(
      start(["immigration.uk_study"]), "immigration.uk_study", "no", model,
    );
    expect(outcome.kind).toBe("understood");
    const next = await nextAction(outcome.state, model);
    expect(next.kind, "nothing behind a none is asked").toBe("confirm");
  });

  it("walks uk_study when they HAVE studied here, carrying the optional parts they skip", async () => {
    let state = start(["immigration.uk_study"]);
    for (const answer of ["yes", "yes", "university", "BSc Computer Science", "2 years 3 months", "2028-09-30"]) {
      const outcome = await receiveAnswer(state, "immigration.uk_study", answer, model);
      expect(outcome.kind, answer).toBe("understood");
      state = outcome.state;
    }
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "immigration.uk_study");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual({
      kind: "studied",
      onStudentVisa: true,
      highestLevel: "university",
      qualification: "BSc Computer Science",
      timeOnVisa: { years: 2, months: 3 },
      currentVisaExpiry: new Date("2028-09-30T00:00:00Z"),
    });
  });

  it("refuses 'about 3 years' for time on a visa, rather than rounding a student's history", () => {
    // The Sep/Sept rule again. A visa period is counted by the Home Office;
    // an approximation of it is a number we made up.
    const spec = FIELD_SPECS["immigration.uk_study"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite");
    const time = spec.parts.find((part) => part.partKey === "timeOnVisa");
    if (time === undefined) return expect.unreachable("timeOnVisa is a part");
    expect(time.parse("2 years 3 months")).toEqual({ years: 2, months: 3 });
    expect(time.parse("18 months")).toEqual({ years: 0, months: 18 });
    expect(time.parse("2 years")).toEqual({ years: 2, months: 0 });
    for (const refused of ["about 3 years", "3", "a while", "two years", ""]) {
      expect(time.parse(refused), refused).toBeNull();
    }
  });

  it("reads a study level only from the options the question listed", () => {
    // The six are the registry's own closed set, and the question names them.
    // Matching what the student picked from a list they wereShown is reading,
    // not guessing — and anything off the list is asked again.
    const spec = FIELD_SPECS["immigration.uk_study"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite");
    const level = spec.parts.find((part) => part.partKey === "highestLevel");
    if (level === undefined) return expect.unreachable("highestLevel is a part");
    expect(level.expectedShape, "the question lists them").toContain("university");
    expect(level.parse("university")).toBe("university");
    expect(level.parse("English language")).toBe("english_language");
    expect(level.parse(" School ")).toBe("school");
    for (const refused of ["postgraduate", "a masters", "", "uni"]) {
      expect(level.parse(refused), refused).toBeNull();
    }
  });

  it("can now ask for every ordinary field except the five list-valued ones and the held one", () => {
    // The phase's own arithmetic, counted rather than claimed.
    const missing = (PROFILE_FIELD_KEYS as readonly ProfileFieldKey[]).filter(
      (key) => FIELD_SPECS[key] === undefined,
    );
    expect([...missing].sort()).toEqual([
      "education.highest_qualification",
      "education.prior_qualifications",
      "employment.history",
      "immigration.previous_uk_visas",
      "immigration.previous_visa_refusals",
      "residence.history",
    ]);
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

// ───────────────────────────────────────────────────────────────────────────
// The interview never asks for a credential
// ───────────────────────────────────────────────────────────────────────────

describe("what the interview is not allowed to ask for", () => {
  /**
   * ═════════════════════════════════════════════════════════════════════════
   * Vahid, 2026-08-26: *"Never ask 'What is your password?' in ordinary
   * conversational text."*
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Nobody is going to write `askStudent("what is your password?")` on
   * purpose. What happens instead is that the password becomes ONE MORE FIELD
   * in an interview that already asks fifteen questions, because that is the
   * path of least resistance and the interview already works. The student
   * types it as a chat message, it lands in the transcript, the transcript
   * goes to the model as context on the next turn, and it is now somewhere
   * nobody can get it out of.
   *
   * A password is collected through `RunStep.request_secret` and AskiMate
   * Chat's own secure control — a different type, a different code path, and
   * no function that converts one into the other. This test is the tripwire on
   * the easy mistake.
   */
  const CREDENTIAL_WORDS = [
    "password",
    "passcode",
    "credential",
    "pin",
    "secret",
    "security question",
    "security answer",
    "one-time code",
    "otp",
  ];

  it("has no field spec that is a credential", () => {
    // P192: a composite's parts carry student-facing text of their own, so the
    // tripwire reads them too. A rule that covered only the field would have
    // let a `password` part in under a field named something else.
    const offending = allSpecs().filter(([key, spec]) => {
      const text = isComposite(spec)
        ? `${key} ${spec.rationale} ${spec.parts
            .map((part) => `${part.partKey} ${part.rationale} ${part.expectedShape}`)
            .join(" ")}`
        : `${key} ${spec.rationale} ${spec.expectedShape}`;
      return CREDENTIAL_WORDS.some((word) => text.toLowerCase().includes(word));
    });
    expect(offending.map(([key]) => key)).toEqual([]);
  });

  // ── P191: the registry's scalar fields can be asked for ──────────────────
  //
  // Twenty of the registry's twenty-seven fields had no question, so a person
  // edited a file. Vahid, 2026-09-22: *"Nothing above matters to a real student
  // until that is closed."* This phase closes the twelve that are one value
  // each; the composites and the list-valued groups are their own phases.

  const SCALARS = [
    "identity.country_of_birth",
    "identity.sex",
    "study.intended_start",
    "finance.funding_source",
    "finance.sponsor_name",
    "finance.available_funds",
    "residence.country",
    "residence.in_uk_now",
    "residence.always_in_residence_country",
    "residence.always_in_eu",
    "residence.outside_residence_country_last_three_years",
    "residence.uk_entry_date",
  ] as const;

  it("can ask for every scalar field in the registry (P191)", () => {
    const missing = SCALARS.filter((key) => FIELD_SPECS[key] === undefined);
    expect(missing, "a field with no question is a field a person edits into a file by hand").toEqual([]);
  });

  it("reads a yes or a no, and refuses anything that is neither (P191)", () => {
    // ADR-0115: these are CLAIMS the student makes, asked and never derived
    // from the history. A claim read wrong is signed at the bottom of an
    // application, so a doubtful answer is asked again rather than guessed.
    const spec = scalarSpec("residence.in_uk_now");
    for (const yes of ["yes", "Yes", " y ", "yeah", "yep", "true"]) expect(spec.parse(yes), yes).toBe(true);
    for (const no of ["no", "No", "n", "nope", "false"]) expect(spec.parse(no), no).toBe(false);
    for (const neither of ["maybe", "sometimes", "I think so", "", "   ", "not sure", "on and off"]) {
      expect(spec.parse(neither), neither).toBeNull();
    }
  });

  it("reads a month and a year, and refuses a form that could be read two ways (P191)", () => {
    // ADR-0115, his words: Sheffield asks a day "because it asks a day, not
    // because anyone knows it". The registry holds month and year, so the
    // question asks for month and year and nothing invents a day.
    const spec = scalarSpec("residence.uk_entry_date");
    expect(spec.parse("2019-09")).toEqual({ year: 2019, month: 9 });
    expect(spec.parse("September 2019")).toEqual({ year: 2019, month: 9 });
    expect(spec.parse(" sept 2019 ")).toEqual({ year: 2019, month: 9 });
    // 09/08 could be either order, and 2019-13 is not a month.
    for (const refused of ["09/08", "2019-13", "2019-00", "September", "2019", "the autumn of 2019", ""]) {
      expect(spec.parse(refused), refused).toBeNull();
    }
  });

  it("refuses an amount with no currency rather than choosing one (P191)", () => {
    // The same rule as ADR-0112's award date: a value with a part we chose is
    // worse than no value. "20000" is not an amount of money until the student
    // says of what.
    const spec = scalarSpec("finance.available_funds");
    expect(spec.parse("£20,000")).toEqual({ amountMinorUnits: 2_000_000, currency: "GBP" });
    expect(spec.parse("GBP 20000")).toEqual({ amountMinorUnits: 2_000_000, currency: "GBP" });
    expect(spec.parse("20000 gbp")).toEqual({ amountMinorUnits: 2_000_000, currency: "GBP" });
    expect(spec.parse("€1500.50")).toEqual({ amountMinorUnits: 150_050, currency: "EUR" });
    for (const refused of ["20000", "twenty thousand", "£", "about £20,000", "20000 pounds-ish", ""]) {
      expect(spec.parse(refused), refused).toBeNull();
    }
  });

  it("keeps what the student typed for the open ones, and refuses an empty answer (P191)", () => {
    for (const key of ["identity.country_of_birth", "identity.sex", "study.intended_start", "finance.funding_source", "finance.sponsor_name", "residence.country"] as const) {
      const spec = scalarSpec(key);
      expect(spec.parse("  Iran  "), key).toBe("Iran");
      expect(spec.parse("   "), key).toBeNull();
      expect(spec.parse(""), key).toBeNull();
    }
  });

  it("explains itself for every scalar it asks for, and names the shape wanted (P191)", () => {
    // A question with no reason is interrogation, not conversation — the rule
    // this file opens with. Held for the new ones, not just the first seven.
    for (const key of SCALARS) {
      const spec = scalarSpec(key);
      expect(spec.rationale.length, key).toBeGreaterThan(20);
      expect(spec.expectedShape.length, key).toBeGreaterThan(3);
    }
  });

  // ── P192: the guardian path, which is a mandatory-review category ───────
  //
  // Vahid, 2026-09-23: *"They are reachable only on the minor path and that is
  // exactly why they should not wait: a path that is rarely taken and never
  // built is the one that fails in front of a real person."*

  const GUARDIAN = [
    "guardian.given_name",
    "guardian.family_name",
    "guardian.relationship",
    "guardian.email",
    "guardian.mobile",
  ] as const;

  it("can ask for every guardian field, so the minor path is built rather than assumed (P192)", () => {
    const missing = GUARDIAN.filter((key) => FIELD_SPECS[key] === undefined);
    expect(missing, "the rarely-taken path is the one that fails in front of a real person").toEqual([]);
  });

  it("tells a minor that a person will check this part, rather than only routing it (P192)", async () => {
    // Anything involving a minor is a mandatory human review, every time,
    // regardless of confidence (brief §2.5). That changes what the student is
    // TOLD, not only who reads it afterwards: a student who is told a person
    // will look is not surprised by the wait that follows.
    const said = (
      await Promise.all(
        GUARDIAN.map(async (key) => {
          const action = await nextAction(start([key]), model);
          return action.kind === "ask" ? action.say : "";
        }),
      )
    ).join(" ");
    expect(said, "at least one of the guardian questions names the person who checks").toMatch(
      /a person here checks|a person here checks everything/i,
    );
  });

  it("says whose details these are, because they are a third party's (P192)", () => {
    // The guardian is not in this conversation and has consented to nothing
    // here. The least the question can do is be clear that it is asking about
    // someone else — see `field-specs.ts` for the gap that leaves.
    for (const key of ["guardian.email", "guardian.mobile"] as const) {
      const spec = scalarSpec(key);
      expect(spec.rationale.toLowerCase(), key).toContain("not yours");
    }
  });

  it("never asks whether the student is a minor — that is determined (P192)", () => {
    // ADR-0011: minority comes from the date of birth. A question inviting a
    // student to answer around a safeguard is the one question this registry
    // must not contain.
    const asked = allSpecs()
      .map(([key, spec]) =>
        `${key} ${spec.rationale} ${isComposite(spec) ? spec.parts.map((part) => part.rationale).join(" ") : spec.expectedShape}`,
      )
      .join(" ")
      .toLowerCase();
    // The ban is on ASKING. Telling a minor why they are being asked for a
    // guardian — "because you are under 18" — states back a determination that
    // was already made from their date of birth, which is the opposite failure
    // and the honest thing to do.
    for (const forbidden of [
      "are you under 18",
      "under eighteen",
      "are you a minor",
      "how old are you",
      "what is your age",
    ]) {
      expect(asked, forbidden).not.toContain(forbidden);
    }
  });

  it("reads a country through the REVIEWED table, and refuses what it does not hold (P195)", () => {
    // ═══════════════════════════════════════════════════════════════════
    // This test asserted the opposite in P192, and the change is Vahid's.
    //
    // Then: *"Iran"* was refused, because turning a name into `IR` was a
    // lookup and there was no table to do it with — and a half-table failing
    // invisibly is worse than a refusal. Now (blocker 61, decided 2026-09-23):
    // *"build it as a reviewed artefact… the list itself reviewed and hashed
    // like a blueprint, and refuse anything not in it."* With the artefact in
    // place the lookup is checkable, so the name resolves.
    //
    // The rule did not soften. What changed is that there is now something to
    // look in.
    // ═══════════════════════════════════════════════════════════════════
    const spec = FIELD_SPECS["contact.address"];
    if (spec === undefined || !isComposite(spec)) return expect.unreachable("a composite, asked for above");
    const country = spec.parts.find((part) => part.partKey === "countryCode");
    if (country === undefined) return expect.unreachable("countryCode is a part");

    expect(country.parse("IR")).toBe("IR");
    expect(country.parse(" gb ")).toBe("GB");
    expect(country.parse("Iran"), "the name a student would actually type").toBe("IR");
    expect(country.parse("united kingdom")).toBe("GB");

    // MEMBERSHIP, not shape. `ZZ` and `XK` are well formed and nobody is
    // assigned them; a regular expression would have taken both.
    for (const refused of ["ZZ", "XK", "EU", "Persia", "IRN", "I", ""]) {
      expect(country.parse(refused), refused).toBeNull();
    }
  });

  it("asks a composite again rather than reading a correction to the whole of it (P192)", async () => {
    // "no, flat 4" could be a new first line or a new second line, and
    // choosing between them is us supplying the answer.
    let state = start(["contact.address"]);
    for (const utterance of ["12 Valiasr Street", "-", "Tehran", "-", "1966733411", "IR"]) {
      state = (await receiveAnswer(state, "contact.address", utterance, model)).state;
    }
    const outcome = receiveConfirmation(state, { agreed: false, correction: "flat 4" }, NOW);
    expect(outcome.kind).toBe("not_understood");
    if (outcome.kind === "not_understood") expect(outcome.reason).toContain("part by part");
    // And it starts again from the first part rather than being stranded.
    const again = await nextAction(outcome.state, model);
    expect(again.kind).toBe("ask");
    if (again.kind === "ask") expect(again.partKey).toBe("line1");
  });

  it("counts attempts per PART, so one unreadable answer does not exhaust a six-part field (P192)", async () => {
    // Counting per field would escalate an address after two readable answers
    // and one unreadable one — which is not three failures, it is one.
    let state = start(["contact.address"]);
    state = (await receiveAnswer(state, "contact.address", "12 Valiasr Street", model)).state;
    state = (await receiveAnswer(state, "contact.address", "-", model)).state;
    state = (await receiveAnswer(state, "contact.address", "Tehran", model)).state;
    expect(state.attempts.get("contact.address#line1")).toBe(1);
    expect(state.attempts.get("contact.address"), "the field itself was never the question").toBeUndefined();
    const action = await nextAction(state, model);
    expect(action.kind, "three answers in, still asking").toBe("ask");
  });

  it("escalates on a part asked three times without a usable answer (P192)", async () => {
    let state = start(["identity.passport"]);
    state = (await receiveAnswer(state, "identity.passport", "yes", model)).state;
    state = (await receiveAnswer(state, "identity.passport", "X12345678", model)).state;
    for (const unreadable of ["sometime next year", "soon", "I'd have to check"]) {
      state = (await receiveAnswer(state, "identity.passport", unreadable, model)).state;
    }
    const action = await nextAction(state, model);
    expect(action.kind).toBe("escalate");
    if (action.kind === "escalate") {
      expect(action.reason, "the escalation names the part, not just the field").toContain("expiry");
    }
  });

  it("still asks for the things it SHOULD, so this is not passing by emptiness", () => {
    // A tripwire over an empty list is not a tripwire.
    expect(Object.keys(FIELD_SPECS).length).toBeGreaterThan(3);
    expect(Object.keys(FIELD_SPECS)).toContain("identity.given_name");
  });
});
