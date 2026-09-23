/**
 * Deriving a portal's country mapping, and printing the disagreements a person
 * must actually read (P200, blocker 69).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A DERIVATION AND NOT A LIST SOMEBODY TYPES.
 *
 * The reviewed Sheffield entry carried EIGHT countries of 249, keyed by ISO
 * alpha-2 — GB, IR, IN, PK, CN, NG, TR, US, the eight one synthetic student
 * needed. Every other applicant is a `render_refused` blocker, and the portal
 * offers their country perfectly well.
 *
 * Vahid, 2026-09-23, on how the rest may NOT be brought to him:
 *
 *   *"Not 249 lines to approve blind — I would be signing your join again,
 *   which is what we just agreed I should not do."*
 *
 * So the join is mechanical and re-runnable, and the page it produces asks him
 * to read only what the join could NOT settle:
 *
 *   *"The ones a strict join matches exactly, listed as a count with a
 *   spot-check I can make myself. The ones it does not — the 15 to 18 per
 *   cent — listed in full, each with our name, the portal's option text, and
 *   its submitted value, so I read only the disagreements. That is a page I
 *   can actually check, and Iran will be on it."*
 *
 * ── The two shapes a country select takes, and why they are not equal ─────
 *
 * Sheffield spells its country options two ways, and the difference decides
 * whether a field can be derived at all:
 *
 *   ISO CODES  `fundingNationality`, `countryOfBirth` — `IR:O`, `GB:H`,
 *              `DE:E`. The join is the identity on a code the reviewed table
 *              already holds. There is nothing to guess and nothing to read.
 *
 *   NAMES      `corrCountry`, `permanentResidence`, `previousCountry1..4`,
 *              `institutionCountry` — `IRAN`, `Iran, Islamic Republic of:O`.
 *              The join is a string comparison between two authorities that
 *              disagree, and measured on this portal it misses 15–18% —
 *              Czechia/Czech Republic, Côte d'Ivoire/Ivory Coast, and `IR`
 *              ITSELF, which Sheffield spells *Iran, Islamic Republic of*.
 *              A miss is silent. That is the half-table blocker 61 refused.
 *
 * So: the code-valued fields are DERIVED and the name-valued fields are
 * REVIEWED, which is Vahid's split, and this file does both halves — it
 * derives what can be derived and writes the disagreements out for the rest.
 *
 * ── The suffix ───────────────────────────────────────────────────────────
 *
 * Sheffield appends a single-letter fee-status marker to the submitted value:
 * `:H` home, `:O` overseas, `:E` EU, `:Q` on one option. It is part of the
 * value the form submits, so it is KEPT in the mapping and stripped only to
 * read the code or name underneath. Reading `:H`/`:O` and forgetting `:E` is
 * how P199's first measurement claimed Germany and France were missing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COUNTRIES, normaliseCountryText } from "@askimate/aas-profile";
import type { Country } from "@askimate/aas-profile";

export interface PortalOption {
  readonly value: string;
  readonly label: string;
}

/** How this select spells a country. Decided by looking, never assumed. */
export type OptionShape = "iso_code" | "name";

export interface Matched {
  readonly country: Country;
  readonly option: PortalOption;
}

export interface Unmatched {
  readonly country: Country;
  /** A PROPOSAL for the reviewer, never a decision. `null` when nothing fits. */
  readonly candidate: PortalOption | null;
  readonly why: string;
}

export interface Derivation {
  readonly fieldRef: string;
  readonly shape: OptionShape;
  /** Options the portal offers, not counting the empty one. */
  readonly offered: number;
  readonly matched: readonly Matched[];
  readonly unmatched: readonly Unmatched[];
  /** Options no country in the reviewed table claimed. */
  readonly unclaimed: readonly PortalOption[];
}

/** `IR:O` → `IR`. Every single-letter suffix, not the two we happened to see. */
export function bareValue(value: string): string {
  return value.replace(/:[A-Za-z]$/, "");
}

/**
 * Whether this select spells countries as codes or as names.
 *
 * Measured, not configured: a select is code-shaped when MOST of its non-empty
 * options are two letters after the suffix is stripped. Sheffield's nationality
 * list is 242 options of which all but a handful are codes; its residence list
 * has none.
 */
export function shapeOf(options: readonly PortalOption[]): OptionShape {
  const values = options.map((option) => bareValue(option.value)).filter((v) => v !== "");
  if (values.length === 0) return "name";
  const codes = values.filter((v) => /^[A-Za-z]{2}$/.test(v)).length;
  return codes * 2 > values.length ? "iso_code" : "name";
}

