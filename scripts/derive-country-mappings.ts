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

/**
 * How a candidate was arrived at — and they are not equally good (P202).
 *
 * `portal_corroborated` is a fact about the portal: its own code-valued select
 * names this code, and that name appears in this select's list. Nothing of
 * ours is involved.
 *
 * `name_resemblance` is our name against the portal's text, which is a guess.
 *
 * `absent` means the portal's list has no trace of this country under any of
 * the portal's OWN names for it — the Antarctica case, which is a different
 * fact from "the proposer failed" and is printed as one.
 */
export type CandidateKind = "portal_corroborated" | "name_resemblance" | "absent";

export interface Unmatched {
  readonly country: Country;
  /** A PROPOSAL for the reviewer, never a decision. `null` when nothing fits. */
  readonly candidate: PortalOption | null;
  readonly kind: CandidateKind;
  readonly why: string;
}

/**
 * Two or more countries whose proposals landed on ONE submitted value.
 *
 * Vahid, 2026-09-23, on the pair that made this a rule rather than something
 * he had to catch by eye: *"Two countries, one proposal, same submitted value.
 * If I approved that page as it stands, a student from one would have the
 * other on their application… refuse to propose the same submitted value for
 * two different codes — make that a rule in the derivation."*
 *
 * So a collision is never printed as a candidate. Every code in it loses its
 * proposal and the group is shown together, because the disagreement is
 * between them and reading one row could not settle it.
 */
export interface Collision {
  readonly option: PortalOption;
  readonly countries: readonly Country[];
}

export interface Derivation {
  readonly fieldRef: string;
  readonly shape: OptionShape;
  /** Options the portal offers, not counting the empty one. */
  readonly offered: number;
  readonly matched: readonly Matched[];
  readonly unmatched: readonly Unmatched[];
  /** Proposals that landed on one option and were therefore withdrawn. */
  readonly collisions: readonly Collision[];
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
 * Every name the PORTAL gives one option, from its own punctuation.
 *
 * Sheffield writes aliases two ways — `Korea (South) [Korea, Republic of]`,
 * `Ivory Coast [Côte D'ivoire]`, `Burma (Myanmar)` — and a different select on
 * the same portal picks a different one of them. Splitting a label into the
 * names it contains lets the two lists be compared on the PORTAL's vocabulary
 * rather than on ours, which is what Vahid asked for: *"search the portal's
 * list for each blank by something other than our name."*
 *
 * Nothing here invents a name. Every candidate is a substring of what the
 * portal printed.
 */
export function portalAliases(label: string): readonly string[] {
  const out = new Set<string>();
  const add = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length > 1) out.add(fold(trimmed));
  };
  add(label);
  // The text before the first bracket of either kind: `Korea (South) [..]`
  // gives `Korea`, `Hong Kong (Special…)` gives `Hong Kong`.
  const beforeBracket = label.split(/[[(]/)[0] ?? "";
  add(beforeBracket);
  // `Korea (South) [Korea, Republic of]` also gives `Korea (South)`.
  const beforeSquare = label.split("[")[0] ?? "";
  add(beforeSquare);
  for (const inside of label.matchAll(/[[(]([^\])]*)[\])]/g)) add(inside[1] ?? "");
  return [...out];
}

/**
 * The comparison fold for PORTAL text.
 *
 * `normaliseCountryText` is the registry's, and it stays as it is — it decides
 * what a STUDENT's answer means and must not drift. This one is wider by
 * exactly one character: the capture contains `Korea, Democratic People¿s
 * Republic of`, where `¿` sits between letters in the place of an apostrophe.
 * Whether Sheffield serves that byte or the capture mangled it is unread, so
 * it is folded away here — in the portal-quirk layer — rather than taught to
 * the registry.
 */
function fold(text: string): string {
  return normaliseCountryText(text.replace(/¿/g, ""));
}

/**
 * PASS 2 — the portal corroborating itself.
 *
 * Takes the label the portal's own CODE-valued select gives this country, and
 * looks for an option in this select that shares a name with it. Both sides
 * are expanded by `portalAliases`, and the match is exact on the fold, so
 * `Ivory Coast [Côte D'ivoire]` meets `Ivory Coast (Cote d'Ivoire)` on
 * `ivory coast` and `Laos [Lao People¿s Democratic Republic]` does NOT meet
 * `Lao PDR`, which is right: an abbreviation is a person's call.
 *
 * Ambiguity is refused rather than resolved: if two options share a name with
 * the code's label, neither is offered.
 */
