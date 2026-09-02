/**
 * The identity of a page's CONTENT (ADR-0051 §6, amending ADR-0047 §1).
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * An `advance_portal_page` intent used to be keyed on the page alone, and so
 * the ledger could say "page one was saved" but never "was the CORRECTED value
 * written?". A student who fixes a date after the page is filled must have the
 * page offered again, and the only thing that can make that true is a target
 * that changes when the content changes.
 *
 * These are pure unit tests rather than another journey assertion, deliberately.
 * The journey proves the target reaches the ledger; it cannot prove the target
 * is STABLE, because it computes it once. Stability is a property of the
 * function, and the mutation that removes the `.sort()` survives every
 * integration test in the repository — both sides happen to walk fields in the
 * same order today, and would stop the moment `planFill` or `StoredFillPlan`
 * changed how they iterate.
 */

import { describe, expect, it } from "vitest";

import { pageFillTarget } from "./run.js";

const VALUES = [
  { fieldRef: "given_name", text: "Niloofar" },
  { fieldRef: "family_name", text: "Ahmadi" },
  { fieldRef: "date_of_birth", text: "2001-03-14" },
];

describe("pageFillTarget — one intent per page VERSION", () => {
  it("names the page, so a person can still read it", () => {
    expect(pageFillTarget({ pageRef: "page-application", values: VALUES })).toMatch(
      /^page-application@sha256:[0-9a-f]{64}$/,
    );
  });

  it("does not depend on the ORDER the values arrive in", () => {
    // The Application Plane holds a `FillPlan` and the lease payload holds a
    // `StoredFillPlan`. Instruction order is an artefact of how each was built.
    // A target that differed between them would complete an intent for content
    // nobody typed — the page would be marked done having never been filled.
    const forward = pageFillTarget({ pageRef: "page-application", values: VALUES });
    const reversed = pageFillTarget({ pageRef: "page-application", values: [...VALUES].reverse() });
    const shuffled = pageFillTarget({
      pageRef: "page-application",
      values: [VALUES[1]!, VALUES[2]!, VALUES[0]!],
    });

    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it("CHANGES when a single value changes", () => {
    // The whole point. A correction must not complete the intent the
    // uncorrected page opened.
    const before = pageFillTarget({ pageRef: "page-application", values: VALUES });
    const after = pageFillTarget({
      pageRef: "page-application",
      values: [VALUES[0]!, VALUES[1]!, { fieldRef: "date_of_birth", text: "2001-03-03" }],
    });

    expect(after).not.toBe(before);
  });

  it("distinguishes a value that MOVED from one field to another", () => {
    // `given_name=A family_name=B` and `given_name=B family_name=A` are
    // different applications. Concatenating the texts alone would call them the
    // same, which is why the pair is hashed and not just the value.
    const one = pageFillTarget({
      pageRef: "page-application",
      values: [
        { fieldRef: "given_name", text: "Ahmadi" },
        { fieldRef: "family_name", text: "Niloofar" },
      ],
    });
    const other = pageFillTarget({
      pageRef: "page-application",
      values: [
        { fieldRef: "given_name", text: "Niloofar" },
        { fieldRef: "family_name", text: "Ahmadi" },
      ],
    });

    expect(one).not.toBe(other);
  });

  it("keeps two pages apart even when they hold the same content", () => {
    const first = pageFillTarget({ pageRef: "page-application", values: VALUES });
    const second = pageFillTarget({ pageRef: "page-study", values: VALUES });

    expect(first).not.toBe(second);
  });

  it("is stable across calls, so a resumed run recomputes the same intent", () => {
    expect(pageFillTarget({ pageRef: "page-application", values: VALUES })).toBe(
      pageFillTarget({ pageRef: "page-application", values: VALUES }),
    );
  });
});
