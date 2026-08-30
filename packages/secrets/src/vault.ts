/**
 * The ephemeral encrypted vault. ADR-0034.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *   plaintext ──▶ AES-256-GCM with a per-secret data key from KMS
 *              ──▶ ciphertext + wrapped key ──▶ cache, persistence disabled,
 *                                               TTL = the request's
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why not `InMemorySecretStore` ─────────────────────────────────────────
 *
 * That store holds plaintext in one process's heap. It has the property we
 * want — nothing at rest — and one that makes it unusable in production: the
 * instance that receives the submission and the instance that later spends the
 * handle are different processes, so the handle resolves to nothing on every
 * real run. Sticky routing by request id would make correctness depend on a
 * load balancer's hashing, which is not a security control.
 *
 * ADR-0034 keeps the first property and fixes the second. The plaintext exists
 * in exactly two places, both transient: the DOM element the student typed it
 * into, and one stack frame in the secure service. It is encrypted before it is
 * assigned to anything that outlives that frame.
 *
 * ── What is kept EXACTLY from the existing design ─────────────────────────
 *
 * There is no read API. `use()` takes a callback, hands it the plaintext, and
 * returns THE CALLBACK'S RESULT. No getter, no accessor, no queue. A vault with
 * a `get` is a vault whose value ends up in a variable, and a variable ends up
 * in a log line. ADR-0034 says this design "is kept exactly", and it is.
 *
 * ── Two independent compromises ───────────────────────────────────────────
 *
 * The cache holds ciphertext and a WRAPPED data key. Reading the cache yields
 * nothing without KMS; holding KMS yields nothing without the cache. Memory-only
 * required one compromise; this requires both.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM. 32-byte key, 12-byte nonce, 16-byte tag. */
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

/**
 * ADR-0034: a hard ceiling, whatever a caller asks for.
 *
 * Deliberately a SECOND check, and deliberately not the same constant as
 * `request.ts`'s. That one governs what a request may ask for; this one governs
 * what the vault will actually hold, and it is applied at the moment of
 * encryption. A caller that reached `put` without going through request
 * validation — a future code path, a test, a mistake — still cannot store a
 * ciphertext that outlives five minutes.
 */
export const VAULT_TTL_CEILING_SECONDS = 300;

/**
 * A data key, as KMS returns one.
 *
 * `plaintext` is the key we encrypt with and then zero. `wrapped` is the same
 * key encrypted under a KMS customer master key — the only form that is ever
 * stored, and the reason the cache is useless on its own.
 */
export interface DataKey {
  readonly plaintext: Buffer;
  readonly wrapped: Buffer;
}

/**
 * Where data keys come from.
 *
 * A port, because the production answer is a network call to a cloud service
 * and no test can make one. What must NOT differ between implementations is the
 * shape: a key per secret, wrapped by something this process cannot forge, and
 * zeroed after use.
 */
export interface DataKeyProvider {
  /** A fresh key per secret. ADR-0034: no key caching across requests. */
  generateDataKey(): Promise<DataKey>;
  /** Unwraps one. Returns null when the key cannot be unwrapped. */
  decryptDataKey(wrapped: Buffer): Promise<Buffer | null>;
  /** For the boot-time assertion below. Never used in a decision. */
  readonly kind: "kms" | "local";
}

/**
 * Development and test only. **Refuses to run in production.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Do not fake KMS availability in a way that makes
 * production security claims untrue."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This wraps a data key with a local master key held in this process. That is
 * a genuinely weaker arrangement than KMS and the difference is not cosmetic:
 * a host compromise yields the master key, so it yields every ciphertext in the
 * cache. Under KMS it does not, because unwrapping is an API call this process
 * cannot perform without a credential that can be revoked and is audited.
 *
 * So this class does not merely document the difference — `assertVaultIsProduc
 * tionGrade` refuses to start a production process that is using it. A comment
 * saying "not for production" is advice; a process that will not boot is a
 * control.
 */
export class LocalDataKeyProvider implements DataKeyProvider {
  public readonly kind = "local" as const;
  readonly #master: Buffer;

  public constructor(master: Buffer = randomBytes(KEY_BYTES)) {
    if (master.length !== KEY_BYTES) {
      throw new Error(`a master key must be ${String(KEY_BYTES)} bytes`);
    }
    this.#master = master;
  }

