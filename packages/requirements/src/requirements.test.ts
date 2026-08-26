import { describe, expect, it } from "vitest";

import { assessUsability } from "@askimate/aas-domain";

import {
  InMemoryKnowledgeBase,
  approve,
  curatedEvidenceFrom,
  reject,
  type KbEntryRecord,
} from "./knowledge-base.js";
import {
  RecordedSourceReader,
  excerptChanged,
  hashExcerpt,
  readOfficialSource,
  type Extractor,
} from "./official-source.js";
import { establishRequirement, outstandingWork, type RequirementQuery } from "./service.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const FRESH = new Date("2026-12-01T00:00:00Z");

function entry(overrides: Partial<KbEntryRecord> = {}): KbEntryRecord {
  return {
    entryId: "kb-1",
    key: "english_language.ielts_overall",
    statedValue: "6.5 overall with no band below 6.0",
    citedSource: "Ulster University MSc International Business entry requirements page",
    status: "pending",
    submittedBy: "specialist-a",
    submittedAt: NOW,
    ...overrides,
  };
}

const PAGE_TEXT = [
  "MSc International Business",
  "Entry requirements",
  "English language: IELTS 6.5 overall with no band below 6.0.",
  "Applicants must hold a second-class honours degree or equivalent.",
].join("\n");

const IELTS_EXTRACTOR: Extractor = {
  label: "IELTS overall",
  extract: (text) => {
    const line = text.split("\n").find((candidate) => candidate.startsWith("English language:"));
    if (line === undefined) return null;
    // Captures to the end of the sentence, not to the first full stop — "6.0"
    // contains one. Getting this wrong produced a false CONFLICT the first
    // time this ran, which is the strict comparison working: it refused to
    // decide that "…below 6" and "…below 6.0" were the same requirement.
    const value = /IELTS\s+(.*?)\.?$/i.exec(line);
    return value === null ? null : { excerpt: line, value: value[1] ?? "" };
  },
};

const reader = new RecordedSourceReader([
  {
    url: "https://www.ulster.ac.uk/courses/msc-international-business",
    text: PAGE_TEXT,
    retrievedAt: NOW,
  },
]);

// ───────────────────────────────────────────────────────────────────────────
// The curated channel — AskiMate's own workflow
// ───────────────────────────────────────────────────────────────────────────

