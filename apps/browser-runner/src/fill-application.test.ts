/**
 * What the fill does when the page does not cooperate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Written after a deliberate regression was NOT detected. Changing the outcome
 * of a save that never lands from `uncertain` to `failed` broke nothing,
 * because the journey only ever exercises a portal that answers.
 *
 * It is the most consequential distinction in the fill: the click may have
 * reached the portal and the page may be saved, and `failed` asserts that
 * nothing happened on a university's system — a claim about somebody else's
 * database that this process is not entitled to make (ADR-0008).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ClaimedWork, WorkDocument } from "@askimate/aas-contracts";
import { DISCLOSE_DOCUMENT, b2Register } from "@askimate/aas-disclosure";
import type { ApplicationSession } from "@askimate/aas-execution";

import { documentSourceFor } from "./document-source.js";

import type { ChallengeProbe } from "./challenge.js";
import { fillApplication } from "./fill-application.js";

const NOW = new Date("2026-08-31T10:00:00Z");
/** No plane to ask, and no plan here references an upload (ADR-0099). */
const noDocuments = (): Promise<null> => Promise.resolve(null);
/** A page with nothing in the way. Every test below but the two about challenges. */
const unchallenged: ChallengeProbe = () => Promise.resolve(null);
const FORM = "https://portal.test/apply";

const WORK: ClaimedWork = {
  leaseId: "wl_1",
  expiresAt: NOW.toISOString(),
  runId: "run_1",
  caseId: "case_1",
  studentRef: "11111111-1111-1111-1111-111111111111",
  kind: "execute",
  portalHost: "portal.test",
  email: "niloofar@example.test",
  approach: "student_chosen",
  formUrl: FORM,
  advanceLocator: { strategy: "role", value: "button:Save and continue" },
  plan: {
    blueprintId: "bp",
    blueprintVersion: "1.0.0",
    mappingSetId: "ms",
    instructions: [
      {
        fieldRef: "given_name",
        label: "First name",
        inputType: "text",
        locators: [{ strategy: "label", value: "First name" }],
        value: {
          kind: "confirmed",
          fieldKey: "identity.given_name",
          text: "Niloofar",
          provenance: { source: "student_stated", confirmedAt: NOW.toISOString() },
        },
      },
    ],
    uploads: [],
  },
};

/** A session that does what it is told, and records it. */
function session(over: Partial<ApplicationSession> = {}): ApplicationSession & {
  readonly typed: string[];
  readonly clicked: string[];
} {
  const typed: string[] = [];
  const clicked: string[] = [];
  let url = FORM;
  return {
    typed,
    clicked,
    goto: (to: string) => {
      url = to;
      return Promise.resolve();
    },
    fill: (_locator, value) => {
      typed.push(String((value as unknown as { value: string }).value));
      return Promise.resolve();
    },
    fillConstant: (_locator, text) => {
      typed.push(text);
      return Promise.resolve();
    },
    click: (locator) => {
      clicked.push(locator.value);
      return Promise.resolve();
    },
    attach: () => Promise.reject(new Error("no documents")),
    awaitOption: () => Promise.resolve(),
    fillTypeahead: (_locator, _entries, value) => {
      typed.push(String((value as unknown as { value: string }).value));
      return Promise.resolve();
    },
    fillTypeaheadConstant: (_locator, _entries, text) => {
      typed.push(text);
      return Promise.resolve();
    },
    readValue: () => Promise.resolve("Niloofar"),
    count: () => Promise.resolve(0),
    currentUrl: () => Promise.resolve(url),
    ...over,
  };
}

