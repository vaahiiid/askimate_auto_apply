/**
 * The confirmed profile, across a restart. ADR-0044.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The property that matters is not "a row round-trips". It is that a REHYDRATED
 * value is indistinguishable from the one `applyConfirmation` minted — same
 * value, same provenance, same answer from `resolveField`. A store that lost
 * the provenance would produce a value nobody confirmed, which is the one thing
 * ADR-0004 exists to prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed, provenanceOf } from "@askimate/aas-domain";
import { encodeEvent, decodeEvent } from "@askimate/aas-case-store/serialisation";
import type { CaseEvent } from "@askimate/aas-domain";

import { applyConfirmation, isDeclined } from "./confirmation.js";
import {
  InMemoryConfirmedProfileStore,
  decodeValue,
  encodeValue,
  rehydrateProfile,
  toStoredEntry,
} from "./persistence.js";
import { confirmField, emptyProfile, resolveField } from "./profile.js";

const NOW = new Date("2026-08-31T10:00:00Z");
const STUDENT = studentId("student-1");
const BIRTHDAY = new Date("1999-04-02T00:00:00Z");

/** A profile with a string and a Date in it, both properly confirmed. */
function confirmed(): ReturnType<typeof emptyProfile> {
  let profile = emptyProfile(STUDENT, NOW);

  const name = applyConfirmation({
    key: "identity.given_name",
    proposed: proposeValue({ value: "Niloofar", origin: "conversation", verbatim: "Niloofar", confidence: 1 }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: NOW,
    },
  });
  if (isDeclined(name)) expect.unreachable("the confirmation was accepted");
  profile = confirmField(profile, name, NOW);

  const dob = applyConfirmation({
    key: "identity.date_of_birth",
    proposed: proposeValue({ value: BIRTHDAY, origin: "conversation", verbatim: "2 April 1999", confidence: 1 }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: NOW,
    },
  });
  if (isDeclined(dob)) expect.unreachable("the confirmation was accepted");
  return confirmField(profile, dob, NOW);
}

describe("a rehydrated value is the value that was confirmed", () => {
  it("round-trips the value AND its provenance", () => {
    const profile = confirmed();
    const stored = [...profile.entries].map(([key, entry]) => toStoredEntry(key, entry));

    const rebuilt = rehydrateProfile({ studentId: STUDENT, entries: stored, updatedAt: NOW });

    const name = resolveField(rebuilt, "identity.given_name");
    expect(unwrapConfirmed(name as never)).toBe("Niloofar");
    // The provenance is the half a careless store loses, and losing it produces
    // a value nobody confirmed.
    expect(provenanceOf(name as never).source).toBe("student_stated");
    expect(provenanceOf(name as never).confirmedAt).toEqual(NOW);
  });

  it("brings a Date back as a Date, not as a string", () => {
    // The silent defect: `JSON.parse(JSON.stringify(profile))` typechecks,
    // passes a shallow equality test, and then throws the first time anything
    // calls `.getTime()` — which the minor-detection safeguard does.
    const profile = confirmed();
    const stored = [...profile.entries].map(([key, entry]) => toStoredEntry(key, entry));
    const rebuilt = rehydrateProfile({ studentId: STUDENT, entries: stored, updatedAt: NOW });

    const dob = unwrapConfirmed(resolveField(rebuilt, "identity.date_of_birth") as never);
    expect(dob).toBeInstanceOf(Date);
    expect((dob as Date).getTime()).toBe(BIRTHDAY.getTime());
  });

  it("keeps a field that was never stored unavailable, rather than inventing one", () => {
    const rebuilt = rehydrateProfile({ studentId: STUDENT, entries: [], updatedAt: NOW });
    const missing = resolveField(rebuilt, "identity.given_name");
    expect(missing).toMatchObject({ kind: "field_unavailable", reason: "not_collected" });
  });

  it("preserves the revision, so a correction is still visible as one", () => {
    const profile = confirmed();
    const corrected = applyConfirmation({
      key: "identity.given_name",
      proposed: proposeValue({ value: "Niloofar", origin: "conversation", verbatim: "Niloofar", confidence: 1 }),
      confirmation: {
        studentRef: STUDENT,
        presentedText: "Is that right?",
        response: { kind: "corrected", correctedValue: "Nilufar" },
        respondedAt: NOW,
      },
    });
    if (isDeclined(corrected)) expect.unreachable("the confirmation was corrected");
    const updated = confirmField(profile, corrected, NOW);

    const entry = updated.entries.get("identity.given_name");
    if (entry === undefined) expect.unreachable("the entry should exist");
    const stored = toStoredEntry("identity.given_name", entry);
    expect(stored.revision).toBe(2);
    expect(stored.provenance.source).toBe("student_corrected");

    const rebuilt = rehydrateProfile({ studentId: STUDENT, entries: [stored], updatedAt: NOW });
    expect(unwrapConfirmed(resolveField(rebuilt, "identity.given_name") as never)).toBe("Nilufar");
  });
});

