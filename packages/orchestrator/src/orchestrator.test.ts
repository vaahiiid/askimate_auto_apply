import { describe, expect, it } from "vitest";

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ConfirmedValue, StudentId } from "@askimate/aas-domain";
import { proposeValue, studentId } from "@askimate/aas-domain";
import { newInterview } from "@askimate/aas-interview";
import { DeterministicModelClient } from "@askimate/aas-llm";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import type { MappingSet, UsableMappingSet } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import {
  InMemoryAuthorisationLedger,
  buildPreview,
  checkAuthorisable,
  validatePlan,
} from "@askimate/aas-preparation";
import type { PreviewDocument } from "@askimate/aas-preparation";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import {
  DISCLOSURE_ACTIVITY,
  authoriseDisclosure,
  determineLawfulBasis,
  type DisclosureAuthorisation,
} from "@askimate/aas-disclosure";

import type { ApplicationSession, DocumentSource, ExecutionContext } from "./execute.js";
import { executePlan, failures } from "./execute.js";
import {
  beginRun,
  markFilled,
  nextStep,
  requiredFieldsFor,
  withAuthorisation,
  withProfile,
} from "./run.js";
import type { RunInputs, RunState } from "./run.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const STUDENT: StudentId = studentId("student-1");
const model = new DeterministicModelClient();

const PASSPORT: PreviewDocument = {
  documentId: "doc-passport-1",
  filename: "passport.pdf",
  contentHash: "sha256:aaaa",
};

const STATEMENT =
  "I want to study this course because it builds directly on my industrial engineering degree " +
  "and the operations work I did afterwards.";

function withConfirmed(entries: readonly [ProfileFieldKey, unknown][]): ConfirmedProfile {
  let profile = emptyProfile(STUDENT, NOW);
  for (const [key, value] of entries) {
    const result = applyConfirmation({
      key,
      proposed: proposeValue({
        value: value as ProfileFieldType<ProfileFieldKey>,
        origin: "conversation",
        verbatim: "as stated",
        confidence: 0.9,
      }),
      confirmation: {
        studentRef: STUDENT,
        presentedText: "…",
        respondedAt: NOW,
        response: { kind: "accepted" },
      },
    });
    if (isDeclined(result)) expect.unreachable("the student accepted");
    profile = confirmField(profile, result, NOW);
  }
  return profile;
}

const COMPLETE = withConfirmed([
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["identity.nationality", "Iranian"],
  ["contact.email", "niloofar.hosseini@example.com"],
  ["study.personal_statement", STATEMENT],
]);

function inputs(overrides: Partial<RunInputs> = {}): RunInputs {
  return {
    caseId: "case-1",
    studentRef: STUDENT,
    blueprint: FIXTURE_BLUEPRINT,
    mappingSet: FIXTURE_MAPPING_SET,
    documents: new Map([["passport", PASSPORT]]),
    ...overrides,
  };
}

function usable(mappingSet: MappingSet = FIXTURE_MAPPING_SET): UsableMappingSet {
  const check = checkUsable(mappingSet, FIXTURE_BLUEPRINT);
  if (!check.usable) expect.unreachable("the fixture is usable");
  return check.mappingSet;
}

