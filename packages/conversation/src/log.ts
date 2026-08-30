/**
 * The client's conversation log: what the server has said, and what we are
 * drawing while we wait to be told.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The client must never create a durable ordinal. Only the
 * Conversation Service assigns ordinals… The browser may temporarily use local
 * rendering state, but every durable event must ultimately come from the server
 * with its server-assigned ordinal."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The bug this removes ──────────────────────────────────────────────────
 *
 * The React container appended with `ordinal: previous.length + 1`. That is a
 * plausible number and a false claim. An ordinal is dense, unique per
 * conversation, assigned by `UPDATE conversations SET last_ordinal =
 * last_ordinal + 1 … RETURNING` inside the insert's transaction, and it is also
 * the SSE event id a reconnect resumes from. A client that computes one has
 * produced a value that looks like a resume cursor and is not one. Two tabs
 * would produce different "ordinal 4"s for different events; a reconnect
 * carrying a locally-computed `Last-Event-ID` would skip or repeat real events.
 *
 * ── The split ─────────────────────────────────────────────────────────────
 *
 * DURABLE entries are `ConversationEvent`s: they arrived from the server and
 * carry the server's ordinal and the server's timestamp. They are held sorted
 * by ordinal and deduplicated by ordinal, so a reconnect that re-delivers a
 * span cannot double it and out-of-order arrival still converges on one
 * ordering — which is what makes two clients watching one conversation agree.
 *
 * PROVISIONAL entries are `UnpositionedEvent`s with a client-local id. They
 * have no ordinal and no `createdAt`, by type: there is no field on them to put
 * one in. They exist so the student sees their own message immediately, and
 * they are retired the moment the durable event that describes the same
 * happening arrives.
 *
 * ── Why openness reads the merged list ────────────────────────────────────
 *
 * `openSecretRequest` is the single authority for "is a secure step open", and
 * it must see everything the student can see, or the composer would unblock on
 * a state the transcript is not showing. Provisional entries only ever exist
 * where the SERVER already confirmed the transition over HTTP and the legacy
 * response simply carried no ordinal — a provisional entry is never a guess
 * about lifecycle. The server's own 409 remains the real boundary regardless;
 * see `composerPolicy`.
 */

import type { ConversationEvent } from "@askimate/aas-contracts";

import { openSecretRequest } from "./openness.js";
import type { TranscriptItem } from "./transcript.js";
import { durableAt, projectEvent, provisionalAt } from "./transcript.js";
import type { UnpositionedEvent } from "./unpositioned.js";

/** Something the client is drawing that the log has not yet placed. */
export interface ProvisionalEntry {
  /** Client-local, opaque, and never sent anywhere. Not a position. */
  readonly localId: string;
  readonly event: UnpositionedEvent;
}

export interface ConversationLog {
  /** Sorted by ordinal, unique by ordinal. Every one came from the server. */
  readonly durable: readonly ConversationEvent[];
  /** In the order they were drawn. None of them has a position. */
  readonly provisional: readonly ProvisionalEntry[];
}

export const EMPTY_LOG: ConversationLog = { durable: [], provisional: [] };

/**
 * Do two entries describe the same happening?
 *
 * Compared on the identifying fields of the kind and nothing else, because the
 * two copies differ exactly in what the client could not know: the ordinal and
 * the timestamp. A message is identified by who said it and what it said; a
 * secure event by which request it concerns. This is what lets the durable
 * event retire the provisional one without the client tracking a correlation id
 * through an endpoint that has no field for one.
 */
export function describesSame(a: UnpositionedEvent, b: UnpositionedEvent): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "message") {
    return b.kind === "message" && a.actor === b.actor && a.content === b.content;
  }
  // Narrowed by the two lines above: `a` is a secure event, and `b` shares its
  // kind. Re-testing `b` would be a cast wearing a guard's clothes.
  return b.kind !== "message" && a.requestId === b.requestId;
}

function unposition(event: ConversationEvent): UnpositionedEvent {
  // A structural strip rather than a cast: the durable event is a supertype of
  // its unpositioned form in every field but the two, so comparing them means
  // comparing the same shape. `describesSame` reads only kind-identifying
  // fields, so passing the event itself would work — and would also mean an
  // ordinal was in scope inside a comparison that must never consider one.
  const { ordinal: _ordinal, createdAt: _createdAt, ...rest } = event;
  return rest;
}

