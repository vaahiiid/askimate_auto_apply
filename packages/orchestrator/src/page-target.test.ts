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

import type { FillPlan } from "@askimate/aas-mapping";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import { studentId } from "@askimate/aas-domain";
import { emptyProfile } from "@askimate/aas-profile";

import { pageFillTarget, pageValuesOf } from "./run.js";

const STUDENT = studentId("student-p33");
const NOW = new Date("2026-09-06T00:00:00Z");

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

  it("is computed from INSTRUCTIONS ONLY, which uploads are not part of", () => {
    // ═══════════════════════════════════════════════════════════════════
    // Measured in P33, and the fact the document-transport decision rests on.
    //
    // `pageValuesOf` reads `plan.instructions`. `plan.uploads` are not in the
    // target, so the page's content identity is BLIND to which document is
    // attached — replacing a passport does not change the intent key, while
    // `attach_document`'s own comment in the domain says "Duplicates are
    // visible to admissions."
    //
    // That is not a defect in this function: it does exactly what ADR-0051 §6
    // asked of it, for values. It is a gap in what nothing has yet asked of
    // it. Asserted here so that whoever changes it comes to
    // `docs/document-transport-options.md` §5 first, because attachment
    // needing its own intent identity is a conclusion of that document.
    //
    // Built from the REAL fixture rather than a hand-made plan: a
    // `ReviewedConstant` is branded and mintable only from a
    // `UsableMappingSet`, and a cast here would be asserting against a shape
    // `planFill` might never produce.
    // ═══════════════════════════════════════════════════════════════════
    const usable = checkUsable(FIXTURE_MAPPING_SET, FIXTURE_BLUEPRINT);
    if (!usable.usable) expect.unreachable("the fixture mapping set is reviewed");
    const plan = planFill(FIXTURE_BLUEPRINT, usable.mappingSet, emptyProfile(STUDENT, NOW));

    expect(plan.uploads.length, "the fixture really does attach a document").toBeGreaterThan(0);
    const fields = new Set([...plan.instructions, ...plan.uploads].map((one) => one.fieldRef));

    const target = (from: FillPlan): string =>
      pageFillTarget({ pageRef: "page-application", values: pageValuesOf(from, fields) });

    // Removing every upload changes nothing the ledger can see…
    expect(target({ ...plan, uploads: [] })).toBe(target(plan));
    // …and neither does attaching a DIFFERENT document to the same field.
    const swapped: FillPlan = {
      ...plan,
      uploads: plan.uploads.map((upload) => ({ ...upload, documentRef: "something-else" })),
    };
    expect(target(swapped)).toBe(target(plan));
  });
});
