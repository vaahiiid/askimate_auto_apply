/**
 * The synthetic profile for Run A, shown before it is written (P150).
 *
 * Vahid, 2026-09-16: *"the synthetic profile: I want to see its values before
 * it seeds."* So this command has two modes, and the first is the default:
 *
 *   pnpm run profile:seed <profile.json>
 *       prints every value the file holds, and writes NOTHING.
 *
 *   pnpm run profile:seed <profile.json> --write --subject <label>
 *       writes them for the student whose `subject` is <label> on the
 *       conversation database (`AAS_CONVERSATION_DATABASE_URL`), creating the
 *       students row if there is none, and REFUSES if that student already has
 *       any profile entry — a seed never overwrites what a person has said.
 *
 * What is written is what the interview would have written, through the same
 * store (`PostgresConfirmedProfileStore`) and in the same stored shape, with
 * one honest difference: the provenance of every entry says it was seeded from
 * this file by this command on this date and that no interview took place.
 * Nothing here mints a `ConfirmedValue`: the store takes plain stored entries,
 * and the brand is minted at load by `rehydrateProfile` as for any row.
 *
 * The identity it prints is the `students.id` UUID — the only value the
 * profile store, the dev-session route and an `ownAccountOnly` approval agree
 * on (`profile_entries.student_id` is a uuid referencing `students`), and NOT
 * the label: post the UUID as the dev session's `subject`, and write it into
 * the approval.
 */
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { PostgresConfirmedProfileStore } from "@askimate/aas-conversation-service";
import type { StoredProfileEntry } from "@askimate/aas-profile";
import { PROFILE_FIELD_KEYS } from "@askimate/aas-profile";

export interface ProfileFixture {
  readonly entries: readonly { readonly key: StoredProfileEntry["key"]; readonly value: unknown }[];
}

export type FixtureRefusal =
  | { readonly kind: "not_an_object" }
  | { readonly kind: "entries_missing" }
  | { readonly kind: "entry_malformed"; readonly index: number }
  | { readonly kind: "unknown_key"; readonly key: string }
  | { readonly kind: "duplicate_key"; readonly key: string };

/** Reads a fixture: `{ entries: [{ key, value }] }` in the profile store's stored (encoded) shape. */
export function readFixture(text: string): { ok: true; fixture: ProfileFixture } | { ok: false; refusal: FixtureRefusal } {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, refusal: { kind: "not_an_object" } };
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return { ok: false, refusal: { kind: "entries_missing" } };
  const known = new Set<string>(PROFILE_FIELD_KEYS);
  const seen = new Set<string>();
  const out: { key: StoredProfileEntry["key"]; value: unknown }[] = [];
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "object" || entry === null || !("key" in entry) || !("value" in entry)) {
      return { ok: false, refusal: { kind: "entry_malformed", index } };
    }
    const { key, value } = entry as { key: unknown; value: unknown };
    if (typeof key !== "string" || !known.has(key)) return { ok: false, refusal: { kind: "unknown_key", key: String(key) } };
    if (seen.has(key)) return { ok: false, refusal: { kind: "duplicate_key", key } };
    seen.add(key);
    out.push({ key: key as StoredProfileEntry["key"], value });
  }
  return { ok: true, fixture: { entries: out } };
}

/** Every value, one per line, in the stored shape — dates as `{"$date": …}` — so what is shown is what is written. */
export function renderValues(fixture: ProfileFixture): string {
  const width = Math.max(...fixture.entries.map((e) => e.key.length));
  return fixture.entries.map((e) => `${e.key.padEnd(width)}  ${JSON.stringify(e.value)}`).join("\n");
}

export type SeedOutcome =
  | { readonly ok: true; readonly studentId: string; readonly created: boolean; readonly written: number }
  | { readonly ok: false; readonly kind: "profile_not_empty"; readonly studentId: string; readonly held: number };

/** Writes the fixture for the student with this `subject`, creating the row if needed; refuses a non-empty profile. */
export async function seedProfile(
  pool: pg.Pool,
  fixture: ProfileFixture,
  subject: string,
  now: Date,
  fixtureName: string,
): Promise<SeedOutcome> {
  const found = await pool.query<{ id: string }>("SELECT id FROM students WHERE subject = $1", [subject]);
  let studentId = found.rows[0]?.id;
  let created = false;
  if (studentId === undefined) {
    const inserted = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ($1, true) RETURNING id",
      [subject],
    );
    studentId = inserted.rows[0]!.id;
    created = true;
  }
  const held = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM profile_entries WHERE student_id = $1", [studentId]);
  const count = Number(held.rows[0]?.n ?? "0");
  if (count > 0) return { ok: false, kind: "profile_not_empty", studentId, held: count };
  const store = new PostgresConfirmedProfileStore(pool);
  for (const entry of fixture.entries) {
    await store.save(studentId, {
      key: entry.key,
      value: entry.value,
      provenance: {
        source: "student_entered",
        confirmedAt: now,
        sourceExcerpt:
          `seeded from ${fixtureName} by \`pnpm run profile:seed --write\` on ${now.toISOString()}; ` +
          "no interview took place — a synthetic profile for the owner's own account (P150)",
      },
      revision: 1,
    });
  }
  return { ok: true, studentId, created, written: fixture.entries.length };
}

function usage(): void {
  console.error(
    "Usage:\n" +
      "  pnpm run profile:seed <profile.json>                         print the values; write nothing\n" +
      "  pnpm run profile:seed <profile.json> --write --subject <s>   write them for the student whose subject is <s>\n" +
      "                                                               (AAS_CONVERSATION_DATABASE_URL; refuses a non-empty profile)\n",
  );
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const path = args[0];
  if (path === undefined || path.startsWith("--")) return usage();
  const write = args.includes("--write");
  const subjectAt = args.indexOf("--subject");
  const subject = subjectAt === -1 ? undefined : args[subjectAt + 1];
  if (write && (subject === undefined || subject.startsWith("--"))) return usage();

  const read = readFixture(await readFile(resolve(path), "utf8"));
  if (!read.ok) {
    console.error(`✗ ${path}: ${JSON.stringify(read.refusal)}`);
    process.exitCode = 1;
    return;
  }
  const { fixture } = read;
  console.log(`${String(fixture.entries.length)} value(s) in ${path}:\n`);
  console.log(renderValues(fixture));
  console.log();

  if (!write) {
    console.log("Nothing written. Add --write --subject <label> to seed them.");
    return;
  }
  const url = process.env["AAS_CONVERSATION_DATABASE_URL"];
  if (url === undefined || url.length === 0) {
    console.error("✗ --write needs AAS_CONVERSATION_DATABASE_URL (the conversation database the local stack created).");
    process.exitCode = 1;
    return;
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    // eslint-disable-next-line no-restricted-syntax -- an entry point is where the real clock is made
    const outcome = await seedProfile(pool, fixture, subject ?? "", new Date(), basename(path));
    if (!outcome.ok) {
      console.error(
        `✗ Not written: the student with subject "${subject ?? ""}" (id ${outcome.studentId}) already holds ` +
          `${String(outcome.held)} profile entr(ies). A seed never overwrites what a person has said.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `✓ ${String(outcome.written)} value(s) written for subject "${subject ?? ""}" ` +
        `(${outcome.created ? "students row created" : "existing students row"}).\n\n` +
        `studentId: ${outcome.studentId}\n\n` +
        "This UUID is the identity everything else keys on: post it as the dev session's `subject`,\n" +
        "and write it into the approval's ownAccountOnly.studentId (ADR-0118).",
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