/**
 * Takes an event the SERVER wrote, at the position the SERVER gave it.
 *
 * Three properties, all of them things a naive `[...previous, event]` gets
 * wrong when a stream reconnects:
 *
 *   1. An ordinal already present is IGNORED. A resumed stream that overlaps
 *      by a frame, a poll that races the live subscription, a page that both
 *      backfills and subscribes — none of them can duplicate an event.
 *   2. Insertion is BY ORDINAL, not by arrival. Two clients that receive the
 *      same events in different orders hold the same list.
 *   3. A provisional entry describing the same happening is RETIRED, so the
 *      local echo becomes the real event rather than sitting beside it.
 */
export function admitDurable(log: ConversationLog, event: ConversationEvent): ConversationLog {
  const provisional = log.provisional.filter(
    (entry) => !describesSame(entry.event, unposition(event)),
  );

  if (log.durable.some((held) => held.ordinal === event.ordinal)) {
    // Already known. The provisional filter above still applies: a duplicate
    // delivery is still evidence the happening is durable.
    return provisional.length === log.provisional.length ? log : { durable: log.durable, provisional };
  }

  const durable = [...log.durable, event].sort((left, right) => left.ordinal - right.ordinal);
  return { durable, provisional };
}

export function admitAllDurable(
  log: ConversationLog,
  events: readonly ConversationEvent[],
): ConversationLog {
  return events.reduce(admitDurable, log);
}

export function addProvisional(log: ConversationLog, entry: ProvisionalEntry): ConversationLog {
  return { durable: log.durable, provisional: [...log.provisional, entry] };
}

/** Drops a local echo — because the server accepted it, or because it refused. */
export function retireProvisional(log: ConversationLog, localId: string): ConversationLog {
  const provisional = log.provisional.filter((entry) => entry.localId !== localId);
  return provisional.length === log.provisional.length
    ? log
    : { durable: log.durable, provisional };
}

/**
 * The whole conversation, drawn: everything the server has placed, then
 * everything we are drawing on our own, in that order.
 *
 * Provisional entries go last because they have no position to interleave BY.
 * Inventing one — "after the highest ordinal we have seen" — is the same
 * arithmetic this module exists to delete, and it would be wrong the moment a
 * backfill delivered an older event.
 */
export function projectLog(log: ConversationLog): readonly TranscriptItem[] {
  return [
    ...log.durable.map((event) => projectEvent(event, durableAt(event.ordinal))),
    ...log.provisional.map((entry) => projectEvent(entry.event, provisionalAt(entry.localId))),
  ];
}

/**
 * Is a secure step open? Asked of the whole log, answered by the one authority.
 *
 * This module does not decide it. It concatenates the two lists — durable
 * first, then what we are drawing — and calls `openSecretRequest`, which is the
 * same function the Conversation Service calls over the same shape. That is the
 * structural reason a client and a server cannot disagree about whether a step
 * is open.
 *
 * No ordinal is involved, and none is invented. `openSecretRequest` takes
 * UNPOSITIONED events precisely so that asking this question about a
 * locally-drawn entry does not require making up a position for it.
 */
export function openSecretRequestInLog(log: ConversationLog): string | null {
  return openSecretRequest(merged(log));
}

/** Durable first, then provisional. Order, with no positions attached. */
function merged(log: ConversationLog): readonly UnpositionedEvent[] {
  return [...log.durable, ...log.provisional.map((entry) => entry.event)];
}

/**
 * The DURABLE `secret_requested` event for an open request, or null.
 *
 * Durable only, deliberately. This is what a client reads to decide whether it
 * can render the step — its channel and its expiry — and both must come from
 * the log rather than from anything the browser drew for itself. A provisional
 * entry has neither field with any authority behind it.
 */
export function durableSecretRequest(
  log: ConversationLog,
  requestId: string,
): { readonly channel: string; readonly expiresAt: string } | null {
  for (const event of log.durable) {
    if (event.kind === "secret_requested" && event.requestId === requestId) {
      return { channel: event.channel, expiresAt: event.expiresAt };
    }
  }
  return null;
}

/** The events the model may be told about: the durable ones, in order. */
export function durableEvents(log: ConversationLog): readonly ConversationEvent[] {
  return log.durable;
}
