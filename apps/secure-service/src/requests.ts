/**
 * The secure plane's own store: requests, frame tokens, sessions, uses.
 *
 * Everything here is a LIFECYCLE FACT. The schema has no column that can hold a
 * secret and this file has no method that returns one — the plaintext lives in
 * the vault (`EnvelopeVault`, ADR-0034) and reaches nothing that this class
 * writes.
 *
 * ── Hashed, not stored ────────────────────────────────────────────────────
 *
 * Frame tokens and session ids are held as SHA-256 of the value. A database
 * read — a backup, a replica, a support query — therefore yields nothing that
 * can be presented. They are high-entropy random values, so a hash is a real
 * one-way function here in a way it is not for a password.
 */

import { createHash, randomBytes } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { RejectionReason } from "@askimate/aas-contracts";

export type Lifecycle =
  | "secret_requested"
  | "secret_received"
  | "secret_consumed"
  | "secret_expired"
  | "secret_cancelled";

export type Purpose = "portal_account_creation" | "portal_password_reset";

export interface SecretRequestRow {
  readonly requestId: string;
  readonly studentRef: string;
  readonly conversationId: string;
  readonly caseRef: string;
  readonly purpose: Purpose;
  readonly targetHost: string;
  readonly lifecycle: Lifecycle;
  readonly handle: string | null;
  readonly requiresConfirmation: boolean;
  readonly title: string | null;
  readonly explanation: string | null;
  readonly expiresAt: Date;
}

export interface OpenInput {
  readonly studentRef: string;
  readonly conversationId: string;
  readonly caseRef: string;
  readonly purpose: Purpose;
  readonly targetHost: string;
  readonly title?: string;
  readonly explanation?: string;
  readonly requiresConfirmation: boolean;
  readonly ttlSeconds: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** `sr_` + 32 hex, matching the contract's pattern and the column's CHECK. */
export function newRequestId(): string {
  return `sr_${randomBytes(16).toString("hex")}`;
}

export function newHandle(): string {
  return `sh_${randomBytes(16).toString("hex")}`;
}

/**
 * 43+ base64url characters, per the contract's `minLength`.
 *
 * 32 random bytes. Not a JWT and not derived from anything: a token that
 * encodes claims is a token someone eventually reads claims out of, and this
 * one needs to carry nothing but its own unguessability.
 */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export class SecureRequestStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** Opens a request and mints its one-time frame token, in one transaction. */
  public async open(
    input: OpenInput,
    now: Date,
  ): Promise<{ readonly row: SecretRequestRow; readonly frameToken: string }> {
    const requestId = newRequestId();
    const frameToken = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO secret_requests
           (request_id, student_ref, conversation_id, case_ref, purpose, target_host,
            requires_confirmation, title, explanation, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          requestId,
          input.studentRef,
          input.conversationId,
          input.caseRef,
          input.purpose,
          input.targetHost,
          input.requiresConfirmation,
          input.title ?? null,
          input.explanation ?? null,
          expiresAt,
        ],
      );
      // Seconds, not minutes: it exists only to cross one postMessage.
      await client.query(
        `INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, $3)`,
        [sha256(frameToken), requestId, new Date(now.getTime() + 30_000)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const row = await this.find(requestId);
    if (row === null) throw new Error("the request vanished between write and read");
    return { row, frameToken };
  }

  /**
   * Mints a FRESH single-use frame token for an already-open request.
   *
   * A page that reloads needs a new capability, and re-serving the original
   * would mean a token that survives as long as the request — the opposite of
   * "single-use and seconds-lived". Each mount gets its own, and the previous
   * one stays consumed or expires unused.
   *
   * Only for a request that is still open: a settled request has nothing to
   * bootstrap into, and minting for one would create a session that could
   * outlive the step it was for.
   */
  public async mintFrameToken(requestId: string, now: Date): Promise<string | null> {
    const row = await this.find(requestId);
    if (row === null || row.lifecycle !== "secret_requested") return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;

    const frameToken = newOpaqueToken();
    await this.#pool.query(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, $3)",
      [sha256(frameToken), requestId, new Date(now.getTime() + 30_000)],
    );
    return frameToken;
  }

  public async find(requestId: string): Promise<SecretRequestRow | null> {
    const found = await this.#pool.query<RawRequest>(
      `SELECT request_id, student_ref, conversation_id, case_ref, purpose, target_host,
              lifecycle, handle, requires_confirmation, title, explanation, expires_at
         FROM secret_requests WHERE request_id = $1`,
      [requestId],
    );
    const row = found.rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Claims a frame token: single-use, atomically.
   *
   * ONE statement. Checking `consumed_at IS NULL` and then updating races, and
   * the race is a token usable twice — which is a session for a request the
   * second caller was never given. The `WHERE` doing both is what makes a
   * concurrent second claim return no rows.
   */
  public async claimFrameToken(
    frameToken: string,
    now: Date,
  ): Promise<{ readonly requestId: string; readonly studentRef: string } | null> {
    const claimed = await this.#pool.query<{ request_id: string }>(
      `UPDATE frame_tokens SET consumed_at = $2
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
        RETURNING request_id`,
      [sha256(frameToken), now],
    );
    const requestId = claimed.rows[0]?.request_id;
    if (requestId === undefined) return null;

