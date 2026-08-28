/**
 * Rebuilding the conversation after a refresh, without ever storing what was
 * typed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Persisting enough directive state to survive refresh
 * without ever persisting secret content."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is stored, and what is reconstructed ─────────────────────────────
 *
 * STORED: an ordinal, a kind, a request id, and — depending on kind — a
 * lifecycle word or a rejection code. All four are values from closed sets
 * decided before the student touched the keyboard, and the database enforces
 * the sets with CHECK constraints.
 *
 * RECONSTRUCTED at read time: the prompt itself, from
 * `askimate_secret_requests`. So the card's title, explanation and host are
 * never written twice, and the row carries nothing that could be rendered on
 * its own.
 *
 * ── The property this preserves ───────────────────────────────────────────
 *
 * A student who refreshes mid-password sees the conversation as it was: the
 * assistant's message, the secure step in its place, and whatever followed.
 * What they do NOT get back is anything they had typed — not the password
 * (which never left the input element) and not the composer draft (which is
 * deliberately not persisted while a request is open). Continuity of the
 * conversation, not of the input.
 */

import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { SecretLifecycle, SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";

import type { ChatTurn, SecretRejectionReason } from "./chat-transport.js";
import { askimateConversationEvents } from "./schema.js";

/** One persisted, content-free record of a secure step. */
export interface ConversationEvent {
  readonly conversationId: number;
  readonly ordinal: number;
  readonly kind: "directive" | "secret_status" | "secret_rejected";
  readonly requestId: SecretRequestId;
  readonly lifecycle?: SecretLifecycle;
  readonly reasonCode?: SecretRejectionReason;
}

/**
 * The port.
 *
 * `record` is deliberately narrow: there is no parameter through which a
 * caller could pass display text, so "just store the message too" requires
 * changing this interface in a diff a reviewer sees.
 */
export interface ConversationEventStore {
  record(event: ConversationEvent): Promise<void>;
  eventsFor(conversationId: number): Promise<readonly ConversationEvent[]>;
}

export class DatabaseConversationEventStore implements ConversationEventStore {
  public constructor(private readonly db: NodePgDatabase<Record<string, never>>) {}

  public async record(event: ConversationEvent): Promise<void> {
    await this.db
      .insert(askimateConversationEvents)
      .values({
        conversationId: event.conversationId,
        ordinal: event.ordinal,
        kind: event.kind,
        requestId: event.requestId,
        lifecycle: event.lifecycle ?? null,
        reasonCode: event.reasonCode ?? null,
      })
      // A replayed write must not duplicate an item in the transcript. The
      // UNIQUE (conversation_id, ordinal) constraint is what actually enforces
      // it; this turns the resulting error into a no-op rather than a crash.
      .onConflictDoNothing();
  }

  public async eventsFor(conversationId: number): Promise<readonly ConversationEvent[]> {
    const rows = await this.db
      .select()
      .from(askimateConversationEvents)
      .where(eq(askimateConversationEvents.conversationId, conversationId))
      .orderBy(asc(askimateConversationEvents.ordinal));

    return rows.map((row) => ({
      conversationId: row.conversationId,
      ordinal: row.ordinal,
      kind: row.kind as ConversationEvent["kind"],
      requestId: row.requestId as SecretRequestId,
      ...(row.lifecycle === null ? {} : { lifecycle: row.lifecycle as SecretLifecycle }),
      ...(row.reasonCode === null
        ? {}
        : { reasonCode: row.reasonCode as SecretRejectionReason }),
    }));
  }
}

/**
 * Rebuilds the non-message turns of a conversation.
 *
 * Takes the prompts separately — they come from `askimate_secret_requests`,
 * not from the event rows — which is what keeps the event table free of
 * anything renderable. An event whose request is no longer resolvable is
 * DROPPED rather than rendered from a placeholder: showing a password box we
 * cannot describe would be worse than showing nothing.
 */
export function replayEvents(input: {
  readonly events: readonly ConversationEvent[];
  readonly prompts: ReadonlyMap<SecretRequestId, SecretPrompt>;
}): readonly { readonly ordinal: number; readonly turn: ChatTurn }[] {
  const out: { ordinal: number; turn: ChatTurn }[] = [];
  for (const event of input.events) {
    switch (event.kind) {
      case "directive": {
        const prompt = input.prompts.get(event.requestId);
        if (prompt === undefined) break;
        out.push({
          ordinal: event.ordinal,
          turn: { kind: "directive", directive: "request_secret", prompt },
        });
        break;
      }
      case "secret_status": {
        if (event.lifecycle === undefined) break;
        // Note what is NOT restored: the handle. It resolves only inside a
        // live store, and a handle from before a restart resolves to nothing.
        // Replaying one would tell the model a secret is available when it is
        // not.
        out.push({
          ordinal: event.ordinal,
          turn: { kind: "secret_status", lifecycle: event.lifecycle },
        });
        break;
      }
      case "secret_rejected": {
        if (event.reasonCode === undefined) break;
        out.push({
          ordinal: event.ordinal,
          turn: { kind: "secret_rejected", reason: event.reasonCode },
        });
        break;
      }
    }
  }
  return out;
}