function corroborate(
  portalLabelForCode: string | undefined,
  available: readonly PortalOption[],
): PortalOption | null {
  if (portalLabelForCode === undefined) return null;
  const textOf = (option: PortalOption): string => option.label || bareValue(option.value);

  // ── The WHOLE label first, and Congo is why ──────────────────────────
  //
  // Alias expansion strips a parenthetical, so `Congo (Democratic Republic)`
  // offers `Congo` among its names — which is also, exactly, another option.
  // Comparing aliases first made both Congos ambiguous and resolved neither.
  // The portal's full label is unambiguous when it matches: `Congo` is
  // `Congo` and `Congo (Democratic Republic)` is itself.
  const whole = fold(portalLabelForCode);
  const exact = available.filter((option) => fold(textOf(option)) === whole);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;

  // Only then the aliases, for the labels that carry them:
  // `Korea (South) [Korea, Republic of]` meets `Korea, Republic of`.
  const names = new Set(portalAliases(portalLabelForCode));
  const hits = available.filter((option) =>
    portalAliases(textOf(option)).some((alias) => names.has(alias)),
  );
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * PASS 3 — our name against the portal's text, and DELIBERATELY WEAK.
 *
 * It offers an option whose text starts with our name, or whose first word is
 * our first word — enough to put *Iran, Islamic Republic of* next to *Iran*,
 * and not enough to pair *Côte d'Ivoire* with *Ivory Coast*, which pass 2 now
 * does properly from the portal's own list. The shortest candidate wins.
 */
function propose(country: Country, available: readonly PortalOption[]): PortalOption | null {
  const ours = normaliseCountryText(country.name);
  const ourFirst = ours.split(" ")[0] ?? "";
  const fits = available
    .map((option) => ({ option, text: normaliseCountryText(option.label || bareValue(option.value)) }))
    .filter(({ text }) => {
      if (text.startsWith(ours) || ours.startsWith(text)) return true;
      const theirFirst = text.split(" ")[0] ?? "";
      return ourFirst.length >= 4 && theirFirst === ourFirst;
    })
    .sort((a, b) => a.text.length - b.text.length);
  return fits[0]?.option ?? null;
}

/**
 * The join, in three passes, and a collision rule over all of them.
 *
 * 1. STRICT — exact on the code, or exact on the normalised name. Derived.
 * 2. CORROBORATED — the portal's own code-valued select names this country,
 *    and that name is in this select's list. A fact about the portal.
 * 3. RESEMBLANCE — our name against the portal's text. A guess, marked one.
 *
 * Then: any submitted value proposed for more than one country is withdrawn
 * from all of them and printed as a collision (Vahid, 2026-09-23). A code that
 * survives none of this is `absent` — the portal's list has no trace of it
 * under any of the portal's own names, which is a different fact from a
 * proposer that failed, and the page prints them apart.
 */
export function deriveCountryMapping(
  fieldRef: string,
  options: readonly PortalOption[],
  /** What the portal's own code-valued selects call each code (pass 2). */
  portalLabels: ReadonlyMap<string, string> = new Map(),
): Derivation {
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

  const available = offered.filter((option) => !claimed.has(option.value));
  const proposed: { country: Country; option: PortalOption | null; kind: CandidateKind }[] = [];
  for (const country of missed) {
    const corroborated = corroborate(portalLabels.get(country.code), available);
    if (corroborated !== null) {
      proposed.push({ country, option: corroborated, kind: "portal_corroborated" });
      continue;
    }
    const resembles = propose(country, available);
    proposed.push({
      country,
      option: resembles,
      kind: resembles === null ? "absent" : "name_resemblance",
    });
  }

  // ── The collision rule ────────────────────────────────────────────────
  //
  // Congo is why this exists. The portal offers `Congo` and `Congo
  // (Democratic Republic)`; pass 3 offered `Congo` to BOTH `CG` and `CD`,
  // and approving that would have put one country on the other's
  // application. Pass 2 now settles Congo from the portal's own code list,
  // but the rule stands over every pass: one option, one country.
  const byOption = new Map<string, Country[]>();
  for (const { country, option } of proposed) {
    if (option === null) continue;
    byOption.set(option.value, [...(byOption.get(option.value) ?? []), country]);
  }
  const collided = new Map<string, Collision>();
  for (const [value, countries] of byOption) {
    if (countries.length < 2) continue;
    const option = offered.find((candidate) => candidate.value === value);
    if (option !== undefined) collided.set(value, { option, countries });
  }

  const unmatched: Unmatched[] = proposed.map(({ country, option, kind }) => {
    if (option !== null && collided.has(option.value)) {
      const others = (collided.get(option.value)?.countries ?? [])
        .filter((other) => other.code !== country.code)
        .map((other) => `${other.code} ${other.name}`)
        .join(", ");
      return {
        country,
        candidate: null,
        kind: "absent",
        why: `WITHDRAWN — the same submitted value was proposed for ${others}, and one option cannot be two countries`,
      };
    }
    if (option === null) {
      return {
        country,
        candidate: null,
        kind: "absent",
        why: "no option in the portal's list carries this country under any of the portal's own names",
      };
    }
    return {
      country,
      candidate: option,
      kind,
      why:
        kind === "portal_corroborated"
          ? `corroborated by the portal itself: its code list calls ${country.code} "${portalLabels.get(country.code) ?? ""}"`
          : `proposed by name, UNVERIFIED: "${option.label}" against our "${country.name}"`,
    };
  });

  const stillProposed = new Set(
    unmatched.flatMap((entry) => (entry.candidate === null ? [] : [entry.candidate.value])),
  );
  const unclaimed = available.filter(
    (option) => !stillProposed.has(option.value) && !collided.has(option.value),
  );
  return {
    fieldRef,
    shape,
    offered: offered.length,
    matched,
    unmatched,
    collisions: [...collided.values()],
    unclaimed,
  };
}

/**
 * What the portal's own code-valued selects call each ISO code.
 *
 * Built from every code-shaped select in the blueprint, which is the only
 * place a portal states its own name for a code. A code two selects name
 * differently is dropped rather than guessed at.
 */
export function portalLabelsForCodes(
  selects: readonly (readonly PortalOption[])[],
): ReadonlyMap<string, string> {
  const seen = new Map<string, string | null>();
  for (const options of selects) {
    if (shapeOf(options) !== "iso_code") continue;
    for (const option of options) {
      const code = bareValue(option.value).toUpperCase();
      if (!/^[A-Z]{2}$/.test(code) || option.label === "") continue;
      const already = seen.get(code);
      if (already === undefined) seen.set(code, option.label);
      else if (already !== null && fold(already) !== fold(option.label)) seen.set(code, null);
    }
  }
  return new Map(
    [...seen].filter((entry): entry is [string, string] => entry[1] !== null),
  );
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
  const kindOf = (d: Derivation, kind: CandidateKind): readonly Unmatched[] =>
    d.unmatched.filter((entry) => entry.kind === kind);

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
  out.push("## How a row got where it is");
  out.push("");
  out.push("| | what it means | how far to trust it |");
  out.push("|---|---|---|");
  out.push("| **derived** | the portal submits this country's ISO code, or spells its name exactly as the reviewed table does | nothing was guessed |");
  out.push("| **corroborated** | the portal's OWN code-valued select names this code, and that name is in this list | a fact about the portal; nothing of ours is involved |");
  out.push("| **proposed** | our name resembles the portal's text | a guess — this is the column to read |");
  out.push("| **absent** | no option carries this country under any of the portal's own names | the portal does not have it |");
  out.push("| **withdrawn** | two countries' proposals landed on one submitted value | never shown as a candidate |");
  out.push("");
  out.push("## What the portal has, before a single line is read");
  out.push("");
  out.push(
    table(
      derivations.map((d) => [
        `\`${d.fieldRef}\``,
        d.shape === "iso_code" ? "ISO codes" : "names",
        String(d.offered),
        String(d.matched.length),
        String(kindOf(d, "portal_corroborated").length),
        `**${String(kindOf(d, "name_resemblance").length)}**`,
        String(kindOf(d, "absent").length),
        String(d.collisions.length),
      ]),
      ["field", "options are", "offered", "derived", "corroborated", "to read", "absent", "collisions"],
    ),
  );
  out.push("");
  out.push("`offered` counts the portal's own list without its empty first entry. The reviewed");
  out.push("table holds 249 countries (ADR-0141). **to read** is the only column that asks");
  out.push("anything of you.");
  out.push("");

  for (const derivation of derivations) {
    const corroborated = kindOf(derivation, "portal_corroborated");
    const proposed = kindOf(derivation, "name_resemblance");
    const absent = kindOf(derivation, "absent");
    out.push(`## \`${derivation.fieldRef}\` — ${derivation.shape === "iso_code" ? "DERIVED" : "NEEDS YOUR READING"}`);
    out.push("");
    if (derivation.shape === "iso_code") {
      out.push("The portal submits ISO codes, so the join is the identity on a code the reviewed table");
      out.push(`already holds: **${String(derivation.matched.length)} of 249**, nothing guessed.`);
    } else {
      out.push("The portal submits names, so the join is a comparison between two authorities that");
      out.push(`disagree. **${String(derivation.matched.length)} of 249** matched exactly, **${String(corroborated.length)}** more were settled from the`);
      out.push(`portal's own code list, and **${String(proposed.length)}** are guesses you have to read.`);
    }
    out.push("");
    out.push("**Spot-check** — every 25th derived match, so it is the same rows every run:");
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

    if (derivation.collisions.length > 0) {
      out.push("### Withdrawn — one option, two countries");
      out.push("");
      out.push("Each of these had a proposal, and the proposals landed on the same submitted value.");
      out.push("None is offered as a candidate: approving one would put a student from one country on");
      out.push("the other's application.");
      out.push("");
      out.push(
        table(
          derivation.collisions.map((collision) => [
            cell(collision.countries.map((c) => `${c.code} ${c.name}`).join(" · ")),
            cell(collision.option.label),
            `\`${cell(collision.option.value)}\``,
          ]),
          ["the countries that collided", "the one option", "submitted value"],
        ),
      );
      out.push("");
    } else if (derivation.shape === "name") {
      out.push("### Withdrawn — one option, two countries");
      out.push("");
      out.push("**None.** The rule ran and found no submitted value proposed for two countries.");
      out.push("");
    }

    if (corroborated.length > 0) {
      out.push(`### Corroborated by the portal itself (${String(corroborated.length)}) — read if you want to, not because you must`);
      out.push("");
      out.push("The portal's own code-valued select names this code, and that name is in this list.");
      out.push("No name of ours took part.");
      out.push("");
      out.push(
        table(
          corroborated.map((u) => [
            `\`${u.country.code}\``,
            cell(u.country.name),
            cell(u.candidate?.label ?? ""),
            `\`${cell(u.candidate?.value ?? "")}\``,
          ]),
          ["code", "our name", "the portal's option text", "submitted value"],
        ),
      );
      out.push("");
    }

    if (proposed.length > 0) {
      out.push(`### To read (${String(proposed.length)}) — a guess from our name against the portal's text`);
      out.push("");
      out.push("This is the column that needs you. Nothing acts on it until you say so.");
      out.push("");
      out.push(
        table(
          proposed.map((u) => [
            `\`${u.country.code}\``,
            cell(u.country.name),
            cell(u.candidate?.label ?? ""),
            `\`${cell(u.candidate?.value ?? "")}\``,
          ]),
          ["code", "our name", "proposed option text (UNVERIFIED)", "submitted value"],
        ),
      );
      out.push("");
    }

    if (absent.length > 0) {
      out.push(`### Absent (${String(absent.length)}) — the portal's list has no trace of these`);
      out.push("");
      out.push("Searched by the portal's own name for the code as well as by ours. A row here means");
      out.push("the list does not carry the country, not that the search failed.");
      out.push("");
      out.push(
        table(
          absent.map((u) => [`\`${u.country.code}\``, cell(u.country.name), cell(u.why)]),
          ["code", "our name", "why"],
        ),
      );
      out.push("");
    }

    if (derivation.unclaimed.length > 0) {
      out.push(`### What the portal offers that nothing claimed (${String(derivation.unclaimed.length)})`);
      out.push("");
      out.push("Read this beside the tables above: between them they are the whole disagreement.");
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
  out.push("signature you offered to spend. The derived and corroborated fields are then held by");
  out.push("`scripts/derive-country-mappings.test.ts`, which re-derives them and fails if the entry");
  out.push("and the derivation ever disagree. What you read is held by your reading, recorded here.");
  out.push("");
  return out.join("\n");
}

/**
 * Every country select of the entry, derived together.
 *
 * Together, because pass 2 needs the portal's code-valued selects to settle
 * the name-valued ones: a field cannot be derived in isolation from the portal
 * it belongs to.
 */
export function derivationsFrom(entryJson: string): readonly Derivation[] {
  const selects = COUNTRY_FIELD_REFS.map((ref) => optionsFromEntry(entryJson, ref));
  const portalLabels = portalLabelsForCodes(selects);
  return COUNTRY_FIELD_REFS.map((fieldRef, index) =>
    deriveCountryMapping(fieldRef, selects[index] ?? [], portalLabels),
  );
}

function main(): void {
  const entryJson = readFileSync(ENTRY, "utf8");
  const derivations = derivationsFrom(entryJson);
  writeFileSync(PAGE, reviewPage(derivations), "utf8");
  for (const d of derivations) {
    console.log(
      `${d.fieldRef.padEnd(30)} ${d.shape.padEnd(9)} offered ${String(d.offered).padStart(3)}` +
        `  derived ${String(d.matched.length).padStart(3)}/249` +
        `  corroborated ${String(d.unmatched.filter((u) => u.kind === "portal_corroborated").length).padStart(2)}` +
        `  proposed ${String(d.unmatched.filter((u) => u.kind === "name_resemblance").length).padStart(2)}` +
        `  absent ${String(d.unmatched.filter((u) => u.kind === "absent").length).padStart(2)}` +
        `  collisions ${String(d.collisions.length).padStart(2)}`,
    );
  }
  console.log(`\nWritten: ${PAGE}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("derive-country-mappings.ts")) main();
