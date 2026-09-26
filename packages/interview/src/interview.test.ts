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
import { FIELD_SPECS, isComposite, isList } from "./field-specs.js";
import type { InterviewState } from "./interview.js";
import {
  chooseReading,
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
  if (isList(spec)) return expect.unreachable(`${key} is a list, not a scalar`);
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

  it("says the reading was set aside when the last one was rejected as an unreadable correction (P221)", async () => {
    // Vahid, on typing "yes" to a playback and being told "I didn't quite
    // catch that": *"It did catch it; it refused it as a correction. A student
    // reading that will retype the same address, as I did twice."*
    const state: InterviewState = {
      ...start(["contact.email"]),
      attempts: new Map([["contact.email", 1]]),
      rejected: new Set(["contact.email"]),
    };
    const again = await nextAction(state, model);
    expect(again.kind).toBe("ask");
    if (again.kind === "ask") {
      expect(again.say).toContain("I read your last message as a correction");
      expect(again.say).toContain("set that reading aside");
      expect(again.say).toContain("personal email address");
      expect(again.say).not.toContain("didn't quite catch");
      expect(again.say, "the label carries no possessive of its own").not.toContain("your your");
    }
  });

  it("reads a date with a short month name, and a numeric date with only one reading (P223)", async () => {
    // Vahid typed "11 Aug 1989" on his own run and was refused for an
    // abbreviation. "25/08/1989" has one reading: the first number cannot
    // be a month.
    const short = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "11 Aug 1989", model);
    expect(short.kind).toBe("understood");
    if (short.kind === "understood") {
      const proposed = short.state.pending?.proposed as { value: Date } | undefined;
      expect(proposed?.value.toISOString()).toBe("1989-08-11T00:00:00.000Z");
    }
    const dayFirst = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "25/08/1989", model);
    expect(dayFirst.kind).toBe("understood");
    if (dayFirst.kind === "understood") {
      const proposed = dayFirst.state.pending?.proposed as { value: Date } | undefined;
      expect(proposed?.value.toISOString()).toBe("1989-08-25T00:00:00.000Z");
    }
    // A day the calendar does not have is refused either way round.
    const impossible = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "30/02/1989", model);
    expect(impossible.kind).toBe("not_understood");
  });

  it("refuses a date the calendar does not have, says so in the next question, and never repeats the question verbatim (P223)", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Vahid, on "11/08/1989" answered with the same question, twice: *"A
    // person here has no idea whether they typed it wrong, whether the
    // system is broken, or what shape it wants — and there is nothing on the
    // screen to tell them."* And: *"Do not tell me the format to type."*
    // ═══════════════════════════════════════════════════════════════════
    const first = await nextAction(start(["identity.date_of_birth"]), model);
    // (P225: a two-way date is offered now, so the refusal under test is
    // the one that remains — a day the calendar does not have.)
    const answered = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "30/02/1989", model);
    expect(answered.kind).toBe("not_understood");
    if (answered.kind !== "not_understood") return;
    expect(answered.reason).toBe('"30/02/1989" is not a day the calendar has, read either way round.');
    expect(answered.state.attempts.get("identity.date_of_birth"), "the attempt counts").toBe(1);
    const again = await nextAction(answered.state, model);
    expect(again.kind).toBe("ask");
    if (first.kind === "ask" && again.kind === "ask") {
      expect(again.say.startsWith('"30/02/1989" is not a day the calendar has')).toBe(true);
      expect(again.say).not.toBe(first.say);
      expect(again.say).not.toContain("didn't quite catch");
      expect(again.say).toContain("What's your date of birth?");
    }
    // A two-digit year, and a reading that could not be read at all, each say what happened.
    const century = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "11/08/89", model);
    if (century.kind === "not_understood") expect(century.reason).toContain("two-digit year");
    const nonsense = await receiveAnswer(start(["identity.date_of_birth"]), "identity.date_of_birth", "soon", model);
    if (nonsense.kind === "not_understood") {
      expect(nonsense.reason).toBe('I could not read a date of birth, e.g. 1999-04-02 or 2 April 1999 from "soon".');
    }
    // A reading that IS understood clears the record of the unread one.
    const then = await receiveAnswer(answered.state, "identity.date_of_birth", "11 August 1989", model);
    expect(then.kind).toBe("understood");
    if (then.kind === "understood") expect(then.state.unread).toBeUndefined();
  });

  it("OFFERS the readings a two-way date has, spends no attempt, and the pick becomes the reading to confirm (P225)", async () => {
    // Vahid: *"Not guessing was right. Not offering is the defect."* — *"The
    // pick is an answer to the open question, not a new question — so it
    // should not spend an attempt."*
    const before = start(["identity.date_of_birth"]);
    const outcome = await receiveAnswer(before, "identity.date_of_birth", "11/08/1989", model);
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.fieldKey).toBe("identity.date_of_birth");
    expect(outcome.partKey).toBeUndefined();
    expect(outcome.readings.map((reading) => [reading.id, reading.label])).toEqual([
      ["r1", "11 August 1989"],
      ["r2", "8 November 1989"],
    ]);
    expect(outcome.state.attempts.get("identity.date_of_birth"), "no attempt spent").toBeUndefined();
    expect(outcome.state.unread, "nothing was refused").toBeUndefined();
    // The pick: their own statement of the value, pending as a reading is.
    const picked = chooseReading(outcome.state, "identity.date_of_birth", undefined, outcome.readings[1]!.proposed);
    expect(picked.kind).toBe("understood");
    if (picked.kind === "understood") {
      const proposed = picked.state.pending?.proposed as { value: Date; verbatim: string } | undefined;
      expect(proposed?.value.toISOString()).toBe("1989-11-08T00:00:00.000Z");
      expect(proposed?.verbatim, "their words travel with it").toBe("11/08/1989");
    }
    // One reading is not an offer: the date reads, or it is refused with why.
    expect((await receiveAnswer(before, "identity.date_of_birth", "25/08/1989", model)).kind).toBe("understood");
    expect((await receiveAnswer(before, "identity.date_of_birth", "30/02/1989", model)).kind).toBe("not_understood");
  });

  it("offers the readings of a two-way date given for a PART, and the pick is read as that part (P225)", async () => {
    // The mechanism is the field's, not the date of birth's: a passport's
    // expiry reads two ways just the same.
    let state = start(["identity.passport"]);
    for (const utterance of ["yes I have one", "X12345678"]) {
      const step = await receiveAnswer(state, "identity.passport", utterance, model);
      expect(step.kind).toBe("understood");
      state = step.state;
    }
    const outcome = await receiveAnswer(state, "identity.passport", "03/04/2031", model);
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.partKey).toBe("expiry");
    expect(outcome.readings.map((reading) => reading.label)).toEqual(["3 April 2031", "4 March 2031"]);
    const picked = chooseReading(state, "identity.passport", "expiry", outcome.readings[0]!.proposed);
    expect(picked.kind).toBe("understood");
    if (picked.kind === "understood") {
      expect(picked.state.pending, "the walk is not finished: the issuing country is still to ask").toBeUndefined();
      const read = picked.state.partial.get("identity.passport")?.get("expiry") as { value: Date } | undefined;
      expect(read?.value.toISOString()).toBe("2031-04-03T00:00:00.000Z");
      const next = await nextAction(picked.state, model);
      expect(next.kind === "ask" && next.partKey).toBe("issuingCountry");
    }
    // A pick for a part the walk is not on is refused, not applied.
    expect(chooseReading(state, "identity.passport", "issuingCountry", outcome.readings[0]!.proposed).kind).toBe("not_understood");
  });

  it("rephrases on a second attempt rather than repeating verbatim", async () => {
    const first = await nextAction(start(), model);
    const afterFailure = await receiveAnswer(start(), "identity.given_name", "12345", model);
    const second = await nextAction(afterFailure.state, model);

    expect(first.kind).toBe("ask");
    expect(second.kind).toBe("ask");
    if (first.kind === "ask" && second.kind === "ask") {
      expect(second.say).not.toBe(first.say);
      // P223: the second question opens with what happened to the answer,
      // never with "I didn't quite catch that" — it was caught, and refused.
      expect(second.say.startsWith('I could not read a person\'s first name from "12345".')).toBe(true);
      expect(second.say).not.toContain("didn't quite catch");
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

  it("never GUESSES an ambiguous date: both readings are offered, neither is taken", async () => {
    // 02/04/1999 is April 2nd in Britain and February 4th in America. Date of
    // birth drives minor detection, so a wrong reading has legal consequences.
    // Refused until P225; offered since (ADR-0146). Still never guessed.
    const outcome = await receiveAnswer(start(), "identity.date_of_birth", "02/04/1999", model);
    expect(outcome.kind).toBe("ambiguous");
    expect(outcome.state.pending, "nothing proposed on its own").toBeUndefined();
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
  it("NEVER skips a required field: whatever the counts, the action is about the first outstanding field (P224)", async () => {
    // Vahid: *"Nothing required may ever be skipped, by any path, for any
    // reason … Make that a structural property."* `nextAction` has one
    // selection and no predicate over attempts: the first outstanding
    // field is asked, or is the field stopped on. Walked over every count
    // the first two fields could hold.
    const fields: ProfileFieldKey[] = ["contact.email", "identity.given_name", "identity.family_name"];
    for (let first = 0; first <= MAX_ATTEMPTS_PER_FIELD + 1; first += 1) {
      for (let second = 0; second <= MAX_ATTEMPTS_PER_FIELD + 1; second += 1) {
        const state: InterviewState = {
          ...start(fields),
          attempts: new Map([["contact.email", first], ["identity.given_name", second]]),
        };
        const action = await nextAction(state, model);
        expect(action.kind === "ask" || action.kind === "escalate").toBe(true);
        if (action.kind === "ask" || action.kind === "escalate") {
          expect(action.fieldKey, `first=${String(first)} second=${String(second)}`).toBe("contact.email");
        }
        if (action.kind === "escalate") {
          expect(first).toBeGreaterThanOrEqual(MAX_ATTEMPTS_PER_FIELD);
          expect(action.attempts).toBe(first);
        }
      }
    }
  });

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

  it("can now ask for every ordinary field except the two visa lists and the held one (P211)", () => {
    // The phase's own arithmetic, counted rather than claimed. P211 gave the
    // three lists the Sheffield entry reads their questions; the two visa
    // lists it does not read, and the held `highest_qualification`, stay.
    const missing = (PROFILE_FIELD_KEYS as readonly ProfileFieldKey[]).filter(
      (key) => FIELD_SPECS[key] === undefined,
    );
    expect([...missing].sort()).toEqual([
      "education.highest_qualification",
      "immigration.previous_uk_visas",
      "immigration.previous_visa_refusals",
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
      const partsText = (parts: readonly { partKey: string; rationale: string; expectedShape: string }[]): string =>
        parts.map((part) => `${part.partKey} ${part.rationale} ${part.expectedShape}`).join(" ");
      const text = isComposite(spec)
        ? `${key} ${spec.rationale} ${partsText(spec.parts)}`
        : isList(spec)
          ? `${key} ${spec.rationale} ${spec.anyRationale} ${spec.anotherRationale} ${partsText(spec.item.parts)}`
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
    // ── Two fields LEFT this list in P199, and the reversal is the point ───
    //
    // `identity.country_of_birth` and `residence.country` were here when P191
    // wrote this test, and keeping what the student typed was right for them
    // then: there was no reviewed country table to read a name with, and a
    // half-table was worse than none. With the table built (ADR-0141) and the
    // reviewed mapping set keyed by ISO alpha-2, keeping the text is what is
    // now wrong — it stores `"Iran"` against an option map keyed `IR`. Their
    // contract is asserted above, in the P199 block; what remains here is the
    // fields that really are the student's own words.
    for (const key of ["identity.sex", "study.intended_start"] as const) {
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
        `${key} ${spec.rationale} ${
          isComposite(spec)
            ? spec.parts.map((part) => part.rationale).join(" ")
            : isList(spec)
              ? `${spec.anyRationale} ${spec.item.parts.map((part) => part.rationale).join(" ")}`
              : spec.expectedShape
        }`,
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

describe("the three country fields read through the reviewed table (P199, blocker 64)", () => {
  // ── Why this test exists ─────────────────────────────────────────────────
  //
  // Run A filled Sheffield's nationality, country-of-birth and residence boxes
  // only because a person had written `IR` into `docs/run-a/synthetic-profile
  // .json` by hand. The reviewed mapping set is keyed by ISO alpha-2 — nine
  // country-typed mappings, every one an option map on the code — and the
  // interview stored whatever the student typed. So a student answering *Iran*
  // stored `"Iran"`, the option map holds no such key, and the fill refuses.
  //
  // It is the saveBtn and Sep failure again: a value that looked right because
  // somebody authored it, not because anything read it.
  const COUNTRY_FIELDS: readonly ProfileFieldKey[] = [
    "identity.nationality",
    "identity.country_of_birth",
    "residence.country",
  ];

  it("stores the CODE the mapping is keyed by, whichever way the student writes the country", () => {
    for (const key of COUNTRY_FIELDS) {
      const spec = scalarSpec(key);
      // The three spellings a student actually uses, and the code itself.
      for (const written of ["Iran", "iran", " Iran ", "IR", "ir"]) {
        expect(spec.parse(written), `${key} ← ${JSON.stringify(written)}`).toBe("IR");
      }
      expect(spec.parse("United Kingdom"), key).toBe("GB");
      expect(spec.parse("South Korea"), key).toBe("KR");
    }
  });

  it("refuses what the table does not hold, rather than storing it and failing at the portal", () => {
    for (const key of COUNTRY_FIELDS) {
      const spec = scalarSpec(key);
      // `ZZ` is well-formed and assigned to nobody; the rest are not countries.
      // A demonym is refused TOO, and deliberately — see blocker 68. ICU ships
      // no demonyms, so reading "Iranian" would need a second reviewed table
      // with no derivation behind it, and that is Vahid's call, not this
      // parser's.
      for (const refused of ["Atlantis", "ZZ", "", "  ", "Iranian"]) {
        expect(spec.parse(refused), `${key} ← ${JSON.stringify(refused)}`).toBeNull();
      }
    }
  });

  it("says the shape it wants, so a student who writes a nationality is asked once and gets it right", () => {
    for (const key of COUNTRY_FIELDS) {
      const spec = scalarSpec(key);
      // The re-ask is built from `expectedShape`, and it is the only thing a
      // student who typed "Iranian" has to go on.
      expect(spec.expectedShape, key).toContain("country");
      expect(spec.expectedShape, key).toMatch(/Iran|e\.g\./);
    }
  });
});

describe("a list is collected entry by entry (ADR-0113, P211)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Item 1 of the list. Measured in P210 on an empty profile against the
  // signed entry: the interview's FIRST action was `escalate` on
  // `employment.history` — *"No question is defined"* — before the name was
  // asked, because three of the fourteen fields it is handed are list-valued
  // and had no question, and `nextAction` checks for an undefined field before
  // a question it can ask. Vahid: *"the sentence not even starting, and
  // neither of us knew."*
  //
  // ADR-0113, in his words: *"Entry by entry, not a CV block … one entry at a
  // time, one part at a time … 'none' is a confirmation."*
  // ═══════════════════════════════════════════════════════════════════════
  const SHEFFIELD_REQUIRED: readonly ProfileFieldKey[] = [
    "contact.email",
    "identity.given_name",
    "identity.family_name",
    "identity.date_of_birth",
    "contact.address",
    "employment.history",
    "education.prior_qualifications",
    "residence.in_uk_now",
    "residence.outside_residence_country_last_three_years",
    "residence.always_in_residence_country",
    "residence.always_in_eu",
    "immigration.uk_status",
    "immigration.uk_study",
    "identity.passport",
  ];

  async function walk(
    state: InterviewState,
    fieldKey: ProfileFieldKey,
    answers: readonly (readonly [string, string])[],
  ): Promise<InterviewState> {
    for (const [partKey, utterance] of answers) {
      const action = await nextAction(state, model);
      expect(action.kind, `before ${partKey}`).toBe("ask");
      if (action.kind === "ask") expect(action.partKey, "asked in order").toBe(partKey);
      const outcome = await receiveAnswer(state, fieldKey, utterance, model);
      expect(outcome.kind, `${partKey}: ${utterance}`).toBe("understood");
      state = outcome.state;
    }
    return state;
  }

  it("ASKS on its first move for the Sheffield entry's fourteen fields, rather than escalating before the name (P210's measurement, reversed)", async () => {
    const action = await nextAction(start(SHEFFIELD_REQUIRED), model);
    expect(action.kind).toBe("ask");
    if (action.kind === "ask") expect(action.fieldKey).toBe("contact.email");
  });

  it("takes 'none' as the whole answer: an empty list is put for confirmation and confirmed (ADR-0113 §3)", async () => {
    let state = start(["employment.history"]);
    const first = await nextAction(state, model);
    expect(first.kind).toBe("ask");
    if (first.kind === "ask") expect(first.partKey).toBe("any");
    state = (await receiveAnswer(state, "employment.history", "no", model)).state;
    const next = await nextAction(state, model);
    expect(next.kind, "nothing to list is an answer, and it is confirmed").toBe("confirm");
    if (next.kind === "confirm") expect(next.say).toContain("none");
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "employment.history");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual([]);
  });

  it("walks one job part by part, asks 'another?', and confirms the whole list once", async () => {
    let state = start(["employment.history"]);
    state = await walk(state, "employment.history", [
      ["any", "yes"],
      ["item0.employer", "Example Ltd"],
      ["item0.employerAddress", "1 Example Way, Sheffield"],
      ["item0.position", "Engineer"],
      ["item0.startDate", "January 2023"],
      ["item0.still", "yes"],
      ["item0.basis", "full time"],
      ["item0.duties", "Designing and testing things."],
      ["item0.refereeName", "none"],
      ["item0.another", "no"],
    ]);
    const done = await nextAction(state, model);
    expect(done.kind, "one confirmation, for the whole list").toBe("confirm");
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    expect(confirmed.kind).toBe("confirmed");
    const held = resolveField(confirmed.state.profile, "employment.history");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual([
      {
        employer: "Example Ltd",
        employerAddress: "1 Example Way, Sheffield",
        position: "Engineer",
        startDate: { year: 2023, month: 1 },
        end: { kind: "current" },
        basis: "full_time",
        duties: "Designing and testing things.",
      },
    ]);
  });

  it("asks the end date only of a job that has ended, and never reads 'current' off a blank (ADR-0111)", async () => {
    let state = start(["employment.history"]);
    state = await walk(state, "employment.history", [
      ["any", "yes"],
      ["item0.employer", "Old Employer"],
      ["item0.employerAddress", "2 Old Road"],
      ["item0.position", "Assistant"],
      ["item0.startDate", "2019-09"],
      ["item0.still", "no"],
      ["item0.endDate", "June 2021"],
      ["item0.basis", "none"],
      ["item0.duties", "Assisting."],
      ["item0.refereeName", "Dr Example"],
      ["item0.refereeRole", "Manager"],
      ["item0.another", "no"],
    ]);
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "employment.history");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual([
      {
        employer: "Old Employer",
        employerAddress: "2 Old Road",
        position: "Assistant",
        startDate: { year: 2019, month: 9 },
        end: { kind: "ended", date: { year: 2021, month: 6 } },
        duties: "Assisting.",
        referee: { name: "Dr Example", role: "Manager" },
      },
    ]);
  });

  it("collects a second entry when the student says there is another, and stops when they say there is not", async () => {
    let state = start(["residence.history"]);
    state = await walk(state, "residence.history", [
      ["any", "yes"],
      ["item0.countryCode", "Iran"],
      ["item0.from", "September 2015"],
      ["item0.still", "no"],
      ["item0.to", "August 2022"],
      ["item0.another", "yes"],
      ["item1.countryCode", "GB"],
      ["item1.from", "September 2022"],
      ["item1.still", "yes"],
      ["item1.another", "no"],
    ]);
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "residence.history");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual([
      { countryCode: "IR", from: { year: 2015, month: 9 }, to: { kind: "ended", date: { year: 2022, month: 8 } } },
      { countryCode: "GB", from: { year: 2022, month: 9 }, to: { kind: "current" } },
    ]);
  });

  it("collects a qualification with its level, end kind and grade scale read from the options the question lists — never a free spelling (ADR-0112)", async () => {
    let state = start(["education.prior_qualifications"]);
    // A level the question did not list is asked again, not decided to mean
    // something: `gradingSystemId` keys on the level's exact text.
    state = (await receiveAnswer(state, "education.prior_qualifications", "yes", model)).state;
    const loose = await receiveAnswer(state, "education.prior_qualifications", "a masters", model);
    expect(loose.kind).toBe("not_understood");
    state = await walk(state, "education.prior_qualifications", [
      ["item0.level", "Master's degree"],
      ["item0.awardTitle", "MSc"],
      ["item0.subject", "Industrial Engineering"],
      ["item0.institution", "Sharif University of Technology"],
      ["item0.countryCode", "IR"],
      ["item0.start", "September 2008"],
      ["item0.endKind", "completed"],
      ["item0.endDate", "June 2012"],
      ["item0.award", "none"],
      ["item0.grade", "17.2"],
      ["item0.gradeScale", "20-point"],
      ["item0.another", "no"],
    ]);
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "education.prior_qualifications");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual([
      {
        level: "Master's degree",
        awardTitle: "MSc",
        subject: "Industrial Engineering",
        institution: "Sharif University of Technology",
        countryCode: "IR",
        start: { year: 2008, month: 9 },
        end: { kind: "completed", date: { year: 2012, month: 6 } },
        grade: "17.2",
        gradeScale: "twenty_point",
      },
    ]);
  });

  it("keeps the award date the student gives, and never derives it from the end (ADR-0112)", async () => {
    let state = start(["education.prior_qualifications"]);
    state = await walk(state, "education.prior_qualifications", [
      ["any", "yes"],
      ["item0.level", "Bachelor's degree"],
      ["item0.awardTitle", "BSc"],
      ["item0.subject", "Business Management"],
      ["item0.institution", "University of Sheffield"],
      ["item0.countryCode", "United Kingdom"],
      ["item0.start", "2019-09"],
      ["item0.endKind", "completed"],
      ["item0.endDate", "2022-06"],
      ["item0.award", "July 2022"],
      ["item0.grade", "2:1"],
      ["item0.gradeScale", "UK honours"],
      ["item0.another", "no"],
    ]);
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "education.prior_qualifications");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    const [only] = unwrapConfirmed(held);
    expect(only?.award).toEqual({ year: 2022, month: 7 });
    expect(only?.end).toEqual({ kind: "completed", date: { year: 2022, month: 6 } });
    expect(only?.countryCode).toBe("GB");
    expect(only?.awardTitle, "the title as the student stated it, distinct from the level").toBe("BSc");
  });

  it("asks for the AWARD TITLE as its own part, stated by the student and never derived from the level (blocker 71, ADR-0142, P213)", async () => {
    // Blocker 71: the degree map read a level and wrote a title, so every BA
    // student was told to Sheffield as a BSc. The title is the student's own
    // statement now — and a qualification that carries none (a school
    // certificate) is stored without one, never with one invented.
    let state = start(["education.prior_qualifications"]);
    state = await walk(state, "education.prior_qualifications", [
      ["any", "yes"],
      ["item0.level", "High school diploma"],
      ["item0.awardTitle", "none"],
      ["item0.subject", "General"],
      ["item0.institution", "Example High School"],
      ["item0.countryCode", "IR"],
      ["item0.start", "2004-09"],
      ["item0.endKind", "completed"],
      ["item0.endDate", "2008-06"],
      ["item0.award", "none"],
      ["item0.grade", "18"],
      ["item0.gradeScale", "20-point"],
      ["item0.another", "no"],
    ]);
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "education.prior_qualifications");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    const [only] = unwrapConfirmed(held);
    expect(only?.level).toBe("High school diploma");
    expect("awardTitle" in (only ?? {}), "no title stated, no title stored").toBe(false);
  });

  it("refuses a part it cannot read and asks the SAME part again, counting the attempt under the item's key", async () => {
    let state = start(["employment.history"]);
    state = (await receiveAnswer(state, "employment.history", "yes", model)).state;
    state = (await receiveAnswer(state, "employment.history", "Example Ltd", model)).state;
    state = (await receiveAnswer(state, "employment.history", "1 Example Way", model)).state;
    state = (await receiveAnswer(state, "employment.history", "Engineer", model)).state;
    const unreadable = await receiveAnswer(state, "employment.history", "a while ago", model);
    expect(unreadable.kind).toBe("not_understood");
    state = unreadable.state;
    expect(state.attempts.get("employment.history#item0.startDate")).toBe(1);
    const again = await nextAction(state, model);
    expect(again.kind).toBe("ask");
    if (again.kind === "ask") expect(again.partKey).toBe("item0.startDate");
  });

  it("drops every entry when the student rejects the list, and starts again from 'any' (ADR-0140's rule, for a list)", async () => {
    let state = start(["residence.history"]);
    state = await walk(state, "residence.history", [
      ["any", "yes"],
      ["item0.countryCode", "GB"],
      ["item0.from", "2022-09"],
      ["item0.still", "yes"],
      ["item0.another", "no"],
    ]);
    const rejected = receiveConfirmation(state, { agreed: false }, NOW);
    expect(rejected.kind).toBe("declined");
    const again = await nextAction(rejected.state, model);
    expect(again.kind).toBe("ask");
    if (again.kind === "ask") expect(again.partKey).toBe("any");
    // And a correction to the WHOLE list is refused for the composite's
    // reason: which entry, which part, is not ours to decide.
    const corrected = receiveConfirmation(state, { agreed: false, correction: "no, 2021" }, NOW);
    expect(corrected.kind).toBe("not_understood");
    if (corrected.kind === "not_understood") expect(corrected.reason).toContain("entry by entry");
  });

  it("names the entry and the part in the question, so the student knows which job is being asked about", async () => {
    let state = start(["employment.history"]);
    state = (await receiveAnswer(state, "employment.history", "yes", model)).state;
    const action = await nextAction(state, model);
    expect(action.kind).toBe("ask");
    if (action.kind === "ask") {
      expect(action.partKey).toBe("item0.employer");
      expect(action.say.toLowerCase()).toContain("job 1");
      expect(action.say.toLowerCase()).toContain("employer");
    }
  });
});

describe("funding is the student's own statement (ADR-0143, P216)", () => {
  it("takes NO as a complete answer, asks nothing more, and stores { known: false } — never a guessed source", async () => {
    let state = start(["finance.funding"]);
    const first = await nextAction(state, model);
    expect(first.kind).toBe("ask");
    if (first.kind === "ask") expect(first.partKey).toBe("known");
    state = (await receiveAnswer(state, "finance.funding", "no", model)).state;
    const next = await nextAction(state, model);
    expect(next.kind, "nothing else is asked of a student who does not know").toBe("confirm");
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "finance.funding");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    expect(unwrapConfirmed(held)).toEqual({ known: false });
  });

  it("asks the source and the stage from closed lists, and the details as optional, of a student who knows", async () => {
    let state = start(["finance.funding"]);
    state = (await receiveAnswer(state, "finance.funding", "yes", model)).state;
    const loose = await receiveAnswer(state, "finance.funding", "my uncle", model);
    expect(loose.kind, "a source the question did not list is asked again").toBe("not_understood");
    for (const [partKey, utterance] of [["source", "self or family"], ["stage", "thinking about it"], ["details", "none"]] as const) {
      const action = await nextAction(state, model);
      expect(action.kind).toBe("ask");
      if (action.kind === "ask") expect(action.partKey).toBe(partKey);
      state = (await receiveAnswer(state, "finance.funding", utterance, model)).state;
    }
    const confirmed = receiveConfirmation(state, { agreed: true }, NOW);
    const held = resolveField(confirmed.state.profile, "finance.funding");
    if (isFieldUnavailable(held)) return expect.unreachable("just confirmed");
    // "thinking about it" is reachable: the normal case, not an edge.
    expect(unwrapConfirmed(held)).toEqual({ known: true, source: "self_or_family", stage: "considering" });
  });

  it("is financial evidence, so it still routes to the mandatory review (the gate is not weakened by the reshaping)", async () => {
    const { FINANCIAL_FIELDS } = await import("@askimate/aas-profile");
    expect(FINANCIAL_FIELDS).toContain("finance.funding");
    expect(FINANCIAL_FIELDS).toContain("finance.available_funds");
  });
});

describe("every part is asked for by the name a person uses, never by its key (P228, row 92, ADR-0147 §5)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Vahid, on his own interview: *"'What's your home address — line1?',
  // '— postalcode?', '— countrycode?' … Those are internal words on a
  // student's screen by the same rule."* His rule: *"Every field a person is
  // asked for needs the name a person uses — street, town, county, postcode,
  // country — and the playback reads as those names."*
  // ═══════════════════════════════════════════════════════════════════════
  // A key a person cannot read: a capital in the middle, an underscore, a
  // digit. "level", "subject" and "employer" are keys AND words, and stay.
  const camelCase = /[a-z][A-Z]/;
  const snakeCase = /[a-z]_[a-z]/;
  const digits = /\d/;

  it("names every part of every field with parts in a person's words, and never with its key", () => {
    let parts = 0;
    for (const key of PROFILE_FIELD_KEYS) {
      const spec = FIELD_SPECS[key] as FieldSpec<unknown> | undefined;
      if (spec === undefined) continue;
      const list = isList(spec) ? spec.item.parts : isComposite(spec) ? spec.parts : [];
      for (const part of list) {
        parts += 1;
        expect(part.label, `${key}.${part.partKey} has a name`).toBeTruthy();
        expect(part.label, `${key}.${part.partKey} is words`).not.toMatch(camelCase);
        expect(part.label, `${key}.${part.partKey} is words`).not.toMatch(snakeCase);
        expect(part.label, `${key}.${part.partKey} is words`).not.toMatch(digits);
      }
    }
    expect(parts, "the walk found the parts").toBeGreaterThan(40);
  });

  it("asks for the address by street, town, county, postcode and country, and the question carries no key", async () => {
    let state = start(["contact.address"]);
    const asked: string[] = [];
    for (const utterance of ["12 Valiasr Street", "-", "Tehran", "-", "1966733411", "IR"]) {
      const action = await nextAction(state, model);
      expect(action.kind).toBe("ask");
      if (action.kind !== "ask") return;
      asked.push(action.say);
      const outcome = await receiveAnswer(state, "contact.address", utterance, model);
      expect(outcome.kind, utterance).toBe("understood");
      state = outcome.state;
    }
    expect(asked.map((say) => say.slice(say.indexOf("What's your")))).toEqual([
      "What's your home address — street?",
      "What's your home address — second line of the address?",
      "What's your home address — town?",
      "What's your home address — county?",
      "What's your home address — postcode?",
      "What's your home address — country?",
    ]);
    // The keys that are not plain words — a digit, a capital in the middle —
    // are the ones a person cannot read; "city" and "region" are words.
    for (const say of asked) {
      for (const key of ["line1", "line2", "postalCode", "countryCode"]) {
        expect(say, `no "${key}" in "${say}"`).not.toContain(key);
      }
    }
    // The playback of the whole value reads by the same names.
    const playback = await nextAction(state, model);
    expect(playback.kind).toBe("confirm");
    if (playback.kind !== "confirm") return;
    expect(playback.say).toContain("Street: 12 Valiasr Street");
    expect(playback.say).toContain("Town: Tehran");
    expect(playback.say).toContain("Postcode: 1966733411");
    expect(playback.say).toContain("Country: Iran (IR)");
    expect(playback.say).not.toMatch(/line1|postalCode|countryCode/);
  });

  it("names a list entry's part the same way — 'job 1 — employer', never a key", async () => {
    let state = start(["employment.history"]);
    const any = await receiveAnswer(state, "employment.history", "yes", model);
    expect(any.kind).toBe("understood");
    state = any.state;
    const action = await nextAction(state, model);
    expect(action.kind).toBe("ask");
    if (action.kind === "ask") {
      expect(action.say).toContain("job 1 — employer");
      expect(action.say).not.toMatch(camelCase);
    }
  });

  it("stops on an exhausted part by its name, not its key", async () => {
    let state = start(["identity.passport"]);
    const held = await receiveAnswer(state, "identity.passport", "yes I have one", model);
    state = held.state;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const refused = await receiveAnswer(state, "identity.passport", "?", model);
      expect(refused.kind).toBe("not_understood");
      state = refused.state;
    }
    const stop = await nextAction(state, model);
    expect(stop.kind).toBe("escalate");
    if (stop.kind === "escalate") {
      expect(stop.reason).toContain('Asked for "Passport — passport number"');
      expect(stop.reason).not.toContain("— number");
    }
  });
});
