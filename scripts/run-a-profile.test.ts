/**
 * P150 — the synthetic profile for Run A, and the command that shows it
 * before it seeds.
 *
 * Vahid, 2026-09-16: *"the synthetic profile: I want to see its values before
 * it seeds."* Three things are held here: the fixture plans onto the
 * Sheffield drafts with nothing blocking on Part 1 (so the day is not spent
 * finding a hole in it); the command prints the values and writes nothing by
 * default; and with `--write` it writes exactly those values, through the
 * real store into a real migrated database, under a students row it created,
 * with a provenance that says it was seeded — and refuses to write twice.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import { labelledHash, loadCatalogueDirectory, parseBlueprint, parseMappingSet, parseReviewedEntryText, toCanonical } from "@askimate/aas-catalogue";
import { MIGRATIONS_DIR as CONVERSATION_MIGRATIONS, PostgresConfirmedProfileStore } from "@askimate/aas-conversation-service";
import { checkUsable, planFill, textOf } from "@askimate/aas-mapping";
import { migrate } from "@askimate/aas-migrate";
import type { ModelClient } from "@askimate/aas-llm";
import { beginRun, nextStep, requiredFieldsFor, specialistHandoverOf } from "@askimate/aas-orchestrator";
import type { RunState } from "@askimate/aas-orchestrator";
import { newInterview } from "@askimate/aas-interview";
import { studentId } from "@askimate/aas-domain";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { buildPreview, renderPreview, validatePlan } from "@askimate/aas-preparation";
import { rehydrateProfile } from "@askimate/aas-profile";
import type { StoredProfileEntry } from "@askimate/aas-profile";

import { readFixture, renderValues, seedProfile } from "./profile-seed.js";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = join(ROOT, "docs", "run-a", "synthetic-profile.json");
const DRAFTS = join(ROOT, "docs", "captures", "sheffield-pgt-2026-09-10");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

function fixture() {
  const read = readFixture(readFileSync(FIXTURE, "utf8"));
  if (!read.ok) expect.unreachable(JSON.stringify(read.refusal));
  return read.fixture;
}

function drafts() {
  const blueprint = parseBlueprint(JSON.parse(readFileSync(join(DRAFTS, "blueprint.draft.curated.json"), "utf8")));
  const mappingSet = parseMappingSet(JSON.parse(readFileSync(join(DRAFTS, "mapping-set.draft.json"), "utf8")));
  if (!blueprint.ok) expect.unreachable(JSON.stringify(blueprint.refusal));
  if (!mappingSet.ok) expect.unreachable(JSON.stringify(mappingSet.refusal));
  return { blueprint: blueprint.value, mappingSet: mappingSet.value };
}

describe("the synthetic profile for Run A (P150)", () => {
  it("holds one entry per registry field the Sheffield set reads, and nothing the set does not read", () => {
    const { mappingSet } = drafts();
    const read = new Set(
      mappingSet.mappings.flatMap((m) => (m.source.kind === "profile_field" ? [m.source.fieldKey] : [])),
    );
    const held = new Set(fixture().entries.map((e) => e.key));
    // Read by the set but deliberately not held: the entry date (hidden for a
    // resident abroad) — everything else the set reads, the fixture holds.
    expect([...read].filter((key) => !held.has(key))).toEqual(["residence.uk_entry_date"]);
    expect([...held].filter((key) => !read.has(key))).toEqual([]);
    expect(held.size).toBe(19);
  });

  it("plans onto the drafts with nothing blocking on Part 1, the education chain typed by name, and the preview inside the yes", () => {
    const { blueprint, mappingSet } = drafts();
    const asIfReviewed = { ...mappingSet, status: "reviewed" as const, reviewedBy: "Vahid Mohammadi", reviewedAt: new Date(0) };
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.detail);
    const now = new Date("2026-09-16T12:00:00Z");
    const profile = rehydrateProfile({
      studentId: "run-a",
      updatedAt: now,
      entries: fixture().entries.map((e) => ({ ...e, provenance: { source: "seeded", confirmedAt: now }, revision: 1 })),
    });
    const plan = planFill(blueprint, check.mappingSet, profile);
    // ── NOTHING blocks on Part 1 again — and for the right reason this time ──
    //
    // Until 2026-09-25 this asserted `[]` because `degree` carried
    // `Bachelor's degree → BSc`, a level rendered as a title (blocker 71): the
    // assertion was right about the code and the code was wrong about the
    // world. P209 made it refuse; P213 (ADR-0142) put the award title in the
    // registry as the student's own stated part, and the fixture states
    // `BSc` — which is what Run A typed on his account and he checked on
    // `summary.do`. So `[]` again, from a value the fixture states rather
    // than one a map derived.
    // ── Part 1 clean; Part 2 blocks by name (P215) ─────────────────────
    //
    // Page 12 — the taught-course page, read by Vahid in place on 2026-09-25 —
    // is in the blueprint with one map (`courseStartYear`, a reviewed constant
    // from the target's intake). Its other required boxes have no mapping
    // yet, on purpose: each waits on something named in the entry's note —
    // his statement of the study mode, his read with a course chosen, the
    // funding decision. So the plan blocks on exactly those five, loudly, and
    // on nothing in Part 1.
    const PART_2 = new Set(
      blueprint.pages.find((page) => page.pageRef === "page12")?.sections.flatMap((section) => section.fields.map((field) => field.fieldRef)) ?? [],
    );
    // P217: NOTHING blocks, on either part. The last Part 2 box, `startDate`,
    // turned out to be a row the page hides for a course with one fixed start
    // (three reads, the markup's own tooltips), so it is not a box on this
    // page. Part 1 and Part 2 plan clean from what the fixture states.
    expect(plan.blockers).toEqual([]);
    expect(PART_2.size, "page 12 is in the blueprint").toBeGreaterThan(0);
    const validation = validatePlan(blueprint, plan);
    expect(validation.violations).toEqual([]);
    expect(validation.unknownFields).toEqual([]);
    const typed = new Map(plan.instructions.map((i) => [`${i.fieldRef}${i.item === undefined ? "" : `#${String(i.item.index)}`}`, textOf(i.value)]));
    // The education chain, per P149; the UK-study qualification, per P150.
    expect(typed.get("institutionCountry-ts-control#0")).toBe("UNITED KINGDOM");
    expect(typed.get("institution-ts-control#0")).toBe("SHEFFIELD");
    expect(typed.get("degree#0"), "the title the fixture STATES, not one derived from its level").toBe("BSc");
    expect(typed.get("subjectSearch#0")).toBe("business");
    expect(typed.get("subject#0")).toBe("Business Management");
    expect(typed.get("gradingSystemId#0")).toBe("7");
    expect(typed.get("grade#0")).toBe("2.1");
    expect(typed.get("qualificationLevel")).toBe("UNIVERSITY_LEVEL");
    expect(typed.get("highestQualification(UNIVERSITY_LEVEL)")).toBe("UG DEGREE");
    // The preview builds from the WHOLE plan again — Part 2 included.
    const preview = buildPreview(blueprint, plan, new Map(), { portalHost: "www.sheffield.ac.uk" });
    if (!preview.built) expect.unreachable(preview.refusal.kind);
    const text = renderPreview(preview.preview);
    expect(text).toContain("University of Sheffield");
    expect(text).toContain("Business Management");
    // The two boxes read as the reviewer recorded them, with what the form is
    // sent beside (ADR-0109), and the country box carries the row's question
    // rather than its DOM id (0.2.25).
    expect(text).toContain('Select the country the institution is based in:: United Kingdom  (sent as "UNITED KINGDOM")');
    expect(text).toContain('Search for an institution...: University of Sheffield  (sent as "SHEFFIELD")');
    expect(text).not.toContain("institutionCountry-ts-control");
    // ADR-0139: the sentence that says what the university is being told names
    // documents by the PAGE'S own headings. Until P188 it read *"your
    // officialCertTranslation, your officialTranTranslation, …"* — four of the
    // portal's field names, two of them the wrong document.
    expect(text).toContain(
      "We are telling University of Sheffield that your Final Academic Certificate, your Final Academic Transcript, " +
        "your Final Academic Certificate Translation and your Final Academic Transcript Translation are coming later.",
    );
    for (const slot of ["certificate", "transcript", "officialCertTranslation", "officialTranTranslation", "certificateTranslation", "transcriptTranslation"]) {
      expect(text, `no field name reaches the student: ${slot}`).not.toContain(`You attach yourself: ${slot}`);
    }
    expect(text).not.toContain("a document this form does not name");
  });

  it("prints the values and writes nothing without --write", async () => {
    const child = spawn(TSX, ["scripts/profile-seed.ts", "docs/run-a/synthetic-profile.json"], {
      cwd: ROOT,
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(output).toContain("19 value(s)");
    expect(output).toContain(renderValues(fixture()));
    expect(output).toContain("Nothing written.");
  });

  it("refuses a fixture that names a field the registry does not hold, or names one twice", () => {
    expect(readFixture(JSON.stringify({ entries: [{ key: "identity.shoe_size", value: 42 }] }))).toEqual({
      ok: false,
      refusal: { kind: "unknown_key", key: "identity.shoe_size" },
    });
    expect(readFixture(JSON.stringify({ entries: [{ key: "identity.given_name", value: "A" }, { key: "identity.given_name", value: "B" }] }))).toEqual({
      ok: false,
      refusal: { kind: "duplicate_key", key: "identity.given_name" },
    });
  });
});

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P150 — the seed writes through the real store");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;
const DATABASE = "aas_run_a_profile_test";

describeIfDatabase("the seed, against a real migrated conversation database", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${DATABASE}`);
    } finally {
      await admin.end();
    }
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${DATABASE}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
    await migrate(pool, CASE_MIGRATIONS);
    await migrate(pool, CONVERSATION_MIGRATIONS);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the students row, writes every value through the store with a provenance that says it was seeded, and the store reads the same profile back", async () => {
    const now = new Date("2026-09-16T12:00:00Z");
    const outcome = await seedProfile(pool, fixture(), "run-a-test", now, "synthetic-profile.json");
    if (!outcome.ok) expect.unreachable(outcome.kind);
    expect(outcome.created).toBe(true);
    expect(outcome.written).toBe(19);
    const row = await pool.query<{ id: string; email_verified: boolean }>("SELECT id, email_verified FROM students WHERE subject = 'run-a-test'");
    expect(row.rows[0]?.id).toBe(outcome.studentId);
    expect(row.rows[0]?.email_verified).toBe(true);
    const loaded = await new PostgresConfirmedProfileStore(pool).load(outcome.studentId, now);
    expect(loaded.entries.size).toBe(19);
    const stored = await pool.query<{ field_key: string; provenance: { source: string; sourceExcerpt?: string } }>(
      "SELECT field_key, provenance FROM profile_entries WHERE student_id = $1 ORDER BY field_key",
      [outcome.studentId],
    );
    expect(stored.rows.map((r) => r.field_key)).toEqual([...fixture().entries.map((e) => e.key)].sort());
    for (const r of stored.rows) {
      // ADR-0121: the true word, not the nearest one. Vahid: "'Seeded, no
      // interview took place' is a real origin and the nearest honest word is
      // not it."
      expect(r.provenance.source).toBe("seeded");
      expect(r.provenance.sourceExcerpt).toContain("seeded from synthetic-profile.json");
      expect(r.provenance.sourceExcerpt).toContain("no interview took place");
    }
    // The values round-trip: what the store holds decodes to the fixture's.
    const decoded = await pool.query<{ field_key: StoredProfileEntry["key"]; value: unknown }>(
      "SELECT field_key, value FROM profile_entries WHERE student_id = $1",
      [outcome.studentId],
    );
    for (const e of fixture().entries) {
      expect(decoded.rows.find((r) => r.field_key === e.key)?.value, e.key).toEqual(e.value);
    }
  });

  it("refuses to write a second time: a seed never overwrites what a person has said", async () => {
    const again = await seedProfile(pool, fixture(), "run-a-test", new Date("2026-09-16T13:00:00Z"), "synthetic-profile.json");
    expect(again).toEqual({ ok: false, kind: "profile_not_empty", studentId: expect.any(String) as string, held: 19 });
    const count = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM profile_entries");
    expect(count.rows[0]?.n).toBe("19");
  });
});

describe("the catalogue entry for Run A (P152)", () => {
  const ENTRY = join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");
  const READ = join(ROOT, "docs", "run-a", "what-will-be-typed.md");

  function entry() {
    const parsed = parseReviewedEntryText(readFileSync(ENTRY, "utf8"));
    if (!parsed.ok) expect.unreachable(`${parsed.refusal.path}: ${parsed.refusal.detail}`);
    return parsed.value;
  }

  it("is the two drafts, parsed, plus the signature and nothing else — so the entry cannot drift from them unnoticed — with the refs and the delivery Run A needs", () => {
    const { blueprint, mappingSet } = drafts();
    const value = entry();
    // P154: signed. The drafts in docs/captures stay drafts (the record of the
    // reads); the entry is the drafts with the three signature fields set by
    // Vahid's act 1, and NOTHING else may differ.
    expect({ ...value.blueprint, status: "draft" }).toEqual(blueprint);
    const { status: _status, reviewedBy: _by, reviewedAt: _at, ...unsigned } = value.mappingSet;
    expect(unsigned).toEqual({ ...mappingSet, status: undefined, reviewedBy: undefined, reviewedAt: undefined } as unknown as typeof unsigned);
    expect(value.institutionRef).toBe("inst-sheffield");
    expect(value.courseRef).toBe("course-sheffield-msc-management-and-international-business");
    expect(value.intakeRef).toBe("2027-09");
    expect(value.requiredDocuments, "nothing attached by the runner on the international path").toEqual([]);
    expect(value.passwordDelivery).toBe("askimate_secure_channel");
    expect(value.portalAuthentication?.portalHost).toBe("www.sheffield.ac.uk");
    expect(value.portalAuthentication?.applicantChoosesPassword).toBe(true);
    expect(value.portalAuthentication?.mfaOrOtpRequired).toBe(false);
  });

  it("locates every page's SAVE by what that page's own read showed — name where no id was ever read (P176)", () => {
    // ═══════════════════════════════════════════════════════════════════
    // Found by Run A's attempt 3, 2026-09-21. The fill reached personal.do
    // and could not press Save: `LocatorNotFoundError`. Vahid read the page
    // on his own account — `input name=saveBtn`, **no id** — and the entry
    // said `id=saveBtn`. An authored locator no read had ever shown.
    //
    // It was a generalisation. The discovery of 2026-09-10 recorded
    // `id=saveBtn` on THREE pages (nationality.do, language.app,
    // documents.do) and, on the other six, a blank or stray label. Curation
    // then set `id=saveBtn` on all nine.
    //
    // MEASURED, 2026-09-21 — Vahid read all six on his own account,
    // read-only, after the first draft of this table inferred them:
    //
    //   personal.do            name only
    //   contact.do             name only
    //   employment.do          name only
    //   equalOpportunities.do  name only
    //   marketing.do           name only
    //   education.do?new=true  name AND id    ← the inference was WRONG here
    //
    // The locator below is right on all six — every one carries the name —
    // but the reasoning that produced it was not. It ran: `fieldRef =
    // field.name ?? field.id` (discovery.ts:146), all nine carry a `saveBtn`
    // field record, so a page the tool gave no id for must have taken that
    // ref from the name. True of five. On education.do the id is THERE and
    // the discovery simply failed to name it — a gap in the tool, not a fact
    // about the page. A right answer from a wrong premise is still a wrong
    // premise, and the next page it is used on may not be so lucky.
    //
    // nationality.do's captured markup (2026-09-15) shows BOTH
    // `name="saveBtn"` and `id="saveBtn"`; language.app and documents.do
    // have the id from the tool's read and no markup of their own, so `name`
    // there would be a guess in the other direction — they keep the id, and
    // the entry is signed at `sha256:3238406a…` with these locators.
    // ═══════════════════════════════════════════════════════════════════
    const READ: Record<string, { readonly strategy: string; readonly value: string }> = {
      // The entry page, from the 2026-09-11 entry read.
      page0: { strategy: "name", value: "startApplicationBtn" },
      // All six measured by Vahid, 2026-09-21. Five carry the name alone;
      // education carries both, and the name is what they have in common.
      page3: { strategy: "name", value: "saveBtn" }, // personal.do — name only
      page4: { strategy: "name", value: "saveBtn" }, // contact.do — name only
      page7: { strategy: "name", value: "saveBtn" }, // education.do — name AND id
      page8: { strategy: "name", value: "saveBtn" }, // employment.do — name only
      page9: { strategy: "name", value: "saveBtn" }, // equalOpportunities.do — name only
      page10: { strategy: "name", value: "saveBtn" }, // marketing.do — name only
      // The tool's own read named an id on these three.
      page5: { strategy: "id", value: "saveBtn" }, // nationality.do — markup shows name AND id
      page6: { strategy: "id", value: "saveBtn" }, // language.app
      page11: { strategy: "id", value: "saveBtn" }, // documents.do
      // Part 2's taught page, from Vahid's 2026-09-25 read: name only, as the
      // Part 1 pages he measured (P215).
      page12: { strategy: "name", value: "saveBtn" }, // studyprogrammetaught.do
    };
    for (const page of entry().blueprint.pages) {
      const expected = READ[page.pageRef];
      if (expected === undefined) {
        expect(page.advanceControl, `${page.pageRef} advances nothing`).toBeUndefined();
        continue;
      }
      expect(page.advanceControl, page.pageRef).toEqual(expected);
    }
  });

  it("is SIGNED by Vahid Mohammadi, one signature, his own account only — a SEVENTH time (36c4145) — and the entry has moved again for item 3, so the directory REFUSES it until the one signature at item 6", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Five signatures now, each superseding the last:
    //
    //   sha256:baca64a9…  16 September, the entry as first reviewed
    //   sha256:21060fca…  21 September 08:00, after the consent notice
    //                     (ADR-0131, P174) became signed content
    //   sha256:3238406a…  21 September 12:00, after six pages' save locators
    //                     were corrected from `id=saveBtn` to `name=saveBtn`
    //   sha256:56388e65…  22 September, after the education month maps were
    //                     corrected to the select's own Sept / June / July
    //                     (ADR-0136, P185)
    //   sha256:e2a10113…  22 September, THIS one — ADR-0138 and ADR-0139
    //                     together, the condition and the wording
    //
    // Each move made the previous approval stop covering the entry, and in
    // each interval the directory REFUSED to load and this test asserted the
    // refusal — ADR-0057 biting on real edits to a real signed entry rather
    // than being worked around. He computed every hash himself before signing
    // rather than taking it from an agent's report; the superseded approval
    // goes out in the same commit as the new one comes in, because an approval
    // left behind would assert an approval for content that no longer exists.
    //
    // ── What the fifth signature covers, and why it is ONE ───────────────
    //
    // `sha256:cdb43561…` existed for about an hour between P187 and P188 and
    // was never signed. Vahid, reading P187's preview before signing it:
    // *"There is no point signing cdb43561 and re-signing in an hour."*
    //
    //   ADR-0138 — a completed qualification is not asked for its proof of
    //   registration or its most recent transcript, so those two slots and
    //   their companions are not planned, previewed or set. The preview shows
    //   four documents, which is what the page shows.
    //
    //   ADR-0139 — the sentence that says what the university is being told
    //   named FOUR of the portal's field names, two of them the wrong
    //   document: `officialCertTranslation` is the page's *Final Academic
    //   Certificate*, not a translation of anything. The six slots now carry
    //   the page's own heading, read off each companion row's captured label
    //   and held to it by the parser.
    //
    // Both are what goes into a box, or what a student is told goes into one,
    // which is what separates this from the consent and save-locator
    // re-signatures: those governed how a page is reached and left.
    // ═══════════════════════════════════════════════════════════════════
    const value = entry();
    expect(value.blueprint.status).toBe("reviewed");
    expect(value.mappingSet.status).toBe("reviewed");
    expect(value.mappingSet.reviewedBy).toBe("Vahid Mohammadi");
    expect(value.mappingSet.reviewedAt?.toISOString()).toBe("2026-09-16T19:19:35.241Z");
    // ── THE INTERVAL AGAIN (P213, item 3 of the list): the award title ───
    //
    //   sha256:baca64a9…  16 September, the entry as first reviewed
    //   sha256:21060fca…  21 September 08:00, the consent notice (ADR-0131)
    //   sha256:3238406a…  21 September 12:00, six save locators by name
    //   sha256:56388e65…  22 September, the education months (ADR-0136)
    //   sha256:e2a10113…  22 September, ADR-0138 and ADR-0139 together
    //   sha256:f13dff6d…  25 September, the country maps (signed, f67ec69)
    //   sha256:be3b0ae0…  25 September, `degree` refuses by design (signed, 36c4145)
    //   sha256:55759f10…  25 September, `degree` is the student's own stated
    //                     title (ADR-0142), mapping set 0.3.37 (unsigned)
    //   sha256:26aafb1b…  25 September, every education row chosen to match
    //                     the synthetic profile says so in its note (P214),
    //                     mapping set 0.3.38 (unsigned)
    //   sha256:34e8e737…  25 September, Part 2's taught page in the blueprint
    //                     (0.2.29) with one map (0.3.39), P215 (unsigned)
    //   sha256:27f5b6c9…  25 September, the course, the qualification, the
    //                     study mode and the funding mapped (0.2.30 / 0.3.40,
    //                     ADR-0143), P216 (unsigned)
    //   sha256:80d99170…  25 September, THIS one — the start-date rows the page
    //                     hides for this course taken off page 12 (0.2.31 /
    //                     0.3.41), P217. Item 5 closed.
    //
    // The `degree` mapping reads `awardTitle` — the part the registry now
    // holds, stated by the student and distinct from `level` — onto the
    // select's own forty-one titles. Unsigned, on Vahid's instruction: *"If a
    // phase needs my signature, batch it — I would rather sign once at the end
    // of a working path than seven times along it."* So the directory REFUSES
    // to load until item 6, and this test asserts the refusal, as it has in
    // every interval. What it protects: the content it refuses to load is
    // content that types a value the student stated; the gate does not care
    // which direction a change goes.
    expect(labelledHash(toCanonical(value))).toBe("sha256:80d991700e4cf42e1b085d51de3fb7b4fbd35fb172834b89f2647feabf1250f7");
    const load = await loadCatalogueDirectory({ directory: join(ROOT, "docs", "run-a", "catalogue") });
    expect(load.ok, "REFUSED until he signs, at item 6 — ADR-0057 working").toBe(false);
    if (load.ok) expect.unreachable("expected the unsigned entry to be refused");
    expect(load.problems.map((problem) => problem.detail).join("; ")).toContain(
      "No approval exists for sha256:80d99170",
    );
    // The superseded approval is still the only one on file, and it now
    // approves content that no longer exists. It goes out in the SAME commit
    // as the new one comes in — never left beside it.
    const approvals = JSON.parse(readFileSync(join(ROOT, "docs", "run-a", "catalogue", "approvals.json"), "utf8")) as {
      contentHash: string;
    }[];
    expect(approvals, "one signature, and no stale approval beside it").toHaveLength(1);
    expect(approvals[0]?.contentHash, "still the degree-stop one, now void").toBe(
      "sha256:be3b0ae0ae64adf93c31384e0f10f53d31e28fb11b2b07fc5f8deb9e1900bfdd",
    );
    // The four spellings of Iran, from the entry itself: unchanged by this
    // edit, and the reason the countries' signature was spent.
    const iranIn = (fieldRef: string): string => {
      const mapping = value.mappingSet.mappings.find((m) => m.fieldRef === fieldRef);
      let rule: unknown = (mapping?.source as { format?: unknown } | undefined)?.format;
      while (rule !== null && typeof rule === "object") {
        if ((rule as { kind?: string }).kind === "option") {
          return (rule as { options: Record<string, string> }).options["IR"] ?? "";
        }
        rule = (rule as { then?: unknown }).then;
      }
      return "";
    };
    expect(iranIn("fundingNationality")).toBe("IR:O");
    expect(iranIn("permanentResidence")).toBe("Iran, Islamic Republic of:O");
    expect(iranIn("previousCountry1")).toBe("IRAN:O");
    expect(iranIn("corrCountry")).toBe("IRAN");
  });

  it("goes VOID the moment anything in the signed entry changes — loudly, at load (ADR-0057), never worked around", () => {
    // Vahid, before signing: "If anything in either changes afterwards — a
    // label, a value, a condition — the hash moves and the approval is void,
    // and I would rather that happened loudly than be worked around."
    const value = entry();
    const edited = {
      ...value,
      blueprint: {
        ...value.blueprint,
        pages: value.blueprint.pages.map((page) => ({
          ...page,
          sections: page.sections.map((section) => ({
            ...section,
            fields: section.fields.map((field) => (field.fieldRef === "dobMonth" ? { ...field, label: "Month of birth" } : field)),
          })),
        })),
      },
    };
    expect(labelledHash(toCanonical(edited))).not.toBe(labelledHash(toCanonical(value)));
  });

  it("the committed page-by-page read IS the command's output for the synthetic profile, and lists no registration page", async () => {
    const child = spawn(TSX, ["scripts/catalogue.ts", "preview", "docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json", "docs/run-a/synthetic-profile.json"], {
      cwd: ROOT,
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    // ── A FILLED APPLICATION, Part 1 and Part 2 (P217) ─────────────────
    //
    // Every box on the path is mapped, handed or hidden by the page's own
    // rule, so what will be typed is a page of values again — this time
    // through the course choice: the study mode in his words, the window, the
    // course entry, the qualification, and the funding as the fixture states
    // it. Nothing typed here came from a map's guess.
    expect(code).toBe(0);
    expect(output).toBe(readFileSync(READ, "utf8"));
    expect(output).toContain("REVIEWED — blueprint 0.2.31, mapping set 0.3.41, reviewed by Vahid Mohammadi.");
    expect(output).toContain("How do you want to study?*: Full Time");
    expect(output).toContain('(sent as "MGT:Management and International Business")');
    expect(output).toContain("MSC, Master of Science");
    expect(output).toContain("Self or Family");
    expect(output).not.toContain("blocker(s)");
    expect(output).not.toContain("render_refused");
    expect(output).not.toContain("no_mapping");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// What a student from a country the portal's list does not offer meets TODAY
// ───────────────────────────────────────────────────────────────────────────

describe("a country in the absent column, on the current build (P204)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Vahid, 2026-09-24, after signing off blocker 69's three name-keyed
  // fields: *"what a student from a country in the absent column meets
  // today. Not the shape 66 will give them — what happens now… If the answer
  // is 'the plan refuses and a person is called', say so. If it is anything
  // quieter than that, it is the same class as the silent seven and it should
  // be a blocker of its own before the signature."*
  //
  // The absent column of `docs/run-a/country-mapping-review.md` is the codes
  // the derivation could find NOTHING for in the portal's own list — not a
  // weak candidate rejected, an option that is not there. Curaçao, Antarctica
  // and the Caribbean Netherlands are three of them.
  //
  // This was traced once by hand to answer him. It is a test because a hand
  // trace answers the question once and guards nothing: the quiet failure he
  // is asking about is exactly the kind that would arrive later, by someone
  // making `planFill` fall back to the closest option or the orchestrator
  // treat a `render_refused` as a value the interview could ask for.
  //
  // The model is a stub that THROWS. Nothing about a country the portal does
  // not offer is a question for a model, and a stub that answers would hide
  // the run walking into the interview branch.
  // ═══════════════════════════════════════════════════════════════════════
  const NOW = new Date("2026-09-24T12:00:00Z");
  const REFUSING_MODEL = {
    composeQuestion: () => Promise.reject(new Error("the model must not be consulted")),
    composeDocumentRequest: () => Promise.reject(new Error("the model must not be consulted")),
    readDocument: () => Promise.reject(new Error("the model must not be consulted")),
  } as unknown as ModelClient;

  // The SIGNED entry, not the drafts: `nextStep` refuses a draft blueprint
  // before it ever looks at a plan, so a draft here would answer
  // `blueprint_not_executable` and prove nothing about a country. Found by
  // this test failing exactly that way on its first run.
  function signed() {
    const parsed = parseReviewedEntryText(
      readFileSync(join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json"), "utf8"),
    );
    if (!parsed.ok) expect.unreachable(`${parsed.refusal.path}: ${parsed.refusal.detail}`);
    return { blueprint: parsed.value.blueprint, mappingSet: parsed.value.mappingSet };
  }

  function stateFor(code: string): RunState {
    const { blueprint, mappingSet } = signed();
    const asIfReviewed = mappingSet;
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.detail);
    const profile = rehydrateProfile({
      studentId: "run-a",
      updatedAt: NOW,
      entries: fixture().entries.map((e) => ({
        ...e,
        ...(e.key === "residence.country" ? { value: code } : {}),
        provenance: { source: "seeded", confirmedAt: NOW },
        revision: 1,
      })),
    });
    return beginRun({
      inputs: {
        caseId: "case-absent",
        studentRef: studentId("run-a"),
        blueprint,
        mappingSet: asIfReviewed,
        documents: new Map(),
      },
      profile,
      interview: newInterview({
        studentRef: "run-a",
        profile,
        requiredFields: requiredFieldsFor(blueprint, check.mappingSet),
        requiredDocuments: [],
      }),
    });
  }

  // The control. Iran IS in every one of the six country maps, so the same
  // construction has to produce no country blocker at all — otherwise the
  // three below would prove only that this harness blocks everything.
  it("plans without a country blocker for a code the portal DOES offer", () => {
    const { blueprint } = signed();
    const state = stateFor("IR");
    const plan = planFill(blueprint, (checkUsable(state.inputs.mappingSet, blueprint) as { mappingSet: Parameters<typeof planFill>[1] }).mappingSet, state.profile);
    // No COUNTRY blocker — and no other: `degree` is typed from the stated
    // title since P213.
    expect(plan.blockers.flatMap((b) => (b.kind === "render_refused" ? [b.fieldRef] : []))).toEqual([]);
  });

  for (const [code, country] of [["CW", "Curaçao"], ["AQ", "Antarctica"], ["BQ", "Caribbean Netherlands"]] as const) {
    it(`refuses to write ${country} (${code}) and hands the run to a person — it does not guess the closest country`, async () => {
      const { blueprint } = signed();
      const state = stateFor(code);
      const usableSet = checkUsable(state.inputs.mappingSet, blueprint);
      if (!usableSet.usable) expect.unreachable(usableSet.refusal.detail);
      const plan = planFill(blueprint, usableSet.mappingSet, state.profile);

      // ── The plan refuses ────────────────────────────────────────────────
      // Named rather than counted, so a second refusal on the page can never
      // pass as this one.
      const refused = plan.blockers.find(
        (blocker) => blocker.kind === "render_refused" && blocker.fieldRef === "permanentResidence",
      );
      if (refused?.kind !== "render_refused") expect.unreachable("expected a residence refusal");
      expect(refused.fieldRef).toBe("permanentResidence");
      expect(refused.refusal.detail).toContain(`"${code}" is not one of this field's options`);
      // The standing rule, in the refusal's own words.
      expect(refused.refusal.detail).toContain("will not choose the closest one");
      // And nothing was written for that field regardless.
      expect(plan.instructions.some((instruction) => instruction.fieldRef === "permanentResidence")).toBe(false);

      // ── And a PERSON is called, not the student ─────────────────────────
      //
      // `render_refused` is structural, so `nextStep` takes the branch above
      // the interview's: it is not a value the student failed to give, and
      // asking them to pick a different country would be handing them our
      // problem (ADR-0007).
      const step = await nextStep(state, REFUSING_MODEL);
      expect(step.kind).toBe("specialist");
      if (step.kind !== "specialist") expect.unreachable("checked above");
      expect(step.reason).toBe("render_refused");
      expect(step.detail).toContain(`"${code}" is not one of this field's options`);

      // The run driver recognises the hand-over by the orchestrator's OWN
      // narrowing (ADR-0065), not by a comparison on `reason` — so every
      // reason reaches `#stopForSpecialist`, which raises the intervention
      // and tells the student once. This is the join between the two halves:
      // if `specialistHandoverOf` stopped narrowing this step, the driver
      // would fall through and the run would go quiet.
      const handover = specialistHandoverOf(step);
      expect(handover, "the driver's ADR-0065 stop sees this step").not.toBeNull();
      expect(handover?.reason).toBe("render_refused");
    });
  }
});