  public generateDataKey(): Promise<DataKey> {
    const plaintext = randomBytes(KEY_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#master, nonce);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Promise.resolve({
      plaintext,
      wrapped: Buffer.concat([nonce, cipher.getAuthTag(), body]),
    });
  }

  public decryptDataKey(wrapped: Buffer): Promise<Buffer | null> {
    if (wrapped.length <= NONCE_BYTES + 16) return Promise.resolve(null);
    try {
      const nonce = wrapped.subarray(0, NONCE_BYTES);
      const tag = wrapped.subarray(NONCE_BYTES, NONCE_BYTES + 16);
      const body = wrapped.subarray(NONCE_BYTES + 16);
      const decipher = createDecipheriv(ALGORITHM, this.#master, nonce);
      decipher.setAuthTag(tag);
      return Promise.resolve(Buffer.concat([decipher.update(body), decipher.final()]));
    } catch {
      // A wrong tag, a truncated buffer, a key from another process. All the
      // same answer, and never an exception carrying the input.
      return Promise.resolve(null);
    }
  }
}

/**
 * Refuses to start a production process on a development key provider.
 *
 * Called at boot, not at submission time: a service that discovered this on the
 * first real secret would already be holding one.
 */
export function assertVaultIsProductionGrade(
  provider: DataKeyProvider,
  environment: string | undefined,
): void {
  if (environment !== "production") return;
  if (provider.kind === "kms") return;
  throw new Error(
    "REFUSING TO START: NODE_ENV=production with a LocalDataKeyProvider. " +
      "ADR-0034 requires a KMS-backed data key per secret; a local master key " +
      "means one host compromise yields every ciphertext in the cache. " +
      "Configure AAS_SECURE_KMS_KEY_ID and use KmsDataKeyProvider.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The cache
// ───────────────────────────────────────────────────────────────────────────

/** One envelope. Nothing here is readable without the key provider. */
export interface Envelope {
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
  readonly wrappedKey: Buffer;
  readonly expiresAt: Date;
}

/**
 * Where envelopes live between submission and use.
 *
 * A port, because production is Valkey/Redis with `appendonly no`, `save ""`,
 * `maxmemory-policy noeviction` and TLS — none of which a test can stand up,
 * and all of which are DEPLOYMENT configuration rather than code. See
 * `docs/secure-plane-deployment.md`.
 *
 * What the port guarantees regardless of implementation: entries expire, an
 * expired entry is indistinguishable from one that never existed, and `take` is
 * atomic — the entry is gone before the caller sees it.
 */
export interface EnvelopeCache {
  put(key: string, envelope: Envelope): Promise<void>;
  /** Reads AND removes, indivisibly. There is deliberately no `get`. */
  take(key: string, now: Date): Promise<Envelope | null>;
  /** Removes without reading. For cancellation and expiry. */
  drop(key: string): Promise<void>;
  /** Removes everything past its TTL. Returns how many went. */
  sweep(now: Date): Promise<number>;
}

/**
 * In-process, for tests and single-instance development.
 *
 * Correct, and NOT what ADR-0034 specifies for production — it is the exact
 * arrangement the ADR rejects, because two instances do not share it. The
 * deployment document names the Valkey configuration that replaces it; the
 * interface above is what stays the same.
 */
export class InMemoryEnvelopeCache implements EnvelopeCache {
  readonly #entries = new Map<string, Envelope>();

  public put(key: string, envelope: Envelope): Promise<void> {
    this.#entries.set(key, envelope);
    return Promise.resolve();
  }

  public take(key: string, now: Date): Promise<Envelope | null> {
    const found = this.#entries.get(key);
    // Deleted whether or not it had expired: a caller asking for an expired
    // entry has finished with it either way, and leaving it would keep
    // ciphertext alive past its TTL.
    this.#entries.delete(key);
    if (found === undefined) return Promise.resolve(null);
    return Promise.resolve(found.expiresAt.getTime() <= now.getTime() ? null : found);
  }

  public drop(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  public sweep(now: Date): Promise<number> {
    let gone = 0;
    for (const [key, envelope] of this.#entries) {
      if (envelope.expiresAt.getTime() <= now.getTime()) {
        this.#entries.delete(key);
        gone += 1;
      }
    }
    return Promise.resolve(gone);
  }

  /** For a test that needs to prove ciphertext rather than plaintext is held. */
  public rawEntries(): readonly Envelope[] {
    return [...this.#entries.values()];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The vault
// ───────────────────────────────────────────────────────────────────────────

export type VaultRefusal = "unknown_handle" | "expired" | "already_spent";

export type VaultUse<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly reason: VaultRefusal };

/**
 * Zeroes a buffer in place.
 *
 * Not a guarantee — V8 may have copied it — but it removes the copy we control,
 * and the alternative is leaving a key sitting in a buffer for the life of the
 * process. ADR-0034: "a data key is requested per secret and zeroed after use".
 */
function zero(buffer: Buffer): void {
  buffer.fill(0);
}

export class EnvelopeVault {
  readonly #keys: DataKeyProvider;
  readonly #cache: EnvelopeCache;

  public constructor(keys: DataKeyProvider, cache: EnvelopeCache) {
    this.#keys = keys;
    this.#cache = cache;
  }

  /**
   * Encrypts and stores. The plaintext argument dies with this call.
   *
   * Nothing is returned but `void`: the caller already has the handle it
   * generated, and a return value shaped like the input is how a value escapes.
   */
  public async put(handle: string, secret: string, expiresAt: Date, now: Date): Promise<void> {
    const ceiling = new Date(now.getTime() + VAULT_TTL_CEILING_SECONDS * 1000);
    const bounded = expiresAt.getTime() > ceiling.getTime() ? ceiling : expiresAt;

    const key = await this.#keys.generateDataKey();
    try {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key.plaintext, nonce);
      // `Buffer.from(secret)` is the only copy this function makes, and it is
      // consumed by `update` immediately.
      const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      await this.#cache.put(handle, {
        nonce,
        tag: cipher.getAuthTag(),
        ciphertext,
        wrappedKey: key.wrapped,
        expiresAt: bounded,
      });
    } finally {
      // Zeroed whether or not the write succeeded. A failed put that left the
      // key in memory would be the worst of both.
      zero(key.plaintext);
    }
  }

  /**
   * Spends it: decrypts, hands the plaintext to `task`, and returns the TASK'S
   * result.
   *
   * The entry is taken from the cache — and therefore gone — before `task`
   * runs, so a task that throws, hangs or retries cannot spend it twice. The
   * plaintext exists for the duration of one call and is zeroed after.
   */
  public async use<T>(
    handle: string,
    task: (secret: string) => T | Promise<T>,
    now: Date,
  ): Promise<VaultUse<T>> {
    const envelope = await this.#cache.take(handle, now);
    if (envelope === null) {
      // One answer for "never existed", "already spent" and "expired". Telling
      // them apart would confirm that some handle had once been real.
      return { ok: false, reason: "unknown_handle" };
    }

    const key = await this.#keys.decryptDataKey(envelope.wrappedKey);
    if (key === null) return { ok: false, reason: "unknown_handle" };

    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv(ALGORITHM, key, envelope.nonce);
      decipher.setAuthTag(envelope.tag);
      plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    } catch {
      return { ok: false, reason: "unknown_handle" };
    } finally {
      zero(key);
    }

    try {
      return { ok: true, result: await task(plaintext.toString("utf8")) };
    } finally {
      zero(plaintext);
    }
  }

  /** Destroys one without reading it. Cancellation and expiry both land here. */
  public async destroy(handle: string): Promise<void> {
    await this.#cache.drop(handle);
  }

  public async sweep(now: Date): Promise<number> {
    return await this.#cache.sweep(now);
  }
}

/**
 * Constant-time comparison of a secret with its confirmation.
 *
 * `===` on two strings short-circuits at the first differing byte. That is a
 * timing oracle on a value the caller supplied twice — small, but free to
 * remove, and this is the one comparison in the system where both operands are
 * the plaintext.
 */
export function confirmationMatches(secret: string, confirmation: string): boolean {
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(confirmation, "utf8");
  try {
    // Lengths are compared first because `timingSafeEqual` throws on a
    // mismatch. The length of a password is not a secret from the person who
    // just typed it twice.
    return a.length === b.length && timingSafeEqual(a, b);
  } finally {
    zero(a);
    zero(b);
  }
}
