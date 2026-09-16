/**
 * What a student is shown, and the offer they accept.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0058. Two gates stand between a conversation and a case:
 *
 *   GATE 1  an offer can only be built from a REVIEWED CATALOGUE ENTRY
 *   GATE 2  a case opens only when the student names the hash of an offer
 *           this server built for THEM, in THIS conversation
 *
 * This file is Gate 1's output and Gate 2's input. It holds no policy about
 * who may ask — that is the route's — and no knowledge of runs or cases.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the offer is not just the blueprint id ────────────────────────────
 *
 * Until P21 the run-start request named a `blueprintId`. An identifier proves
 * nothing about what the student was shown: `bp-gated-portal` is not a
 * sentence anybody can consent to. So the server renders the target's identity,
 * hashes it, and the student names the hash. What they accepted is then
 * answerable as *"this institution, this course, this intake, through this
 * portal"* rather than as *"a string and a sentence"*.
 */

import type { Canonical } from "./canonical.js";
import { labelledHash } from "./canonical.js";
import type { ReviewedCatalogueEntry } from "./entry.js";
import type { Admission } from "./registry.js";

/**
 * A reviewed target, as a person reads it.
 *
 * Every field comes from the catalogue entry — nothing here is invented and
 * nothing is derived from prose. `institutionName`, `campus`, `courseName` and
 * `intake` are the blueprint's own human labels; the three `…Ref` fields are
 * the reviewed identity a specialist set (ADR-0017), and `intakeRef` is the
 * `YYYY-MM` that goes into the submission key rather than the label.
 */
export interface ReviewedTarget {
  /** The catalogue key. Not shown to a student as identity; used to resolve. */
  readonly blueprintId: string;
  readonly blueprintVersion: string;

  /**
   * Whom this target's approval admits (ADR-0118). A target on a single
   * signature is listed to the one student it names and to nobody else; the
   * run driver refuses everybody else again at the start and at every later
   * lookup. NOT part of the offer's canonical form: the offer binds a student
   * to content, and this is a fact about the approval, not the content.
   */
  readonly admits: Admission;

  readonly institutionName: string;
  readonly campus?: string;
  readonly courseName: string;
  /** The label, e.g. "September 2026". */
  readonly intake: string;

  readonly institutionRef: string;
  readonly courseRef: string;
  /** `YYYY-MM`. The submission identity. */
  readonly intakeRef: string;

  /**
   * How the application is reached — `direct_portal`, `partner_portal`,
   * `assisted_manual`.
   *
   * Part of the identity a student must see, because two reviewed targets can
   * share institution, course and intake and differ only here. See
   * `ambiguousGroups`.
   */
  readonly route: string;
  /**
   * The host the application is actually made against.
   *
   * The DEPLOYED host where a deployment overrides it, otherwise the
   * blueprint's own. A student choosing between two routes is choosing between
   * two portals, and the portal is the part they can recognise.
   */
  readonly portalHost: string;

  /**
   * Document kinds the application needs. Shown so the ask is not a surprise.
   *
   * The entry's advisory list, carried through verbatim. `renderOffer` puts it
   * in the sentence the student accepts, so it is a statement made TO a student
   * — and, today, one nothing in the system acts on (ADR-0066 §4). It is
   * deliberately absent from `offerCanonical`: the entry's `contentHash` is in
   * there, and that already covers it (ADR-0057).
   */
  readonly requiredDocuments: readonly string[];
  /**
   * The catalogue entry's content hash (ADR-0057).
   *
   * Carried into the offer so an offer is bound to the exact reviewed artefact
   * that supported it, and so a later change to that artefact is detectable
   * rather than silently reinterpreted.
   */
  readonly contentHash: string;
}

/** The host an application against this entry is actually made to. */
function hostOf(entry: ReviewedCatalogueEntry, portalOrigin: string | undefined): string {
  if (portalOrigin !== undefined) {
    try {
      return new URL(portalOrigin).host;
    } catch {
      // Configuration already refused a non-URL origin; this is belt and
      // braces rather than a decision.
      return portalOrigin;
    }
  }
  const observed = entry.blueprint.provenance.observedUrls[0];
  const login = entry.blueprint.authentication.loginUrl;
  for (const candidate of [login, observed]) {
    if (candidate === undefined) continue;
    try {
      return new URL(candidate).host;
    } catch {
      continue;
    }
  }
  // A reviewed blueprint with no observed URL cannot exist: `checkExecutable`
  // refuses one, and the catalogue will not load it.
  return entry.portalAuthentication?.portalHost ?? "";
}

/** Builds the human-readable target from a reviewed entry and its hash. */
export function targetOf(input: {
  readonly entry: ReviewedCatalogueEntry;
  readonly contentHash: string;
  /** Whom the entry's approval admits (ADR-0118). From the registry, never the entry. */
  readonly admits: Admission;
  readonly portalOrigin?: string;
}): ReviewedTarget {
  const { entry } = input;
  return {
    admits: input.admits,
    blueprintId: String(entry.blueprint.blueprintId),
    blueprintVersion: entry.blueprint.version,
    institutionName: entry.blueprint.institutionName,
    ...(entry.blueprint.campus === undefined ? {} : { campus: entry.blueprint.campus }),
    courseName: entry.blueprint.courseName,
    intake: entry.blueprint.intake,
    institutionRef: entry.institutionRef,
    courseRef: entry.courseRef,
    intakeRef: entry.intakeRef,
    route: entry.blueprint.route,
    portalHost: hostOf(entry, input.portalOrigin),
    requiredDocuments: entry.requiredDocuments,
    contentHash: input.contentHash,
  };
}