describe("kb_pending_entries → human review → kb_entries", () => {
  it("approves a pending entry reviewed by someone else", () => {
    const result = approve({ entry: entry(), approvedBy: "specialist-b", at: NOW });
    expect(result.approved).toBe(true);
  });

  it("REFUSES self-approval", () => {
    // One person's opinion with a second timestamp on it is not review. Same
    // rule as mapping sets, for the same reason.
    const result = approve({ entry: entry(), approvedBy: "specialist-a", at: NOW });
    if (result.approved) expect.unreachable("self-approval is not approval");
    expect(result.refusal.kind).toBe("self_approval");
  });

  it("refuses an entry that cites no source", () => {
    const result = approve({
      entry: entry({ citedSource: "   " }),
      approvedBy: "specialist-b",
      at: NOW,
    });
    if (result.approved) expect.unreachable("a source is required");
    expect(result.refusal.kind).toBe("no_source");
  });

  it("refuses to approve something already rejected", () => {
    const rejected = reject({
      entry: entry(),
      rejectedBy: "specialist-b",
      reason: "Out of date",
      at: NOW,
    });
    const result = approve({ entry: rejected, approvedBy: "specialist-c", at: NOW });
    if (result.approved) expect.unreachable("not pending");
    expect(result.refusal.kind).toBe("not_pending");
  });

  it("records WHO approved it as the reviewer, not who submitted it", () => {
    // The evidence bar is about who checked it.
    const result = approve({ entry: entry(), approvedBy: "specialist-b", at: NOW });
    if (!result.approved) expect.unreachable("approved");

    const evidence = curatedEvidenceFrom(result.entry);
    expect(evidence.reviewerId).toBe("specialist-b");
    expect(evidence.channel).toBe("curated");
  });

  it("has no route from a PENDING entry to curated evidence", () => {
    // @ts-expect-error a KbEntryRecord is not an ApprovedKbEntry
    curatedEvidenceFrom(entry());
  });

  it("keeps a rejection's reason, because a rejection with none teaches nobody", () => {
    const rejected = reject({
      entry: entry(),
      rejectedBy: "specialist-b",
      reason: "The cited page is for the 2025 intake",
      at: NOW,
    });
    expect(rejected.rejectionReason).toContain("2025 intake");
    expect(rejected.rejectionReason).toContain("specialist-b");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The official channel
// ───────────────────────────────────────────────────────────────────────────

describe("reading the university's own page", () => {
  it("reads the value and keeps the passage it came from", async () => {
    const result = await readOfficialSource({
      reader,
      url: "https://www.ulster.ac.uk/courses/msc-international-business",
      extractor: IELTS_EXTRACTOR,
      confidence: 0.95,
    });

    if (!result.read) expect.unreachable(`expected a reading: ${result.refusal.kind}`);
    expect(result.evidence.extractedValue).toContain("6.5 overall");
    // The passage, so a human can check the reading rather than trust it.
    expect(result.evidence.evidenceExcerpt).toContain("English language:");
  });

  it("says so when the page cannot be read, rather than assuming", async () => {
    const result = await readOfficialSource({
      reader,
      url: "https://www.ulster.ac.uk/courses/something-else",
      extractor: IELTS_EXTRACTOR,
      confidence: 0.9,
    });
    if (result.read) expect.unreachable("page unavailable");
    expect(result.refusal.kind).toBe("page_unavailable");
  });

  it("says so when the value is not on the page", async () => {
    const empty = new RecordedSourceReader([
      { url: "https://www.ulster.ac.uk/x", text: "Nothing relevant here.", retrievedAt: NOW },
    ]);
    const result = await readOfficialSource({
      reader: empty,
      url: "https://www.ulster.ac.uk/x",
      extractor: IELTS_EXTRACTOR,
      confidence: 0.9,
    });
    if (result.read) expect.unreachable("not found");
    expect(result.refusal.kind).toBe("not_found_on_page");
  });

  it("clamps a confidence a caller got wrong rather than failing the read", () => {
    // Advisory anyway — no value of it promotes anything.
    expect(hashExcerpt("a")).toBe(hashExcerpt("  a  "));
  });

  it("treats a reflow as the same wording", () => {
    expect(hashExcerpt("IELTS 6.5\noverall")).toBe(hashExcerpt("IELTS 6.5 overall"));
  });

  it("does NOT treat a reworded page as the same wording", async () => {
    // The point of the hash. A university rewording a page in a way that
    // changes its meaning without changing the number must force re-review.
    const original = await readOfficialSource({
      reader,
      url: "https://www.ulster.ac.uk/courses/msc-international-business",
      extractor: IELTS_EXTRACTOR,
      confidence: 0.9,
    });
    const reworded = await readOfficialSource({
      reader: new RecordedSourceReader([
        {
          url: "https://www.ulster.ac.uk/courses/msc-international-business",
          text: "English language: IELTS 6.5 overall with no band below 6.0, waived for some applicants.",
          retrievedAt: NOW,
        },
      ]),
      url: "https://www.ulster.ac.uk/courses/msc-international-business",
      extractor: IELTS_EXTRACTOR,
      confidence: 0.9,
    });

    if (!original.read || !reworded.read) expect.unreachable("both read");
    expect(excerptChanged(original.evidence, reworded.evidence)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Both channels, through the gate that already existed
// ───────────────────────────────────────────────────────────────────────────

/**
 * Drops the official channel.
 *
 * Under `exactOptionalPropertyTypes`, absent and present-but-undefined differ,
 * and absent is what "no official source is recorded" means.
 */
function withoutOfficial(base: RequirementQuery): RequirementQuery {
  const { officialUrl: _url, extractor: _extractor, ...rest } = base;
  return rest;
}

function query(overrides: Partial<RequirementQuery> = {}): RequirementQuery {
  return {
    requirementId: "req-1",
    key: "english_language.ielts_overall",
    criticality: "material",
    scope: "university_application",
    officialUrl: "https://www.ulster.ac.uk/courses/msc-international-business",
    extractor: IELTS_EXTRACTOR,
    revalidateBy: FRESH,
    ...overrides,
  };
}

async function knowledgeBaseWith(statedValue: string): Promise<InMemoryKnowledgeBase> {
  const kb = new InMemoryKnowledgeBase();
  const submitted = await kb.submit(entry({ statedValue }));
  const approval = approve({ entry: submitted, approvedBy: "specialist-b", at: NOW });
  if (!approval.approved) expect.unreachable("approved");
  await kb.recordApproval(approval.entry);
  return kb;
}

describe("establishing a requirement", () => {
  it("corroborates when both channels agree", async () => {
    const kb = await knowledgeBaseWith("6.5 overall with no band below 6.0");
    const outcome = await establishRequirement({ query: query(), knowledgeBase: kb, reader, now: NOW });

    expect(outcome.usability.status).toBe("corroborated");
    expect(outcome.usability.usable).toBe(true);
  });

  it("does NOT resolve a conflict, at any criticality", async () => {
    // ADR-0009, unchanged. The system does not prefer a channel and does not
    // prefer the fresher source.
    const kb = await knowledgeBaseWith("7.0 overall");
    const outcome = await establishRequirement({
      query: query({ criticality: "procedural" }),
      knowledgeBase: kb,
      reader,
      now: NOW,
    });

    expect(outcome.usability.status).toBe("conflicted");
    expect(outcome.usability.usable).toBe(false);
    expect(outstandingWork(outcome)[0]).toContain("A human decides which is right");
  });

  it("refuses a CRITICAL requirement on one channel alone", async () => {
    const kb = await knowledgeBaseWith("6.5 overall with no band below 6.0");
    const outcome = await establishRequirement({
      query: withoutOfficial(query({ criticality: "critical" })),
      knowledgeBase: kb,
      now: NOW,
    });

    expect(outcome.usability.usable).toBe(false);
    expect(outstandingWork(outcome)).toContain(
      "Check the university's own page and record the excerpt.",
    );
  });

  it("accepts a MATERIAL requirement on one fresh channel", async () => {
    const kb = await knowledgeBaseWith("6.5 overall with no band below 6.0");
    const outcome = await establishRequirement({
      query: withoutOfficial(query()),
      knowledgeBase: kb,
      now: NOW,
    });
    expect(outcome.usability.usable).toBe(true);
  });

  it("explains a missing channel rather than leaving a silent gap", async () => {
    // Material, and the official channel read fine — so this is USABLE on one
    // channel. The note still says the curated one is missing, because a
    // silent gap is how a requirement ends up resting on one source without
    // anyone choosing that.
    const outcome = await establishRequirement({
      query: query(),
      knowledgeBase: new InMemoryKnowledgeBase(),
      reader,
      now: NOW,
    });

    expect(outcome.usability.usable).toBe(true);
    expect(outcome.usability.status).toBe("official_only");
    expect(outcome.channelNotes.join(" ")).toContain("No approved knowledge-base entry");
  });

  it("says what to do when neither channel has anything", async () => {
    const outcome = await establishRequirement({
      query: withoutOfficial(query()),
      knowledgeBase: new InMemoryKnowledgeBase(),
      now: NOW,
    });

    expect(outcome.usability.usable).toBe(false);
    expect(outstandingWork(outcome)).toContain(
      "Submit a knowledge-base entry, and have a second person approve it.",
    );
  });

  it("REFUSES a near-match rather than deciding two answers are one", async () => {
    // "no band below 6" and "no band below 6.0" may well mean the same thing.
    // Deciding that is a human's job — a fuzzy comparison here would be the
    // system quietly resolving a disagreement about an entry requirement.
    const kb = await knowledgeBaseWith("6.5 overall with no band below 6");
    const outcome = await establishRequirement({ query: query(), knowledgeBase: kb, reader, now: NOW });

    expect(outcome.usability.status).toBe("conflicted");
  });

  it("returns the gate's verdict alongside the requirement", async () => {
    // A caller that wanted only the requirement would have to ignore the
    // verdict deliberately, which is harder to do by accident than forgetting
    // to check.
    const kb = await knowledgeBaseWith("6.5 overall with no band below 6.0");
    const outcome = await establishRequirement({ query: query(), knowledgeBase: kb, reader, now: NOW });

    expect(outcome.usability).toEqual(assessUsability(outcome.requirement, NOW));
  });

  it("carries scope through, so a visa rule cannot block an application", async () => {
    const kb = await knowledgeBaseWith("£1,334 per month for up to 9 months");
    const outcome = await establishRequirement({
      query: query({ key: "financial_evidence.maintenance", scope: "student_visa" }),
      knowledgeBase: kb,
      now: NOW,
    });
    expect(outcome.requirement.scope).toBe("student_visa");
  });
});