describe("the in-memory store, as the contract every implementation must meet", () => {
  it("returns what was saved, per student", async () => {
    const store = new InMemoryConfirmedProfileStore();
    const profile = confirmed();
    for (const [key, entry] of profile.entries) {
      await store.save(STUDENT, toStoredEntry(key, entry));
    }

    const loaded = await store.load(STUDENT, NOW);
    expect(unwrapConfirmed(resolveField(loaded, "identity.given_name") as never)).toBe("Niloofar");

    // Another student's profile is not this one's. Obvious, and the assertion
    // that would catch a store keying by field alone.
    const other = await store.load("student-2", NOW);
    expect(resolveField(other, "identity.given_name")).toMatchObject({ kind: "field_unavailable" });
  });

  it("overwrites a key rather than accumulating rows for it", async () => {
    const store = new InMemoryConfirmedProfileStore();
    await store.save(STUDENT, {
      key: "contact.email",
      value: "first@example.test",
      provenance: { source: "student_stated", confirmedAt: NOW },
      revision: 1,
    });
    await store.save(STUDENT, {
      key: "contact.email",
      value: "second@example.test",
      provenance: { source: "student_corrected", confirmedAt: NOW },
      revision: 2,
    });
    const loaded = await store.load(STUDENT, NOW);
    expect(unwrapConfirmed(resolveField(loaded, "contact.email") as never)).toBe(
      "second@example.test",
    );
    expect(loaded.entries.size).toBe(1);
  });
});

describe("the two date encoders in this repository agree", () => {
  it("round-trips a Date identically to the case store's", () => {
    // `packages/case-store/src/serialisation.ts` does the same job for case
    // events and is deliberately NOT shared: it depends on `pg`, and this is
    // the package that mints ConfirmedValues. Written twice, so this is what
    // makes writing it twice safe.
    const when = new Date("2026-08-31T09:08:07.006Z");

    const throughProfile = decodeValue(encodeValue({ when, nested: [{ when }] })) as {
      when: Date;
      nested: { when: Date }[];
    };
    expect(throughProfile.when).toBeInstanceOf(Date);
    expect(throughProfile.when.toISOString()).toBe(when.toISOString());
    expect(throughProfile.nested[0]?.when).toBeInstanceOf(Date);

    const event = {
      type: "CaseStateChanged",
      eventId: "e1",
      caseId: "c1",
      sequence: 1,
      occurredAt: when,
      actor: { kind: "system" },
      from: "draft",
      to: "ready",
    } as unknown as CaseEvent;
    const throughCaseStore = decodeEvent(JSON.parse(encodeEvent(event)));
    expect(throughCaseStore.occurredAt).toBeInstanceOf(Date);
    expect(throughCaseStore.occurredAt.toISOString()).toBe(when.toISOString());
  });
});
