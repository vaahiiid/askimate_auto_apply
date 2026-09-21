/**
 * Filling the application form — the plan, executed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0046. The plan arrives as its two halves — each value's text and the
 * provenance the student's confirmation produced — and is reassembled through
 * the one mint that may produce a `ConfirmedValue`. What runs here is
 * `executePlan` from `@askimate/aas-execution`: the same function
 * `scripts/end-to-end.ts` has always run, unchanged, on a plan that is the
 * same plan the Application Plane built.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a session is passed in rather than opened ─────────────────────────
 *
 * Because the form is behind a login. Creating the account SIGNED THE STUDENT
 * IN — the portal set a session cookie exactly as it would for a person — and
 * the context holding that cookie is the only session this run has. A fill that
 * opened its own context would arrive logged out, be redirected to the
 * registration page, and have no way back: the password was single-use and is
 * gone.
 *
 * So the caller supplies the context, and a run that has lost it gets an honest
 * refusal — `needs_the_student` — rather than a second account.
 *
 * ── What this does not do ─────────────────────────────────────────────────
 *
 * Submit. `executePlan` fills and advances; the submit control is not among
 * the things it touches, and this file does not press one either. Submission is
 * out of scope by ADR-0014 and the portal's own `submissions()` is what asserts
 * it in the tests.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ClaimedWork, WireTransmission } from "@askimate/aas-contracts";
import { countRecorded, executePlan, failures, verifyRecorded } from "@askimate/aas-execution";
import type { ApplicationSession, DocumentSource } from "@askimate/aas-execution";
import { rehydratePlan } from "@askimate/aas-mapping";
import type { StoredFillPlan } from "@askimate/aas-mapping";
import type { ProfileFieldKey } from "@askimate/aas-profile";

import { challengeFailure, type ChallengeProbe } from "./challenge.js";
import { RobotsDisallowedError } from "./playwright-fill-session.js";
import { pressCheckInWords, thrownInWords } from "./runner-log.js";
import type { PerformOutcome } from "./work-intake.js";

export interface FillApplicationDeps {
  /** Injected, so date-dependent behaviour is testable. Required, not defaulted. */
  readonly now: () => Date;
  /**
   * The signed-in session, as an `ApplicationSession`.
   *
   * The runner's `PlaywrightPreparationSession` satisfies this structurally,
   * with no adapter — which is why the port is shaped the way it is.
   */
  readonly session: ApplicationSession;
  /**
   * Where a document comes from, for each upload the plan references
   * (ADR-0099). `documentSourceFor` in production; a test supplies its own.
   * Required, not defaulted: a fill that silently had no source would report
   * every upload as "no document supplied", which is the outcome the plane
   * used to refuse transport to avoid.
   */
  readonly documents: DocumentSource;
  /**
   * Reads the page the runner is about to type into for a CAPTCHA or a second
   * factor (ADR-0101 §6). `PlaywrightPreparationSession.challenge` in
   * production; a test supplies its own. Required, not defaulted: a fill that
   * silently had no probe would type into a challenged page and report the
   * refusal that followed as a fill error, which is the confusing failure the
   * requirement exists to prevent.
   */
  readonly challenge: ChallengeProbe;
  /**
   * Where this page fill says what it is doing (ADR-0124, applied to the
   * fill in P163). Optional so every existing test builds deps without one;
   * the production runner always passes it. What it receives has been
   * through `runner-log`'s vocabulary: our words for a recognised error, the
   * class alone when the message could not be repeated, the blueprint's own
   * field names, and the form's REVIEWED URL. Nothing from a page reaches it.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Run A's third conversation, 2026-09-18: the sign-in succeeded and the
   * next line on disk was `uncertain (runner_fault)`, which this file
   * produces in one place and the intake's catch in another, and nothing said
   * which. P157 gave the sign-in its lines and left the fill silent. Vahid:
   * *"That is not a gap to note, it is the same defect in a second place, and
   * it should be fixed before the next attempt rather than after."*
   * ═══════════════════════════════════════════════════════════════════════
   */
  readonly log?: (line: string) => void;
  /**
   * What stands at a control's point, for the line written when the Save
   * press fails (ADR-0129, as the sign-in already does). `atPointInWords`
   * over the runner's page in production; a test supplies its own words.
   * Absent, the line says the point was not read rather than guessing.
   */
  readonly atPoint?: (locator: FieldLocator) => Promise<string>;
  /**
   * Whether the control the entry names is on the page at all (P176).
   *
   * A press can fail because something is over the button, or because there
   * is no button — an entry naming a control the page does not carry. The
   * first is the portal's doing and the second is ours, a reviewer's locator
   * that no read ever showed, and a line that cannot tell them apart sends a
   * person looking in the wrong place. Vahid found exactly that on
   * `personal.do`, 2026-09-21: `id=saveBtn` against a page whose Save has a
   * name and no id.
   */
  readonly isPresent?: (locator: FieldLocator) => Promise<boolean>;
}

