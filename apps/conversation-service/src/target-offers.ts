/**
 * Gate 1 and Gate 2: resolving a reviewed target, and verifying the request
 * that accepts it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0058.
 *
 *   GATE 1  an offer is built ONLY from a reviewed catalogue entry
 *   GATE 2  a case opens ONLY when the student names the hash of an offer this
 *           server built for THEM, in THIS conversation
 *
 * Nothing here trusts a client, a model or an upstream system to say what the
 * target is. The client sends a `blueprintId` it read from the listing and,
 * later, an `offerHash` — and both are re-resolved against the live catalogue
 * before anything is written.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the request re-derives rather than reading the stored offer ───────
 *
 * The offer event is stored, and it would be simpler to look up the hash and
 * accept it. That would make POSSESSION of a hash sufficient — and a hash
 * stored yesterday says nothing about whether the target is still reviewed,
 * still executable, or still the same artefact.
 *
 * So the request rebuilds the offer from the catalogue as it is NOW and
 * compares. One mechanism then answers every integrity question without a
 * clock: a retired target is gone from the catalogue, changed content produces
 * a different hash, another student's or conversation's offer hashes
 * differently because both ids are inside the hash.
 *
 * The stored offer event is still required — a request may only accept
 * something that was actually offered here (see `verifyRequest`) — but it is
 * never the authority on whether the offer still HOLDS. It is the AUDIT:
 * evidence that this target was put to this student, and of which reviewed
 * content supported it.
 */

import {
  isAmbiguous,
  offerFor,
  renderOffer,
  type ReviewedTarget,
  type TargetOffer,
} from "@askimate/aas-catalogue";

/**
 * What the offer path needs from a catalogue.
 *
 * A narrow port rather than the whole `ApplicationCatalogue`: this path never
 * needs a blueprint or a mapping set, and a port that could hand it one would
 * invite the offer to start describing things a student cannot check.
 */
export interface TargetDirectory {
  /** Every reviewed, executable target. Gate 1 is that this is the only source. */
  targets(): readonly ReviewedTarget[];
}

export type OfferRefusal =
  /**
   * The catalogue holds no such target.
   *
   * The honest answer to a student asking for something not reviewed yet. No
   * case is opened to represent the demand and no blueprint is invented
   * (ADR-0058); their message and this reply are already the durable record.
   */
  | { readonly kind: "unknown_target"; readonly detail: string }
  /**
   * Several reviewed targets share this one's submission identity.
   *
   * A SAFETY refusal, not a UX one. `submissionKey` is
   * `(student, institution, course, intake, attempt)` and does not include the
   * blueprint, so starting one of these permanently blocks the others for this
   * student. The choice is irreversible, so the student makes it — never a
   * default, a best match, or the first one found.
   */
  | {
      readonly kind: "ambiguous_target";
      readonly detail: string;
      readonly candidates: readonly ReviewedTarget[];
    };

export type OfferResult =
  | { readonly ok: true; readonly offer: TargetOffer; readonly rendered: string }
  | { readonly ok: false; readonly refusal: OfferRefusal };

/**
 * Resolves a chosen target and builds the offer.
 *
 * `chosenBlueprintId` comes from the listing the student was shown. It is a
 * lookup key and nothing more: every field of the offer is taken from the
 * catalogue entry it resolves to, so a client that sent a different id gets a
 * different offer rather than an offer it described.
 */
export function makeOffer(input: {
  readonly directory: TargetDirectory;
  readonly chosenBlueprintId: string;
  readonly studentId: string;
  readonly conversationId: string;
  /**
   * Set when the student has already been shown the alternatives and picked
   * this one. Without it an ambiguous target refuses.
   */
  readonly disambiguated?: boolean;
}): OfferResult {
  const targets = input.directory.targets();
  const target = targets.find((candidate) => candidate.blueprintId === input.chosenBlueprintId);

  if (target === undefined) {
    return {
      ok: false,
      refusal: {
        kind: "unknown_target",
        detail:
          `No reviewed application target with id "${input.chosenBlueprintId}" is available. ` +
          `This system applies only to targets that have been discovered, reviewed by two ` +
          `people and approved (ADR-0057), so a course it cannot execute against is not ` +
          `offered at all.`,
      },
    };
  }

  if (input.disambiguated !== true && isAmbiguous(target, targets)) {
    const candidates = targets.filter(
      (candidate) =>
        candidate.institutionRef === target.institutionRef &&
        candidate.courseRef === target.courseRef &&
        candidate.intakeRef === target.intakeRef,
    );
    return {
      ok: false,
      refusal: {
        kind: "ambiguous_target",
        detail:
          `${String(candidates.length)} reviewed targets share this institution, course and ` +
          `intake and differ by route. Applying through one of them permanently rules out the ` +
          `others for this student, so the choice is theirs to make explicitly.`,
        candidates,
      },
    };
  }

  const offer = offerFor({
    target,
    studentId: input.studentId,
    conversationId: input.conversationId,
  });
  return { ok: true, offer, rendered: renderOffer(offer) };
}

