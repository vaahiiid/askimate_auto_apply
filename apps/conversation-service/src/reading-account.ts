/**
 * The account of a reading: its structure, kept, and its sentence, said
 * (P248; ADR-0148 §9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-09-29, on the sentence: *"'Things it did not say' and 'things
 * that are yours to tell me' are different kinds of missing, and a student
 * reading the first version would think their CV was deficient for not
 * stating whether a job was full-time. It is not — we never asked it to."*
 *
 * And on where it ends up: *"The sentence is right for a text conversation.
 * It is not the confirmation. When the interface exists, a student who
 * uploads a CV should see everything that was read from it as a table —
 * every job, every qualification, every part — and confirm it there, with
 * the gaps visible in the same view… keep the report's structure intact
 * rather than collapsing it into prose — the table needs the parts, the
 * entries and the gaps, and if the only thing that survives is a sentence we
 * will be rebuilding it later."*
 *
 * So two things come out of one report. The STRUCTURE — every entry, which
 * parts it gave, which it did not and of what kind — is kept on the reading's
 * row, in part keys and nothing else: the values and their words are on the
 * conversation log as part readings, keyed `item{n}.<part>` with the
 * document as their origin, and the table is the join of the two. The
 * SENTENCE is derived from the structure and said once, because today the
 * only surface is text. Nothing here reads the log; nothing here holds a
 * word of the document.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReadingOutcome, ReadingReport } from "@askimate/aas-contracts";
import { partLabel } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";

/** One entry as read: which parts the document gave, and which it did not, by kind. Part keys only. */
export interface ReadingStructureEntry {
  /** The reader's one-based index, in document order. */
  readonly index: number;
  /** Parts the document stated, whole. */
  readonly read: readonly string[];
  /** Document parts the document did not state, or stated as something else — "things it did not say". */
  readonly missing: readonly string[];
  /** Parts read in part, with the components still to ask: a year without its month. */
  readonly partial: Readonly<Record<string, readonly string[]>>;
  /** The student's to state, never asked of the document (ADR-0149) — "things that are yours to tell me". */
  readonly student: readonly string[];
}

export interface ReadingStructureList {
  readonly fieldKey: string;
  /** Whether the walk was seeded from this list — false when the student had already begun or confirmed the field, and the document did not overrule them. */
  readonly seeded: boolean;
  /** The entries offered to the walk, in order. */
  readonly entries: readonly ReadingStructureEntry[];
  /** Entries the reader cut and could not read whole — an invented span, two date ranges cut as one, nothing read — and does not offer. A count. */
  readonly unread: number;
}

export interface ReadingStructure {
  readonly lists: readonly ReadingStructureList[];
}

/**
 * The structure of a report, for the row: part keys, kinds and counts, and
 * no value or span. `seeded` names the lists whose entries went onto the log.
 */
export function structureOf(report: ReadingReport, seeded: ReadonlySet<string>): ReadingStructure {
  return {
    lists: (report.lists ?? []).map((list) => {
      const offered = list.entries.filter((entry) => Object.keys(entry.fields).length > 0);
      return {
        fieldKey: list.fieldKey,
        seeded: seeded.has(list.fieldKey),
        entries: offered.map((entry) => {
          const student = new Set(entry.student);
          const partial = Object.fromEntries(Object.entries(entry.partial ?? {}).map(([key, inPart]) => [key, [...inPart.lacking]]));
          return {
            index: entry.index,
            read: Object.keys(entry.fields),
            missing: entry.toAsk.filter((key) => !student.has(key) && !(key in partial)),
            partial,
            student: [...entry.student],
          };
        }),
        unread: list.dropped + (list.entries.length - offered.length),
      };
    }),
  };
}

// ── The words ───────────────────────────────────────────────────────────────