function runWith(profile: ConfirmedProfile, overrides: Partial<RunInputs> = {}): RunState {
  const runInputs = inputs(overrides);
  return beginRun({
    inputs: runInputs,
    profile,
    interview: newInterview({
      studentRef: STUDENT,
      profile,
      requiredFields: requiredFieldsFor(FIXTURE_BLUEPRINT, usable()),
      requiredDocuments: ["passport"],
    }),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The order of the workflow
// ───────────────────────────────────────────────────────────────────────────

describe("what the orchestrator does first", () => {
  it("refuses an unreviewed blueprint before asking the student anything", async () => {
    // No point asking for a date of birth against a blueprint nobody checked.
    const state = runWith(emptyProfile(STUDENT, NOW), {
      blueprint: { ...FIXTURE_BLUEPRINT, status: "draft" },
    });

    const step = await nextStep(state, model);
    expect(step.kind).toBe("specialist");
    if (step.kind !== "specialist") expect.unreachable("checked above");
    expect(step.reason).toBe("blueprint_not_executable");
  });

  it("refuses an unreviewed mapping set", async () => {
    const state = runWith(COMPLETE, {
      mappingSet: { ...FIXTURE_MAPPING_SET, status: "draft" },
    });

    const step = await nextStep(state, model);
    expect(step.kind).toBe("specialist");
  });
});

describe("who gets asked", () => {
  it("asks the STUDENT for a missing value", async () => {
    const state = runWith(emptyProfile(STUDENT, NOW));
    const step = await nextStep(state, model);

    expect(step.kind).toBe("interview");
    if (step.kind !== "interview") expect.unreachable("checked above");
    expect(step.action.kind).toBe("ask");
  });

  it("asks a SPECIALIST about a missing mapping", async () => {
    // A gap in the mapping set is the system's problem, not the applicant's.
    // Asking them where something belongs on a form is the exact thing this
    // system exists not to do.
    const withGap: MappingSet = {
      ...FIXTURE_MAPPING_SET,
      mappings: FIXTURE_MAPPING_SET.mappings.filter((m) => m.fieldRef !== "email"),
    };
    const state = runWith(COMPLETE, { mappingSet: withGap });

    const step = await nextStep(state, model);
    expect(step.kind).toBe("specialist");
    if (step.kind !== "specialist") expect.unreachable("checked above");
    expect(step.reason).toBe("no_mapping");
  });

  it("asks a SPECIALIST when a dropdown no longer offers the student's answer", async () => {
    const unusual = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hosseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Kurdish"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", STATEMENT],
    ]);

    const step = await nextStep(runWith(unusual), model);
    expect(step.kind).toBe("specialist");
    if (step.kind !== "specialist") expect.unreachable("checked above");
    expect(step.reason).toBe("render_refused");
  });

  it("derives the interview's worklist from the portal, not a fixed list", () => {
    // The next university will want different things. Nothing about which
    // fields to collect is hard-coded.
    expect(requiredFieldsFor(FIXTURE_BLUEPRINT, usable())).toEqual([
      "identity.given_name",
      "identity.family_name",
      "identity.date_of_birth",
      "identity.nationality",
      "contact.email",
      "study.personal_statement",
    ]);
  });
});

describe("content the portal would reject", () => {
  it("goes back for a fix rather than to authorisation", async () => {
    const tooLong = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hosseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Iranian"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", "A".repeat(4_500)],
    ]);

    const step = await nextStep(runWith(tooLong), model);
    expect(step.kind).toBe("fix_content");
    if (step.kind !== "fix_content") expect.unreachable("checked above");
    expect(step.violations[0]?.rule.kind).toBe("maxlength");
  });
});

describe("authorisation", () => {
  it("asks the student to approve exactly what will be sent", async () => {
    const step = await nextStep(runWith(COMPLETE), model);

    expect(step.kind).toBe("authorise");
    if (step.kind !== "authorise") expect.unreachable("checked above");
    expect(step.presentedText).toContain("This is exactly what will be submitted.");
    expect(step.presentedText).toContain("Date of birth: 02/04/1999");
  });

  it("moves to execution once the student has authorised", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const state = runWith(COMPLETE);

    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE);
    const previewResult = buildPreview(FIXTURE_BLUEPRINT, plan, state.inputs.documents);
    if (!previewResult.built) expect.unreachable("expected a preview");
    const check = checkAuthorisable(previewResult.preview, validatePlan(FIXTURE_BLUEPRINT, plan));
    if (!check.authorisable) expect.unreachable("expected authorisable");

    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: check.preview,
      authorisedAt: NOW,
    });

    expect((await nextStep(withAuthorisation(state, record), model)).kind).toBe("execute");
  });

  it("asks AGAIN when the content changed after the authorisation", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const state = runWith(COMPLETE);

    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE);
    const previewResult = buildPreview(FIXTURE_BLUEPRINT, plan, state.inputs.documents);
    if (!previewResult.built) expect.unreachable("expected a preview");
    const check = checkAuthorisable(previewResult.preview, validatePlan(FIXTURE_BLUEPRINT, plan));
    if (!check.authorisable) expect.unreachable("expected authorisable");

    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: check.preview,
      authorisedAt: NOW,
    });

    // The student corrects the spelling of their surname AFTER authorising.
    const corrected = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hoseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Iranian"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", STATEMENT],
    ]);

    const authorised = withAuthorisation(state, record);
    const changed = withProfile(authorised, corrected, authorised.interview);

    // The old authorisation covers a different application. It is not reused.
    expect((await nextStep(changed, model)).kind).toBe("authorise");
  });
});

describe("where the system stops", () => {
  it("reaches ready_to_submit and goes no further", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const state = runWith(COMPLETE);

    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE);
    const previewResult = buildPreview(FIXTURE_BLUEPRINT, plan, state.inputs.documents);
    if (!previewResult.built) expect.unreachable("expected a preview");
    const check = checkAuthorisable(previewResult.preview, validatePlan(FIXTURE_BLUEPRINT, plan));
    if (!check.authorisable) expect.unreachable("expected authorisable");

    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: check.preview,
      authorisedAt: NOW,
    });

    const step = await nextStep(markFilled(withAuthorisation(state, record)), model);
    expect(step.kind).toBe("ready_to_submit");
    if (step.kind !== "ready_to_submit") expect.unreachable("checked above");
    expect(step.contentHash).toBe(previewResult.preview.contentHash);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Execution