export type RequestRefusal =
  /** The hash names no offer this server would build for this student here. */
  | { readonly kind: "unknown_offer"; readonly detail: string }
  /** The target moved — retired, superseded, or its reviewed content changed. */
  | { readonly kind: "offer_no_longer_valid"; readonly detail: string };

export type RequestResult =
  | { readonly ok: true; readonly target: ReviewedTarget }
  | { readonly ok: false; readonly refusal: RequestRefusal };

/**
 * GATE 2. Verifies that a hash names an offer this server ACTUALLY MADE to this
 * student in this conversation, and that it still describes a live target.
 *
 * ── Two independent conditions, and neither is sufficient alone ───────────
 *
 *   THE LOG      the hash appears as a `target_offered` event in THIS
 *                conversation. This is what makes progression structural: a
 *                request can only accept something that was offered, so
 *                "recommendation ≠ selection" is enforced by evidence rather
 *                than by the client's good manners.
 *
 *   RE-DERIVATION  some reviewed target, rebuilt from the catalogue AS IT IS
 *                NOW for this student and conversation, hashes to it. This is
 *                what makes possession insufficient: a retired target is gone
 *                from the catalogue, changed reviewed content produces a
 *                different hash, and another student's or conversation's offer
 *                hashes differently because both ids are inside the hash.
 *
 * The log alone would accept an offer whose target has since been retired or
 * rewritten. Re-derivation alone would accept a hash the client COMPUTED for
 * itself and was never offered — the fields are server-side today, but a gate
 * that holds only because a listing withholds two columns is not a gate.
 * Requiring both costs one array lookup.
 *
 * ── Why the rebuild is a loop over every target ───────────────────────────
 *
 * O(targets), and the catalogue is deliberately tiny (ADR-0057). What it buys
 * is that validity is computed from the catalogue at this instant rather than
 * read back from anything stored — the stored event is the AUDIT of what was
 * put to the student, never the authority on whether it still holds.
 */
export function verifyRequest(input: {
  readonly directory: TargetDirectory;
  readonly offerHash: string;
  readonly studentId: string;
  readonly conversationId: string;
  /**
   * Offer hashes this conversation's log actually holds.
   *
   * Not a hint and not a diagnostic: an offer hash that is not in here is
   * refused before the catalogue is looked at.
   */
  readonly stored: readonly string[];
}): RequestResult {
  // Condition one. Checked FIRST and on its own, so that a hash nobody was
  // ever offered here is refused without the catalogue being consulted at all
  // — and so the two refusals below cannot be confused with each other.
  if (!input.stored.includes(input.offerHash)) {
    return {
      ok: false,
      refusal: {
        kind: "unknown_offer",
        detail:
          `That offer hash names nothing this system offered to you in this conversation. An ` +
          `offer is made by this server, to one student, in one conversation — so a hash from ` +
          `somewhere else, or one a client worked out for itself, cannot be spent here.`,
      },
    };
  }

  // Condition two.
  for (const target of input.directory.targets()) {
    const rebuilt = offerFor({
      target,
      studentId: input.studentId,
      conversationId: input.conversationId,
    });
    if (rebuilt.offerHash === input.offerHash) return { ok: true, target };
  }

  return {
    ok: false,
    refusal: {
      kind: "offer_no_longer_valid",
      detail:
        `This offer was made in this conversation and no longer describes an available ` +
        `target. Either the target was retired, or the reviewed content behind it changed — ` +
        `and an approval covers the content that was reviewed, not the identifier ` +
        `(ADR-0057). A fresh offer is needed.`,
    },
  };
}
