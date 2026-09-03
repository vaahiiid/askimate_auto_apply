/**
 * The ciphertext cache the Secure Service and the Fill Agent SHARE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0034 defines the port; ADR-0042 makes sharing it non-optional. The
 * service that receives a student's password and the agent that spends it are
 * DIFFERENT DEPLOYABLES. `InMemoryEnvelopeCache` is in-process, so with it the
 * two share nothing and every handle resolves to nothing — which
 * `secure-plane-deployment.md` §2 has named as the failure since the vault was
 * written, while noting that the adapter was "not implemented here".
 *
 * This is that adapter. It is what makes the accepted topology implementable
 * rather than merely described.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What Redis holds, and what it cannot do with it ───────────────────────
 *
 * An `Envelope` is ciphertext, a nonce, a GCM tag, and a data key **wrapped
 * under KMS**. Redis holds all four and can decrypt none of them: unwrapping is
 * a KMS call requiring a credential this cache has no access to. That is the
 * property ADR-0034 §"Memory-only" describes — *"holding the cache yields
 * nothing without KMS; holding KMS yields nothing without the cache"* — and a
 * test scans the bytes Redis actually stores to prove the plaintext is not
 * among them.
 *
 * ── Why the TTL is set twice ──────────────────────────────────────────────
 *
 * `put` sets `PXAT`, so the SERVER removes the entry when its time is up even
 * if nothing ever asks for it again. `take` then compares `expiresAt` to the
 * INJECTED clock and refuses an expired envelope regardless of what the server
 * did. Belt and braces on purpose: server-side expiry bounds how long
 * ciphertext exists at all, and the injected comparison keeps this
 * implementation's semantics identical to the in-memory one — which is what the
 * shared contract test can then hold both to.
 */

import { Buffer } from "node:buffer";

import { Redis, type RedisOptions } from "ioredis";

import type { Envelope, EnvelopeCache } from "@askimate/aas-secrets";

/**
 * Raised when the cache is reachable but configured in a way that would make
 * the Secure Plane's guarantees untrue.
 *
 * Separate from a connection error because the operator action is different: a
 * connection error is "it is not there", this is "it is there and it is wrong".
 */
export class CacheUnsafeError extends Error {
  public constructor(message: string) {
    super(`REFUSING TO START: ${message}`);
    this.name = "CacheUnsafeError";
  }
}

export interface RedisEnvelopeCacheOptions {
  /** `redis://` or `rediss://`. TLS is required in production by the caller. */
  readonly url: string;
  /**
   * Key prefix. Namespacing only — never a security boundary, because anything
   * that can read one key in this database can read the others.
   */
  readonly prefix?: string;
  /** For a test that wants to supply its own client. */
  readonly client?: Redis;
}

const DEFAULT_PREFIX = "aas:envelope:";

/**
 * The client's own settings, fixed rather than passed through.
 *
 * No `redisOptions` escape hatch: this is the cache the Secure Plane depends
 * on, and a deployment that could hand it arbitrary client options could turn
 * the offline queue back on. TLS comes from the URL scheme (`rediss://`), which
 * is where a deployment states it.
 */
const CLIENT_OPTIONS = {
  // A cache that silently queues commands while disconnected would make `take`
  // answer LATE rather than answer "no", and a late answer to "may this
  // credential be spent" is the wrong shape entirely.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
} satisfies RedisOptions;

/** How many bytes each length header takes. Four is more than any field needs. */
const LENGTH_BYTES = 4;

/**
 * One envelope as bytes.
 *
 * Length-prefixed rather than JSON: three of the five fields are binary, and a
 * JSON round trip through base64 would be two conversions that can each lose a
 * byte silently. A framed encoding either decodes exactly or throws.
 */
export function encodeEnvelope(envelope: Envelope): Buffer {
  const parts = [envelope.nonce, envelope.tag, envelope.ciphertext, envelope.wrappedKey];
  const header = Buffer.alloc(8 + LENGTH_BYTES * parts.length);
  // Milliseconds since the epoch, as a 64-bit value. `writeBigInt64BE` rather
  // than a double, so a far-future expiry cannot lose precision.
  header.writeBigInt64BE(BigInt(envelope.expiresAt.getTime()), 0);
  parts.forEach((part, index) => {
    header.writeUInt32BE(part.length, 8 + index * LENGTH_BYTES);
  });
  return Buffer.concat([header, ...parts]);
}

/** The inverse. Throws on anything it did not write itself. */
export function decodeEnvelope(bytes: Buffer): Envelope {
  const headerLength = 8 + LENGTH_BYTES * 4;
  if (bytes.length < headerLength) throw new Error("envelope is truncated");
  const expiresAt = new Date(Number(bytes.readBigInt64BE(0)));
  const lengths = [0, 1, 2, 3].map((index) => bytes.readUInt32BE(8 + index * LENGTH_BYTES));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (bytes.length !== headerLength + total) throw new Error("envelope length header disagrees");

  let offset = headerLength;
  const next = (length: number): Buffer => {
    const slice = bytes.subarray(offset, offset + length);
    offset += length;
    // Copied, not a view: the subarray shares memory with the whole record, so
    // keeping a view would keep every other field alive with it — including the
    // wrapped key, after a caller believed it had finished with the ciphertext.
    return Buffer.from(slice);
  };
  const [nonceLength, tagLength, ciphertextLength, wrappedLength] = lengths as [
    number,
    number,
    number,
    number,
  ];
  return {
    nonce: next(nonceLength),
    tag: next(tagLength),
    ciphertext: next(ciphertextLength),
    wrappedKey: next(wrappedLength),
    expiresAt,
  };
}

