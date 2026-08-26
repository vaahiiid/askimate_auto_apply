/**
 * The Requirements Service: two channels in, one gated requirement out.
 *
 *   kb_pending_entries → human review → kb_entries ──┐
 *                                                    ├→ Requirement → assessUsability
 *   the university's own page, read and hashed ──────┘
 *
 * The gate itself already existed (`packages/domain/src/requirements.ts`). This
 * is the service that feeds it, and it adds no way round it — `assemble`
 * returns a `Requirement`, and every caller still has to pass
 * `assessUsability` before acting.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not decide which channel to believe. Where the two disagree the
 * requirement is `conflicted` and the gate refuses it, at every criticality —
 * that is ADR-0009 and it is not softened here. Picking the fresher source, or
 * the official one, or the one with higher confidence, would each be the system
 * quietly resolving a disagreement about a rule that can cost a student a visa.
 */

import type {
  CuratedEvidence,
  OfficialEvidence,
  Requirement,
  RequirementCriticality,
  RequirementScope,
  RequirementUsability,
} from "@askimate/aas-domain";
import { assessUsability, verificationStatusOf } from "@askimate/aas-domain";

import type { KnowledgeBase } from "./knowledge-base.js";
import { curatedEvidenceFrom } from "./knowledge-base.js";
import type { Extractor, OfficialSourceReader } from "./official-source.js";
import { readOfficialSource } from "./official-source.js";

/** What the service needs in order to establish one requirement. */
export interface RequirementQuery {
  readonly requirementId: string;
  /** What it constrains, e.g. `english_language.ielts_overall`. */
  readonly key: string;
  readonly criticality: RequirementCriticality;
  /** Which process asks for it (ADR-0021). Separate from criticality. */
  readonly scope: RequirementScope;
  /** The official page, where one is known. */
  readonly officialUrl?: string;
  readonly extractor?: Extractor;
  /** After this date the requirement degrades to `stale`. */
  readonly revalidateBy: Date;
}

export interface RequirementOutcome {
  readonly requirement: Requirement;
  readonly usability: RequirementUsability;
  /** Why a channel produced nothing, so the gap is explainable rather than silent. */
  readonly channelNotes: readonly string[];
}

/**
 * Gathers both channels and assembles the requirement.
 *
 * Note the return type: a `Requirement` *and* the gate's verdict on it. A
 * caller that wanted only the requirement would have to ignore the verdict
 * deliberately, which is harder to do by accident than forgetting to check.
 */
export async function establishRequirement(input: {
  readonly query: RequirementQuery;
  readonly knowledgeBase: KnowledgeBase;
  readonly reader?: OfficialSourceReader;
  readonly now: Date;
  /** Confidence in an official reading. Advisory; cannot promote anything. */
  readonly officialConfidence?: number;
}): Promise<RequirementOutcome> {
  const { query, knowledgeBase, reader, now } = input;
  const notes: string[] = [];

  // ── Curated ─────────────────────────────────────────────────────────────
  const approved = await knowledgeBase.approvedFor(query.key);
  const latest = approved[0];
  const curated: CuratedEvidence | undefined =
    latest === undefined ? undefined : curatedEvidenceFrom(latest);

  if (curated === undefined) {
    notes.push(
      `No approved knowledge-base entry for "${query.key}". Someone must submit one and a second ` +
        `person must approve it.`,
    );
  }

  // ── Official ────────────────────────────────────────────────────────────
  let official: OfficialEvidence | undefined;

  if (reader === undefined || query.officialUrl === undefined || query.extractor === undefined) {
    notes.push(
      `No official source was checked for "${query.key}" — ` +
        (query.officialUrl === undefined
          ? `no official URL is recorded for it.`
          : `no reader was supplied.`),
    );
  } else {
    const result = await readOfficialSource({
      reader,
      url: query.officialUrl,
      extractor: query.extractor,
      confidence: input.officialConfidence ?? 0.9,
    });
    if (result.read) {
      official = result.evidence;
    } else {
      notes.push(result.refusal.detail);
    }
  }

  const requirement: Requirement = {
    requirementId: query.requirementId,
    key: query.key,
    criticality: query.criticality,
    scope: query.scope,
    revalidateBy: query.revalidateBy,
    ...(curated !== undefined ? { curated } : {}),
    ...(official !== undefined ? { official } : {}),
  };

  return {
    requirement,
    usability: assessUsability(requirement, now),
    channelNotes: notes,
  };
}

/**
 * What a requirement still needs before it may be acted on.
 *
 * The list a specialist works from: not "this failed" but "here is the one
 * thing missing". Derived from the gate's own verdict rather than
 * reimplementing it, so the two cannot drift apart.
 */
export function outstandingWork(outcome: RequirementOutcome): readonly string[] {
  if (outcome.usability.usable) return [];

  const status = verificationStatusOf(outcome.requirement, outcome.requirement.revalidateBy);
  const work: string[] = [];

  switch (outcome.usability.reason) {
    case "no_evidence":
      work.push("Submit a knowledge-base entry, and have a second person approve it.");
      work.push("Record the official source URL so the second channel can be checked.");
      break;

    case "insufficient_corroboration":
      if (outcome.requirement.curated === undefined) {
        work.push("Submit a knowledge-base entry, and have a second person approve it.");
      }
      if (outcome.requirement.official === undefined) {
        work.push("Check the university's own page and record the excerpt.");
      }
      break;

    case "conflicting_sources":
      // Never resolved automatically, at any criticality (ADR-0009).
      work.push(
        `The specialist recorded "${outcome.requirement.curated?.statedValue ?? "?"}" and the ` +
          `university's page says "${outcome.requirement.official?.extractedValue ?? "?"}". ` +
          `A human decides which is right — the system does not prefer a channel, and does not ` +
          `prefer the fresher source.`,
      );
      break;

    case "stale":
      work.push(
        `The evidence is past its revalidate-by date (status: ${status}). Re-check both channels; ` +
          `two stale agreeing sources are not corroboration.`,
      );
      break;
  }

  return work;
}