/**
 * Proposes a portal option for a country the strict join missed.
 *
 * DELIBERATELY WEAK, and marked as a proposal everywhere it is printed. It
 * offers an option whose text starts with our name, or whose first word is our
 * first word — enough to put *Iran, Islamic Republic of* next to *Iran* and
 * *Czech Republic* next to *Czechia*, and not enough to pair *Côte d'Ivoire*
 * with *Ivory Coast*, which it leaves for a person. The shortest candidate
 * wins, so *Iran* proposes *Iran, Islamic Republic of* rather than a longer
 * option that merely contains the word.
 */
function propose(country: Country, unclaimed: readonly PortalOption[]): Unmatched {
  const ours = normaliseCountryText(country.name);
  const ourFirst = ours.split(" ")[0] ?? "";
  const fits = unclaimed
    .map((option) => ({ option, text: normaliseCountryText(option.label || bareValue(option.value)) }))
    .filter(({ text }) => {
      if (text.startsWith(ours) || ours.startsWith(text)) return true;
      const theirFirst = text.split(" ")[0] ?? "";
      return ourFirst.length >= 4 && theirFirst === ourFirst;
    })
    .sort((a, b) => a.text.length - b.text.length);

  const best = fits[0];
  if (best === undefined) {
    return { country, candidate: null, why: "nothing in the portal's list resembles this name" };
  }
  return {
    country,
    candidate: best.option,
    why: `proposed by name, UNVERIFIED: "${best.option.label}" against our "${country.name}"`,
  };
}

/** The strict join: exact on the code, or exact on the normalised name. */
export function deriveCountryMapping(fieldRef: string, options: readonly PortalOption[]): Derivation {
  const shape = shapeOf(options);
  const offered = options.filter((option) => option.value !== "");

  const byKey = new Map<string, PortalOption>();
  for (const option of offered) {
    const bare = bareValue(option.value);
    if (shape === "iso_code") byKey.set(bare.toUpperCase(), option);
    else {
      // Both the submitted text and the label, because a portal may spell them
      // differently and either is an exact match if it matches exactly.
      byKey.set(normaliseCountryText(bare), option);
      if (option.label !== "") byKey.set(normaliseCountryText(option.label), option);
    }
  }

  const matched: Matched[] = [];
  const missed: Country[] = [];
  const claimed = new Set<string>();
  for (const country of COUNTRIES) {
    const option =
      shape === "iso_code"
        ? byKey.get(country.code)
        : byKey.get(normaliseCountryText(country.name));
    if (option === undefined) missed.push(country);
    else {
      matched.push({ country, option });
      claimed.add(option.value);
    }
  }

  const unclaimed = offered.filter((option) => !claimed.has(option.value));
  const unmatched = missed.map((country) => propose(country, unclaimed));
  return { fieldRef, shape, offered: offered.length, matched, unmatched, unclaimed };
}

/** The mapping a derived field gets: every matched code to the value submitted. */
export function optionMapOf(derivation: Derivation): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { country, option } of derivation.matched) map[country.code] = option.value;
  return map;
}

// ── Reading the entry, and writing the page ────────────────────────────────

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");
const PAGE = join(ROOT, "docs", "run-a", "country-mapping-review.md");

/** The country-typed target fields of the reviewed entry, in the order it lists them. */
export const COUNTRY_FIELD_REFS: readonly string[] = [
  "fundingNationality",
  "countryOfBirth",
  "corrCountry",
  "permanentResidence",
  "previousCountry1",
  "institutionCountry-ts-control",
];

interface BlueprintField {
  readonly fieldRef: string;
  readonly options?: readonly PortalOption[];
}

export function optionsFromEntry(entryJson: string, fieldRef: string): readonly PortalOption[] {
  const entry = JSON.parse(entryJson) as {
    blueprint: { pages: { sections: { fields: BlueprintField[] }[] }[] };
  };
  for (const page of entry.blueprint.pages)
    for (const section of page.sections)
      for (const field of section.fields)
        if (field.fieldRef === fieldRef) return field.options ?? [];
  throw new Error(`no field ${fieldRef} in the blueprint`);
}

/** Every 25th match, so the spot-check is the same rows each run. */
function spotCheck(derivation: Derivation): readonly Matched[] {
  return derivation.matched.filter((_, index) => index % 25 === 0);
}

