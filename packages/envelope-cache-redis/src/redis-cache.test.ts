/**
 * The shared ciphertext cache, against a REAL Redis.
 *
 * A fake would be re-implementing the thing under test. Three of the four
 * properties here are properties of the server rather than of this class:
 * `GETDEL` being one command, `PXAT` expiring an entry without anyone asking,
 * and `CONFIG GET` reporting what the server is actually set to.
 */

import { Buffer } from "node:buffer";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";

import type { Envelope } from "@askimate/aas-secrets";

import { CacheUnsafeError, RedisEnvelopeCache, decodeEnvelope, encodeEnvelope } from "./redis-cache.js";

const URL_ = process.env["AAS_TEST_REDIS_URL"] ?? "redis://127.0.0.1:56379";
const REQUIRED = process.env["AAS_REQUIRE_REDIS"] === "1";

async function reachable(): Promise<boolean> {
  const probe = new Redis(URL_, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    await probe.quit().catch(() => undefined);
  }
}

const HAVE_REDIS = await reachable();
if (!HAVE_REDIS) {
  const banner =
    "\n" +
    "█".repeat(78) + "\n" +
    "██  NOT CHECKED: the SHARED envelope cache (ADR-0034, ADR-0042)\n" +
    "██\n" +
    `██  No Redis at ${URL_}\n` +
    "██  The Secure Service and the Fill Agent are different processes and\n" +
    "██  share this cache. Whether they can was NOT checked.\n" +
    "█".repeat(78) + "\n";
  if (REQUIRED) throw new Error(banner);
  console.warn(banner);
}
const describeIfRedis = HAVE_REDIS ? describe : describe.skip;

let client: Redis;
let cache: RedisEnvelopeCache;

/** The shape the vault actually stores: four buffers and a deadline. */
function envelopeOf(input: { readonly ciphertext: Buffer; readonly expiresAt: Date }): Envelope {
  return {
    nonce: Buffer.from("0123456789ab"),
    tag: Buffer.from("fedcba9876543210"),
    ciphertext: input.ciphertext,
    wrappedKey: Buffer.from("a-key-as-KMS-wrapped-it"),
    expiresAt: input.expiresAt,
  };
}

beforeAll(async () => {
  if (!HAVE_REDIS) return;
  client = new Redis(URL_, { enableOfflineQueue: false });
  cache = new RedisEnvelopeCache({ url: URL_, client, prefix: "aas:test:" });
  await cache.ready();
  const keys = await client.keys("aas:test:*");
  if (keys.length > 0) await client.del(...keys);
});

afterAll(async () => {
  if (!HAVE_REDIS) return;
  const keys = await client.keys("aas:test:*");
  if (keys.length > 0) await client.del(...keys);
  await client.quit().catch(() => undefined);
});

