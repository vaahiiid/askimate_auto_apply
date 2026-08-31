/**
 * The confirmed profile, across a process restart. ADR-0044.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `docs/durable-execution-architecture.md` §12 flagged this when durable runs
 * were designed: *"`ConfirmedProfile` is not reconstructible from the event log
 * by existing design … This needs your decision — it is a change to what the
 * event log is for."* It was decided rather than assumed, and the answer is
 * here: the log keeps recording that a confirmation happened, and the value
 * lives in a store of its own.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the rehydration is in THIS package ────────────────────────────────
 *
 * `applyConfirmation` is the only mint for a `ConfirmedValue` (ADR-0004), and
 * `scripts/check-boundaries.ts` enforces that by forbidding `as ConfirmedValue`
 * anywhere outside `packages/profile/src/`. That rule is package-scoped, so
 * rehydration belongs here — beside the mint, under the same rule. Putting it
 * in a service would have meant widening the rule or casting outside it, and
 * both are worse than one more function in the package that already carries the
 * guarantee.
 *
 * What rehydration is NOT: a second mint. It does not construct a value that
 * nobody confirmed. It round-trips one that `applyConfirmation` already made,
 * with the provenance it was made with — so a rehydrated value carries the same
 * "the student said this, at this time, and corrected it or did not" that the
 * original did.
 */

import type { ConfirmationProvenance, ConfirmedValue } from "@askimate/aas-domain";

import type { ConfirmedProfile } from "./profile.js";
import type { ProfileFieldKey } from "./fields.js";

/**
 * One stored entry, in a shape a database column can hold.
 *
 * `value` is the tagged JSON below rather than a string, because a profile
 * holds dates (`identity.date_of_birth`) and a plain JSON round-trip loses
 * them silently.
 */
export interface StoredProfileEntry {
  readonly key: ProfileFieldKey;
  /** Tagged JSON. See `encodeValue`. */
  readonly value: unknown;
  readonly provenance: ConfirmationProvenance;
  /** 1 for the first confirmation, higher after a correction. */
  readonly revision: number;
}

/**
 * Where confirmed values live between requests.
 *
 * A PORT. The Conversation Plane implements it over its own database
 * (ADR-0044); a test implements it in memory. What the port guarantees, and
 * what the contract suite checks of every implementation: a saved entry comes
 * back with its value AND its provenance intact, a Date comes back as a Date,
 * and saving the same key twice keeps the later value with a higher revision.
 */
export interface ConfirmedProfileStore {
  /** Every confirmed entry for a student. An empty profile when there are none. */
  load(studentId: string, now: Date): Promise<ConfirmedProfile>;
  /** Writes one entry. Overwrites the key, bumping its revision. */
  save(studentId: string, entry: StoredProfileEntry): Promise<void>;
}

// ───────────────────────────────────────────────────────────────────────────
// Serialisation
// ───────────────────────────────────────────────────────────────────────────

/**
 * The wrapper. `$`-prefixed because no profile field starts with one.
 *
 * ── Written twice, and the reason is a dependency direction ───────────────
 *
 * `packages/case-store/src/serialisation.ts` does exactly this for case events,
 * and it is not shared. `packages/case-store` depends on `pg`, and this package
 * is the one place a `ConfirmedValue` is minted — a dependency from here to
 * there would put a database driver in the package the whole branded-type
 * guarantee rests on.
 *
 * `packages/profile/src/persistence.test.ts` asserts both encoders round-trip a
 * `Date` identically, so writing it twice stays safe.
 */
const DATE_TAG = "$date";

function isTaggedDate(value: unknown): value is { readonly [DATE_TAG]: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[DATE_TAG] === "string"
  );
}

/**
 * Encodes a confirmed value for storage.
 *
 * Walks the structure rather than using a `JSON.stringify` replacer: a replacer
 * receives the value AFTER `Date.prototype.toJSON` has already turned it into a
 * string, by which point the type information is gone.
 */
export function encodeValue(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (Array.isArray(value)) return value.map((item: unknown) => encodeValue(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([field, item]) => [
        field,
        encodeValue(item),
      ]),
    );
  }
  return value;
}

/** Decodes a stored value, restoring every tagged `Date`. */
export function decodeValue(stored: unknown): unknown {
  if (isTaggedDate(stored)) return new Date(stored[DATE_TAG]);
  if (Array.isArray(stored)) return stored.map((item: unknown) => decodeValue(item));
  if (typeof stored === "object" && stored !== null) {
    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>).map(([field, item]) => [
        field,
        decodeValue(item),
      ]),
    );
  }
  return stored;
}

/**
 * Turns a profile's entry into something storable.
 *
 * Takes the `ConfirmedValue` apart into the two things a row needs — the value
 * and its provenance — and nothing else. There is no third thing: a
 * `ConfirmedValue` IS a value with a provenance, and if that ever stops being
 * true this function stops compiling, which is the right place to find out.
 */
