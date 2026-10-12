/**
 * No e-mail address in the repository that is neither Vahid's nor a fixture's (P301).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-10-12 (docs/run-a/p301-his-account-as-sent.txt): the Sheffield
 * account used for the reads is registered with another person's address,
 * with her knowledge — *"never write her address into the repository or any
 * record."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until P301 nothing held this. The capture scrub covers input values only,
 * and a page's own text carried an address that was neither his nor a
 * fixture into commit ebac18d1 (2026-09-14); commit 31e88480 removed the file
 * on 2026-09-25, and it is still in the history (row 175). This test would
 * have refused it the day it was added.
 *
 * What it reads: every tracked file, as bytes, for anything address-shaped.
 * What it lets through:
 *   - his own two addresses;
 *   - the fixture domains every test here uses — example.com/.org/.net, any
 *     `.test`, `.invalid`, `.example` or `.internal` host, localhost;
 *   - two addresses, exactly, at two real organisations' domains:
 *     `applications@askimate.com` and `x@universitio.com`, which the account
 *     tests use to show an address of ours is refused as a student's
 *     (`email_not_students`). Not their domains: anyone's real address there
 *     is held like any other (P301's review — the first build let both
 *     domains through, and called Universitio, his consultancy, invented).
 * Everything else fails, by file and line only — NEVER the address, so a red
 * run cannot put into a CI log the thing this test exists to keep out of the
 * record; and not a hash of it either, because a hash of an address confirms
 * a guess at it.
 *
 * What it cannot see: binary files whose text is compressed (a PDF fixture),
 * an address written without an `@`, and anything outside the repository —
 * the profile copy, the databases and the conversation logs on his machine.
 * Silence here is about the tracked files and nothing else.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const HIS = new Set(["vahidmoir@gmail.com", "vahid.mo.ir@gmail.com"]);
/** The two addresses at our own organisations' domains the account tests name, exactly. */
const OURS_IN_TESTS = new Set(["applications@askimate.com", "x@universitio.com"]);
const FIXTURE_DOMAIN = /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.test|[a-z0-9-]+\.invalid|[a-z0-9-]+\.example|[a-z0-9-]+\.internal|localhost)$/iu;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;

/** Each address-shaped string in a text that is neither his nor a fixture's, as `file:line`. */
export function strayAddresses(file: string, text: string): readonly string[] {
  const found: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const match of line.match(ADDRESS) ?? []) {
      const address = match.toLowerCase().replace(/\.$/u, "");
      if (HIS.has(address) || OURS_IN_TESTS.has(address)) continue;
      const domain = address.slice(address.indexOf("@") + 1);
      if (FIXTURE_DOMAIN.test(domain)) continue;
      found.push(`${file}:${String(index + 1)}`);
    }
  }
  return found;
}

describe("no e-mail address in the repository that is neither his nor a fixture's (P301)", () => {
  it("refuses one, naming where and never what — and lets his own and the fixtures' through", () => {
    // Made to fail on purpose with a made-up address, read the way a file is.
    // Assembled here rather than written whole, or this file would carry one.
    const madeUp = ["someone.else", "mail-provider.co.uk"].join("@");
    const caught = strayAddresses("docs/somewhere.md", `line one\nthe page said: ${madeUp}, and more`);
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBe("docs/somewhere.md:2");
    expect(caught[0], "the address itself never appears in what is said").not.toContain("someone");
    expect(strayAddresses("a", "vahidmoir@gmail.com n@example.test x@apply.example.com postgresql://u:p@db.internal/x")).toEqual([]);
    // Our own organisations' domains are not fixtures: only the two test
    // addresses pass, and anyone else's there is caught.
    expect(strayAddresses("a", "applications@askimate.com x@universitio.com")).toEqual([]);
    expect(strayAddresses("a", ["someone", "askimate.com"].join("@"))).toEqual(["a:1"]);
    expect(strayAddresses("a", ["someone", "universitio.com"].join("@"))).toEqual(["a:1"]);
  });

  it("finds none in any tracked file", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8").split("\0").filter((file) => file.length > 0);
    expect(files.length, "the files were listed").toBeGreaterThan(900);
    const stray = files.flatMap((file) => {
      let text: string;
      try {
        text = readFileSync(join(ROOT, file)).toString("latin1");
      } catch {
        return [];
      }
      return strayAddresses(file, text);
    });
    expect(stray, "an address that is neither his nor a fixture's, by file:line").toEqual([]);
  });
});