    const request = await this.find(requestId);
    return request === null ? null : { requestId, studentRef: request.studentRef };
  }

  /** Mints this plane's session for a request. Returns the cookie value. */
  public async createSession(
    input: { readonly requestId: string; readonly studentRef: string },
    now: Date,
    ttlSeconds = 600,
  ): Promise<string> {
    const session = newOpaqueToken();
    await this.#pool.query(
      `INSERT INTO secure_sessions (session_hash, request_id, student_ref, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sha256(session), input.requestId, input.studentRef, new Date(now.getTime() + ttlSeconds * 1000)],
    );
    return session;
  }

  public async readSession(
    session: string,
    now: Date,
  ): Promise<{ readonly requestId: string; readonly studentRef: string } | null> {
    const found = await this.#pool.query<{ request_id: string; student_ref: string }>(
      `SELECT request_id, student_ref FROM secure_sessions
        WHERE session_hash = $1 AND expires_at > $2`,
      [sha256(session), now],
    );
    const row = found.rows[0];
    return row === undefined ? null : { requestId: row.request_id, studentRef: row.student_ref };
  }

  /**
   * Records a receipt: lifecycle and handle, in one statement, only from
   * `secret_requested`.
   *
   * The `WHERE lifecycle = 'secret_requested'` is the duplicate-submission
   * guard, and it is in the statement rather than in a preceding read for the
   * same reason as the token claim: two submissions arriving together would
   * both pass a check-then-write, and the second would overwrite the first's
   * handle — leaving a live vault entry nothing could ever spend.
   */
  public async recordReceipt(
    client: PoolClient,
    requestId: string,
    handle: string,
    now: Date,
  ): Promise<boolean> {
    const updated = await client.query(
      `UPDATE secret_requests
          SET lifecycle = 'secret_received', handle = $2, updated_at = $3
        WHERE request_id = $1 AND lifecycle = 'secret_requested' AND expires_at > $3`,
      [requestId, handle, now],
    );
    return updated.rowCount === 1;
  }

  /** Settles a request. Terminal states only; never back to `secret_requested`. */
  public async settle(
    client: PoolClient,
    requestId: string,
    lifecycle: "secret_consumed" | "secret_expired" | "secret_cancelled",
    now: Date,
  ): Promise<boolean> {
    const updated = await client.query(
      `UPDATE secret_requests SET lifecycle = $2, handle = NULL, updated_at = $3
        WHERE request_id = $1 AND lifecycle NOT IN
              ('secret_consumed', 'secret_expired', 'secret_cancelled')`,
      [requestId, lifecycle, now],
    );
    return updated.rowCount === 1;
  }

  public async findByHandle(handle: string): Promise<SecretRequestRow | null> {
    const found = await this.#pool.query<{ request_id: string }>(
      "SELECT request_id FROM secret_requests WHERE handle = $1",
      [handle],
    );
    const requestId = found.rows[0]?.request_id;
    return requestId === undefined ? null : await this.find(requestId);
  }

  /** An audit row. A code, never a value — the CHECK constraint says so too. */
  public async recordUse(
    client: PoolClient,
    input: {
      readonly requestId: string;
      readonly handle: string;
      readonly consumer: string;
      readonly outcome: "used" | "refused";
      readonly refusalCode?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO secret_uses (request_id, handle, consumer, outcome, refusal_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.requestId, input.handle, input.consumer, input.outcome, input.refusalCode ?? null],
    );
  }

  public async withTransaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await task(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface RawRequest {
  request_id: string;
  student_ref: string;
  conversation_id: string;
  case_ref: string;
  purpose: string;
  target_host: string;
  lifecycle: string;
  handle: string | null;
  requires_confirmation: boolean;
  title: string | null;
  explanation: string | null;
  expires_at: Date;
}

function toRow(raw: RawRequest): SecretRequestRow {
  return {
    requestId: raw.request_id,
    studentRef: raw.student_ref,
    conversationId: raw.conversation_id,
    caseRef: raw.case_ref,
    purpose: raw.purpose as Purpose,
    targetHost: raw.target_host,
    lifecycle: raw.lifecycle as Lifecycle,
    handle: raw.handle,
    requiresConfirmation: raw.requires_confirmation,
    title: raw.title,
    explanation: raw.explanation,
    expiresAt: raw.expires_at,
  };
}

/** The refusal codes this service may answer with. Closed, per the contract. */
export type SubmitRefusalCode = Extract<
  RejectionReason,
  | "confirmation_mismatch"
  | "empty"
  | "unknown_request"
  | "expired"
  | "already_submitted"
  | "not_your_request"
  | "wrong_conversation"
>;