export async function fillApplication(
  work: ClaimedWork,
  deps: FillApplicationDeps,
): Promise<PerformOutcome> {
  const wire = work.plan;
  const formUrl = work.formUrl;
  const advance = work.advanceLocator;
  if (wire === undefined || formUrl === undefined || advance === undefined) {
    // An `execute` item with no plan is a plane that sent the wrong shape.
    // There is no sensible default for "what to type", so it is refused.
    return { kind: "failed", failure: "portal_drift" };
  }

  let target: URL;
  try {
    target = new URL(formUrl);
  } catch {
    return { kind: "failed", failure: "portal_drift" };
  }
  if (target.host !== work.portalHost) {
    // Checked here as well as in the plane, and for the same reason the fill
    // agent re-checks the live page: this is the process that will navigate.
    return { kind: "failed", failure: "portal_drift" };
  }

  // ── The fill says what it is doing (ADR-0124, P163) ───────────────────
  //
  // BEFORE anything opens: a fill that dies mid-page has still said it
  // began, and on which page. The URL is the reviewed blueprint's, rebased by
  // the plane — a fact Vahid signed, not a URL from a page.
  const say = deps.log ?? ((): void => undefined);
  const run = `run ${work.runId}`;
  say(`${run}: page fill starting, opening ${target.toString()}`);

  // ── A repeating page's listing, counted BEFORE the save (ADR-0106) ─────
  //
  // The new-entry form reopens empty by design, so what shows an item exists
  // is the listing growing by one. Counted first, on the same host as the
  // form — a listing elsewhere is a blueprint out of date with the portal.
  const listing = work.repeat?.recorded;
  let before: number | null = null;
  if (listing !== undefined) {
    let where: URL;
    try {
      where = new URL(listing.url);
    } catch {
      return { kind: "failed", failure: "portal_drift" };
    }
    if (where.host !== work.portalHost) return { kind: "failed", failure: "portal_drift" };
    try {
      before = await countRecorded(deps.session, { url: where.toString(), entryLocator: listing.entryLocator });
    } catch (error) {
      say(`${run}: page fill failed — the listing could not be counted before the fill — ${thrownInWords(error)}`);
      return { kind: "failed", failure: error instanceof RobotsDisallowedError ? "robots_disallows" : "runner_fault" };
    }
  }

  try {
    await deps.session.goto(target.toString());
  } catch (error) {
    // The second of ADR-0091's two places: the gate refused before the
    // browser opened; the session refuses again at the navigation (P135).
    say(`${run}: page fill failed opening the form — ${thrownInWords(error)}`);
    return { kind: "failed", failure: error instanceof RobotsDisallowedError ? "robots_disallows" : "runner_fault" };
  }

  // ── Still signed in? ───────────────────────────────────────────────────
  //
  // The gate redirects to the registration page without a session. Asked of
  // the browser rather than assumed, because the honest answer to "we were
  // logged out" is that only the student can get us back in — the password was
  // single-use and is gone.
  const landed = await deps.session.currentUrl();
  if (new URL(landed).pathname !== target.pathname) {
    // Somewhere other than the form — most often a login page the session
    // was bounced to. If THAT page asks for a code, say so rather than "the
    // student is needed": the two are different stops with different plans
    // behind them (ADR-0101 §3 and §5). Where it landed is NOT printed: a
    // page's URL can carry a token, and the line says only that it was not
    // the form.
    const gate = await deps.challenge();
    if (gate !== null) {
      say(`${run}: page fill failed — the browser did not land on the form, and the page it landed on asks for ${gate}`);
      return { kind: "failed", failure: challengeFailure(gate) };
    }
    say(`${run}: page fill failed — the browser did not land on the form; the session is not signed in`);
    return { kind: "failed", failure: "needs_the_student" };
  }
  // On the form. A CAPTCHA on it is met before anything is typed into it.
  const challenged = await deps.challenge();
  if (challenged !== null) {
    say(`${run}: page fill failed — the form asks for ${challenged}, before anything was typed`);
    return { kind: "failed", failure: challengeFailure(challenged) };
  }

  // ── A page filled once per item: open a fresh entry first (ADR-0103, gap 3) ──
  //
  // The page lists what was added so far and reveals its form behind a
  // control; each item of the list comes back here, presses it, fills the
  // form, and saves that one item. A control the page no longer has is the
  // blueprint out of date with the portal — drift, like any other locator.
  const addAnother = work.repeat?.addAnother;
  if (addAnother !== undefined) {
    try {
      await deps.session.click({ strategy: addAnother.strategy, value: addAnother.value });
    } catch (error) {
      say(`${run}: page fill failed — the control that opens a fresh entry could not be pressed — ${thrownInWords(error)}`);
      return { kind: "failed", failure: "portal_drift" };
    }
  }

  const plan = rehydratePlan(toStoredPlan(wire));
  const report = await executePlan(
    deps.session,
    plan,
    // Each upload the plan references is asked for here, one at a time, at
    // the moment `executePlan` reaches it (ADR-0099). A refusal from the
    // plane, a hash that does not match, or a record the gate refuses is a
    // `null` — a named failure on that field, never a throw.
    deps.documents,
    {
      // The case the plane leased this work for, carried rather than derived:
      // the runner has no case store and could not look one up. Every
      // disclosure authorisation spent below is checked against it, so a
      // document authorised for a different application is refused here even
      // though nothing can supply one yet (ADR-0069).
      caseId: work.caseId,
      portalHost: work.portalHost,
      // Empty for the same reason: withdrawals gate document transmission, and
      // there are no documents. A plan that carried one would fail the
      // authorisation gate rather than pass it silently.
      withdrawals: [],
      now: deps.now(),
    },
  );

  if (!report.completed) {
    const failed = failures(report);
    // `drift` is the executor's own word for "the page was not what the
    // blueprint described". Everything else is the portal declining what we
    // sent — a rule we do not model — and the two lead to different work: one
    // is a blueprint to re-review, the other is content to fix.
    const drifted = failed.some((outcome) => outcome.drift);
    // A count and the blueprint's own field names: never what a box said.
    say(
      `${run}: page fill failed — ${String(failed.length)} of ${String(plan.instructions.length)} boxes did ` +
        `not take ${failed.length === 1 ? "its" : "their"} value (${drifted ? "drift" : "refused"}): ` +
        failed.map((outcome) => outcome.fieldRef).join(", "),
    );
    // ── And, for a DRIFT, what the page actually offered (P178) ──────────
    //
    // Attempt 4 on the first real form stopped on `institution-ts-control`
    // with the line above and nothing else, and two explanations already on
    // the record predicted exactly those words: a mapping naming a value the
    // portal's list no longer carries, and a box the page does not lay out
    // the way the entry says. They lead to different work — one changes a
    // signed entry and costs a signature, the other does not — and the line
    // could not tell them apart.
    //
    // Vahid, 2026-09-21: *"If the log line cannot tell them apart, say what
    // it read in the box and what it expected, in the runner's allowed
    // words, and make the next line say that."*
    //
    // ONLY for drift, and that is the whole boundary. Those two errors are
    // the runner's own and their words are chosen: `LocatorNotFoundError`
    // names the locators it tried, `OptionNotAvailableError` names the
    // PORTAL'S option list — not the student's data — and gives the value it
    // wanted as a character count precisely because that value may be. A
    // `refused` came from the portal, about the student's answer, and keeps
    // its silence.
    for (const outcome of failed) {
      if (!outcome.drift) continue;
      say(`${run}: ${outcome.fieldRef} — ${outcome.error}`);
    }
    return {
      kind: "failed",
      failure: drifted ? "portal_drift" : "portal_refused",
    };
  }
  // ── Saving the page, which is what makes any of it real ────────────────
  //
  // A portal keeps nothing until the page is saved. Stopping at the last field
  // would report success over an application the university has no record of.
  //
  // `advance_portal_page`, and consequential: it may create a draft visible to
  // admissions. The session's click guard admits exactly the controls it was
  // configured with, so this cannot become a submit however the blueprint
  // changes (ADR-0014).
  try {
    await deps.session.click({ strategy: advance.strategy, value: advance.value });
  } catch (error) {
    // The fields are typed and the save did not land. UNCERTAIN, not failed:
    // the click may have reached the portal, and asserting that nothing
    // happened on a university's system is not this process's to assert.
    //
    // The FIRST of the two places `uncertain runner_fault` comes from on a
    // fill (the other is a throw the intake catches), and the line names it
    // the way the sign-in names its press (ADR-0129): which check was
    // pending, and what stood at the button's point, structure only.
    // P176, Vahid: *"say in the line that the locator found nothing, in our
    // words, rather than leaving it to be inferred from the error class."*
    // A locator that matches nothing has no point to read, and the two say
    // different things: one is an obstacle, the other is an entry that names
    // a control this page does not carry — which is what personal.do's
    // `id=saveBtn` was on 2026-09-21.
    const found = await deps.isPresent?.(advance);
    const atPoint =
      found === false
        ? "the save button was not on the page at all — nothing matched what the entry says to press"
        : deps.atPoint === undefined
          ? "the point was not read"
          : await deps.atPoint(advance);
    say(
      `${run}: page fill failed — the save button could not be pressed — ${thrownInWords(error)}; ` +
        `pending: ${pressCheckInWords(error)}; ${atPoint}`,
    );
    return { kind: "uncertain", failure: "runner_fault" };
  }

  // ── Saved means SEEN (ADR-0106) ────────────────────────────────────────
  //
  // The press went through. That is not the save: on the first real form a
  // page saved with two radios unanswered drew no error and recorded nothing.
  // So the page is reopened and read back, or its listing counted, or its
  // slot's marker looked for — and what is not seen makes the page uncertain,
  // with no transmission recorded for it. A person then looks, which is the
  // honest price of not reporting a success nobody can see.
  const seen = await verifyRecorded(deps.session, {
    plan,
    report,
    formUrl: target.toString(),
    repeating: work.repeat !== undefined,
    ...(listing === undefined || before === null
      ? {}
      : { listing: { url: listing.url, entryLocator: listing.entryLocator, before } }),
  });
  if (!seen.recorded) {
    // What was NOT seen, by the blueprint's field names or the listing's
    // word for its entries — the reviewer's names, never the page's values.
    say(`${run}: page fill: the save was pressed, the page was read back — not seen: ${seen.unseen.join(", ")}`);
    return { kind: "uncertain", failure: "not_recorded" };
  }
  say(`${run}: page fill: the save was pressed, the page was read back — every filled value seen`);

  // ── What left, with the page that carried it (ADR-0069, P73) ──────────
  //
  // The executor recorded each transmission at the moment of attaching, in
  // the order the plan's uploads were attached — the same order as the
  // `attached` outcomes, which name the box. Joined here, and only now that
  // the page is saved: a transmission on an unsaved page is a file the portal
  // discarded, and the report has no field for one because it must not.
  const attached = report.outcomes.filter(
    (outcome): outcome is Extract<typeof outcome, { kind: "attached" }> =>
      outcome.kind === "attached",
  );
  const transmissions: WireTransmission[] = report.transmissions.map((transmission, index) => ({
    fieldRef: attached[index]?.fieldRef ?? "",
    disclosureId: transmission.disclosureId,
    documentId: transmission.documentId,
    contentHash: transmission.contentHash,
    toHost: transmission.toHost,
    institutionName: transmission.institutionName,
    caseId: transmission.caseId,
    transmittedAt: transmission.transmittedAt.toISOString(),
  }));
  return transmissions.length === 0 ? { kind: "succeeded" } : { kind: "succeeded", transmissions };
}