/** A part named as a student would, per list: what the document did not say, and how to say the part of it that it did (P248). */
const PHRASES: Readonly<Record<string, Readonly<Record<string, { readonly whole: string; readonly inPart?: string }>>>> = {
  "employment.history": {
    position: { whole: "the job title" },
    employer: { whole: "the employer" },
    employerAddress: { whole: "the employer's address" },
    startDate: { whole: "when it started", inPart: "the month it started" },
    end: { whole: "when it ended", inPart: "the month it ended" },
    duties: { whole: "what you did there" },
    basis: { whole: "whether it was full-time or part-time" },
    refereeName: { whole: "the referee's name" },
    refereeRole: { whole: "the referee's role" },
  },
  "education.prior_qualifications": {
    awardTitle: { whole: "the award title" },
    subject: { whole: "the subject" },
    institution: { whole: "the institution" },
    countryCode: { whole: "the country" },
    level: { whole: "the level" },
    start: { whole: "when it started", inPart: "the month it started" },
    end: { whole: "when it ended", inPart: "the month it ended" },
    grade: { whole: "the grade" },
    gradeScale: { whole: "the grade scale" },
    award: { whole: "the award date" },
  },
};

/** Two parts said as one, where the pair reads better than the list: "when it started and ended". */
const PAIRS: readonly { readonly first: string; readonly second: string; readonly whole: string; readonly inPart?: string }[] = [
  { first: "startDate", second: "end", whole: "when it started and ended", inPart: "the months it started and ended" },
  { first: "start", second: "end", whole: "when it started and ended", inPart: "the months it started and ended" },
  { first: "grade", second: "gradeScale", whole: "the grade and its scale" },
];

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function plural(n: number, noun: string): string {
  return `${countWord(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a; b; and c" — his shape: each group is a clause, the last one is joined with "and". */
function clauses(groups: readonly string[]): string {
  if (groups.length <= 1) return groups.join("");
  return `${groups.slice(0, -1).join("; ")}; and ${groups[groups.length - 1] ?? ""}`;
}

interface Gap {
  readonly partKey: string;
  readonly inPart: boolean;
}

/** The phrases for one entry-group's gaps, pairs merged, in the list's own order. */
function phrasesFor(fieldKey: string, gaps: readonly Gap[]): readonly string[] {
  const table = PHRASES[fieldKey] ?? {};
  const remaining = new Map(gaps.map((gap) => [gap.partKey, gap.inPart] as const));
  const out: string[] = [];
  const phraseOf = (partKey: string, inPart: boolean): string => {
    const known = table[partKey];
    if (known !== undefined) return inPart ? (known.inPart ?? known.whole) : known.whole;
    return `the ${partLabel(fieldKey as ProfileFieldKey, partKey) ?? partKey}`;
  };
  for (const gap of gaps) {
    if (!remaining.has(gap.partKey)) continue;
    const pair = PAIRS.find((candidate) => candidate.first === gap.partKey && remaining.has(candidate.second) && remaining.get(candidate.second) === gap.inPart);
    if (pair !== undefined && (!gap.inPart || pair.inPart !== undefined)) {
      out.push(gap.inPart ? (pair.inPart ?? pair.whole) : pair.whole);
      remaining.delete(pair.first);
      remaining.delete(pair.second);
      continue;
    }
    out.push(phraseOf(gap.partKey, gap.inPart));
    remaining.delete(gap.partKey);
  }
  return out;
}

/**
 * The gaps of one list as clauses: "for one job, what you did there", "for
 * each qualification, the country". A part every entry asks is "for each";
 * otherwise the count of entries asking it, and parts asked by the same
 * entries are said together.
 */
function gapClauses(list: ReadingStructureList, itemLabel: string, kind: "document" | "student"): readonly string[] {
  const total = list.entries.length;
  const order: string[] = [];
  const counts = new Map<string, { n: number; inPart: boolean }>();
  for (const entry of list.entries) {
    const gaps: Gap[] =
      kind === "student"
        ? entry.student.map((partKey) => ({ partKey, inPart: false }))
        : [...entry.missing.map((partKey) => ({ partKey, inPart: false })), ...Object.keys(entry.partial).map((partKey) => ({ partKey, inPart: true }))];
    for (const gap of gaps) {
      const key = `${gap.partKey}${gap.inPart ? "#part" : ""}`;
      if (!counts.has(key)) {
        order.push(key);
        counts.set(key, { n: 0, inPart: gap.inPart });
      }
      const held = counts.get(key);
      if (held !== undefined) held.n += 1;
    }
  }
  // Group by how many entries ask it, in first-seen order of the count.
  const byCount = new Map<number, Gap[]>();
  for (const key of order) {
    const held = counts.get(key);
    if (held === undefined) continue;
    const group = byCount.get(held.n) ?? [];
    group.push({ partKey: key.replace(/#part$/, ""), inPart: held.inPart });
    byCount.set(held.n, group);
  }
  const out: string[] = [];
  for (const [n, gaps] of byCount) {
    const scope = n === total ? `for each ${itemLabel}` : `for ${plural(n, itemLabel)}`;
    out.push(`${scope}, ${phrasesFor(list.fieldKey, gaps).join(", ")}`);
  }
  return out;
}

/**
 * What to tell the student once a reading has ended, in his words and his
 * split (P248). Never a value, never a span: counts and the names of parts.
 *
 * `itemLabel` names one entry of a list as the student knows it ("job",
 * "qualification"); a list it cannot name is left out of the counts.
 */
export function readingSentence(input: {
  readonly outcome: ReadingOutcome;
  readonly structure?: ReadingStructure;
  readonly itemLabel: (fieldKey: string) => string | null;
  /** What the student called the document. */
  readonly documentName?: string;
}): string {
  const name = input.documentName ?? "CV";
  const named = (input.structure?.lists ?? []).map((list) => ({ list, label: input.itemLabel(list.fieldKey) })).filter((pair): pair is { list: ReadingStructureList; label: string } => pair.label !== null);
  const nouns = named.map((pair) => `${pair.label}s`);
  const about = nouns.length === 0 ? "it" : nouns.length === 1 ? `your ${nouns[0] ?? ""}` : `your ${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1] ?? ""}`;
  if (input.outcome === "failed" || input.structure === undefined) {
    return `I could not read your ${name} as text, so I will ask you about ${nouns.length === 0 ? "your jobs and qualifications" : about} as usual.`;
  }
  const seeded = named.filter((pair) => pair.list.seeded);
  if (seeded.length === 0) {
    return `I read your ${name}. You had already told me about ${about}, so I have kept what you said.`;
  }
  const filled = seeded.filter((pair) => pair.list.entries.length > 0);
  const unreadPairs = seeded.filter((pair) => pair.list.unread > 0);
  if (filled.length === 0) {
    const what = seeded.map((pair) => pair.label);
    return `I read your ${name} but could not read any ${what.join(" or ")} whole, so I will ask you about ${about} as usual.`;
  }
  const counts = filled.map((pair) => plural(pair.list.entries.length, pair.label));
  const countWords = counts.length === 1 ? (counts[0] ?? "") : `${counts.slice(0, -1).join(", ")} and ${counts[counts.length - 1] ?? ""}`;
  const unreadTotal = unreadPairs.reduce((sum, pair) => sum + pair.list.unread, 0);
  let opening: string;
  if (unreadTotal === 0) {
    opening = `I read your ${name} and filled in ${countWords} from it.`;
  } else {
    // His sentence: "I read your CV and filled in six jobs; one I could not
    // read whole, so I will ask you about it." The noun goes in only when
    // there is more than one list to tell apart.
    const unread = unreadPairs.map((pair) => (filled.length === 1 ? countWord(pair.list.unread) : plural(pair.list.unread, pair.label)));
    opening = `I read your ${name} and filled in ${countWords}; ${unread.join(" and ")} I could not read whole, so I will ask you about ${unreadTotal === 1 ? "it" : "them"}.`;
  }
  const said = filled.flatMap((pair) => gapClauses(pair.list, pair.label, "document"));
  const theirs = filled.flatMap((pair) => gapClauses(pair.list, pair.label, "student"));
  const sentences = [opening];
  if (said.length > 0) sentences.push(`I still need a few things it did not say: ${clauses(said)}.`);
  if (theirs.length > 0) sentences.push(`${said.length > 0 ? "And a few that are" : "A few things are"} yours to tell me: ${clauses(theirs)}.`);
  if (said.length === 0 && theirs.length === 0 && unreadTotal === 0) sentences.push("It gave me everything I need about them.");
  return sentences.join(" ");
}
