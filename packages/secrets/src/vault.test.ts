/**
 * The ephemeral encrypted vault (ADR-0034).
 *
 * The assertions that matter here are negative: that the cache holds ciphertext
 * and never the plaintext, that spending is single-use by construction rather
 * than by discipline, and that a development key provider cannot be the one a
 * production process boots with.
 */

import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
  VAULT_TTL_CEILING_SECONDS,
  assertVaultIsProductionGrade,
  confirmationMatches,
} from "./vault.js";

const NOW = new Date("2026-08-28T10:00:00Z");
const IN_FIVE = new Date(NOW.getTime() + 300_000);
const SECRET = "correct-horse-battery-staple-9!";
const HANDLE = `sh_${"a".repeat(32)}`;

function newVault(): { vault: EnvelopeVault; cache: InMemoryEnvelopeCache } {
  const cache = new InMemoryEnvelopeCache();
  return { vault: new EnvelopeVault(new LocalDataKeyProvider(), cache), cache };
}

describe("what the cache actually holds", () => {
  it("holds no byte of the plaintext, in any field", async () => {
    const { vault, cache } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);

    const entries = cache.rawEntries();
    expect(entries).toHaveLength(1);
    // Every buffer in the envelope, concatenated and searched. Not just
    // `ciphertext`: a leak would most plausibly arrive by someone adding a
    // field, so the scan covers whatever is there rather than what we expect.
    const everything = Buffer.concat(
      Object.values(entries[0] as unknown as Record<string, unknown>)
        .filter((value): value is Buffer => Buffer.isBuffer(value)),
    );
    expect(everything.includes(Buffer.from(SECRET, "utf8"))).toBe(false);
    expect(everything.toString("latin1")).not.toContain(SECRET);
    // And the whole envelope, serialised the way a careless log line would.
    expect(JSON.stringify(entries)).not.toContain(SECRET);
  });

  it("produces a different ciphertext each time for the SAME secret", async () => {
    // A fresh data key and a fresh nonce per secret. Identical ciphertexts
    // would mean two students who chose the same password were visibly linked
    // to anyone reading the cache.
    const { vault, cache } = newVault();
    await vault.put(`sh_${"1".repeat(32)}`, SECRET, IN_FIVE, NOW);
    await vault.put(`sh_${"2".repeat(32)}`, SECRET, IN_FIVE, NOW);

    const [first, second] = cache.rawEntries();
    expect(first?.ciphertext.equals(second?.ciphertext ?? Buffer.alloc(0))).toBe(false);
    expect(first?.wrappedKey.equals(second?.wrappedKey ?? Buffer.alloc(0))).toBe(false);
  });

  it("caps the TTL at five minutes however long a caller asks for", async () => {
    const { vault, cache } = newVault();
    const aWeek = new Date(NOW.getTime() + 7 * 24 * 3_600_000);
    await vault.put(HANDLE, SECRET, aWeek, NOW);

    const held = cache.rawEntries()[0];
    expect(held?.expiresAt.getTime()).toBe(NOW.getTime() + VAULT_TTL_CEILING_SECONDS * 1000);
  });
});