function table(rows: readonly string[][], header: readonly string[]): string {
  const lines = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function reviewPage(derivations: readonly Derivation[]): string {
  const out: string[] = [];
  out.push("# The country mappings: what derives, and what you have to read");
  out.push("");
  out.push("> **Generated — do not edit by hand.** `pnpm run country-mappings` rewrites it, and");
  out.push("> `scripts/derive-country-mappings.test.ts` holds the join. Re-run it and this page");
  out.push("> comes back identical, which is the point: you are checking a derivation you can");
  out.push("> repeat, not a list I typed.");
  out.push("");
  out.push("Blocker 69. The signed entry carries **8 countries of 249**. This is what it takes to");
  out.push("carry the rest, split the way you asked: derive the code-valued fields, read the");
  out.push("disagreements on the name-valued ones.");
  out.push("");
  out.push("## What the portal has, before a single line is read");
  out.push("");
  out.push(
    table(
      derivations.map((d) => [
        `\`${d.fieldRef}\``,
        d.shape === "iso_code" ? "ISO codes" : "names",
        String(d.offered),
        `${String(d.matched.length)} / 249`,
        String(d.unmatched.length),
        String(d.unclaimed.length),
      ]),
      ["field", "options are", "offered", "strict join matches", "to read", "portal options nothing claimed"],
    ),
  );
  out.push("");
  out.push("`offered` counts the portal's own list without its empty first entry. The reviewed");
  out.push("table holds 249 countries (ADR-0141), so `249 − matched` is what is left to settle,");
  out.push("and the last column is what the portal has that we do not.");
  out.push("");

  for (const derivation of derivations) {
    out.push(`## \`${derivation.fieldRef}\` — ${derivation.shape === "iso_code" ? "DERIVED" : "NEEDS YOUR READING"}`);
    out.push("");
    if (derivation.shape === "iso_code") {
      out.push(
        `The portal submits ISO codes, so the join is the identity on a code the reviewed table`,
      );
      out.push(
        `already holds: **${String(derivation.matched.length)} of 249**, nothing guessed. The ${String(derivation.unmatched.length)} it does not carry are below —`,
      );
      out.push("they are absences in the portal's list, not disagreements about a name.");
    } else {
      out.push(
        `The portal submits names, so the join is a comparison between two authorities that`,
      );
      out.push(
        `disagree. **${String(derivation.matched.length)} of 249** matched exactly; **${String(derivation.unmatched.length)}** did not, and those are yours to read.`,
      );
    }
    out.push("");
    out.push("**Spot-check** — every 25th match, so it is the same rows every run:");
    out.push("");
    out.push(
      table(
        spotCheck(derivation).map((m) => [
          `\`${m.country.code}\``,
          cell(m.country.name),
          cell(m.option.label),
          `\`${cell(m.option.value)}\``,
        ]),
        ["code", "our name", "the portal's option text", "submitted value"],
      ),
    );
    out.push("");
    if (derivation.unmatched.length > 0) {
      out.push(`**The ${String(derivation.unmatched.length)} the join could not settle.** The candidate column is a PROPOSAL and`);
      out.push("nothing acts on it until you say so; a blank one means nothing in the portal's list");
      out.push("resembled our name at all.");
      out.push("");
      out.push(
        table(
          derivation.unmatched.map((u) => [
            `\`${u.country.code}\``,
            cell(u.country.name),
            u.candidate === null ? "— nothing resembles it —" : cell(u.candidate.label),
            u.candidate === null ? "—" : `\`${cell(u.candidate.value)}\``,
          ]),
          ["code", "our name", "proposed option text (UNVERIFIED)", "submitted value"],
        ),
      );
      out.push("");
    }
    if (derivation.unclaimed.length > 0) {
      out.push(`**What the portal offers that no country in our table claimed (${String(derivation.unclaimed.length)}).** Read this`);
      out.push("beside the table above: between them they are the whole disagreement.");
      out.push("");
      out.push(
        table(
          derivation.unclaimed.map((o) => [cell(o.label), `\`${cell(o.value)}\``]),
          ["the portal's option text", "submitted value"],
        ),
      );
      out.push("");
    }
  }
  out.push("## What happens after you sign");
  out.push("");
  out.push("The option maps go into the entry, which moves its content hash — that is the");
  out.push("signature you offered to spend. The derived fields are then held by the test in");
  out.push("`scripts/derive-country-mappings.test.ts`, which re-derives them and fails if the");
  out.push("entry and the derivation ever disagree. The name-valued fields are held by your");
  out.push("reading, recorded here.");
  out.push("");
  return out.join("\n");
}

function main(): void {
  const entryJson = readFileSync(ENTRY, "utf8");
  const derivations = COUNTRY_FIELD_REFS.map((fieldRef) =>
    deriveCountryMapping(fieldRef, optionsFromEntry(entryJson, fieldRef)),
  );
  writeFileSync(PAGE, reviewPage(derivations), "utf8");
  for (const d of derivations) {
    console.log(
      `${d.fieldRef.padEnd(30)} ${d.shape.padEnd(9)} offered ${String(d.offered).padStart(3)}  matched ${String(d.matched.length).padStart(3)}/249  to read ${String(d.unmatched.length).padStart(2)}  unclaimed ${String(d.unclaimed.length).padStart(2)}`,
    );
  }
  console.log(`\nWritten: ${PAGE}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("derive-country-mappings.ts")) main();
