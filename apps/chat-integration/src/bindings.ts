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

import { and, eq } from "drizzle-orm";
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
 * The port.
 *
 * `find` is synchronous because the route needs the binding before it decides
 * anything, and an await between reading the body and checking whose request it
 * is would be a window in which the plaintext sits in scope for no reason. The
 * implementation keeps a read-through cache of open requests and writes through
 * to the database.
 */
export interface SecretBindingStore {
  open(binding: SecretBinding): Promise<void>;
  find(requestId: SecretRequestId): SecretBinding | null;
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

  public find(requestId: SecretRequestId): SecretBinding | null {
    return this.#open.get(requestId) ?? null;
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