describe("filling a page that does not cooperate", () => {
  it("types, then SAVES — because a portal keeps nothing until the page is saved", async () => {
    const live = session();
    expect(await fillApplication(WORK, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "succeeded",
    });
    expect(live.typed).toEqual(["Niloofar"]);
    expect(live.clicked, "the save is not optional").toEqual(["button:Save and continue"]);
  });

  it("reports UNCERTAIN when the save never lands, never a clean failure", async () => {
    const dying = session({
      click: () => Promise.reject(new Error("net::ERR_CONNECTION_RESET at /apply")),
    });
    const outcome = await fillApplication(WORK, { session: dying, now: () => NOW, documents: noDocuments, challenge: unchallenged });
    expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
    // And the page's error text is nowhere in the answer. There is no field on
    // the outcome that could hold what a site we do not control wrote.
    expect(JSON.stringify(outcome)).not.toContain("ERR_CONNECTION");
  });

  it("refuses when the student has been logged out", async () => {
    // The gate redirects to the registration page without a session. Only the
    // student can get us back in — the password was single-use and is gone —
    // so `needs_the_student` is the honest answer rather than a retry.
    const loggedOut = session({
      currentUrl: () => Promise.resolve("https://portal.test/register"),
    });
    expect(await fillApplication(WORK, { session: loggedOut, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "failed",
      failure: "needs_the_student",
    });
    expect(loggedOut.typed, "and nothing was typed into the wrong page").toEqual([]);
  });

  it("refuses a form that is not on the bound host", async () => {
    const elsewhere = session();
    const outcome = await fillApplication(
      { ...WORK, formUrl: "https://somewhere-else.test/apply" },
      { session: elsewhere, now: () => NOW, documents: noDocuments, challenge: unchallenged },
    );
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    expect(elsewhere.typed).toEqual([]);
  });

  it("refuses an execute item with no plan, rather than guessing", async () => {
    const idle = session();
    // Built by omission rather than by assigning `undefined`: with
    // `exactOptionalPropertyTypes` those are different things, and the wire
    // form of "absent" is the one a plane would actually send.
    const { plan: _plan, ...withoutAPlan } = WORK;
    void _plan;
    const outcome = await fillApplication(withoutAPlan, { session: idle, now: () => NOW, documents: noDocuments, challenge: unchallenged });
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    expect(idle.typed).toEqual([]);
  });

  it("reports a portal that refused, distinguished from drift", async () => {
    // `drift` is the executor's word for "the page was not what the blueprint
    // described". Everything else is the portal declining what we sent, and the
    // two lead to different work: one is a blueprint to re-review, the other is
    // content to fix.
    const refusing = session({
      fill: () => Promise.reject(new Error("the portal would not take it")),
    });
    expect(await fillApplication(WORK, { session: refusing, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "failed",
      failure: "portal_refused",
    });
  });
});

describe("a page asking for something only a person can pass (ADR-0101 §6)", () => {
  // Vahid, 2026-09-10: *"If a runner meets a CAPTCHA or a second factor where
  // A expects neither, it must stop and say which it met, not fail as a fill
  // error."* The probe reads the page; these prove what the fill does with
  // its answer — and that nothing is typed into a challenged page.
  it("stops BEFORE typing when the form carries a CAPTCHA, and says which", async () => {
    const live = session();
    const outcome = await fillApplication(WORK, {
      session: live,
      now: () => NOW,
      documents: noDocuments,
      challenge: () => Promise.resolve("captcha" as const),
    });
    expect(outcome).toEqual({ kind: "failed", failure: "captcha_met" });
    expect(live.typed, "nothing was typed into a challenged page").toEqual([]);
    expect(live.clicked, "and nothing was saved").toEqual([]);
  });

  it("says SECOND FACTOR, not 'needs the student', when the sign-in it was bounced to asks for a code", async () => {
    // Bounced off the form to a page that asks for a one-time code. Before
    // this phase that was `needs_the_student` — true, and not the fact that
    // decides what happens next (ADR-0101 §3 and §5).
    const bounced = session({ currentUrl: () => Promise.resolve("https://portal.test/verify") });
    const outcome = await fillApplication(WORK, {
      session: bounced,
      now: () => NOW,
      documents: noDocuments,
      challenge: () => Promise.resolve("second_factor" as const),
    });
    expect(outcome).toEqual({ kind: "failed", failure: "second_factor_met" });
    expect(bounced.typed).toEqual([]);
  });

  it("still reports a plain bounce as needing the student when no challenge is on the page", async () => {
    const bounced = session({ currentUrl: () => Promise.resolve("https://portal.test/login") });
    expect(
      await fillApplication(WORK, {
        session: bounced,
        now: () => NOW,
        documents: noDocuments,
        challenge: unchallenged,
      }),
    ).toEqual({ kind: "failed", failure: "needs_the_student" });
  });
});

describe("a page that carries a document (ADR-0069, P73)", () => {
  const BYTES = Buffer.from("%PDF-1.7\n a synthetic passport, not a real one\n");
  const HASH = createHash("sha256").update(BYTES).digest("hex");
  const DOCUMENT_ID = "01JQDOC0000000000000000001";

  /** The plane's hand-over, as `documentForWork` answers it, for THIS work. */
  const handed: WorkDocument = {
    documentId: DOCUMENT_ID,
    documentType: "passport",
    contentHash: HASH,
    contentType: "application/pdf",
    retrieval: { url: "https://vault.test/documents/stu/x?sig=1", method: "GET", expiresAt: NOW.toISOString() },
    disclosure: {
      disclosureId: "disc_run_1_passport_upload",
      subject: {
        documentId: DOCUMENT_ID,
        documentType: "passport",
        contentHash: HASH,
        caseId: WORK.caseId,
        requestedFor: "Upload your passport",
      },
      destination: { institutionName: "Example University", portalHost: WORK.portalHost },
      determinationId: DISCLOSE_DOCUMENT.determinationId,
      studentAuthorisation: {
        studentRef: WORK.studentRef,
        // Names the document, where it goes and for what, as the gate requires
        // the text the student saw to (ADR-0022, ADR-0098).
        presentedText:
          "Documents that will be sent:\n  Upload your passport: your passport\n    going to: Example University (portal.test)",
        authorisedAt: NOW.toISOString(),
        method: "chat_affirmation",
      },
    },
  };

  const WITH_UPLOAD: ClaimedWork = {
    ...WORK,
    plan: {
      ...WORK.plan!,
      uploads: [
        {
          fieldRef: "passport_upload",
          label: "Upload your passport",
          documentRef: "passport",
          locators: [{ strategy: "label", value: "Upload your passport" }],
        },
      ],
    },
  };

  function documents() {
    return documentSourceFor({
      intake: { document: () => Promise.resolve(handed) },
      work: WITH_UPLOAD,
      register: b2Register(NOW),
      fetch: () => Promise.resolve(new Response(new Uint8Array(BYTES), { status: 200 })),
    });
  }

  /** A recorded-marker on the slot: what the page shows when a file is held. */
  const WITH_RECORDED_UPLOAD: ClaimedWork = {
    ...WITH_UPLOAD,
    plan: {
      ...WITH_UPLOAD.plan!,
      uploads: WITH_UPLOAD.plan!.uploads.map((upload) => ({ ...upload, recorded: { strategy: "id", value: "passportHeld" } })),
    },
  };

  it("reports the transmission WITH the box it went into, once the page is saved AND the file is seen there (ADR-0106)", async () => {
    const attached: { documentId: string; bytes: number }[] = [];
    const live = session({
      attach: (_locator, documentId, contents) => {
        attached.push({ documentId, bytes: contents.length });
        return Promise.resolve();
      },
      // The reopened page shows the held file by the slot's marker.
      count: () => Promise.resolve(1),
    });
    const outcome = await fillApplication(WITH_RECORDED_UPLOAD, {
      session: live,
      now: () => NOW,
      documents: documents(),
      challenge: unchallenged,
    });
    expect(attached).toEqual([{ documentId: DOCUMENT_ID, bytes: BYTES.length }]);
    expect(live.clicked, "and the page was saved").toEqual(["button:Save and continue"]);
    expect(outcome).toEqual({
      kind: "succeeded",
      transmissions: [
        {
          fieldRef: "passport_upload",
          disclosureId: "disc_run_1_passport_upload",
          documentId: DOCUMENT_ID,
          contentHash: HASH,
          toHost: WORK.portalHost,
          institutionName: "Example University",
          caseId: WORK.caseId,
          transmittedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it("reports NO transmission when the save did not land — the portal kept nothing", async () => {
    const dying = session({
      attach: () => Promise.resolve(),
      click: () => Promise.reject(new Error("the tab died")),
    });
    const outcome = await fillApplication(WITH_UPLOAD, {
      session: dying,
      now: () => NOW,
      documents: documents(),
      challenge: unchallenged,
    });
    expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
  });

  // ── ADR-0106: a page is saved when the portal shows it ─────────────────

  it("reports UNCERTAIN, not_recorded, and NO transmission when the slot names nothing to see the file by", async () => {
    // Vahid, 2026-09-12: a save the portal dropped silently. A file input reads
    // back empty by HTML's rule, so without a marker nothing can show the file
    // was kept — and a transmission record for a dropped file is the worst case.
    const live = session({ attach: () => Promise.resolve(), count: () => Promise.resolve(1) });
    const outcome = await fillApplication(WITH_UPLOAD, { session: live, now: () => NOW, documents: documents(), challenge: unchallenged });
    expect(outcome).toEqual({ kind: "uncertain", failure: "not_recorded" });
  });

  it("reports the transmission when the reopened page shows the file by its marker, and UNCERTAIN when it does not", async () => {
    const shown = session({ attach: () => Promise.resolve(), count: () => Promise.resolve(1) });
    const seen = await fillApplication(WITH_RECORDED_UPLOAD, { session: shown, now: () => NOW, documents: documents(), challenge: unchallenged });
    expect(seen.kind).toBe("succeeded");
    expect(seen.kind === "succeeded" ? seen.transmissions?.length : 0).toBe(1);

    const dropped = session({ attach: () => Promise.resolve(), count: () => Promise.resolve(0) });
    const unseen = await fillApplication(WITH_RECORDED_UPLOAD, { session: dropped, now: () => NOW, documents: documents(), challenge: unchallenged });
    expect(unseen).toEqual({ kind: "uncertain", failure: "not_recorded" });
  });
});

describe("a page is saved when the portal shows it, not when a control was pressed (ADR-0106)", () => {
  /** A session whose page holds the value while typing, and afterwards what `afterSave` says. */
  function reopening(afterSave: string, extra: Partial<ApplicationSession> = {}) {
    const visited: string[] = [];
    let saved = false;
    const live = session({
      goto: (to) => {
        visited.push(to);
        return Promise.resolve();
      },
      click: (locator) => {
        if (locator.value === "button:Save and continue") saved = true;
        return Promise.resolve();
      },
      readValue: () => Promise.resolve(saved ? afterSave : "Niloofar"),
      ...extra,
    });
    return { live, visited };
  }

  it("reopens the page after the save and reads every filled value back before reporting it saved", async () => {
    const { live, visited } = reopening("Niloofar");
    expect(await fillApplication(WORK, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "succeeded",
    });
    // The form URL twice: once to fill, once to see.
    expect(visited).toEqual([FORM, FORM]);
  });

  it("reports UNCERTAIN, not_recorded — never succeeded — when the reopened page does not hold what was typed", async () => {
    // The press went through and nothing complained; the portal simply did not
    // keep it. Vahid's second qualification, 2026-09-12.
    const { live } = reopening("");
    expect(await fillApplication(WORK, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "uncertain",
      failure: "not_recorded",
    });
  });

  it("reports UNCERTAIN when the reopened page holds something ELSE — a value the portal changed is not a value it kept", async () => {
    const { live } = reopening("Niloufar");
    expect(await fillApplication(WORK, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "uncertain",
      failure: "not_recorded",
    });
  });

  const LISTING = { url: "https://portal.test/education", entryLocator: { strategy: "css" as const, value: "#qualifications li" } };
  const ITEM: ClaimedWork = { ...WORK, formUrl: "https://portal.test/education", repeat: { index: 1, count: 2, recorded: LISTING } };

  it("counts a repeating page's listing before and after: one more entry is the save, the same number is not", async () => {
    let entries = 1;
    const grows = session({
      count: () => Promise.resolve(entries),
      click: () => {
        entries += 1;
        return Promise.resolve();
      },
    });
    expect(await fillApplication(ITEM, { session: grows, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "succeeded",
    });

    const stays = session({ count: () => Promise.resolve(1) });
    expect(await fillApplication(ITEM, { session: stays, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "uncertain",
      failure: "not_recorded",
    });
  });

  it("reports UNCERTAIN for a repeating page that names no listing — a new-entry form reopens empty by design", async () => {
    const item: ClaimedWork = { ...WORK, formUrl: "https://portal.test/education", repeat: { index: 0, count: 1 } };
    expect(await fillApplication(item, { session: session(), now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "uncertain",
      failure: "not_recorded",
    });
  });

  it("refuses a listing on another host as drift, before anything is typed", async () => {
    const elsewhere: ClaimedWork = { ...ITEM, repeat: { index: 1, count: 2, recorded: { ...LISTING, url: "https://other.test/education" } } };
    const live = session();
    expect(await fillApplication(elsewhere, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged })).toEqual({
      kind: "failed",
      failure: "portal_drift",
    });
    expect(live.typed).toEqual([]);
  });
});

describe("the fill says what it did, in words it is allowed to say (ADR-0124 applied to the fill, P163)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Run A's third conversation, 2026-09-18: the sign-in succeeded and the
  // next line on disk was `uncertain (runner_fault)`. That code comes from
  // two places — the Save press threw, or something threw out of the fill —
  // and nothing said which, because P157 gave the sign-in its lines and left
  // the fill silent. Vahid: *"That is not a gap to note, it is the same
  // defect in a second place, and it should be fixed before the next attempt
  // rather than after."*
  // ═══════════════════════════════════════════════════════════════════════
  function collecting(): { readonly lines: string[]; readonly log: (line: string) => void } {
    const lines: string[] = [];
    return { lines, log: (line) => lines.push(line) };
  }
  /** The point read a test supplies: what the runner would say about the Save button's point. */
  const cover = (): Promise<string> =>
    Promise.resolve("at the button's point: div#cover (fixed, 1280×720 at 0,0) > button#save (static, 120×30 at 500,600)");

  it("says it is starting, and which page, BEFORE anything opens — so a fill that dies mid-page still said it began", async () => {
    const { lines, log } = collecting();
    const opened: string[] = [];
    const live = session({
      goto: (to) => {
        opened.push(to);
        expect(lines, "the start line precedes the first navigation").toHaveLength(1);
        return Promise.resolve();
      },
    });
    await fillApplication(WORK, { session: live, now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    // The form URL is a REVIEWED blueprint fact, as the login URL is on the
    // sign-in's line — not a URL from a page.
    expect(lines[0]).toBe(`run run_1: page fill starting, opening ${FORM}`);
    expect(opened[0]).toBe(FORM);
  });

  it("names the Save press as the thing that failed, which check was pending, and what stood at the button's point — never the error's text", async () => {
    const { lines, log } = collecting();
    const dying = session({
      click: () => Promise.reject(new Error("net::ERR_CONNECTION_RESET at /apply?session=tok_abc123")),
    });
    const outcome = await fillApplication(WORK, {
      session: dying, now: () => NOW, documents: noDocuments, challenge: unchallenged, log, atPoint: cover,
    });
    expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
    const failed = lines.find((line) => line.includes("could not be pressed"));
    expect(failed, "the source of this uncertain is named").toBeDefined();
    expect(failed).toContain("run run_1: page fill failed — the save button could not be pressed — Error: the network failed: ERR_CONNECTION_RESET");
    expect(failed).toContain("pending: a check this log does not name");
    expect(failed).toContain("at the button's point: div#cover (fixed, 1280×720 at 0,0) > button#save");
    // Nothing of the thrown message beyond the recognised code.
    expect(lines.join("\n")).not.toContain("tok_abc123");
    expect(lines.join("\n")).not.toContain("/apply?");
  });

  it("says the Save was NOT ON THE PAGE, in our words, when the entry names a control this page does not carry (P176)", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Run A, attempt 3, 2026-09-21. The fill reached personal.do and threw
    // `LocatorNotFoundError`; the line said *the point could not be read* and
    // *a check this log does not name*, and left the reader to infer from an
    // error class that the button was not there. Vahid: *"say in the line
    // that the locator found nothing, in our words."*
    //
    // The two cases are different in whose fault they are. Something over the
    // button is the portal's; a control the page does not carry is OURS — an
    // authored locator no read ever showed, which is exactly what
    // `id=saveBtn` was. A person sent to look at the wrong one loses a day.
    // ═══════════════════════════════════════════════════════════════════
    const { lines, log } = collecting();
    const missing = session({
      click: () => Promise.reject(new Error("LocatorNotFoundError: no element matches")),
    });
    const outcome = await fillApplication(WORK, {
      session: missing,
      now: () => NOW,
      documents: noDocuments,
      challenge: unchallenged,
      log,
      atPoint: cover,
      isPresent: () => Promise.resolve(false),
    });
    expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
    const failed = lines.find((line) => line.includes("could not be pressed"));
    expect(failed).toContain("the save button was not on the page at all — nothing matched what the entry says to press");
    // NOT the point read: there is no point to read, and saying one was tried
    // would be the inference this line exists to remove.
    expect(failed).not.toContain("at the button's point");
    expect(failed).not.toContain("the point could not be read");
  });

  it("still reads the point when the control IS on the page: the two cases stay apart (P176)", async () => {
    const { lines, log } = collecting();
    const dying = session({ click: () => Promise.reject(new Error("net::ERR_CONNECTION_RESET")) });
    await fillApplication(WORK, {
      session: dying,
      now: () => NOW,
      documents: noDocuments,
      challenge: unchallenged,
      log,
      atPoint: cover,
      isPresent: () => Promise.resolve(true),
    });
    const failed = lines.find((line) => line.includes("could not be pressed"));
    expect(failed).toContain("at the button's point: div#cover");
    expect(failed).not.toContain("was not on the page at all");
  });

  it("withholds a message it does not recognise, naming the class alone", async () => {
    const { lines, log } = collecting();
    const leaking = session({
      click: () => Promise.reject(new Error("Set-Cookie: JSESSIONID=9f8e7d6c; the page said: Welcome Niloofar")),
    });
    await fillApplication(WORK, { session: leaking, now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    const failed = lines.find((line) => line.includes("could not be pressed"));
    expect(failed).toContain("Error (message withheld: it matched nothing this runner may repeat)");
    expect(lines.join("\n")).not.toContain("JSESSIONID");
    expect(lines.join("\n")).not.toContain("Welcome");
    // No point reader supplied: said so, not guessed.
    expect(failed).toContain("the point was not read");
  });

  it("says the page was read back and what was NOT seen, by the blueprint's own field names (ADR-0106)", async () => {
    const { lines, log } = collecting();
    let saved = false;
    const forgetting = session({
      click: () => {
        saved = true;
        return Promise.resolve();
      },
      readValue: () => Promise.resolve(saved ? "" : "Niloofar"),
    });
    const outcome = await fillApplication(WORK, { session: forgetting, now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    expect(outcome).toEqual({ kind: "uncertain", failure: "not_recorded" });
    expect(lines.at(-1)).toBe("run run_1: page fill: the save was pressed, the page was read back — not seen: given_name");
  });

  it("says the page was saved and seen, so a success is not silent either", async () => {
    const { lines, log } = collecting();
    await fillApplication(WORK, { session: session(), now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    expect(lines.at(-1)).toBe("run run_1: page fill: the save was pressed, the page was read back — every filled value seen");
  });

  it("counts the boxes that would not take their value, without repeating what the page said", async () => {
    const { lines, log } = collecting();
    const refusing = session({
      fill: () => Promise.reject(new Error("the portal said: 'Niloofar' is not a valid name for field #given_name")),
    });
    const outcome = await fillApplication(WORK, { session: refusing, now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    expect(outcome.kind).toBe("failed");
    expect(lines.at(-1)).toMatch(/^run run_1: page fill failed — 1 of 1 boxes did not take its value \((refused|drift)\)/u);
    expect(lines.join("\n")).not.toContain("not a valid name");
  });

  it("says when the browser did not land on the form, without printing where it landed", async () => {
    const { lines, log } = collecting();
    const bounced = session({ currentUrl: () => Promise.resolve("https://portal.test/login?next=%2Fapply&sid=tok_secret") });
    const outcome = await fillApplication(WORK, { session: bounced, now: () => NOW, documents: noDocuments, challenge: unchallenged, log });
    expect(outcome).toEqual({ kind: "failed", failure: "needs_the_student" });
    expect(lines.at(-1)).toBe("run run_1: page fill failed — the browser did not land on the form; the session is not signed in");
    expect(lines.join("\n")).not.toContain("tok_secret");
  });
});
