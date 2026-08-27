/**
 * Which student, which conversation, which case — recorded in the database, so
 * a page refresh does not lose the thread.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Ensure the secure password request is bound to:
 * authenticated student/user, correct conversation, correct case/application,
 * correct secret purpose, intended target. A SecretHandle must not be usable
 * by another student, conversation or case."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is persisted when the secret is not ──────────────────────────
 *
 * The secret lives in memory and dies in minutes. The *binding* has to outlive
 * a page refresh: a student who reloads mid-password must see "you were asked
 * for a password" rather than a blank chat, and the server must be able to
 * refuse a submission from a different tab, a different conversation or a
 * different account.
 *
 * So the row holds identifiers, one lifecycle word and two timestamps. There
 * is no plaintext column, no encrypted column, no hash and no length — see
 * `askimateSecretRequests` in ./schema.ts.
 *
 * After a process restart the in-memory secret is gone but the row remains,
 * saying `secret_received` for a handle that no longer resolves. That is the
 * correct outcome and the reconciliation is deliberate: `find` reports what the
 * row says, and the store is the authority on whether the handle still works.
 * A student in that position is asked again, which is the honest response.
 */

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { SecretHandle, SecretLifecycle, SecretPurpose, SecretRequestId } from "@askimate/aas-secrets";

import { askimateSecretRequests } from "./schema.js";

export interface SecretBinding {
  readonly requestId: SecretRequestId;
  readonly userId: number;
  readonly conversationId: number;
  readonly caseRef: string;
  readonly purpose: SecretPurpose;
  readonly targetHost: string;
  readonly requiresConfirmation: boolean;
  readonly lifecycle: SecretLifecycle;
  readonly handle?: SecretHandle;
  readonly expiresAt: Date;
}

/**
 * The port — two lookups, split by what happens when they are WRONG.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"fix the binding lookup/open-request behaviour so the
 * guard cannot fail open after restart."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why one method could not serve both callers honestly ──────────────────
 *
 * `find` was a single synchronous method reading a process-local `Map`. Its
 * doc comment claimed "a read-through cache"; there was no read-through. After
 * a restart the map is empty and every open request is invisible.
 *
 * For the SECRET ENDPOINT that is harmless, and in fact correct: an unknown
 * request means the submission is refused. A cache miss there **fails closed**.
 *
 * For the QUARANTINE GUARD it is the opposite. That guard asks "is a secure
 * request open on this conversation?" and closes the ordinary message path
 * while one is. A miss there means "no request open", so the guard **fails
 * open** — the message pipeline is left available at exactly the moment the
 * student is most likely to type a password into it.
 *
 * Same data, same staleness, opposite consequence. So the port names them
 * separately, and the difference is in the types rather than in a comment
 * somebody has to remember:
 *
 *   `findSync`        synchronous, cache-only, MAY MISS. Only safe where a
 *                     miss means refuse.
 *   `openRequestFor`  asynchronous, authoritative, reads the DATABASE. The
 *                     only lookup a guard may use.
 *
 * `findSync` stays synchronous for the reason it always was: the secret route
 * must check ownership without an `await` sitting between reading the body and
 * deciding, because that await is a window in which the plaintext is in scope
 * for no reason.
 */
export interface SecretBindingStore {
  open(binding: SecretBinding): Promise<void>;

  /**
   * Cache-only. Returns null on a miss, INCLUDING after a restart.
   *
   * Use only where null means "refuse". Never to decide that nothing is open.
   */
  findSync(requestId: SecretRequestId): SecretBinding | null;

  /**
   * Authoritative. Reads the database, so it survives a restart.
   *
   * Returns the live (non-terminal, unexpired) request for a conversation, or
   * null when there genuinely is not one. This is what the quarantine guard
   * asks, and it must never answer null merely because this process has
   * forgotten.
   */
  openRequestFor(conversationId: number, now: Date): Promise<SecretBinding | null>;

  record(
    requestId: SecretRequestId,
    update: { readonly lifecycle: SecretLifecycle; readonly handle?: SecretHandle },
  ): Promise<void>;
}

/**
 * The real one: Drizzle over the real `askimate_secret_requests` table.
 *
 * Writes go to the database so the adversarial test has actual rows to scan —
 * a store that only kept a `Map` would make requirement 8 ("search the actual
 * database writes") vacuous, which is the failure mode a previous test in this
 * repository already had once.
 */
