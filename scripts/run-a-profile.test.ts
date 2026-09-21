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
    expect(held.size).toBe(18);
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
    expect(plan.blockers).toEqual([]);
    // ── The validator, which never ran on this entry until Run A stopped ──
    //
    // Found by Vahid at Run A's step 3, 2026-09-17: this test checked the
    // plan's blockers and nothing more, so the run was the first thing to
    // run `validatePlan` on the signed entry with this profile — and it
    // answered eighteen violations, every one a starred box in the language
    // section he had saved empty on the live portal (blocker 34, ADR-0123).
    // The gap is worth its own line: the plan and the validator are two
    // readings of one page, and only the run compared them.
    const validation = validatePlan(blueprint, plan);
    expect(validation.violations, "the run authorises only what the validator passes").toEqual([]);
    expect(validation.unknownFields).toEqual([]);
    const typed = new Map(plan.instructions.map((i) => [`${i.fieldRef}${i.item === undefined ? "" : `#${String(i.item.index)}`}`, textOf(i.value)]));
    // The education chain, per P149; the UK-study qualification, per P150.
    expect(typed.get("institutionCountry-ts-control#0")).toBe("UNITED KINGDOM");
    expect(typed.get("institution-ts-control#0")).toBe("SHEFFIELD");
    expect(typed.get("degree#0")).toBe("BSc");
    expect(typed.get("subjectSearch#0")).toBe("business");
    expect(typed.get("subject#0")).toBe("Business Management");
    expect(typed.get("gradingSystemId#0")).toBe("7");
    expect(typed.get("grade#0")).toBe("2.1");
    expect(typed.get("qualificationLevel")).toBe("UNIVERSITY_LEVEL");
    expect(typed.get("highestQualification(UNIVERSITY_LEVEL)")).toBe("UG DEGREE");
    expect(typed.get("previousStudentVisa")).toBe("yes");
    expect(typed.get("passportNumber")).toBe("no passport");
    expect(typed.get("livedOutsideCountry")).toBe("no");
    expect(typed.get("corrCountry")).toBe("IRAN");
    expect(typed.get("endMonth#0"), "a current job's end is empty").toBe("");
    // Nothing is handed to the student but the six document slots.
    expect(plan.handoffs.filter((h) => h.inputType !== "file")).toEqual([]);
    // What the student reads: the whole preview builds and renders.
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
    expect(output).toContain("18 value(s)");
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
    expect(outcome.written).toBe(18);
    const row = await pool.query<{ id: string; email_verified: boolean }>("SELECT id, email_verified FROM students WHERE subject = 'run-a-test'");
    expect(row.rows[0]?.id).toBe(outcome.studentId);
    expect(row.rows[0]?.email_verified).toBe(true);
    const loaded = await new PostgresConfirmedProfileStore(pool).load(outcome.studentId, now);
    expect(loaded.entries.size).toBe(18);
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
    expect(again).toEqual({ ok: false, kind: "profile_not_empty", studentId: expect.any(String) as string, held: 18 });
    const count = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM profile_entries");
    expect(count.rows[0]?.n).toBe("18");
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

  it("is SIGNED by Vahid Mohammadi, one signature, his own account only — RE-SIGNED a THIRD time after the save-locator correction (2026-09-21, commit d64e75d): the directory loads and admits exactly that account", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Three signatures now, and the third is the one this test is about.
    //
    //   sha256:baca64a9…  16 September, the entry as first reviewed
    //   sha256:21060fca…  21 September 08:00, after the consent notice
    //                     (ADR-0131, P174) became signed content
    //   sha256:3238406a…  21 September 12:00, after six pages' save locators
    //                     were corrected from `id=saveBtn` to `name=saveBtn`
    //
    // Each move made the previous approval stop covering the entry, and in
    // each interval the directory REFUSED to load and this test asserted the
    // refusal — ADR-0057 biting on real edits to a real signed entry rather
    // than being worked around.
    //
    // He computed each hash himself before signing rather than taking it from
    // an agent's report, and before this one he read all six save buttons on
    // his own account, read-only, because the correction had been inferred
    // rather than measured. The superseded approval goes out in the same
    // commit as the new one comes in: an approval left behind would assert an
    // approval for content that no longer exists.
    //
    // What did NOT move across either re-signature, and is why one signature
    // could replace another: docs/run-a/what-will-be-typed.md, line for line,
    // and its own reference hash. A consent choice governs what happens
    // before the form; a save locator is how a page is left. Neither is what
    // goes into a box.
    // ═══════════════════════════════════════════════════════════════════
    const value = entry();
    expect(value.blueprint.status).toBe("reviewed");
    expect(value.mappingSet.status).toBe("reviewed");
    expect(value.mappingSet.reviewedBy).toBe("Vahid Mohammadi");
    expect(value.mappingSet.reviewedAt?.toISOString()).toBe("2026-09-16T19:19:35.241Z");
    expect(labelledHash(toCanonical(value))).toBe("sha256:3238406aa4fec5d3301aa7e4f3101d86a75fa696d9c7b81f7b897f7224f262ba");
    const load = await loadCatalogueDirectory({ directory: join(ROOT, "docs", "run-a", "catalogue") });
    if (!load.ok) expect.unreachable(load.problems.map((p) => p.detail).join("; "));
    expect(load.catalogue.size).toBe(1);
    const loaded = await load.catalogue.find("bp-sheffield-pgt-september-direct");
    expect(loaded?.admits).toEqual({ kind: "one_account_only", studentId: "af398e01-c154-469d-a086-3e9c8c60a020", signedBy: "Vahid Mohammadi" });
    // ONE approval on file: the superseded one is gone, not merely outvoted.
    const approvals = JSON.parse(readFileSync(join(ROOT, "docs", "run-a", "catalogue", "approvals.json"), "utf8")) as unknown[];
    expect(approvals, "one signature, and no stale approval beside it").toHaveLength(1);
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
    expect(code).toBe(0);
    expect(output).toBe(readFileSync(READ, "utf8"));
    expect(output).toContain("REVIEWED — blueprint 0.2.26, mapping set 0.3.31, reviewed by Vahid Mohammadi.");
    // P153: the read's four label defects gone — the hidden selects are not
    // "left empty", the radios read Yes/No, the date selects carry the row's question.
    expect(output).not.toContain("institutionCode");
    expect(output).toContain("Have you previously studied in the United Kingdom on a Student Visa?: Yes  (sent as \"yes\")");
    expect(output).toContain("Date of Birth:*: April");
    expect(output).not.toContain("dobMonth");
    expect(output).not.toContain("exactly what will be submitted");
    expect(output).not.toContain("Sign in or start an application");
    expect(output).toContain("Search for an institution...: University of Sheffield");
    expect(output).toContain("Please select the qualification you studied:: Bachelors Degree");
  });
});
