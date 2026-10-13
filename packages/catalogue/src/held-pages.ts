/**
 * Pages the run may not open, held outside the signed entry (P305, ADR-0160).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-10-13 (`docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt`):
 *
 *   *"BEFORE MY LIVE RUN: find out whether saving page 12 (the course choice)
 *   is itself the submission. Read studyprogrammetaught.js (row 82) and
 *   anything else that shows it, read-only. Until this is known, my run must
 *   stop before saving page 12."*
 *
 * P305's read-only search found that the repository cannot settle it: nothing
 * observed shows that saving page 12 submits the application, and nothing
 * observed shows that it does not (row 80). So the page is held here, and the
 * run stops before it, without opening it: filling it alone fires five handlers
 * whose code was never captured (row 82), and Back is a submit in the same
 * form, so "do not press Save" would not be enough.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kept here and not in the signed entry, because a hold only takes work away
 * from a run; it never permits anything the signature did not. The precedent
 * is P301's rule that the run never presses "Forgot password", built in code
 * from his typed words without a new signature.
 *
 * Matched two ways, and either one holds the page: by (blueprintId, pageRef)
 * and by the page's address. A blueprint that renumbers the page is still held
 * by its address; an address that moves is still held by its ref. Neither
 * drift can release it quietly. Lifting a hold is deleting its line, in a
 * commit that quotes the words that lift it.
 */

export interface HeldPage {
  readonly blueprintId: string;
  readonly pageRef: string;
  /** The page's address. Compared without its query string or fragment. */
  readonly url: string;
  /** What the student is told the page is, in words a student can read. */
  readonly pageName: string;
  /** Why, verbatim, in the words of the person who decided it. */
  readonly because: string;
  /** Where those words are kept, as sent. */
  readonly source: string;
}

export const HELD_PAGES: readonly HeldPage[] = [
  {
    blueprintId: "bp-sheffield-pgt-september-direct",
    pageRef: "page12",
    url: "https://www.sheffield.ac.uk/postgradapplication/studyprogrammetaught.do",
    pageName: "the course choice page",
    because: "Until this is known, my run must stop before saving page 12.",
    source: "docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt",
  },
];

/** What a caller knows about a page: its ref, and its address when it has one. */
export interface PageToCheck {
  readonly pageRef: string;
  readonly url?: string;
}

/**
 * The hold on this page, or null.
 *
 * `register` defaults to the kept register; tests pass their own.
 */
export function heldPageOf(
  blueprintId: string,
  page: PageToCheck,
  register: readonly HeldPage[] = HELD_PAGES,
): HeldPage | null {
  for (const held of register) {
    const ownBlueprint = held.blueprintId === blueprintId;
    if (ownBlueprint && held.pageRef === page.pageRef) return held;
    if (page.url !== undefined && page.url !== "" && sameAddress(page.url, held.url, ownBlueprint)) return held;
  }
  return null;
}

/**
 * Every page of a blueprint the register holds, as a preview is told of them.
 *
 * One place, so the run's preview and the review tool's preview say the same
 * thing (the P305 review found the review tool saying nothing of the hold).
 */
export function heldPagesIn(
  blueprintId: string,
  pages: readonly PageToCheck[],
  register: readonly HeldPage[] = HELD_PAGES,
): readonly { readonly pageRef: string; readonly pageName: string }[] {
  return pages.flatMap((page) => {
    const held = heldPageOf(blueprintId, page, register);
    return held === null ? [] : [{ pageRef: page.pageRef, pageName: held.pageName }];
  });
}

/**
 * The same page, by the loosest reading that is still that page.
 *
 * Broader than an exact match on purpose, because a hold must not be escaped by
 * spelling (the P305 review measured seven spellings that escaped the first
 * version): the scheme, a port, a leading `www.`, the query string, the
 * fragment, `;` path parameters such as `;jsessionid=`, percent-encoding,
 * repeated slashes, a trailing slash and the path's case are all ignored.
 *
 * An address with no host of its own (`/postgradapplication/…`, a bare file
 * name, `about:blank`, an empty string) is read against the held page's address
 * only on the held page's own blueprint, where that address is the right base,
 * and there one that cannot be read even then is held, not let through. On
 * another blueprint it is not this page: the second P305 review measured
 * `about:blank`, `mailto:` and an empty address all held as Sheffield's course
 * choice page on a blueprint that was not Sheffield's.
 */
function sameAddress(page: string, held: string, ownBlueprint: boolean): boolean {
  const right = addressOf(held);
  if (right === null) return page === held;
  const absolute = addressOf(page);
  if (absolute !== null) return absolute === right;
  if (!ownBlueprint) return false;
  const relative = addressOf(page, held);
  return relative === null ? true : relative === right;
}

function addressOf(url: string, base?: string): string | null {
  try {
    const parsed = base === undefined ? new URL(url) : new URL(url, base);
    if (parsed.hostname === "") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // A malformed escape: compared as it stands.
    }
    path = path
      .split("/")
      .map((segment) => segment.split(";")[0] ?? "")
      .join("/")
      .replace(/\/{2,}/gu, "/")
      .replace(/(?<=.)\/$/u, "")
      .toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}
