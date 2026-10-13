/**
 * P305 — a page the run may not open, held outside the signed entry.
 *
 * Vahid, 2026-10-13 (docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt):
 * *"Until this is known, my run must stop before saving page 12."*
 *
 * What is under test is that the hold cannot be released by drift: a page is
 * held when EITHER its (blueprint, pageRef) OR its address matches, so a
 * blueprint that renumbers the page, or a page whose address moves, is still
 * held by the other key.
 */

import { describe, expect, it } from "vitest";

import { HELD_PAGES, heldPageOf, heldPagesIn, type HeldPage } from "./held-pages.js";

const HELD: HeldPage = {
  blueprintId: "bp-a-portal",
  pageRef: "page-course",
  url: "https://portal.test/apply/course.do",
  pageName: "the course choice page",
  because: "a test reason",
  source: "a test",
};

describe("a held page", () => {
  it("is held by its blueprint and pageRef", () => {
    expect(heldPageOf("bp-a-portal", { pageRef: "page-course" }, [HELD])).toBe(HELD);
  });

  it("is held by its address alone, when the blueprint has renumbered it", () => {
    expect(
      heldPageOf("bp-a-portal-v2", { pageRef: "page-9", url: "https://portal.test/apply/course.do" }, [HELD]),
    ).toBe(HELD);
  });

  it("is held by its address whatever the query string or fragment", () => {
    expect(
      heldPageOf("bp-other", { pageRef: "p", url: "https://PORTAL.test/apply/course.do?new=true#top" }, [HELD]),
    ).toBe(HELD);
  });

  it("is held by its pageRef when its address has moved", () => {
    expect(
      heldPageOf("bp-a-portal", { pageRef: "page-course", url: "https://portal.test/apply/course2.do" }, [HELD]),
    ).toBe(HELD);
  });

  it("does not hold another page of the same portal", () => {
    expect(
      heldPageOf("bp-a-portal", { pageRef: "page-personal", url: "https://portal.test/apply/personal.do" }, [HELD]),
    ).toBeNull();
  });

  it("does not hold the same pageRef on another blueprint at another address", () => {
    expect(
      heldPageOf("bp-another-portal", { pageRef: "page-course", url: "https://another.test/course.do" }, [HELD]),
    ).toBeNull();
  });

  it("compares as written when the HELD address itself cannot be parsed", () => {
    const odd: HeldPage = { ...HELD, url: "not a url" };
    expect(heldPageOf("bp-x", { pageRef: "p", url: "not a url" }, [odd])).toBe(odd);
  });

  // The P305 review measured each of these escaping the first version.
  it.each([
    ["the path's case", "https://portal.test/apply/Course.DO"],
    ["a ;jsessionid path parameter", "https://portal.test/apply/course.do;jsessionid=ABC123"],
    ["a doubled slash", "https://portal.test/apply//course.do"],
    ["percent-encoding", "https://portal.test/apply/c%6Furse.do"],
    ["http rather than https", "http://portal.test/apply/course.do"],
    ["a leading www.", "https://www.portal.test/apply/course.do"],
    ["a port", "https://portal.test:443/apply/course.do"],
    ["a trailing slash", "https://portal.test/apply/course.do/"],
  ])("is held by its address whatever %s", (_how, url) => {
    expect(heldPageOf("bp-another-blueprint", { pageRef: "page-9", url }, [HELD])).toBe(HELD);
  });

  it("is held by a path with no host on its own blueprint, read against the held page", () => {
    expect(heldPageOf("bp-a-portal", { pageRef: "page-9", url: "/apply/course.do" }, [HELD])).toBe(HELD);
    expect(heldPageOf("bp-a-portal", { pageRef: "page-9", url: "course.do" }, [HELD])).toBe(HELD);
  });

  it("holds an address it cannot read on its own blueprint, rather than let it through", () => {
    expect(heldPageOf("bp-a-portal", { pageRef: "page-9", url: "about:blank" }, [HELD])).toBe(HELD);
  });

  // The second P305 review measured each of these held as the course choice
  // page on a blueprint that was not the held page's.
  it.each([
    ["about:blank", "about:blank"],
    ["a mailto address", "mailto:someone@portal.test"],
    ["a file address", "file:///tmp/page.html"],
    ["a path with no host", "/apply/course.do"],
    ["a bare file name", "course.do"],
  ])("does not hold %s on another blueprint", (_how, url) => {
    expect(heldPageOf("bp-another-blueprint", { pageRef: "page-9", url }, [HELD])).toBeNull();
  });

  it("does not hold a page whose address is empty, on any blueprint, by its address", () => {
    expect(heldPageOf("bp-another-blueprint", { pageRef: "page-9", url: "" }, [HELD])).toBeNull();
    expect(heldPageOf("bp-a-portal", { pageRef: "page-9", url: "" }, [HELD])).toBeNull();
  });

  it("does not hold a different path on the same host, however it is spelled", () => {
    expect(heldPageOf("bp-x", { pageRef: "p", url: "https://www.portal.test/apply/Course2.do;x=1" }, [HELD])).toBeNull();
  });
});

describe("the register as kept", () => {
  it("names each hold's reason in words kept in a file, and a name a student can read", () => {
    expect(HELD_PAGES.length, "the register is not empty while his stop stands").toBeGreaterThan(0);
    for (const held of HELD_PAGES) {
      expect(held.because.length).toBeGreaterThan(0);
      expect(held.source).toMatch(/^docs\//);
      expect(held.pageName).toMatch(/^the /);
      expect(() => new URL(held.url)).not.toThrow();
    }
  });

  it("holds Sheffield's course choice page, in his words", () => {
    const sheffield = HELD_PAGES.find((held) => held.pageRef === "page12");
    expect(sheffield?.blueprintId).toBe("bp-sheffield-pgt-september-direct");
    expect(sheffield?.url).toBe("https://www.sheffield.ac.uk/postgradapplication/studyprogrammetaught.do");
    expect(sheffield?.because).toBe("Until this is known, my run must stop before saving page 12.");
    expect(sheffield?.source).toBe("docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt");
  });
});

describe("the held pages of a blueprint", () => {
  it("lists each held page with the name a student reads, and no other", () => {
    expect(
      heldPagesIn(
        "bp-a-portal",
        [{ pageRef: "page-personal", url: "https://portal.test/apply/personal.do" }, { pageRef: "page-course" }],
        [HELD],
      ),
    ).toEqual([{ pageRef: "page-course", pageName: "the course choice page" }]);
  });
});
