/**
 * The port the document transport is wired to, and the refusal that guards it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0090. The transport is the route and the checks in front of it; WHERE
 * the bytes come to rest is a separate question, and this is the seam between
 * them. `openIntake` does not know what a vault is, and since ADR-0092 the
 * vault never sees bytes: it mints the upload URL and confirms what the bucket
 * holds.
 *
 * ── Why the in-memory implementation refuses to run in production ─────────
 *
 * `InMemoryDocumentVault` satisfies the whole `DocumentVault` contract over an
 * in-memory bucket, and loses everything when the process restarts. That is fine for a test and is
 * a data-loss incident for a student, so it is refused the way the secure
 * plane refuses `LocalDataKeyProvider` (ADR-0055): one function, called at
 * wiring time, that both processes go through.
 *
 * The alternative — shipping it and writing "not for production" in a comment
 * — is the shape this repository keeps finding: a record that says the right
 * thing over code that does not enforce it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { DocumentIntake, DocumentVault, IntakeId } from "@askimate/aas-documents";
import { InMemoryDocumentVault } from "@askimate/aas-documents";
import type { LawfulBasisRegister } from "@askimate/aas-disclosure";
import type { RetentionSchedule } from "@askimate/aas-domain";

/**
 * What the routes need: somewhere to put an open intake, and a vault.
 *
 * The intake store is separate from the vault because the two have different
 * lifetimes and different failure modes. An intake is a fifteen-minute
 * permission; a document is held for a year.
 */
export interface DocumentIntakePort {
  readonly schedule: RetentionSchedule;
  readonly register: LawfulBasisRegister;
  readonly vault: DocumentVault;
  /** Records an opened intake. Overwriting an existing id is a programming error. */
  open(intake: DocumentIntake): Promise<void>;
  /**
   * Takes the intake and REMOVES it, atomically.
   *
   * Reading and deleting are one operation on purpose: an intake is permission
   * to send one document once, and a read-then-delete leaves a window in which
   * two concurrent requests both see it open. Returns null when there is
   * nothing to take, which covers unknown, expired-and-swept, and already
   * spent — all three of which the route answers the same way, because
   * distinguishing them would tell a caller which intake ids exist.
   */
  take(conversationId: string, intakeId: IntakeId): Promise<DocumentIntake | null>;
}

/**
 * An in-process intake store and vault. Development and tests only.
 *
 * Every open intake and every stored document lives in this process's heap.
 * Two replicas do not share them, and a restart loses them.
 */
export class InMemoryDocumentIntakePort implements DocumentIntakePort {
  readonly #intakes = new Map<string, DocumentIntake>();
  public readonly vault: DocumentVault;

  public constructor(
    public readonly schedule: RetentionSchedule,
    public readonly register: LawfulBasisRegister,
  ) {
    this.vault = new InMemoryDocumentVault();
  }

  public open(intake: DocumentIntake): Promise<void> {
    this.#intakes.set(`${intake.conversationId}/${intake.intakeId}`, intake);
    return Promise.resolve();
  }

  public take(conversationId: string, intakeId: IntakeId): Promise<DocumentIntake | null> {
    const key = `${conversationId}/${intakeId}`;
    const found = this.#intakes.get(key);
    if (found === undefined) return Promise.resolve(null);
    this.#intakes.delete(key);
    return Promise.resolve(found);
  }
}

/**
 * Refuses an in-memory document store in production.
 *
 * ── Where the control lives, and why it is here rather than in config ─────
 *
 * ADR-0055 recorded the lesson: `assertVaultIsProductionGrade` had a
 * configuration check beside it that already refused the same start, so the
 * function was not load-bearing and a deliberate regression deleted it with
 * every test still green. Two checks, one reachable.
 *
 * So this is the check, it is called at wiring time, and there is no second
 * one. A regression that deletes the call fails a test.
 */
export function assertDocumentStoreIsDurable(
  port: DocumentIntakePort,
  environment: string | undefined,
): void {
  if (environment !== "production") return;
  if (!(port instanceof InMemoryDocumentIntakePort)) return;

  throw new Error(
    "REFUSING TO START: NODE_ENV=production with an in-memory document store. " +
      "Every open intake and every stored document would live in this process's heap — not " +
      "shared between replicas, and gone on restart. A student's passport is not something to " +
      "lose to a deploy. ADR-0090: the durable, encrypted store is the next phase, and until it " +
      "exists this service must run without a document transport rather than with a pretend one.",
  );
}
