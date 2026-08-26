/**
 * The official channel — reading the university's own page.
 *
 * ADR-0009's second evidence channel. It produces **evidence, not truth**: a
 * machine reading a page is interpreting it, and gets the same treatment as
 * every other machine interpretation in this system.
 *
 * ── Two implementations, and why the second one matters ───────────────────
 *
 * The live reader needs network access this environment does not have. So the
 * port has a **recorded** implementation that replays pages captured during a
 * discovery run — the same idea as the replay harness, applied to requirements.
 *
 * That is not only a workaround for blocked egress. A requirement verified
 * against a captured page is verified against something a human can open and
 * check, months later, exactly as it was. A live fetch is unrepeatable: the
 * page has moved on and the evidence is gone.
 */

import { createHash } from "node:crypto";

import type { OfficialEvidence } from "@askimate/aas-domain";

/** A page, as read. */
export interface SourcePage {
  readonly url: string;
  readonly text: string;
  readonly retrievedAt: Date;
}

/** Fetches a page. An infrastructure port. */
export interface OfficialSourceReader {
  read(url: string): Promise<SourcePage | null>;
}

/**
 * Reads pages captured during a discovery run.
 *
 * Deterministic, offline, and — the point — the evidence stays openable.
 */
export class RecordedSourceReader implements OfficialSourceReader {
  readonly #pages: ReadonlyMap<string, SourcePage>;

  public constructor(pages: readonly SourcePage[]) {
    this.#pages = new Map(pages.map((page) => [normaliseUrl(page.url), page]));
  }

  public read(url: string): Promise<SourcePage | null> {
    return Promise.resolve(this.#pages.get(normaliseUrl(url)) ?? null);
  }
}

function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** How a value is located on the page. */
export interface Extractor {
  /** What is being looked for, e.g. `IELTS overall`. */
  readonly label: string;
  /**
   * Finds the passage and the value in it.
   *
   * Deterministic, and supplied by the caller. A model reading the page is
   * possible later, but it would produce a `ProposedValue`, and the extracted
   * value here is already treated as an interpretation either way.
   */
  readonly extract: (text: string) => { readonly excerpt: string; readonly value: string } | null;
}

export type ReadRefusal =
  | { readonly kind: "page_unavailable"; readonly detail: string }
  | { readonly kind: "not_found_on_page"; readonly detail: string };

export type OfficialReadResult =
  | { readonly read: true; readonly evidence: OfficialEvidence }
  | { readonly read: false; readonly refusal: ReadRefusal };

/**
 * Reads one value from one official page.
 *
 * `excerptHash` is the interesting field. On re-verification a changed hash
 * forces re-review **even when the extracted value looks identical** — which
 * catches a university quietly rewording a page in a way that changes its
 * meaning without changing the number.
 */
export async function readOfficialSource(input: {
  readonly reader: OfficialSourceReader;
  readonly url: string;
  readonly extractor: Extractor;
  /**
   * Confidence in the reading, 0–1.
   *
   * A layer-one escalation signal. It can send a poor reading to a human; it
   * can never promote one past its criticality's evidence bar.
   */
  readonly confidence: number;
}): Promise<OfficialReadResult> {
  const page = await input.reader.read(input.url);
  if (page === null) {
    return {
      read: false,
      refusal: {
        kind: "page_unavailable",
        detail:
          `${input.url} could not be read. The official channel has no evidence, which is a ` +
          `normal outcome — it is not a reason to rely on the curated channel alone for a ` +
          `critical requirement.`,
      },
    };
  }

  const found = input.extractor.extract(page.text);
  if (found === null) {
    return {
      read: false,
      refusal: {
        kind: "not_found_on_page",
        detail:
          `"${input.extractor.label}" was not found on ${input.url}. The page may have changed, ` +
          `or the value may live somewhere else — either way nothing was read and nothing is ` +
          `assumed.`,
      },
    };
  }

  return {
    read: true,
    evidence: {
      channel: "official",
      sourceUrl: page.url,
      retrievedAt: page.retrievedAt,
      evidenceExcerpt: found.excerpt,
      excerptHash: hashExcerpt(found.excerpt),
      extractedValue: found.value,
      confidence: Math.min(1, Math.max(0, input.confidence)),
    },
  };
}

/**
 * Hashes an excerpt for change detection.
 *
 * Whitespace-normalised, because a reflow is not a change of meaning — and
 * NOT case-folded or punctuation-stripped, because those can be.
 */
export function hashExcerpt(excerpt: string): string {
  const normalised = excerpt.replace(/\s+/g, " ").trim();
  return `sha256:${createHash("sha256").update(normalised).digest("hex")}`;
}

/** Has the page's wording changed since this evidence was gathered? */
export function excerptChanged(previous: OfficialEvidence, current: OfficialEvidence): boolean {
  return previous.excerptHash !== current.excerptHash;
}