export class RedisEnvelopeCache implements EnvelopeCache {
  readonly #redis: Redis;
  readonly #prefix: string;

  public constructor(options: RedisEnvelopeCacheOptions) {
    this.#redis =
      options.client ??
      new Redis(options.url, CLIENT_OPTIONS);
    this.#prefix = options.prefix ?? DEFAULT_PREFIX;
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  public async put(key: string, envelope: Envelope): Promise<void> {
    const encoded = encodeEnvelope(envelope);
    // `PXAT` alone, with NO clock read here. An expiry already in the past is
    // accepted by Redis and the key is immediately absent — measured, not
    // assumed — so a guard comparing `expiresAt` to the ambient clock would be
    // a second opinion about the same instant, and the repository's lint rule
    // is right to refuse one.
    await this.#redis.set(this.#key(key), encoded, "PXAT", envelope.expiresAt.getTime());
  }

  public async take(key: string, now: Date): Promise<Envelope | null> {
    // GETDEL, so the read and the removal are ONE command. Two commands would
    // be a race between two fill agents, and the thing being raced for is
    // permission to type a student's password into a portal.
    const bytes = await this.#redis.getdelBuffer(this.#key(key));
    if (bytes === null) return null;
    const envelope = decodeEnvelope(bytes);
    // Expired against the INJECTED clock, exactly as the in-memory cache does.
    // The entry is gone either way — `getdel` already removed it — which is
    // also what the in-memory implementation does and for the same reason.
    return envelope.expiresAt.getTime() <= now.getTime() ? null : envelope;
  }

  public async drop(key: string): Promise<void> {
    await this.#redis.del(this.#key(key));
  }

  /**
   * Always zero, and that is the honest answer.
   *
   * The in-memory cache needs a sweep because nothing else would ever remove an
   * expired entry from a `Map`. Redis removes its own expired keys, so by the
   * time anything could sweep, there is nothing past its TTL to find. Returning
   * a number this implementation cannot truthfully produce — say, a count of
   * keys it deleted itself — would mean scanning the keyspace to do work the
   * server has already done.
   */
  public sweep(_now: Date): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * The startup check: reachable, and configured so that ciphertext neither
   * survives a restart nor vanishes under memory pressure.
   *
   * ── Why each of these, and why refusing is right ─────────────────────────
   *
   * `maxmemory-policy noeviction` — `secure-plane-deployment.md` §3.2 calls it
   * load-bearing: *"silent eviction under memory pressure would look to a
   * student like a spontaneous cancellation, and a security control that fails
   * quietly is not one."*
   *
   * `appendonly no` and `save ""` — ciphertext must not reach disk. It is
   * encrypted, so this is defence in depth rather than the only protection, but
   * an AOF of every envelope is a durable copy of every credential exchange
   * that nobody decided to keep.
   *
   * **A server that refuses `CONFIG GET` fails this check.** Some managed
   * offerings disable it. That is inconvenient and it is still the right
   * answer: this method exists to establish a property, and "I could not ask"
   * is not the same as "it holds". An operator who cannot expose `CONFIG GET`
   * needs a different attestation, not a check that passes when it learns
   * nothing.
   */
  public async verify(): Promise<void> {
    await this.ready();
    await this.#redis.ping();

    const settings: readonly { readonly name: string; readonly expected: string; readonly why: string }[] = [
      {
        name: "maxmemory-policy",
        expected: "noeviction",
        why: "an evicted envelope looks to a student like a spontaneous cancellation",
      },
      { name: "appendonly", expected: "no", why: "ciphertext must not reach disk" },
      { name: "save", expected: "", why: "ciphertext must not reach disk" },
    ];

    for (const setting of settings) {
      let value: string;
      try {
        const pair = await this.#redis.config("GET", setting.name);
        value = pair[1] ?? "";
      } catch {
        throw new CacheUnsafeError(
          `the envelope cache would not answer CONFIG GET ${setting.name}. This check exists ` +
            "to establish a property of the cache, and a check that cannot ask has not " +
            "established it.",
        );
      }
      if (value.trim() !== setting.expected) {
        throw new CacheUnsafeError(
          `the envelope cache has ${setting.name} set to something other than ` +
            `"${setting.expected}" — ${setting.why} (see secure-plane-deployment.md §3.2).`,
        );
      }
    }
  }

  /**
   * Waits until the client can actually carry a command.
   *
   * `enableOfflineQueue: false` is deliberate — a queued command answers LATE
   * rather than answering "no" — but it also means a command issued before the
   * socket is up fails outright. So connecting is an explicit step rather than
   * something the first caller discovers. `verify()` does it at startup, which
   * is where a connection problem should surface anyway.
   */
  public async ready(): Promise<void> {
    if (this.#redis.status === "ready") return;
    if (this.#redis.status === "wait") {
      await this.#redis.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error): void => {
        this.#redis.off("ready", onReady);
        this.#redis.off("error", onError);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onReady = (): void => {
        done();
      };
      const onError = (error: Error): void => {
        done(error);
      };
      this.#redis.once("ready", onReady);
      this.#redis.once("error", onError);
    });
  }

  /** Closes the connection. Safe to call twice. */
  public async close(): Promise<void> {
    if (this.#redis.status === "end") return;
    await this.#redis.quit().catch(() => undefined);
  }
}