export function toStoredEntry(
  key: ProfileFieldKey,
  entry: { readonly value: ConfirmedValue<unknown>; readonly revision: number },
): StoredProfileEntry {
  const held = entry.value as unknown as {
    readonly value: unknown;
    readonly provenance: ConfirmationProvenance;
  };
  return {
    key,
    value: encodeValue(held.value),
    provenance: held.provenance,
    revision: entry.revision,
  };
}

/**
 * A provenance, with its timestamp back as a `Date`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The value half of an entry goes through `encodeValue`/`decodeValue`, which
 * tag a `Date` so it survives JSON. The PROVENANCE half did not, and it holds
 * one: `confirmedAt`. So a profile read back from the database carried a
 * provenance whose `confirmedAt` was a string that claimed to be a Date, and
 * every caller doing arithmetic on it — or calling `.toISOString()` — got a
 * `TypeError` at runtime and nothing at compile time.
 *
 * Found by wiring a fill plan across a wire, where the provenance is serialised
 * a second time. It was wrong before that and everywhere else too.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function decodeProvenance(provenance: ConfirmationProvenance): ConfirmationProvenance {
  const at: unknown = provenance.confirmedAt;
  if (at instanceof Date) return provenance;
  // A string, or a `$date` tag if it went through `encodeValue` on the way in.
  const decoded: unknown = typeof at === "string" ? new Date(at) : decodeValue(at);
  return {
    ...provenance,
    confirmedAt: decoded instanceof Date ? decoded : new Date(String(at)),
  };
}

/**
 * Reassembles ONE `ConfirmedValue` from its two halves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0046. THE mint, extracted so that `rehydrateProfile` is no longer the
 * only thing that needs it: a fill plan crossing to the Automation Runner has
 * to be rebuilt on the other side, and `packages/mapping` owns `FillPlan` but
 * may not cast to `ConfirmedValue`.
 *
 * So the cast stays here, in the package that owns the type, and `mapping`
 * composes plans out of values this function returns. The boundary rule in
 * `scripts/check-boundaries.ts` is unchanged: `as ConfirmedValue` still appears
 * in exactly one package.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Invent a provenance. It takes one, and a caller with nothing to pass has
 * nothing to call this with — which is the difference between rebuilding a
 * value the student confirmed and manufacturing one nobody did. Every caller
 * gets its provenance from something the student actually did: a stored profile
 * row, or a plan built from one.
 */
export function rehydrateConfirmed<T>(input: {
  readonly value: T;
  readonly provenance: ConfirmationProvenance;
}): ConfirmedValue<T> {
  return {
    value: input.value,
    provenance: input.provenance,
  } as unknown as ConfirmedValue<T>;
}

/**
 * Rebuilds a profile from stored entries.
 *
 * THE ONE CAST, and it is in the package that owns the mint. It reassembles a
 * `ConfirmedValue` from the two halves `toStoredEntry` took apart — the same
 * value, with the same provenance, confirmed by the same student at the same
 * time. Nothing is invented: a row that was never written produces no entry,
 * and `resolveField` answers `not_collected` exactly as it does for a profile
 * that was never saved.
 */
export function rehydrateProfile(input: {
  readonly studentId: string;
  readonly entries: readonly StoredProfileEntry[];
  readonly updatedAt: Date;
}): ConfirmedProfile {
  const entries = new Map<
    ProfileFieldKey,
    { readonly value: ConfirmedValue<unknown>; readonly revision: number }
  >();
  for (const stored of input.entries) {
    entries.set(stored.key, {
      value: rehydrateConfirmed({
        value: decodeValue(stored.value),
        provenance: decodeProvenance(stored.provenance),
      }),
      revision: stored.revision,
    });
  }
  return {
    studentId: input.studentId as ConfirmedProfile["studentId"],
    entries: entries,
    updatedAt: input.updatedAt,
  };
}

/**
 * A store that keeps everything in one process. Tests and development.
 *
 * Correct, and NOT what ADR-0044 specifies for production: two service
 * instances do not share it, which is the same failure `InMemorySecretStore`
 * had and the reason the vault stopped being one.
 */
export class InMemoryConfirmedProfileStore implements ConfirmedProfileStore {
  readonly #entries = new Map<string, Map<ProfileFieldKey, StoredProfileEntry>>();

  public load(studentId: string, now: Date): Promise<ConfirmedProfile> {
    const held = this.#entries.get(studentId);
    return Promise.resolve(
      rehydrateProfile({
        studentId,
        entries: held === undefined ? [] : [...held.values()],
        updatedAt: now,
      }),
    );
  }

  public save(studentId: string, entry: StoredProfileEntry): Promise<void> {
    const held = this.#entries.get(studentId) ?? new Map<ProfileFieldKey, StoredProfileEntry>();
    held.set(entry.key, entry);
    this.#entries.set(studentId, held);
    return Promise.resolve();
  }
}