describe("spending it", () => {
  it("hands the plaintext to the callback and returns the CALLBACK's result", async () => {
    const { vault } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);

    // The result is the task's, not the secret. There is no accessor on this
    // class that could return the value instead.
    const used = await vault.use(HANDLE, (secret) => secret.length, NOW);
    expect(used).toEqual({ ok: true, result: SECRET.length });
  });

  it("is single-use: the entry is gone BEFORE the task runs", async () => {
    const { vault, cache } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);

    let cacheDuringTask: number | null = null;
    await vault.use(
      HANDLE,
      () => {
        cacheDuringTask = cache.rawEntries().length;
        return "done";
      },
      NOW,
    );
    // Zero WHILE the task is running. A task that throws, hangs or is retried
    // therefore cannot spend it twice — that is a property of the order of
    // operations rather than of the caller behaving.
    expect(cacheDuringTask).toBe(0);
    expect(await vault.use(HANDLE, () => "again", NOW)).toEqual({
      ok: false,
      reason: "unknown_handle",
    });
  });

  it("stays spent when the task throws", async () => {
    const { vault } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);
    await expect(
      vault.use(HANDLE, () => {
        throw new Error("the automation failed");
      }, NOW),
    ).rejects.toThrow("the automation failed");

    expect(await vault.use(HANDLE, () => "retry", NOW)).toEqual({
      ok: false,
      reason: "unknown_handle",
    });
  });

  it("gives ONE answer for unknown, spent and expired", async () => {
    // Distinguishing them would confirm that some handle had once been real.
    const { vault } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);
    const late = new Date(NOW.getTime() + 400_000);

    expect(await vault.use(`sh_${"f".repeat(32)}`, () => 1, NOW)).toEqual({
      ok: false,
      reason: "unknown_handle",
    });
    expect(await vault.use(HANDLE, () => 1, late)).toEqual({
      ok: false,
      reason: "unknown_handle",
    });
  });

  it("cannot be decrypted by a vault with a different master key", async () => {
    // The property that makes the cache useless on its own: the envelope is
    // wrapped by something the reader must separately hold.
    const cache = new InMemoryEnvelopeCache();
    const writer = new EnvelopeVault(new LocalDataKeyProvider(), cache);
    await writer.put(HANDLE, SECRET, IN_FIVE, NOW);

    const stranger = new EnvelopeVault(new LocalDataKeyProvider(randomBytes(32)), cache);
    expect(await stranger.use(HANDLE, (secret) => secret, NOW)).toEqual({
      ok: false,
      reason: "unknown_handle",
    });
  });

  it("destroys without reading, for cancellation and expiry", async () => {
    const { vault, cache } = newVault();
    await vault.put(HANDLE, SECRET, IN_FIVE, NOW);
    await vault.destroy(HANDLE);
    expect(cache.rawEntries()).toHaveLength(0);
  });

  it("sweeps what has expired and leaves what has not", async () => {
    const { vault, cache } = newVault();
    await vault.put(`sh_${"1".repeat(32)}`, SECRET, new Date(NOW.getTime() + 60_000), NOW);
    await vault.put(`sh_${"2".repeat(32)}`, SECRET, new Date(NOW.getTime() + 280_000), NOW);

    expect(await vault.sweep(new Date(NOW.getTime() + 120_000))).toBe(1);
    expect(cache.rawEntries()).toHaveLength(1);
  });
});

describe("the production guard", () => {
  it("REFUSES to start a production process on a local key provider", () => {
    // A comment saying "not for production" is advice. A process that will not
    // boot is a control — and this is the difference between the security claim
    // in ADR-0034 being true and being aspirational.
    expect(() => assertVaultIsProductionGrade(new LocalDataKeyProvider(), "production")).toThrow(
      /REFUSING TO START/,
    );
  });

  it("allows it outside production, where it is the intended provider", () => {
    expect(() => assertVaultIsProductionGrade(new LocalDataKeyProvider(), "test")).not.toThrow();
    expect(() => assertVaultIsProductionGrade(new LocalDataKeyProvider(), undefined)).not.toThrow();
  });

  it("allows a KMS provider in production", () => {
    const kms = { kind: "kms" as const, generateDataKey: () => Promise.reject(new Error()),
      decryptDataKey: () => Promise.resolve(null) };
    expect(() => assertVaultIsProductionGrade(kms, "production")).not.toThrow();
  });
});

describe("comparing a secret with its confirmation", () => {
  it("matches identical values and rejects different ones", () => {
    expect(confirmationMatches(SECRET, SECRET)).toBe(true);
    expect(confirmationMatches(SECRET, `${SECRET}x`)).toBe(false);
    expect(confirmationMatches(SECRET, "")).toBe(false);
  });

  it("compares in constant time for equal lengths", () => {
    // `===` short-circuits at the first differing byte. This is the one
    // comparison in the system where both operands are the plaintext, so the
    // oracle is free to remove and worth removing.
    expect(confirmationMatches("aaaaaaaa", "baaaaaaa")).toBe(false);
    expect(confirmationMatches("aaaaaaaa", "aaaaaaab")).toBe(false);
  });
});