describeIfRedis("the shared envelope cache", () => {
  it("round-trips an envelope byte for byte", () => {
    const envelope = envelopeOf({
      ciphertext: Buffer.from([0, 1, 2, 255, 254, 0, 0, 7]),
      expiresAt: new Date("2026-09-03T12:00:00.000Z"),
    });
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    expect(decoded.nonce.equals(envelope.nonce)).toBe(true);
    expect(decoded.tag.equals(envelope.tag)).toBe(true);
    // Embedded NULs and high bytes included: a base64-through-JSON encoding is
    // where those get lost, which is why this is framed binary.
    expect(decoded.ciphertext.equals(envelope.ciphertext)).toBe(true);
    expect(decoded.wrappedKey.equals(envelope.wrappedKey)).toBe(true);
    expect(decoded.expiresAt.getTime()).toBe(envelope.expiresAt.getTime());
  });

  it("refuses to decode anything it did not write", () => {
    expect(() => decodeEnvelope(Buffer.from([1, 2, 3]))).toThrow(/truncated/);
    const good = encodeEnvelope(
      envelopeOf({ ciphertext: Buffer.from("abc"), expiresAt: new Date(Date.now() + 60_000) }),
    );
    expect(() => decodeEnvelope(good.subarray(0, good.length - 1))).toThrow(/disagrees/);
  });

  it("puts and takes, and the take REMOVES", async () => {
    const envelope = envelopeOf({
      ciphertext: Buffer.from("the-ciphertext"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await cache.put("k1", envelope);

    const taken = await cache.take("k1", new Date());
    expect(taken?.ciphertext.toString()).toBe("the-ciphertext");
    // Single use. The vault's whole contract depends on this.
    expect(await cache.take("k1", new Date())).toBeNull();
  });

  it("is taken by exactly ONE of two racing callers", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property that made `GETDEL` the right command rather than a GET and
    // a DEL. Two fill agents polling the same handle must not both be told
    // they may type a student's password into a portal.
    // ═══════════════════════════════════════════════════════════════════
    await cache.put(
      "race",
      envelopeOf({ ciphertext: Buffer.from("once"), expiresAt: new Date(Date.now() + 60_000) }),
    );
    const now = new Date();
    const results = await Promise.all([
      cache.take("race", now),
      cache.take("race", now),
      cache.take("race", now),
      cache.take("race", now),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("holds NO PLAINTEXT, read from the bytes Redis actually stored", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Asserted against the server's own copy rather than against a type. What
    // Redis holds is ciphertext, a nonce, a GCM tag and a data key wrapped
    // under KMS — and unwrapping it is an API call this cache cannot make.
    // ═══════════════════════════════════════════════════════════════════
    const password = "Tr0ub4dor-and-3-HORSE-battery!";
    await cache.put(
      "scan",
      envelopeOf({
        // What the vault would have put here: the encrypted form, never the
        // password. The test states that by constructing it that way.
        ciphertext: Buffer.from("ENCRYPTED-BYTES-NOT-THE-PASSWORD"),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const stored = await client.getBuffer("aas:test:scan");
    expect(stored).not.toBeNull();
    expect(stored?.toString("binary")).not.toContain(password);
    await cache.drop("scan");
    expect(await client.exists("aas:test:scan")).toBe(0);
  });

  it("refuses an envelope whose time has passed, against the INJECTED clock", async () => {
    // The server would expire it too, but the injected comparison is what keeps
    // this implementation's semantics identical to the in-memory one — and a
    // clock disagreement between this process and the server must not be the
    // thing that decides whether a credential may be spent.
    const expiresAt = new Date(Date.now() + 60_000);
    await cache.put("clock", envelopeOf({ ciphertext: Buffer.from("x"), expiresAt }));
    const later = new Date(expiresAt.getTime() + 1);
    expect(await cache.take("clock", later)).toBeNull();
    // And it is gone regardless, exactly as the in-memory cache drops it.
    expect(await client.exists("aas:test:clock")).toBe(0);
  });

  it("lets the SERVER expire an entry nobody ever asks for", async () => {
    await cache.put(
      "ttl",
      envelopeOf({ ciphertext: Buffer.from("x"), expiresAt: new Date(Date.now() + 120) }),
    );
    expect(await client.exists("aas:test:ttl")).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await client.exists("aas:test:ttl"), "the TTL is the server's, not a sweep's").toBe(0);
  });

  it("does not store an envelope that has ALREADY expired", async () => {
    await cache.put(
      "stale",
      envelopeOf({ ciphertext: Buffer.from("x"), expiresAt: new Date(Date.now() - 1_000) }),
    );
    expect(await client.exists("aas:test:stale")).toBe(0);
  });

  it("passes verify() against a correctly configured server", async () => {
    await expect(cache.verify()).resolves.toBeUndefined();
  });

  it("REFUSES a server that would evict under memory pressure", async () => {
    // `secure-plane-deployment.md` §3.2: silent eviction looks to a student like
    // a spontaneous cancellation, and a security control that fails quietly is
    // not one. Changed on the real server and put back afterwards.
    const before = await client.config("GET", "maxmemory-policy");
    await client.config("SET", "maxmemory-policy", "allkeys-lru");
    try {
      await expect(cache.verify()).rejects.toThrow(CacheUnsafeError);
      await expect(cache.verify()).rejects.toThrow(/spontaneous cancellation/);
    } finally {
      await client.config("SET", "maxmemory-policy", before[1] ?? "noeviction");
    }
    await expect(cache.verify(), "and it passes again once put back").resolves.toBeUndefined();
  });

  it("REFUSES a server that would write ciphertext to disk", async () => {
    const before = await client.config("GET", "appendonly");
    await client.config("SET", "appendonly", "yes");
    try {
      await expect(cache.verify()).rejects.toThrow(/must not reach disk/);
    } finally {
      await client.config("SET", "appendonly", before[1] ?? "no");
    }
  });
});