/**
 * The wire form, as `@askimate/aas-mapping` declares it.
 *
 * The mirror of `toWirePlan` on the plane's side: two packages that may not
 * depend on each other hold the same shape, and this is where the wire's
 * version becomes the mapping package's. `scripts/contract-drift.test.ts` takes
 * a real plan through both and requires the round trip to be lossless.
 */
function toStoredPlan(wire: NonNullable<ClaimedWork["plan"]>): StoredFillPlan {
  return {
    blueprintId: wire.blueprintId,
    blueprintVersion: wire.blueprintVersion,
    mappingSetId: wire.mappingSetId,
    instructions: wire.instructions.map((instruction) => ({
      fieldRef: instruction.fieldRef,
      label: instruction.label,
      inputType: instruction.inputType as StoredFillPlan["instructions"][number]["inputType"],
      ...(instruction.optionsAfter === undefined
        ? {}
        : {
            optionsAfter: {
              fieldRef: instruction.optionsAfter.fieldRef,
              ...(instruction.optionsAfter.press === undefined
                ? {}
                : { press: { strategy: instruction.optionsAfter.press.strategy, value: instruction.optionsAfter.press.value } }),
            },
          }),
      ...(instruction.typeahead === undefined
        ? {}
        : {
            typeahead: {
              optionLocator: {
                strategy: instruction.typeahead.optionLocator.strategy,
                value: instruction.typeahead.optionLocator.value,
              },
              text: instruction.typeahead.text,
              ...(instruction.typeahead.escapeValue === undefined ? {} : { escapeValue: instruction.typeahead.escapeValue }),
            },
          }),
      ...(instruction.item === undefined ? {} : { item: { index: instruction.item.index, count: instruction.item.count } }),
      locators: instruction.locators.map((locator) => ({
        strategy: locator.strategy,
        value: locator.value,
      })),
      value:
        instruction.value.kind === "confirmed"
          ? {
              kind: "confirmed" as const,
              fieldKey: instruction.value.fieldKey as ProfileFieldKey,
              text: instruction.value.text,
              provenance: {
                source: instruction.value.provenance.source,
                confirmedAt: new Date(instruction.value.provenance.confirmedAt),
                ...(instruction.value.provenance.sourceExcerpt === undefined
                  ? {}
                  : { sourceExcerpt: instruction.value.provenance.sourceExcerpt }),
                ...(instruction.value.provenance.documentId === undefined
                  ? {}
                  : { documentId: instruction.value.provenance.documentId }),
              },
            }
          : instruction.value.kind === "form_refusal"
            ? {
                kind: "form_refusal" as const,
                text: instruction.value.text,
                rationale: instruction.value.rationale,
                ...(instruction.value.formSays === undefined
                  ? {}
                  : { formSays: instruction.value.formSays }),
                covers: [...instruction.value.covers],
                mappingSetId: instruction.value.mappingSetId,
                reviewedBy: instruction.value.reviewedBy,
              }
            : {
                kind: "reviewed_constant" as const,
                text: instruction.value.text,
                rationale: instruction.value.rationale,
                mappingSetId: instruction.value.mappingSetId,
                reviewedBy: instruction.value.reviewedBy,
              },
    })),
    uploads: wire.uploads.map((upload) => ({
      fieldRef: upload.fieldRef,
      label: upload.label,
      documentRef: upload.documentRef,
      locators: upload.locators.map((locator) => ({
        strategy: locator.strategy,
        value: locator.value,
      })),
      ...(upload.recorded === undefined ? {} : { recorded: { strategy: upload.recorded.strategy, value: upload.recorded.value } }),
      ...(upload.companion === undefined
        ? {}
        : {
            companion: {
              fieldRef: upload.companion.fieldRef,
              label: upload.companion.label,
              locators: upload.companion.locators.map((locator) => ({ strategy: locator.strategy, value: locator.value })),
              text: upload.companion.text,
            },
          }),
    })),
    credentials: [],
  };
}
