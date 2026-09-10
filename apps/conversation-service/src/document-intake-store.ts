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

import type { Pool } from "pg";

import type { DocumentIntake, DocumentUpload, DocumentVault, IntakeId } from "@askimate/aas-documents";
import { InMemoryDocumentVault, assertStorable, openIntake } from "@askimate/aas-documents";
import type { LawfulBasisRegister } from "@askimate/aas-disclosure";
import type { DocumentType, RetentionPurpose, RetentionSchedule } from "@askimate/aas-domain";

import { S3DocumentVault } from "./s3-document-vault.js";

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

  /**
   * The vault may be handed in, so a test can put its in-memory bucket behind
   * a listener the browser can actually reach. It is still an in-memory
   * vault, and `assertDocumentStoreIsDurable` still refuses this port in
   * production whatever it was handed.
   */
  public constructor(
    public readonly schedule: RetentionSchedule,
    public readonly register: LawfulBasisRegister,
    vault: InMemoryDocumentVault = new InMemoryDocumentVault(),
  ) {
    this.vault = vault;
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
 * The durable intake store: the `document_intakes` table (migration 0017).
 *
 * ── `take` re-runs the gates ──────────────────────────────────────────────
 *
 * A row is the record that the gates passed at declaration — the policy
 * reference and the determination relied on are stored, for the audit. But
 * the `DocumentIntake` handed back is not rebuilt from the row by a cast:
 * `assertStorable` runs again, against the schedule and register in force
 * NOW, and `openIntake`'s own checks with it. ADR-0090's sentence, made true
 * of the durable path too: *"the checks that permitted it are re-run, which
 * is the point."* A schedule that changed in the fifteen minutes between
 * declare and confirm refuses the confirm, and that is the right answer.
 *
 * ── One statement ─────────────────────────────────────────────────────────
 *
 * `DELETE … WHERE conversation_id AND intake_id RETURNING … expires_at`:
 * taken and removed in one operation, so two concurrent confirms cannot both
 * see it open. Expiry is judged on the row that came back, in code: an
 * expired row is never returned, and the same statement has already spent
 * it. The first version put `expires_at > $now` in the WHERE clause, which
 * left an expired row in the table — hidden from a take at the right clock,
 * findable by one at the wrong clock — and its own comment said otherwise.
 * The in-memory port promises the same and keeps it with a Map; here the
 * database keeps it.
 */
export class PostgresDocumentIntakePort implements DocumentIntakePort {
  readonly #pool: Pool;
  readonly #now: () => Date;

  /**
   * `now` is injected, as everywhere else in this service: the composition
   * root makes the real clock, a test makes a fixed one. The first version of
   * this class read `new Date()` itself, and its tests fixed their fixtures
   * at 2026-09-09 — which passed all afternoon and failed the moment the
   * date rolled over, because an intake "opened" at a fixed instant was by
   * then sixteen hours expired by the wall clock. A store that consults a
   * clock its caller cannot see is a store whose tests depend on the day.
   */
  public constructor(
    pool: Pool,
    public readonly schedule: RetentionSchedule,
    public readonly register: LawfulBasisRegister,
    public readonly vault: DocumentVault,
    now: () => Date,
  ) {
    this.#pool = pool;
    this.#now = now;
  }

  public async open(intake: DocumentIntake): Promise<void> {
    await this.#pool.query(
      `INSERT INTO document_intakes
         (intake_id, conversation_id, student_id, document_type, purpose, content_type,
          content_hash, declared_size_bytes, policy_reference, lawful_basis, opened_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [
        intake.intakeId,
        intake.conversationId,
        intake.upload.studentId,
        intake.upload.documentType,
        intake.upload.purpose,
        intake.contentType,
        intake.declaredHash,
        intake.declaredSizeBytes,
        intake.upload.policyReference,
        JSON.stringify(intake.upload.lawfulBasis),
        intake.openedAt,
        intake.expiresAt,
      ],
    );
  }

  public async take(conversationId: string, intakeId: IntakeId): Promise<DocumentIntake | null> {
    const now = this.#now();
    const rows = await this.#pool.query<{
      student_id: string;
      document_type: string;
      purpose: string;
      content_type: string;
      content_hash: string;
      declared_size_bytes: string | number;
      opened_at: Date;
      expires_at: Date;
    }>(
      `DELETE FROM document_intakes
        WHERE conversation_id = $1 AND intake_id = $2
        RETURNING student_id, document_type, purpose, content_type, content_hash,
                  declared_size_bytes, opened_at, expires_at`,
      [conversationId, intakeId],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    // Spent either way. An expired intake is not a permission, and the row
    // that recorded it is gone with this statement rather than left for a
    // sweep to find.
    if (row.expires_at.getTime() <= now.getTime()) return null;

    const upload: DocumentUpload = {
      studentId: row.student_id,
      documentType: row.document_type as DocumentType,
      purpose: row.purpose as RetentionPurpose,
      contentType: row.content_type,
      sizeBytes: Number(row.declared_size_bytes),
      contentHash: row.content_hash,
      dates: {},
    };
    // The gates, again. A throw here is a refusal the route answers with the
    // gate's own words, exactly as at declaration.
    const storable = assertStorable({ schedule: this.schedule, register: this.register, upload });
    return openIntake({
      intakeId,
      conversationId,
      upload: storable,
      contentType: row.content_type,
      declaredSizeBytes: Number(row.declared_size_bytes),
      now: row.opened_at,
    });
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

  // Three things have to be durable, and the one check names whichever is
  // not: the intakes, the vault's bytes, and the vault's metadata.
  const failing =
    port instanceof InMemoryDocumentIntakePort
      ? "the intake store is in memory"
      : port.vault instanceof InMemoryDocumentVault
        ? "the vault is in memory"
        : port.vault instanceof S3DocumentVault && !port.vault.durable
          ? "the S3 vault's metadata store is in memory"
          : null;
  if (failing === null) return;

  throw new Error(
    `REFUSING TO START: NODE_ENV=production and ${failing}. ` +
      "An open intake or a document's record would live in this process's heap — not shared " +
      "between replicas, and gone on restart. A student's passport is not something to lose to " +
      "a deploy. ADR-0094: the durable store is the document_intakes and documents tables over " +
      "an S3 vault, and this service must run without a document transport rather than with a " +
      "pretend one.",
  );
}