// ───────────────────────────────────────────────────────────────────────────

/** A session that records what it was asked to do. No browser involved. */
class RecordingSession implements ApplicationSession {
  public readonly filled: { locator: FieldLocator; text: string; confirmed: boolean }[] = [];
  public readonly attached: { locator: FieldLocator; documentId: string }[] = [];
  public readonly clicked: FieldLocator[] = [];
  #failOn: string | null = null;
  #failWith: Error | null = null;

  public failOn(locatorValue: string, error: Error): void {
    this.#failOn = locatorValue;
    this.#failWith = error;
  }

  public goto(_url: string): Promise<void> {
    return Promise.resolve();
  }

  public fill(locator: FieldLocator, value: ConfirmedValue<string>): Promise<void> {
    if (locator.value === this.#failOn && this.#failWith !== null) {
      return Promise.reject(this.#failWith);
    }
    this.filled.push({
      locator,
      text: (value as unknown as { value: string }).value,
      confirmed: true,
    });
    return Promise.resolve();
  }

  public fillConstant(locator: FieldLocator, text: string): Promise<void> {
    this.filled.push({ locator, text, confirmed: false });
    return Promise.resolve();
  }

  public click(locator: FieldLocator): Promise<void> {
    this.clicked.push(locator);
    return Promise.resolve();
  }

  public attach(locator: FieldLocator, documentId: string): Promise<void> {
    this.attached.push({ locator, documentId });
    return Promise.resolve();
  }

  public readValue(locator: FieldLocator): Promise<string> {
    const entry = [...this.filled].reverse().find((f) => f.locator.value === locator.value);
    return Promise.resolve(entry?.text ?? "");
  }

  public currentUrl(): Promise<string> {
    return Promise.resolve("https://apply.example.test/personal");
  }
}

// ── A document, with the authority to send it ─────────────────────────────
//
// Built the long way round on purpose: this is the shape the real flow has to
// produce, and a test helper that shortcut it would prove nothing.

const PASSPORT_BYTES = new TextEncoder().encode("%PDF");
const PASSPORT_HASH = "sha256:passport-v1";
const PORTAL_HOST = "apply.example.test";

const DISCLOSURE_BASIS = (() => {
  const check = determineLawfulBasis(
    {
      determinationId: "lb-disclose-1",
      activity: {
        activity: DISCLOSURE_ACTIVITY,
        purpose: "Send supporting documents to the university the student is applying to.",
        documentTypes: ["passport"],
      },
      article6: "contract",
      requiresStudentAuthorisation: true,
      determinedBy: "dpo-1",
      determinedAt: NOW,
      reasoning:
        "Necessary to perform the service the student asked for; specific authorisation is " +
        "still taken because the destination is a third party.",
      reviewBy: new Date("2027-08-26T00:00:00Z"),
    },
    NOW,
  );
  if (!check.valid) expect.unreachable("the fixture determination is valid");
  return check.determination;
})();

function passportAuthorisation(
  overrides: { readonly contentHash?: string; readonly portalHost?: string } = {},
): DisclosureAuthorisation {
  const check = authoriseDisclosure({
    disclosureId: "disc-1",
    subject: {
      documentId: "doc-passport-1",
      documentType: "passport",
      contentHash: overrides.contentHash ?? PASSPORT_HASH,
      caseId: "case-1",
      requestedFor: "Identity verification",
    },
    destination: {
      institutionName: "Example University",
      portalHost: overrides.portalHost ?? PORTAL_HOST,
    },
    determination: DISCLOSURE_BASIS,
    studentAuthorisation: {
      studentRef: STUDENT,
      presentedText:
        "I need to send your passport to Example University for identity verification. " +
        "Is that alright?",
      authorisedAt: NOW,
      method: "chat_affirmation",
    },
  });
  if (!check.authorised) expect.unreachable(`expected authorised: ${check.refusal.kind}`);
  return check.authorisation;
}

const documentSource: DocumentSource = (ref) =>
  Promise.resolve(
    ref === "passport"
      ? {
          documentId: "doc-passport-1",
          contents: PASSPORT_BYTES,
          contentHash: PASSPORT_HASH,
          authorisation: passportAuthorisation(),
        }
      : null,
  );

const CONTEXT: ExecutionContext = { portalHost: PORTAL_HOST, withdrawals: [], now: NOW };

describe("executing a plan", () => {
  const plan = () => planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE);

  it("fills every mapped field and attaches every document", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, CONTEXT);

    expect(report.completed).toBe(true);
    expect(session.filled.map((f) => f.text)).toContain("02/04/1999");
    expect(session.attached[0]?.documentId).toBe("doc-passport-1");
  });

  it("types a reviewed constant through its OWN method, never as confirmed data", async () => {
    const session = new RecordingSession();
    await executePlan(session, plan(), documentSource, CONTEXT);

    const courseCode = session.filled.find((f) => f.text === "PG-EX-2026");
    expect(courseCode?.confirmed).toBe(false);

    // Everything else went through the confirmed path.
    for (const entry of session.filled.filter((f) => f.text !== "PG-EX-2026")) {
      expect(entry.confirmed).toBe(true);
    }
  });

  it("never touches a field reserved for the student", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, CONTEXT);

    expect(session.filled.map((f) => f.locator.value)).not.toContain(
      "I declare that the information given is true and complete",
    );
    expect(report.handoffs.map((h) => h.fieldRef)).toEqual(["declaration"]);
  });

  it("never clicks anything — advancing pages is not filling", async () => {
    const session = new RecordingSession();
    await executePlan(session, plan(), documentSource, CONTEXT);
    expect(session.clicked).toHaveLength(0);
  });

  it("stops at the first failure instead of pressing on", async () => {
    const session = new RecordingSession();
    const drift = new Error("nothing matched");
    drift.name = "LocatorNotFoundError";
    session.failOn("Date of birth", drift);

    const report = await executePlan(session, plan(), documentSource, CONTEXT);

    expect(report.completed).toBe(false);
    // Filled the two before it; did not go on to the ones after.
    expect(session.filled).toHaveLength(2);
    expect(session.attached).toHaveLength(0);
  });

  it("distinguishes blueprint drift from any other failure", async () => {
    const session = new RecordingSession();
    const drift = new Error("nothing matched");
    drift.name = "LocatorNotFoundError";
    session.failOn("Date of birth", drift);

    const report = await executePlan(session, plan(), documentSource, CONTEXT);
    expect(failures(report)[0]?.drift).toBe(true);
  });

  it("reports a missing document rather than filling around it", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), () => Promise.resolve(null), CONTEXT);

    expect(report.completed).toBe(false);
    expect(failures(report)[0]?.error).toContain("No document was supplied");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The upload gate
