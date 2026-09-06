/**
 * What a specialist is told when a run stops, and what they are deliberately
 * NOT told (ADR-0071).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS NOTICE LEAVES THE SYSTEM. Its destination is a URL an operator
 * configures — a chat webhook, a paging service, an internal relay — and none
 * of those is inside any boundary this repository controls. So the question is
 * not "what would be useful in the message?" but "what may be handed to a
 * third party in order to say that something needs a person?"
 *
 * The answer is: an identifier, a category, and where to look. Nothing else.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is absent, and why each one is absent ────────────────────────────
 *
 * `encountered` / `expected` — the specialist's actual working material, and
 *   the reason the intervention is legible at all. They are free text composed
 *   at the point of failure, and free text is where a value ends up: a
 *   validation error quoted back from a portal can contain what was typed into
 *   the field. Sending them to a chat channel would put the one class of string
 *   nobody audits into the one place nobody controls.
 *
 * `checkpoint` — diagnostic and structured, but it names pages and fields of a
 *   real application in progress. A specialist reads it after authenticating to
 *   the internal route; a webhook subscriber has not authenticated to anything.
 *
 * `studentRef` — a pseudonymous identifier is still a personal identifier, and
 *   it buys the specialist nothing: `caseId` and `runId` are what the CLI and
 *   the internal route take. Sending it would be sending an identifier for a
 *   person to a third party in exchange for nothing.
 *
 * So the notice says: something of this KIND stopped, on this application, at
 * this institution, at this time — go and look. Following it requires the
 * service credential, which is where the detail correctly lives.
 *
 * ── Why this is a type and not a convention ───────────────────────────────
 *
 * `noticeFor` is the only way to make one, and it reads named fields off a
 * `StoredIntervention` rather than spreading it. A future field on the
 * intervention — a specialist's note, a portal's error body — does not appear
 * here by accident, because there is nowhere for it to land. ADR-0017's
 * sentence, applied to an outbound channel: the shape answers the question
 * instead of a reviewer having to remember it.
 */

import type { EscalationPriority, RecoveryReason } from "@askimate/aas-domain";
import type { StoredIntervention } from "@askimate/aas-case-store/interventions";

/**
 * Everything that may leave the system to say a run needs a person.
 *
 * Every field is either an opaque identifier, a member of a closed union, a
 * fact about a REVIEWED artefact (the blueprint and the catalogue entry, both
 * two-person reviewed under ADR-0017 and ADR-0057), or a timestamp. There is no
 * free text and no student.
 */
export interface SpecialistNotice {
  readonly interventionId: string;
  readonly runId: string;
  readonly caseId: string;
  /** A closed union. The category of stop, never a description of it. */
  readonly reason: RecoveryReason;
  readonly priority: EscalationPriority;
  /** From the reviewed catalogue entry, not from the student's application. */
  readonly institutionId: string;
  readonly courseId: string;
  readonly portal: string;
  /** The blueprint page, when the stop was on one. A blueprint fact. */
  readonly page?: string;
  readonly raisedAt: string;
}

/**
 * How long a notice may sit undelivered before it is worth saying so.
 *
 * Not enforced here — nothing in this package decides to give up, because a
 * notice that is dropped is a stopped run nobody hears about, which is the
 * failure this whole phase exists to close. It is exported so that an operator
 * surface can say "this has been trying for four hours" rather than leaving
 * repeated failure invisible.
 */
export const MAX_NOTICE_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * The only constructor.
 *
 * Reads named fields. Deliberately not a spread of the intervention with a few
 * keys deleted — a delete-list is a list somebody has to update, and the field
 * they forget is the one that leaks.
 */
export function noticeFor(held: StoredIntervention): SpecialistNotice {
  return {
    interventionId: held.interventionId,
    runId: held.runId,
    caseId: held.caseId,
    reason: held.escalation.reason,
    priority: held.escalation.priority,
    institutionId: held.context.institutionId,
    courseId: held.context.courseId,
    portal: held.context.portal,
    ...(held.context.page === undefined ? {} : { page: held.context.page }),
    raisedAt: held.escalation.raisedAt.toISOString(),
  };
}

/**
 * Raised when a notice could not be delivered.
 *
 * Carries the notice's id and the transport's own reason, and NOT the response
 * body: a webhook endpoint's error page is content from outside the system, and
 * this error is going into a log.
 */
export class NoticeDeliveryError extends Error {
  public override readonly name = "NoticeDeliveryError";
  public constructor(
    public readonly interventionId: string,
    public readonly detail: string,
  ) {
    super(`Could not deliver the notice for intervention ${interventionId}: ${detail}`);
  }
}

/**
 * Somewhere a notice can be sent.
 *
 * A port, because the destination is an operational choice — a chat webhook
 * today, a paging service or an internal relay later — and because it must be
 * substitutable in a test without a network.
 *
 * **It may throw.** A notifier that swallowed a failure would let the caller
 * mark the intervention as notified when nobody was told, which is the exact
 * failure this phase closes wearing a disguise.
 */
export interface SpecialistNotifier {
  notify(notice: SpecialistNotice): Promise<void>;
}
