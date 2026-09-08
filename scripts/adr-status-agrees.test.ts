/**
 * An ADR's own status and the index that lists it must say the same thing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P48 held one hand-written document to a checked register. This asks the same
 * question of the two records that describe the DECISIONS themselves, and found
 * the same shape — a listing that had quietly disagreed with the thing it lists
 * since the day both were written.
 *
 * Four of eighty-two disagreed. ADRs 0001 to 0004 each say
 *
 *     **Status:** **Accepted** — approved by Vahid, 2026-08-26
 *
 * and the index said `Proposed` for all four, in EVERY commit since the index
 * existed. The history says exactly how, and it is not a judgement call:
 *
 *   08:05  4ee6b1c  Phase 0. Five ADR files, all "Proposed · awaiting Vahid's
 *                   approval". Index created, all five Proposed. Consistent.
 *   08:47  a27cb60  Phase 1. Commit message: "Phase 0 approved by Vahid on
 *                   2026-08-26. ADRs 0001-0005 moved to Accepted." Flips all
 *                   FIVE files. Does not touch the index.
 *   09:02  8786fff  Edits the index — and moves ONLY 0005's row to Accepted.
 *                   0001 to 0004 are left behind.
 *
 * A partial edit, fifteen minutes later, four rows missed. Six weeks and
 * seventy-eight commits carried it forward, and `state-of-the-system.md` grew a
 * standing blocker — "Accept or revise ADRs 0001–0004 · owner: You" — asking
 * for a decision the record says was already made.
 *
 * That is the direction worth noticing. Every previous finding of this shape
 * had a record claiming MORE than the system did. This one claimed less, and
 * the cost was a person being asked twice.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a check and not just a fix ─────────────────────────────────────────
 *
 * The fix is four cells. The reason it survived six weeks is that nothing
 * compared the two, and nothing would have compared them after the fix either.
 * Both records are hand-written, both are edited in most phases, and the index
 * row is edited by a different hand and at a different moment from the file —
 * which is precisely what happened at 09:02.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(join(import.meta.dirname, ".."));
const DECISIONS = join(ROOT, "docs", "decisions");
const INDEX = join(DECISIONS, "README.md");

/** The statuses an ADR is allowed to be in. A fifth would need a decision. */
const STATUSES = ["Accepted", "Proposed", "Superseded", "Rejected", "Deprecated"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Discrepancies that are recorded rather than resolved, because resolving them
 * is not an engineering call.
 *
 * Empty, and that is the point: it exists so that a future disagreement whose
 * resolution belongs to a person can be declared with its evidence and owner
 * instead of being silently picked — the register pattern ADR-0073 uses for a
 * capability with no caller. An entry here must name what each side says and
 * who decides; a declared entry whose two sides have since come to agree fails
 * as stale, exactly as a reviewed-unreachable entry does when it acquires a
 * caller.
 *
 * ADRs 0001 to 0004 are deliberately NOT here. Their approval is recorded in
 * three independent places — the four files, `a27cb60`'s commit message, and
 * sibling ADR-0005, which was approved in the same sentence and whose index row
 * WAS updated — so the index was the one record disagreeing, and it was wrong.
 * Declaring that contested would have been its own false record.
 */
const CONTESTED: readonly {
  readonly adr: string;
  readonly file: Status;
  readonly index: Status;
  readonly evidence: string;
  readonly decidedBy: string;
}[] = [];

/**
 * A count, spelled the way the index writes it.
 *
 * This began as a hand-written map from 78 to 84, which lasted exactly one ADR:
 * the eighty-fifth failed the check with "no spelling for 85 — add one". A list
 * that must be extended every time the thing it counts grows is the defect the
 * last three phases have been removing, so it is computed.
 */
function inWords(n: number): string | undefined {
  const units = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];
  if (!Number.isInteger(n) || n < 1 || n > 99) return undefined;
  if (n < 20) return units[n];
  const ten = tens[Math.floor(n / 10)] ?? "";
  const unit = units[n % 10] ?? "";
  return unit === "" ? ten : `${ten}-${unit.toLowerCase()}`;
}

function statusIn(text: string): Status | null {
  const withoutEmphasis = text.replace(/\*/g, "");
  const found = STATUSES.find((status) =>
    new RegExp(`\\b${status}\\b`).test(withoutEmphasis),
  );
  return found ?? null;
}

/** Every ADR file, by number, with the status its own first Status line states. */
function fileStatuses(): ReadonlyMap<string, Status | null> {
  const out = new Map<string, Status | null>();
  for (const entry of readdirSync(DECISIONS)) {
    if (!/^\d{4}-.*\.md$/.test(entry)) continue;
    const source = readFileSync(join(DECISIONS, entry), "utf8");
    const line = source.split("\n").find((l) => l.startsWith("**Status:"));
    out.set(basename(entry).slice(0, 4), line === undefined ? null : statusIn(line));
  }
  return out;
}

/** Every row of the index, by number, with the status its third column states. */
function indexStatuses(): ReadonlyMap<string, Status | null> {
  const out = new Map<string, Status | null>();
  const index = readFileSync(INDEX, "utf8");
  for (const match of index.matchAll(/^\| \[(\d{4})\]\([^)]+\) \| (.*?) \| (.*?) \|$/gm)) {
    out.set(match[1] ?? "", statusIn(match[3] ?? ""));
  }
  return out;
}

/**
 * The THIRD record of the same fact: `state-of-the-system.md` §3, "Every ADR,
 * and whether it is still in force".
 *
 * Found by this phase while fixing the other two, and it was wrong in both ways
 * at once — the same four rows said Proposed, and 0081 and 0082 were absent
 * entirely, because P47 and P48 each added a row to the index and not here.
 * Two records are a thing that can drift; three is a thing that will.
 */