// ───────────────────────────────────────────────────────────────────────────

describe("a document in the vault is not a reason to send it", () => {
  const plan = () => planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE);

  it("records what actually left, with IDs and hashes", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, CONTEXT);

    expect(report.transmissions).toHaveLength(1);
    expect(report.transmissions[0]?.documentId).toBe("doc-passport-1");
    expect(report.transmissions[0]?.toHost).toBe(PORTAL_HOST);
  });

  it("REFUSES to attach when the file changed since the student agreed", async () => {
    const session = new RecordingSession();
    const stale: DocumentSource = () =>
      Promise.resolve({
        documentId: "doc-passport-1",
        contents: PASSPORT_BYTES,
        // A different file under the same ID. The student has not seen it.
        contentHash: "sha256:passport-v2",
        authorisation: passportAuthorisation(),
      });

    const report = await executePlan(session, plan(), stale, CONTEXT);

    expect(report.completed).toBe(false);
    expect(session.attached).toHaveLength(0);
    expect(failures(report)[0]?.error).toContain("contents have changed");
  });

  it("REFUSES to attach to a portal the authorisation does not cover", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, {
      ...CONTEXT,
      portalHost: "apply.someotheruniversity.ac.uk",
    });

    expect(report.completed).toBe(false);
    expect(session.attached).toHaveLength(0);
    expect(failures(report)[0]?.error).toContain("not permission to send it anywhere else");
  });

  it("REFUSES once the student has withdrawn", async () => {
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, {
      ...CONTEXT,
      withdrawals: [{ disclosureId: "disc-1", withdrawnAt: NOW, reason: "Changed their mind." }],
    });

    expect(report.completed).toBe(false);
    expect(session.attached).toHaveLength(0);
    expect(report.transmissions).toHaveLength(0);
  });

  it("does not report an authorisation failure as blueprint drift", async () => {
    // Different problem, different response. Drift means rediscover the
    // portal; this means ask the student.
    const session = new RecordingSession();
    const report = await executePlan(session, plan(), documentSource, {
      ...CONTEXT,
      withdrawals: [{ disclosureId: "disc-1", withdrawnAt: NOW, reason: "Withdrew." }],
    });
    expect(failures(report)[0]?.drift).toBe(false);
  });
});