export class DatabaseSecretBindingStore implements SecretBindingStore {
  readonly #open = new Map<SecretRequestId, SecretBinding>();

  /**
   * `now` is injected and REQUIRED — no default.
   *
   * The repository lints against reading the ambient clock, and a default here
   * would satisfy the linter while leaving the behaviour exactly as it was: a
   * row whose `updated_at` comes from a clock no test can pin. The caller
   * already has a clock (the app passes one to the routes); passing it twice is
   * cheaper than a row nobody can assert about.
   */
  public constructor(
    private readonly db: NodePgDatabase<Record<string, never>>,
    private readonly now: () => Date,
  ) {}

  public async open(binding: SecretBinding): Promise<void> {
    this.#open.set(binding.requestId, binding);
    await this.db.insert(askimateSecretRequests).values({
      requestId: binding.requestId,
      userId: binding.userId,
      conversationId: binding.conversationId,
      caseRef: binding.caseRef,
      purpose: binding.purpose,
      targetHost: binding.targetHost,
      lifecycle: binding.lifecycle,
      expiresAt: binding.expiresAt,
    });
  }

  public findSync(requestId: SecretRequestId): SecretBinding | null {
    return this.#open.get(requestId) ?? null;
  }

  /**
   * The authoritative lookup. Straight to the table, no cache consulted.
   *
   * Deliberately does NOT fall back to the map, and does not populate it
   * either. A guard that could be satisfied by a cache is a guard that can be
   * satisfied by a stale cache, and the whole reason this method exists is
   * that the cache is empty after a restart.
   *
   * "Open" is defined here rather than by the caller: a row whose lifecycle is
   * still `secret_requested` or `secret_received` and whose expiry has not
   * passed. Terminal states (`secret_consumed`, `secret_expired`) are not open,
   * which is what makes cancellation and expiry release the composer.
   */
  public async openRequestFor(
    conversationId: number,
    now: Date,
  ): Promise<SecretBinding | null> {
    const rows = await this.db
      .select()
      .from(askimateSecretRequests)
      .where(
        and(
          eq(askimateSecretRequests.conversationId, conversationId),
          inArray(askimateSecretRequests.lifecycle, ["secret_requested", "secret_received"]),
          gt(askimateSecretRequests.expiresAt, now),
        ),
      )
      // Newest first, by the table's own serial id.
      //
      // Without an ORDER BY this returned an arbitrary row, which a test caught
      // by naming a request the guard did not report. For "is anything open?"
      // any row would do — but the requestId travels back to a stale client,
      // which uses it to render the card the student is looking at. Pointing
      // them at a superseded request would be wrong in a way nobody would
      // notice until a student typed a password into a box bound to the wrong
      // one. `id` rather than `expires_at`, because two requests opened in the
      // same second share an expiry and would tie.
      .orderBy(desc(askimateSecretRequests.id))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      requestId: row.requestId as SecretRequestId,
      userId: row.userId,
      conversationId: row.conversationId,
      caseRef: row.caseRef,
      purpose: row.purpose as SecretPurpose,
      targetHost: row.targetHost,
      // Not stored on the row; the prompt carries it and the store re-checks.
      // Defaulted rather than invented, and never used by the guard.
      requiresConfirmation: false,
      lifecycle: row.lifecycle as SecretLifecycle,
      ...(row.handle === null ? {} : { handle: row.handle as SecretHandle }),
      expiresAt: row.expiresAt,
    };
  }

  public async record(
    requestId: SecretRequestId,
    update: { readonly lifecycle: SecretLifecycle; readonly handle?: SecretHandle },
  ): Promise<void> {
    const held = this.#open.get(requestId);
    if (held !== undefined) {
      this.#open.set(requestId, {
        ...held,
        lifecycle: update.lifecycle,
        ...(update.handle === undefined ? {} : { handle: update.handle }),
      });
    }
    await this.db
      .update(askimateSecretRequests)
      .set({
        lifecycle: update.lifecycle,
        ...(update.handle === undefined ? {} : { handle: update.handle }),
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(askimateSecretRequests.requestId, requestId),
          // Terminal states are terminal in the database too. Without this a
          // late-arriving write could move a row back from `secret_consumed`,
          // and the row is what a refreshed page reads.
          eq(askimateSecretRequests.lifecycle, held?.lifecycle ?? "secret_requested"),
        ),
      );
  }
}
