/**
 * A decided blocker is not written up as a dependency.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-09-10. Vahid, reading P61's report: *"you wrote 'The runner's fetch,
 * which waits on B5.' B5 was answered on 2026-09-07 — hold, option A … Either
 * that is a stale reference of the shape this repository has found eleven
 * times running, or there is a dependency I have lost track of. Check which,
 * and say plainly."*
 *
 * It was stale. Five places — two ADRs, a provisioning request, the
 * reachability register, and a "not built" bullet in the state document —
 * said a thing "waits on" or "is blocked on" B5, a blocker decided three days
 * earlier and recorded as decided in the same register two entries down.
 *
 * ── What this guards, and what it does not ────────────────────────────────
 *
 * The shape is specific: a DECIDED blocker named in DEPENDENCY framing. Both
 * halves are needed. Mentioning B5 is fine — "B5 is decided", "B5's answer no
 * longer conditions it" — and "waits on" is fine of an open blocker. The
 * combination is the stale record, and it is a combination a grep can find.
 *
 * Scanned: the records that describe the present — ADRs, the provisioning
 * requests, the state document, the README, the reachability register. NOT
 * scanned: the journal (`where-we-are.md`) and the changelog, which record
 * what was true at the time and are supposed to say "blocked on B5" in an
 * entry from before it was decided; and the decision sheets, which are the
 * options as they stood before the decision.
 *
 * The decided set is DATA in this file, with the record that decided each.
 * Adding a blocker here is the visible act of it being decided; a phrase
 * that then calls it pending fails here rather than in a report.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(join(import.meta.dirname, ".."));

/** Blockers Vahid has decided, and where. Only these are checked. */
const DECIDED: readonly { readonly id: string; readonly record: string }[] = [
  { id: "B1", record: "ADR-0078 (2026-09-07) — the twelve periods" },
  { id: "B2", record: "ADR-0087 (2026-09-08) — the four determinations" },
  { id: "B5", record: "ADR-0078 (2026-09-07) — A, hold and reuse" },
];

/** Dependency framing. Deliberately narrow: the shape found, not every mention. */
const FRAMING =
  /\b(waits? (on|for|until)|blocked on|blocks? on|leav(?:es|ing) its hold|pending|until)\b[^.\n]{0,60}?\bB(1|2|5)\b/gi;

/** A match that is really a statement of decision, not of dependency. */
const DECIDED_CONTEXT = /\b(decided|DECIDED|answered|no longer conditions|does not condition|was decided|is decided)\b/;

function scanned(): readonly string[] {
  const decisions = readdirSync(join(ROOT, "docs", "decisions"))
    .filter((name) => /^00(7[8-9]|[89]\d)-.*\.md$/.test(name))
    .map((name) => join("docs", "decisions", name));
  const requests = readdirSync(join(ROOT, "docs"))
    .filter((name) => name.startsWith("provisioning-request-") && name.endsWith(".md"))
    .map((name) => join("docs", name));
  return [
    ...decisions,
    ...requests,
    "docs/state-of-the-system.md",
    "README.md",
    "scripts/check-reachability.ts",
  ];
}

describe("a decided blocker is not written up as a dependency", () => {
  it("names no decided blocker in waits-on, blocked-on or until framing", () => {
    const offending: string[] = [];
    for (const file of scanned()) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const match of text.matchAll(FRAMING)) {
        const id = `B${match[3] ?? ""}`;
        if (!DECIDED.some((d) => d.id === id)) continue;
        // The sentence around the match. A statement that the blocker IS
        // decided is allowed to contain the word "until" or "blocked".
        const start = text.lastIndexOf("\n", match.index) + 1;
        const end = text.indexOf("\n", match.index + match[0].length);
        const line = text.slice(start, end === -1 ? undefined : end);
        if (DECIDED_CONTEXT.test(line)) continue;
        const lineNumber = text.slice(0, match.index).split("\n").length;
        offending.push(`${file}:${String(lineNumber)}: "${match[0]}"`);
      }
    }
    expect(
      offending,
      "these present a DECIDED blocker as something still waited on. Either the blocker was " +
        "re-opened (record that, in Vahid's words) or the reference is stale (say what actually " +
        "gates the thing). Decided: " +
        DECIDED.map((d) => `${d.id} — ${d.record}`).join("; "),
    ).toEqual([]);
  });

  it("is looking at the records it claims to", () => {
    // The vacuity guard: a scan of nothing finds nothing.
    const files = scanned();
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("scripts/check-reachability.ts");
    expect(files).toContain("docs/state-of-the-system.md");
    expect(files.some((f) => f.includes("/0078-"))).toBe(true);
  });

  it("would have caught the five stale references of 2026-09-10", () => {
    // The phrases exactly as they were written, so the pattern is checked
    // against the finding rather than against itself.
    const stale = [
      "nothing calls it until `attach_document` leaves its hold (B5) and the runner fetches",
      "a retrieval URL, which waits on `attach_document` (B5). Both are in the register",
      "the runner's fetch of a retrieval URL, which waits on `attach_document` (B5).",
      "is `attach_document` leaving its hold (B5) and the runner fetching the retrieval URL",
      "storage, no `documents` table. Blocked on B5.",
    ];
    for (const phrase of stale) {
      expect([...phrase.matchAll(FRAMING)].length, phrase).toBeGreaterThan(0);
    }
    // And the corrected forms pass.
    const fine = [
      "B5 is decided (A, hold and reuse, ADR-0078, 2026-09-07) and does not condition it",
      "Me — unblocked, and B5's answer no longer conditions it",
      "B5 is DECIDED (A — hold, 2026-09-07). What is left is the attachment intent identity",
    ];
    for (const phrase of fine) {
      const hits = DECIDED_CONTEXT.test(phrase) ? [] : [...phrase.matchAll(FRAMING)];
      expect(hits, phrase).toEqual([]);
    }
  });
});