/**
 * Reviewed targets that a student could not tell apart by institution, course
 * and intake alone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SAFETY PROPERTY, not a presentation one, and the reason is in
 * `submissionKey`: it is `(student, institution, course, intake, attempt)` and
 * `blueprintId` is NOT in it. So two reviewed routes to the same course and
 * intake produce the SAME key — starting one permanently blocks the other for
 * that student.
 *
 * The choice between them is therefore irreversible, which is why nothing may
 * pick a default, a best match, or the first one found. The student sees both,
 * with the route and portal that distinguish them, and chooses.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function ambiguousGroups(
  targets: readonly ReviewedTarget[],
): ReadonlyMap<string, readonly ReviewedTarget[]> {
  const byIdentity = new Map<string, ReviewedTarget[]>();
  for (const target of targets) {
    // U+0000 separates, because it cannot occur in any of the three refs — so
    // ("a", "b|c") and ("a|b", "c") cannot collide into one group and hide an
    // ambiguity the student must be shown. Written as an ESCAPE and not as a
    // raw byte: as a raw byte it put a NUL in the first 8 KB of this file,
    // which is git's binary heuristic, and every diff of this file — the file
    // holding both of ADR-0058's gates — came back as "Binary files differ".
    // A control nobody can review in a diff is most of the way to not being
    // one. Found in P30 while reading this file; the runtime string is
    // unchanged, and `catalogue.test.ts` pins it.
    const key = `${target.institutionRef}\u0000${target.courseRef}\u0000${target.intakeRef}`;
    const group = byIdentity.get(key);
    if (group === undefined) byIdentity.set(key, [target]);
    else group.push(target);
  }
  const ambiguous = new Map<string, readonly ReviewedTarget[]>();
  for (const [key, group] of byIdentity) {
    if (group.length > 1) ambiguous.set(key, group);
  }
  return ambiguous;
}

/** True when this target shares its submission identity with another on offer. */
export function isAmbiguous(
  target: ReviewedTarget,
  targets: readonly ReviewedTarget[],
): boolean {
  return targets.some(
    (other) =>
      other.blueprintId !== target.blueprintId &&
      other.institutionRef === target.institutionRef &&
      other.courseRef === target.courseRef &&
      other.intakeRef === target.intakeRef,
  );
}

/** An offer, as it is put to one student in one conversation. */
export interface TargetOffer {
  readonly target: ReviewedTarget;
  readonly studentId: string;
  readonly conversationId: string;
  /** `sha256:<hex>` over the canonical form below. */
  readonly offerHash: string;
}

/**
 * The canonical value an offer hash is taken over.
 *
 * ── What is in here, and why each one ─────────────────────────────────────
 *
 *   studentId       an offer made to one student cannot be spent by another
 *   conversationId  an offer made in one conversation cannot be spent in another
 *   the target      two materially different routes are two different offers
 *   contentHash     the offer is bound to the exact reviewed artefact
 *
 * Built by hand rather than by spreading the target, so adding a field to
 * `ReviewedTarget` does not silently change every existing offer's hash — and
 * so a reader can see exactly what the student is bound to.
 */
export function offerCanonical(input: {
  readonly target: ReviewedTarget;
  readonly studentId: string;
  readonly conversationId: string;
}): Canonical {
  const { target } = input;
  return {
    v: 1,
    studentId: input.studentId,
    conversationId: input.conversationId,
    blueprintId: target.blueprintId,
    blueprintVersion: target.blueprintVersion,
    institutionRef: target.institutionRef,
    courseRef: target.courseRef,
    intakeRef: target.intakeRef,
    route: target.route,
    portalHost: target.portalHost,
    contentHash: target.contentHash,
  };
}

/** Builds the offer and its hash. Pure: the same inputs always agree. */
export function offerFor(input: {
  readonly target: ReviewedTarget;
  readonly studentId: string;
  readonly conversationId: string;
}): TargetOffer {
  return {
    target: input.target,
    studentId: input.studentId,
    conversationId: input.conversationId,
    offerHash: labelledHash(offerCanonical(input)),
  };
}

/**
 * What the student is shown, rendered deterministically.
 *
 * Deterministic and model-free, for the reason `renderForConfirmation` is:
 * a model may compose the prose AROUND an offer, but the sentence that names
 * what is being agreed to has to be reproducible from the data, or "what
 * exactly did I agree to?" has no answer.
 */
export function renderOffer(offer: TargetOffer): string {
  const t = offer.target;
  const where = t.campus === undefined ? t.institutionName : `${t.institutionName} (${t.campus})`;
  return [
    `Apply to ${where}`,
    `  Course: ${t.courseName}`,
    `  Intake: ${t.intake} (${t.intakeRef})`,
    `  Applied through: ${t.portalHost} (${t.route.replace(/_/g, " ")})`,
    t.requiredDocuments.length === 0
      ? `  Documents needed: none recorded`
      : `  Documents needed: ${[...t.requiredDocuments].sort().join(", ")}`,
  ].join("\n");
}
