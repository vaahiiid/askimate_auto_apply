import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { EntryChoiceStore } from "./entry-choice-store.js";
import { MIGRATIONS_DIR } from "./index.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const HASH = `sha256:${"a".repeat(64)}`;
const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the entry choice store");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_entry_choices WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_entry_choices");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_entry_choices";
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  await migrate(pool, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

describeIfDatabase("a student's choice from a form's own list, recorded with the application (P290, ADR-0155)", () => {
  const choice = {
    choiceId: "ec_1",
    caseId: "case_1",
    conversationId: "conv_1",
    fieldRef: "institution-ts-control",
    item: 0,
    studentValue: "HHE",
    value: "Not in list",
    label: "Not in list",
    escape: true,
    searchedWith: "HHE",
    offerHash: HASH,
    chosenAt: NOW,
  };

  it("records a choice with the student's words beside the entry, and the escape as the escape", async () => {
    const store = new EntryChoiceStore(pool);
    const recorded = await store.record(choice);
    expect(recorded.recorded).toBe(true);
    expect(await store.forCase("case_1")).toEqual([choice]);
  });

  it("holds ONE choice per value: a second press records nothing and changes nothing", async () => {
    const store = new EntryChoiceStore(pool);
    const again = await store.record({ ...choice, choiceId: "ec_2", value: "UNI1", label: "Some University", escape: false });
    expect(again.recorded).toBe(false);
    expect(again.choice.value, "the first choice stands").toBe("Not in list");
    // Another entry of the same list, or another field, is its own choice.
    expect((await store.record({ ...choice, choiceId: "ec_3", item: 1 })).recorded).toBe(true);
    // The award title's escape submits the empty string (Sheffield).
    expect((await store.record({ ...choice, choiceId: "ec_4", fieldRef: "degree", value: "", label: "Not in list", studentValue: "DBA" })).recorded).toBe(true);
    expect(await store.forCase("case_1")).toHaveLength(3);
  });

  it("refuses at the database a choice with no words of the student's, or an offer it cannot trace", async () => {
    await expect(
      pool.query(
        "INSERT INTO entry_choices (choice_id, case_id, conversation_id, field_ref, student_value, chosen_value, chosen_label, is_escape, offer_hash, chosen_at) VALUES ('x1','c','v','f','','v','l',false,$1,now())",
        [HASH],
      ),
    ).rejects.toThrow(/entry_choices_student_value_check/);
    await expect(
      pool.query(
        "INSERT INTO entry_choices (choice_id, case_id, conversation_id, field_ref, student_value, chosen_value, chosen_label, is_escape, offer_hash, chosen_at) VALUES ('x2','c','v','f','w','v','l',false,'nope',now())",
      ),
    ).rejects.toThrow(/entry_choices_offer_hash_check/);
  });
});