function standingAccountStatuses(): ReadonlyMap<string, Status | null> {
  const out = new Map<string, Status | null>();
  const source = readFileSync(join(ROOT, "docs", "state-of-the-system.md"), "utf8");
  for (const match of source.matchAll(/^\| (\d{4}) \| (.*?) \| (.*?) \|$/gm)) {
    out.set(match[1] ?? "", statusIn(match[3] ?? ""));
  }
  return out;
}

const files = fileStatuses();
const rows = indexStatuses();
const standing = standingAccountStatuses();
const contestedNumbers = new Set(CONTESTED.map((c) => c.adr));

describe("an ADR and the index that lists it", () => {
  it("agree on every status", () => {
    const disagreeing = [...files.entries()]
      .filter(([adr]) => !contestedNumbers.has(adr))
      .filter(([adr, status]) => rows.get(adr) !== status)
      .map(([adr, status]) => `ADR-${adr}: file says ${status ?? "?"}, index says ${rows.get(adr) ?? "?"}`);
    expect(
      disagreeing,
      "the ADR file is the decision and the index is a listing of it — a listing that " +
        "disagrees is a false record of what was decided",
    ).toEqual([]);
  });

  it("lists every ADR that exists, and no ADR that does not", () => {
    const unlisted = [...files.keys()].filter((adr) => !rows.has(adr)).sort();
    const phantom = [...rows.keys()].filter((adr) => !files.has(adr)).sort();
    expect(unlisted, "these ADRs exist and the index does not list them").toEqual([]);
    expect(phantom, "the index lists these and no such ADR file exists").toEqual([]);
  });

  it("agrees with the standing account's copy of the same table", () => {
    // `state-of-the-system.md` §3 is the third hand-written record of one fact,
    // and it is the one the README sends a reader to. It carried the same four
    // stale rows, from the same 09:02 edit, for the same six weeks.
    const disagreeing = [...files.entries()]
      .filter(([adr]) => !contestedNumbers.has(adr))
      .filter(([adr, status]) => standing.get(adr) !== status)
      .map(
        ([adr, status]) =>
          `ADR-${adr}: file says ${status ?? "?"}, state-of-the-system says ${standing.get(adr) ?? "absent"}`,
      );
    expect(disagreeing, "the standing account's ADR table disagrees with the ADRs").toEqual([]);
  });

  it("lists every ADR in the standing account too", () => {
    // The absence direction, which is how 0081 and 0082 went missing: a phase
    // adds its ADR to the index, and the second table is a separate edit that
    // is easy to forget. A reader of §3 would not have known they existed.
    const unlisted = [...files.keys()].filter((adr) => !standing.has(adr)).sort();
    expect(
      unlisted,
      "these ADRs exist and the standing account's table does not list them",
    ).toEqual([]);
  });

  it("gives every ADR a status the project recognises", () => {
    // A file with no `**Status:` line, or one saying something the project has
    // never defined, reads as reviewed and is not. `null` here is the shape
    // that would let an ADR into the tree with no state at all.
    const missing = [...files.entries()]
      .filter(([, status]) => status === null)
      .map(([adr]) => adr);
    expect(missing, "these ADR files have no recognisable Status line").toEqual([]);
  });

  it("states an Accepted count that matches its own rows", () => {
    // The number is quoted in prose, so it drifts on its own — and it did:
    // while the four rows were stale it said seventy-eight, which was right for
    // the index and wrong for the decisions.
    const index = readFileSync(INDEX, "utf8");
    const accepted = [...rows.values()].filter((status) => status === "Accepted").length;
    const expected = inWords(accepted);
    expect(expected, `no spelling for ${String(accepted)}`).toBeDefined();
    expect(
      index.includes(`${expected ?? ""} are **Accepted**.`),
      `the index has ${String(accepted)} Accepted rows and does not say "${expected ?? ""} are **Accepted**."`,
    ).toBe(true);
  });

  it("keeps every declared discrepancy actually in dispute", () => {
    // The stale-allow-list failure, borrowed from the reachability register: an
    // entry that has since been resolved must be REMOVED, not left standing as
    // a permanent excuse for the two records to differ.
    const settled = CONTESTED.filter((c) => files.get(c.adr) === rows.get(c.adr)).map((c) => c.adr);
    expect(settled, "these are declared contested and the two records now agree").toEqual([]);

    for (const entry of CONTESTED) {
      expect(files.get(entry.adr), `ADR-${entry.adr}'s file no longer says what the entry claims`).toBe(
        entry.file,
      );
      expect(rows.get(entry.adr), `ADR-${entry.adr}'s row no longer says what the entry claims`).toBe(
        entry.index,
      );
      expect(entry.evidence.length, "a declared discrepancy must carry its evidence").toBeGreaterThan(
        40,
      );
      expect(entry.decidedBy.length, "a declared discrepancy must name who resolves it").toBeGreaterThan(
        2,
      );
    }
  });

  it("is reading real files and a real index", () => {
    // The vacuity guard. A glob that matched nothing, or a row regex that
    // parsed nothing, would satisfy every assertion above without being about
    // anything.
    expect(files.size, "no ADR files were read").toBeGreaterThanOrEqual(82);
    expect(rows.size, "the index parsed to no rows").toBe(files.size);
    expect(standing.size, "the standing account's table parsed to no rows").toBe(files.size);
    expect(
      [...rows.values()].filter((s) => s === "Accepted").length,
      "no row parsed as Accepted, so the parse is wrong",
    ).toBeGreaterThan(50);
    expect(
      [...standing.values()].filter((s) => s === "Accepted").length,
      "no standing-account row parsed as Accepted, so the parse is wrong",
    ).toBeGreaterThan(50);
  });
});
