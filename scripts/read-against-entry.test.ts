/**
 * The comparison reads a read as the console printed it (P296).
 *
 * His reads of 2026-10-11 reached the repository as the console showed them:
 * each output a string in the console's own quotes — single quotes, or
 * backticks where the string holds a single quote — with a backslash shown
 * doubled. `read-against-entry.ts` read only bare JSON, so every one of them
 * would have come out as NOT A READ LINE. It now takes the console's
 * delimiters off and reads back the console's own escapes, nothing else, and
 * refuses a file holding anything it does not know the console to print.
 *
 * These run the script itself on his files, against the entry in the
 * checkout, and assert only how the file was read: what the entry records of
 * those reads changes with his signatures, and is not what is tested here.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const ENTRY = "docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json";
const READS = "docs/captures/sheffield-pgt-2026-09-10/reads";

function compare(fieldRef: string, file: string, caseKey?: string): { readonly status: number | null; readonly out: string } {
  const run = spawnSync(TSX, ["scripts/read-against-entry.ts", ENTRY, fieldRef, file, ...(caseKey === undefined ? [] : [caseKey])], { cwd: ROOT, encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

function printed(text: string): { readonly file: string; readonly done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "read-against-entry-"));
  const file = join(dir, "read.json");
  writeFileSync(file, text);
  return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("read-against-entry reads a read as the console printed it (P296)", () => {
  it("his grade list R, in the console's single quotes: every line read, and what it was made under", () => {
    const { out } = compare("grade", `${READS}/p294-R-grade-after-institution-escape-gpa20.json`, "(escaped)");
    expect(out).not.toContain("NOT A READ LINE");
    expect(out).toContain("READ AS   the console's printed string: delimiter ', taken off; 0 escape(s) read back");
    expect(out).toContain('MADE UNDER (the file)   institutionCountry-ts-control = "IRAN", institution-ts-control = "Not in list", gradingSystemId = "6"');
    expect(out).toContain("204 line(s) in");
    expect(out).toContain("204 match the entry's options for grade, 0 differ or are missing, 0 could not be read as a line.");
  });

  it("his search T2, in the console's backticks: every entry read, the escape among them", () => {
    const { out } = compare("institution-ts-control", `${READS}/p294-T2-institution-Sheff-under-united-kingdom.json`);
    expect(out).not.toContain("NOT A READ LINE");
    expect(out).toContain('MADE UNDER (the file)   institutionCountry-ts-control = "UNITED KINGDOM"');
    expect(out).toContain("11 line(s) in");
    expect(out).toContain("11 match the entry's options for institution-ts-control");
  });

  it("reads a doubled backslash back as one, and nothing else changes", () => {
    // The console shows the string {"under":{"gradingSystemId":"6"},"grade":[["a\\nb","x"]]}
    // — JSON escaping a newline — with its backslash doubled.
    const read = printed(String.raw`'{"under":{"gradingSystemId":"6"},"grade":[["a\\nb","x"]]}'`);
    try {
      const { out } = compare("grade", read.file);
      expect(out).toContain('MISSING   "a\\nb" "x"');
    } finally {
      read.done();
    }
  });

  it("reads back the delimiter escaped inside itself, the one quote escape the console prints", () => {
    // Chrome shows a string holding ', " and ` in single quotes, each ' written \'.
    // Here the value is it's: the printed form holds a backslash before its '.
    const backslash = String.fromCharCode(92);
    const read = printed(`'{"under":{"gradingSystemId":"6"},"grade":[["it${backslash}'s","x"]]}'`);
    try {
      const { out } = compare("grade", read.file);
      expect(out).toContain("1 escape(s) read back");
      expect(out).toContain(`MISSING   "it's" "x"`);
    } finally {
      read.done();
    }
  });

  it("refuses a quote escaped outside its own delimiter, and a closing delimiter escaped", () => {
    const backslash = String.fromCharCode(92);
    for (const [text, said] of [
      [`'{"under":{},"grade":[["a${backslash}"b","x"]]}'`, "does not know the console to print"],
      [`'{"under":{},"grade":[["0","0"]]}${backslash}'`, "closing delimiter is escaped"],
    ] as const) {
      const read = printed(text);
      try {
        const { status, out } = compare("grade", read.file);
        expect(status, out).toBe(2);
        expect(out).toContain(said);
      } finally {
        read.done();
      }
    }
  });

  it("refuses an escape it does not know the console to print, and a delimiter left inside, each for its own reason", () => {
    // A backslash then "u": built from its character code, so nothing between
    // this source and the file can read it as an escape first.
    const backslash = String.fromCharCode(92);
    for (const [text, said] of [
      [`'{"under":{},"grade":[["${backslash}u0030","0"]]}'`, "does not know the console to print"],
      [`'{"under":{},"grade":[["it's","x"]]}'`, "holds its own delimiter"],
    ] as const) {
      const read = printed(text);
      try {
        const { status, out } = compare("grade", read.file);
        expect(status, out).toBe(2);
        expect(out).toContain(said);
      } finally {
        read.done();
      }
    }
  });

  it("reads back a tab and a newline the console wrote as escapes: value-TAB-label lines as the console printed them", () => {
    const backslash = String.fromCharCode(92);
    const read = printed(`'Select your grade...${backslash}tSelect your grade...${backslash}n0.0${backslash}t0.0'`);
    try {
      const { out } = compare("grade", read.file);
      expect(out).toContain("3 escape(s) read back");
      expect(out).toContain("2 line(s) in");
      expect(out).toContain("2 match the entry's options for grade");
    } finally {
      read.done();
    }
  });
});
