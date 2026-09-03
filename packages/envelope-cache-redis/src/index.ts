/**
 * @askimate/aas-envelope-cache-redis — the shared ciphertext cache (ADR-0034).
 *
 * A SEPARATE package rather than a file inside `@askimate/aas-secrets`, and the
 * reason is the one `check-boundaries.ts` gives for keeping Playwright out of
 * the Secure Service: the vault package holds the only plaintext in the system,
 * and every dependency in its tree is a supply-chain path to it. A Redis client
 * is a reasonable dependency for the two processes that need one; it is not a
 * reasonable dependency for `packages/domain` to inherit through the vault.
 */

export type { RedisEnvelopeCacheOptions } from "./redis-cache.js";
export { CacheUnsafeError, RedisEnvelopeCache, decodeEnvelope, encodeEnvelope } from "./redis-cache.js";
