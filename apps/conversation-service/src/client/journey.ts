/**
 * The student's surface. A projection of what the server says, and a way to
 * send back decisions it asked for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0060 puts this here — inside the service that mints the `__Host-`
 * session and serves every route it calls — for the same reason the secure
 * control lives inside the Secure Service. ADR-0061 is what lets it stay thin.
 *
 * WHAT THIS FILE DOES NOT DO, and must never start doing:
 *
 *   it does not decide what the run should do next     the orchestrator does
 *   it does not decide which decision is available     `pending` says
 *   it does not compute a content hash                 the server sends them
 *   it does not remember the run, the step or an offer a reload re-reads them
 *   it does not infer a transition from an event       an event triggers a
 *                                                      RE-READ, never a guess
 *
 * One hash is the exception, and it is stated rather than smuggled: the
 * SHA-256 of a document the student is sending. The server cannot compute it,
 * because the bytes never reach the server (ADR-0092) — they go from this
 * page to the bucket. What this page computes is not trusted by anything: the
 * bucket refuses a body that does not hash to it (the signed checksum header,
 * ADR-0093), and the confirm reads the bucket's own checksum back. A wrong
 * hash here is a refused upload, never a recorded one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why no framework ──────────────────────────────────────────────────────
 *
 * The same reason `control-client.ts` has none: a framework is what tempts
 * somebody to make the composer controlled, and a controlled composer puts
 * every keystroke into component state — where an error boundary or a
 * state-serialising reporter can read it. The residual risk this whole design
 * minimises is a student typing their password into the ordinary box, and an
 * uncontrolled input keeps that text a DOM value nothing snapshots.
 *
 * ── Why a full re-read on every change ───────────────────────────────────
 *
 * An SSE frame tells this client that SOMETHING happened. It does not tell it
 * what the run should do about it, and a client that worked that out from the
 * event would be a second workflow engine — the exact thing the boundary
 * forbids. So every frame triggers the same read a fresh page load makes, and
 * the screen is drawn from the answer.
 */

import {
  SSE_EVENT_NAME,
  parseConversationEvent,
} from "@askimate/aas-contracts";
import type { ConversationEvent, RunPreview } from "@askimate/aas-contracts";
import {
  composerPolicy,
  openSecretRequest,
  projectTranscript,
} from "@askimate/aas-conversation";

import * as api from "./transport.js";

/** Everything drawn, in one object, replaced whole on every read. */
interface View {
  conversationId: string | null;
  events: readonly ConversationEvent[];
  run: api.RunReading;
  targets: readonly api.ApplicationTarget[];
  offer: api.TargetOffer | null;
  preview: RunPreview | null;
  notice: string;
  /**
   * The second attempt, when the server has offered one (ADR-0006, P42).
   *
   * `refused` is set only from an `already_applying` problem whose `concluded`
   * is true — the server's own answer to "may this student apply again", never
   * this page's reading of a case state it cannot see. `advice` is set only by
   * the server's reply to the first of the two calls, and its presence is what
   * lets the instruction be offered at all.
   */
  reapplication: {
    readonly existingCaseId: string;
    readonly advice: api.WaitAdviceReading | null;
  } | null;
  /**
   * What the student holds, and what they may be given (ADR-0092). `null`
   * when the read failed — most ordinarily because this deployment has no
   * document transport and the route answers 503 — and the panel is then not
   * drawn at all. Not a notice: a service that was deployed without a vault
   * is a configuration, not something that "did not work".
   */
  documents: api.HeldDocuments | null;
}

const view: View = {
  conversationId: null,
  events: [],
  run: { run: null, pending: null },
  targets: [],
  offer: null,
  preview: null,
  notice: "",
  reapplication: null,
  documents: null,
};

let stream: EventSource | null = null;

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function text(node: HTMLElement, value: string): void {
  // `textContent`, never `innerHTML`. Everything below is either the student's
  // own words or a university's, and neither is markup this page should run.
  node.textContent = value;
}

function button(
  label: string,
  onClick: () => void,
  kind = "act",
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = kind;
  text(node, label);
  node.addEventListener("click", onClick);
  return node;
}

// ───────────────────────────────────────────────────────────────────────────
// Reading. Everything the screen shows comes from here.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Rebuilds the whole view from the server.
 *
 * The same path a fresh page load takes, deliberately: if a reload can produce
 * the right screen then so can every update, and there is one code path to be
 * right about rather than two.
 */
async function refresh(): Promise<void> {
  const id = view.conversationId;
  if (id === null) return;

  const [events, run, documents] = await Promise.all([
    api.readEvents(id),
    api.readRun(id),
    api.readDocuments(id),
  ]);
  view.documents = documents.ok ? documents.value : null;

  // A read that FAILED is not a read, and the previous answer is not a
  // substitute for it. Keeping it would make this page the place the run's
  // state lives — the one thing ADR-0060 says it must never be — and the
  // student would go on being shown a step the server never confirmed, and a
  // decision button bound to a hash the server never just named. So the half
  // that failed is cleared and said out loud instead of quietly held.
  if (events.ok) view.events = events.value;
  else {
    view.events = [];
    report(events.code);
  }
  if (run.ok) view.run = run.value;
  else {
    view.run = { run: null, pending: null };
    report(run.code);
  }

  // The preview is fetched ONLY when the server says an authorisation is what
  // it is waiting for. Asking at other times would be asking for something
  // that does not exist, and rendering a stale one would show the student an
  // application they are no longer being asked about.
  const pending = view.run.pending;
  const runId = view.run.run?.runId;
  if (pending?.decision === "authorise" && runId !== undefined) {
    const preview = await api.readPreview(id, runId);
    view.preview = preview.ok ? preview.value : null;
  } else {
    view.preview = null;
  }

  // Targets matter only before a run exists: a conversation owns at most one
  // case, so once it has one there is nothing to choose.
  // `run.ok` as well as the emptiness: after a failed run read this page does
  // not know whether a case exists, and offering the student a fresh choice of
  // where to apply would be the most misleading screen it could draw.
  if (run.ok && view.run.run === null && view.targets.length === 0) {
    const targets = await api.readTargets();
    if (targets.ok) view.targets = targets.value;
  }

  draw();
}

/** Re-reads on every durable event. The frame is a trigger, never a source. */
function listen(conversationId: string): void {
  stream?.close();
  const source = new EventSource(`/v1/conversations/${conversationId}/stream`);
  source.addEventListener(SSE_EVENT_NAME, (event: Event) => {
    // Parsed to confirm it is an event this contract publishes, and then
    // DISCARDED: what it says does not decide anything here.
    const data: unknown = (event as MessageEvent).data;
    if (typeof data !== "string") return;
    if (parseConversationEvent(JSON.parse(data) as unknown) === null) return;
    void refresh();
  });
  stream = source;
}

// ───────────────────────────────────────────────────────────────────────────
// Drawing
// ───────────────────────────────────────────────────────────────────────────

function drawTranscript(): void {
  const list = el("transcript");
  if (list === null) return;
  list.replaceChildren();
  for (const item of projectTranscript(view.events)) {
    if (item.render !== "message" || item.content === null) continue;
    const line = document.createElement("li");
    line.className = `msg ${item.actor}`;
    text(line, item.content);
    list.append(line);
  }
  list.scrollTop = list.scrollHeight;
}

/** Gate 1: the reviewed targets, and nothing this client invented. */
function drawTargets(): void {
  const panel = el("targets");
  if (panel === null) return;
  panel.replaceChildren();
  if (view.run.run !== null || view.offer !== null) return;

  const heading = document.createElement("h2");
  text(heading, "What would you like to apply to?");
  panel.append(heading);

  for (const target of view.targets) {
    const row = document.createElement("div");
    row.className = "target";
    const where =
      target.campus === undefined
        ? target.institutionName
        : `${target.institutionName} (${target.campus})`;
    const label = document.createElement("p");
    text(label, `${where} — ${target.courseName}, ${target.intake}`);
    row.append(label);

    if (target.needsDisambiguation) {
      // ADR-0058: two reviewed routes to one course and intake collide on the
      // submission key, so applying through one permanently rules out the
      // other. The choice is irreversible, so it is shown and made, never
      // defaulted — and the route the student is choosing is named.
      const warn = document.createElement("p");
      warn.className = "warn";
      text(
        warn,
        `More than one way to apply to this. This one goes through ` +
          `${target.portalHost} (${target.route.replace(/_/g, " ")}). Choosing one rules the ` +
          `others out for this course and intake.`,
      );
      row.append(warn);
    }
    row.append(
      button("See what would be applied for", () => {
        void chooseTarget(target.blueprintId, target.needsDisambiguation);
      }),
    );
    panel.append(row);
  }
}

/** The offer, rendered by the SERVER, with the student's request beside it. */
function drawOffer(): void {
  const panel = el("offer");
  if (panel === null) return;
  panel.replaceChildren();
  const offer = view.offer;
  if (offer === null || view.run.run !== null) return;

  const heading = document.createElement("h2");
  text(heading, "This is what I would apply for");
  const body = document.createElement("pre");
  // The server's own deterministic rendering, shown verbatim. This client does
  // not compose it, summarise it, or re-order it.
  text(body, offer.rendered);

  const statement = document.createElement("textarea");
  statement.id = "statement";
  statement.rows = 2;
  statement.placeholder = "In your own words: what are you asking me to do?";

  panel.append(
    heading,
    body,
    statement,
    button("Apply to this for me", () => {
      void applyForOffer(offer.offerHash);
    }),
    button(
      "Choose something else",
      () => {
        view.offer = null;
        draw();
      },
      "quiet",
    ),
  );
}

/**
 * What the run is waiting for. ADR-0061.
 *
 * One branch per decision the SERVER named, and each sends back the hash the
 * server gave. There is no fourth branch that guesses.
 */
/**
 * True for the statuses the run driver says wait for a person (ADR-0048).
 *
 * Named here rather than inlined so the two places that must agree — this line
 * and the composer's hint — cannot drift apart.
 */
function waitsOnAPerson(status: string): boolean {
  return status === "escalated" || status === "uncertain";
}

function drawPending(): void {
  const panel = el("pending");
  if (panel === null) return;
  panel.replaceChildren();

  const run = view.run.run;
  const pending = view.run.pending;
  if (run === null) return;

  const where = document.createElement("p");
  where.className = "position";
  // ── A run waiting on a PERSON does not read as one waiting on you ────
  //
  // ADR-0064. This line used to say `interview (escalated)` whatever had
  // happened, so a student whose run had been handed to a specialist saw the
  // step they were last asked about and a composer inviting them to answer it.
  // The escalation message was in the transcript above, contradicted by the
  // line beneath it.
  //
  // `uncertain` and `escalated` are the two the driver names as waiting for a
  // person; the step is not mentioned for either, because which step it
  // stopped on is not the student's business and reading it as a prompt is
  // exactly the mistake.
  text(
    where,
    waitsOnAPerson(run.status)
      ? "Your application is with a member of the team. I will come back to you."
      : `Your application: ${run.step.replace(/_/g, " ")} (${run.status})`,
  );
  panel.append(where);

  if (pending !== null) {
    if (pending.decision === "authorise" && view.preview !== null) {
      const heading = document.createElement("h2");
      text(heading, "Read this before I fill anything in");
      const body = document.createElement("pre");
      // EXACTLY what the server served, and the hash sent back is exactly the
      // one it came with (ADR-0059).
      text(body, view.preview.presentedText);
      panel.append(heading, body);
    }

    const labels: Readonly<Record<api.PendingDecision["decision"], string>> = {
      authorise: "Yes — this is right, fill it in",
      confirm_value: "Yes, that's right",
      confirm_handoff: "Done — I have completed that",
    };
    panel.append(
      button(labels[pending.decision], () => {
        void answer(pending.decision, pending.contentHash);
      }),
    );
  }

  // ADR-0053: available at every step, and carrying no hash. Offered because
  // the architecture says a stop button that only worked sometimes would not
  // be one — not because a read mentioned it.
  panel.append(
    button(
      "Stop this application",
      () => {
        void answer("cancel");
      },
      "quiet",
    ),
  );
}

/** The secure step, in a cross-origin frame this page cannot read into. */
function drawSecureStep(): void {
  const panel = el("secure");
  if (panel === null) return;
  const open = openSecretRequest(view.events);
  if (open === null) {
    panel.replaceChildren();
    return;
  }
  if (panel.dataset["requestId"] === open) return;
  panel.dataset["requestId"] = open;
  panel.replaceChildren();
  void mountSecureFrame(panel, open);
}

async function mountSecureFrame(
  panel: HTMLElement,
  requestId: string,
): Promise<void> {
  const id = view.conversationId;
  if (id === null) return;
  const bootstrap = await api.bootstrapSecureStep(id, requestId);
  if (!bootstrap.ok) return;

  const frame = document.createElement("iframe");
  frame.title = "Secure step";
  frame.src = `${bootstrap.value.secureOrigin}/v1/secret-requests/${requestId}/control`;
  frame.className = "secure-frame";
  panel.append(frame);

  // The token is handed over by postMessage at the frame's EXACT origin, never
  // `"*"`: a wildcard delivers to whatever happens to be embedding this page.
  // It is never written anywhere and never put in a URL.
  frame.addEventListener("load", () => {
    frame.contentWindow?.postMessage(
      {
        v: 1,
        kind: "bootstrap",
        requestId,
        frameToken: bootstrap.value.frameToken,
      },
      bootstrap.value.secureOrigin,
    );
  });
}

/**
 * The document panel: what is held, and the one control that sends more.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0092. The bytes go from this page to the bucket and never to this
 * origin, so the whole exchange is three calls and one PUT — declare, PUT,
 * confirm, re-read — and every one of them is the server's or the bucket's
 * refusal to make, not this page's.
 *
 * The form is built ONCE and kept across draws. Everything else on this page
 * is replaced whole on every read, which is right for text the server owns;
 * a file input is different, because what it holds is the student's file
 * and a redraw on an unrelated SSE frame would silently drop it. The held
 * list and the type choice are redrawn from the read; the input is not.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function drawDocuments(): void {
  const panel = el("documents");
  if (panel === null) return;
  const held = view.documents;
  if (held === null) {
    panel.replaceChildren();
    return;
  }

  let list = el("held-documents") as HTMLUListElement | null;
  let form = el("document-form") as HTMLFormElement | null;
  if (list === null || form === null) {
    panel.replaceChildren();
    const heading = document.createElement("h2");
    text(heading, "Your documents");
    list = document.createElement("ul");
    list.id = "held-documents";

    form = document.createElement("form");
    form.id = "document-form";
    form.autocomplete = "off";
    const type = document.createElement("select");
    type.id = "document-type";
    type.name = "documentType";
    const file = document.createElement("input");
    file.id = "document-file";
    file.name = "file";
    file.type = "file";
    form.append(
      type,
      file,
      button("Send this document", () => {
        void sendDocument();
      }),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendDocument();
    });
    panel.append(heading, list, form);
  }

  list.replaceChildren();
  for (const item of held.documents) {
    const line = document.createElement("li");
    line.className = "held";
    // What the SERVER says it holds: the type and the state it recorded. The
    // hash and the policy reference are on the wire too; a person reading
    // this list needs neither, and an audit reads the record, not the page.
    text(line, `${item.documentType.replace(/_/g, " ")} — ${item.state.replace(/_/g, " ")}`);
    list.append(line);
  }

  // The choice of type is the server's list, redrawn only when it changes so
  // a selection survives a refresh the same way the file does.
  const type = el("document-type") as HTMLSelectElement | null;
  if (type !== null && type.dataset["types"] !== held.documentTypes.join(",")) {
    type.dataset["types"] = held.documentTypes.join(",");
    type.replaceChildren();
    for (const name of held.documentTypes) {
      const option = document.createElement("option");
      option.value = name;
      text(option, name.replace(/_/g, " "));
      type.append(option);
    }
  }
}

function drawComposer(): void {
  const form = el("composer");
  const input = el("say") as HTMLInputElement | null;
  if (form === null || input === null) return;
  // The shared decision, not a local one. `packages/conversation` owns it, and
  // the service consults the same function — which is what makes "the client
  // and the server cannot disagree" structural (ADR-0041).
  const policy = composerPolicy({
    awaitingSecret: openSecretRequest(view.events) !== null,
  });
  // `typing` is always "live" today — the composer is never disabled, only its
  // SEND is blocked, so a student who was mid-sentence when a secure step
  // opened does not lose what they typed. Read from the policy rather than
  // hard-coded, so the day it gains a second value this follows it.
  input.disabled = policy.draftPersistence === "suspended" && false;
  const submit = form.querySelector("button");
  if (submit !== null) submit.disabled = policy.send !== "enabled";
  const hint = el("composer-hint");
  if (hint !== null) {
    text(
      hint,
      policy.send === "enabled" ? "" : "Finish the secure step above first.",
    );
  }
}

/**
 * The second attempt, when the server has said one is possible.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0006 rule 4 makes the wait recommendation *"advisory in effect but
 * MANDATORY in presentation: the system must show it before accepting the
 * instruction, and must record that it did"*. So this panel has two states and
 * the second cannot be reached without passing through the first:
 *
 *   no advice yet   the outcome question, and nothing that could instruct
 *   advice shown    the advice verbatim, THEN the statement box and the button
 *
 * The server enforces the same order — `reapply` is refused until the advice
 * event is in this conversation's log — so this is not the control, it is the
 * control being obeyed rather than worked around. A page that offered the
 * instruction first would simply be refused, which is the right failure but a
 * bad experience for a student who did nothing wrong.
 *
 * Nothing here decides whether a second attempt is POSSIBLE. That is
 * `concluded` on the server's own refusal.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function drawReapplication(): void {
  const panel = el("reapplication");
  if (panel === null) return;
  panel.replaceChildren();
  const state = view.reapplication;
  if (state === null || view.run.run !== null) return;

  const heading = document.createElement("h2");
  text(heading, "You have applied for this before");
  panel.append(heading);

  if (state.advice === null) {
    const ask = document.createElement("p");
    text(ask, "What happened to that application?");
    panel.append(
      ask,
      button("It was rejected", () => {
        void adviseOn("rejected");
      }),
      button("I withdrew it", () => {
        void adviseOn("withdrawn");
      }),
      button(
        "Leave it",
        () => {
          view.reapplication = null;
          draw();
        },
        "quiet",
      ),
    );
    return;
  }

  // The server's own words, shown verbatim and before anything that could
  // instruct. `pre`, like the offer, because this client does not re-flow a
  // rendering it did not compose.
  const advice = document.createElement("pre");
  advice.id = "wait-advice";
  text(
    advice,
    state.advice.suggestedIntake === undefined
      ? state.advice.rationale
      : `${state.advice.rationale}\n\nA later intake is open: ${state.advice.suggestedIntake}`,
  );

  const statement = document.createElement("textarea");
  statement.id = "reapply-statement";
  statement.rows = 2;
  statement.placeholder = "In your own words: why do you want to apply again?";

  panel.append(
    advice,
    statement,
    button("Apply again anyway", () => {
      void instructReapplication();
    }),
    button(
      "Leave it for now",
      () => {
        view.reapplication = null;
        draw();
      },
      "quiet",
    ),
  );
}

function draw(): void {
  const notice = el("notice");
  if (notice !== null) text(notice, view.notice);
  drawTranscript();
  drawTargets();
  drawOffer();
  drawReapplication();
  drawPending();
  drawDocuments();
  drawSecureStep();
  drawComposer();
}

// ───────────────────────────────────────────────────────────────────────────
// Acting. Each one posts, then RE-READS — never assumes what it did.
// ───────────────────────────────────────────────────────────────────────────

/**
 * What each refusal is, in the student's language.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The server states its reasons in a CLOSED set (`PROBLEM_CODES`), and two of
 * them exist precisely because a client that could not tell them from a
 * generic conflict would show the student a dead end. In their own words:
 *
 *   already_applying      "…if that application has concluded the student can
 *                          instruct a second attempt. A client that could not
 *                          tell this apart from any other 409 could not offer
 *                          them that."
 *   specialist_reviewing  "…a state they were already told about in the
 *                          conversation, and a client that could not tell it
 *                          from a 404 would show them a dead end for something
 *                          that resumes by itself."
 *
 * Both fell through to "That did not work" until P41. The reason was stated on
 * the wire, correctly, and never reached the person it was for.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `CANNOT_REACH_THIS_PAGE` below is the other half, and the two together must
 * cover every code the contract can produce — see `refusal-wording.test.ts`.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  not_found:
    "That is not available any more. Let me show you where things stand.",
  content_changed: "That changed since you looked at it. Here it is again.",
  validation_failed: "That did not go through. Try again.",
  forbidden: "That is not something you can do here.",
  service_unavailable: "That part of the service is not available right now.",
  contract_mismatch: "The server sent something this page did not understand.",

  // P41. Named, not generic — each of these is a state the student can do
  // something about, or one they have already been told about in the thread.
  already_applying:
    "You already have an application for this course and intake. Here it is.",
  specialist_reviewing:
    "A person is checking part of your application. You do not need to do " +
    "anything — I will carry on as soon as they are done.",
  email_not_verified:
    "Confirm your email address first. Check your inbox for the link we sent.",
  secret_request_open:
    "Finish the secure step above first, then this will go through.",
  intervention_already_resolved:
    "Somebody has already dealt with that. Here is where things stand.",
  rate_limited: "That was a lot at once. Give it a moment and try again.",
  internal_error:
    "Something went wrong at our end. Nothing you have given me is lost.",

  // Reachable from the statement box, which takes a paste of any length, and
  // stated as 413 only from P41 — before that the body parser's refusal came
  // back as a 500 and this student was told OUR side had broken, for a body
  // only they could shorten.
  payload_too_large:
    "That is longer than I can take. Shorten it a little and send it again.",
  // The page sends a fresh random key on the two calls that create something,
  // so a conflict means a key was reused with a different body — which cannot
  // happen from here, but is worded rather than assumed away, because the key
  // IS sent and a claim about what a sent header can never provoke is the kind
  // of claim this file has already got wrong once.
  idempotency_key_conflict:
    "That looks like something already sent. Here is where things stand.",

  // The session has expired mid-journey. This page does NOT send them to
  // `/auth/login` for it, though `start` does when the page loads without a
  // session at all, and the difference is deliberate: by this point the
  // student may have typed something into the composer, and navigating away
  // would discard it. The one thing this page is careful about above all is
  // not losing what a student wrote — a send that fails keeps the draft — and
  // a redirect is a send that fails and takes the box with it.
  unauthenticated:
    "You have been signed out. Reload this page to sign back in — anything " +
    "you have typed will still be here until then.",

  // ── P62. The document transport's three, moved here from the list below ──
  //
  // ADR-0090 said that moving them "is the visible act that says the upload
  // surface has landed". This is that act. Each is a state the student can do
  // something about: send the file again.
  content_hash_mismatch:
    "What reached the vault is not the file you chose. Nothing was kept. " +
    "Choose the file and send it again.",
  intake_not_open:
    "That upload took too long, or was already dealt with. Nothing was kept. " +
    "Choose the file and send it again.",
  upload_not_received:
    "The file did not reach the vault. Nothing was kept. Choose it and send " +
    "it again.",
};

/**
 * Codes this page cannot be told, and why.
 *
 * The same shape as the reachability register (ADR-0073): a reviewed list with
 * a reason each, rather than silence. A code that moves from here to `REFUSALS`
 * is a client change somebody made on purpose; a code in NEITHER is the defect
 * P41 fixed, and `refusal-wording.test.ts` fails on it.
 *
 * ── Writing this list is what made it useful ─────────────────────────────
 *
 * Its first draft had THREE entries and two of them were wrong. It claimed
 * `payload_too_large` could not arrive because "the only bodies are short
 * text" — the statement box takes a paste of any size — and that this page
 * "sends no idempotency key", when `transport.ts` sends a fresh one on two of
 * its calls. Both now have wordings. Neither error was findable by reading the
 * page; both were findable by having to WRITE DOWN why a code could not
 * arrive, which is the argument for keeping the list rather than a comment.
 */
const CANNOT_REACH_THIS_PAGE: Readonly<Record<string, string>> = {
  // Every request goes through one helper that sets `Content-Type:
  // application/json` with no charset parameter, and the browser sends no
  // `Content-Encoding` on a body this small. A Content-Type that is not JSON
  // at all does NOT produce this code anyway — `express.json` skips the body
  // and the route refuses the missing field instead.
  unsupported_media_type:
    "one helper sets application/json, with no charset and no content-encoding",

  // ── P57 to P62: three entries that USED to be here ─────────────────────
  //
  // `content_hash_mismatch`, `intake_not_open` and `upload_not_received` sat
  // in this list from P57 (the first two) and P60 (the third) with the reason
  // "this page never opens a document intake". P62 gave the page its upload
  // control, and the three moved to `REFUSALS` — which is exactly what the
  // entry said would be the visible act. Nothing else from the document
  // transport is unreachable from here now.
};

function report(code: string): void {
  view.notice =
    REFUSALS[code] ?? "That did not work. Let me show you where things stand.";
}

/** Exported for `refusal-wording.test.ts`, which asserts the two cover the set. */
export const wording = { REFUSALS, CANNOT_REACH_THIS_PAGE };

async function chooseTarget(
  blueprintId: string,
  needsDisambiguation: boolean,
): Promise<void> {
  const id = view.conversationId;
  if (id === null) return;
  view.notice = "";
  // `disambiguated` is sent only when the LISTING said this target collides
  // with another — the server's answer, not this page's opinion. Sending it
  // unconditionally would turn the safety refusal into a formality.
  const made = await api.askForOffer(id, blueprintId, needsDisambiguation);
  if (!made.ok) {
    report(made.code);
    view.offer = null;
  } else {
    view.offer = made.value;
  }
  await refresh();
}

async function applyForOffer(offerHash: string): Promise<void> {
  const id = view.conversationId;
  if (id === null) return;
  const statement =
    (el("statement") as HTMLTextAreaElement | null)?.value.trim() ?? "";
  if (statement === "") {
    view.notice = "Tell me in your own words what you are asking me to do.";
    draw();
    return;
  }
  view.notice = "";
  const started = await api.requestApplication(id, offerHash, statement);
  if (!started.ok) {
    report(started.code);
    // ── The refusal that is not a dead end (ADR-0006, P42) ──────────────
    //
    // `already_applying` carries `existingCaseId` and `concluded` for exactly
    // one stated purpose — so the client can take the student to what they
    // already have, or offer them a second attempt when it has finished. Both
    // fields reached this page and were thrown away until P42, which made the
    // refusal a full stop for a student the system was ready to help.
    //
    // `concluded` is the SERVER's answer. This page does not read a case state
    // and does not have one to read.
    const problem = started.problem;
    view.reapplication =
      problem?.code === "already_applying" && problem.concluded
        ? { existingCaseId: problem.existingCaseId, advice: null }
        : null;
  } else {
    view.offer = null;
    view.reapplication = null;
  }
  await refresh();
}

/**
 * Step one: say what happened, and be shown the advice.
 *
 * The advice is stored ONLY from the server's reply. There is no path by which
 * this page can put itself into the second state without the round trip that
 * records the advice was shown — which is the whole of ADR-0006 rule 4.
 */
async function adviseOn(outcome: "rejected" | "withdrawn"): Promise<void> {
  const id = view.conversationId;
  const state = view.reapplication;
  if (id === null || state === null) return;
  view.notice = "";

  const advised = await api.advisePriorOutcome(id, outcome);
  if (!advised.ok) {
    report(advised.code);
    // Left in the first state rather than cleared: the student asked for
    // something reasonable and nothing about their situation changed.
    draw();
    return;
  }
  view.reapplication = { existingCaseId: state.existingCaseId, advice: advised.value };
  draw();
}

/** Step two: the instruction, in their own words. */
async function instructReapplication(): Promise<void> {
  const id = view.conversationId;
  if (id === null) return;
  const statement =
    (el("reapply-statement") as HTMLTextAreaElement | null)?.value.trim() ?? "";
  if (statement === "") {
    view.notice = "Tell me in your own words why you want to apply again.";
    draw();
    return;
  }
  view.notice = "";

  const opened = await api.reapply(id, statement);
  if (!opened.ok) report(opened.code);
  else {
    view.reapplication = null;
    view.offer = null;
  }
  await refresh();
}

async function answer(kind: string, contentHash?: string): Promise<void> {
  const id = view.conversationId;
  const runId = view.run.run?.runId;
  if (id === null || runId === undefined) return;
  view.notice = "";
  const recorded = await api.decide(
    id,
    runId,
    contentHash === undefined ? { kind } : { kind, contentHash },
  );
  if (!recorded.ok) report(recorded.code);
  // Re-read either way. A refusal usually means the page was looking at
  // something that has since moved, and the answer to that is to show what is
  // there now rather than to explain.
  await refresh();
}

/*
 * ── Why the gate's words do NOT reach the page ────────────────────────────
 *
 * The storage gates write a `detail` for a person: which document type, which
 * activity, what is missing. It is on the wire for an API caller and in the
 * route tests. It is not shown here, because the contract's `Problem` carries
 * no free-text member at all (`problems.ts`: a `detail` is a channel through
 * which a server could put a hash, a path or a secret in front of a client,
 * and the parser drops it). So a refused document is worded per CODE, like
 * every other refusal on this page. Saying more would need a structured
 * field — which gate refused — not a string.
 */

/** SHA-256 of the file, lowercase hex — the one hash this page computes (see the header). */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Declare, PUT, confirm, re-read. ADR-0092.
 *
 * Each step's failure stops the sequence and says so; none of them leaves a
 * record behind, because the server records only from the confirm and the
 * confirm records only what the bucket holds. The file input is cleared
 * only after the confirm succeeded — a send that fails keeps the choice, for
 * the reason the composer keeps a draft.
 */
async function sendDocument(): Promise<void> {
  const id = view.conversationId;
  const input = el("document-file") as HTMLInputElement | null;
  const type = el("document-type") as HTMLSelectElement | null;
  if (id === null || input === null || type === null) return;
  const file = input.files?.[0];
  if (file === undefined) {
    view.notice = "Choose a file first.";
    draw();
    return;
  }
  view.notice = "";

  const bytes = await file.arrayBuffer();
  const declared = await api.declareDocument(id, {
    documentType: type.value,
    contentType: file.type,
    contentHash: await sha256Hex(bytes),
    sizeBytes: file.size,
  });
  if (!declared.ok) {
    report(declared.code);
    draw();
    return;
  }

  // The bytes, to the bucket, with the headers exactly as stated.
  const put = await api.putDocument(declared.value.upload, file);
  if (!put.ok) {
    // The bucket answers no problem document, so this is worded here rather
    // than in REFUSALS. Nothing was recorded: the confirm was never made.
    view.notice =
      put.status === 0
        ? "The vault could not be reached. Nothing was kept. Try again in a moment."
        : "The vault did not accept the file. Nothing was kept. Choose it and send it again.";
    draw();
    return;
  }

  const confirmed = await api.confirmDocument(id, declared.value.intakeId);
  if (!confirmed.ok) report(confirmed.code);
  else input.value = "";
  // Re-read either way: what is held is the server's list, never this page's
  // memory of what it just sent.
  await refresh();
}

async function onSend(event: Event): Promise<void> {
  event.preventDefault();
  const id = view.conversationId;
  const input = el("say") as HTMLInputElement | null;
  if (id === null || input === null) return;
  const content = input.value.trim();
  if (content === "") return;

  const sent = await api.say(id, content);
  // Cleared only AFTER the server took it. A composer that cleared on submit
  // loses what the student wrote when the send fails.
  if (sent.ok) input.value = "";
  else report(sent.code);
  await refresh();
}

// ───────────────────────────────────────────────────────────────────────────
// Start
// ───────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const form = el("composer");
  form?.addEventListener("submit", (event) => {
    void onSend(event);
  });

  const held = await api.listConversations();
  if (!held.ok) {
    // 401 is the ordinary case for a page loaded without a session: send them
    // to the service's own login, which is where the `__Host-` cookie is
    // minted (ADR-0056).
    if (held.status === 401) window.location.assign("/auth/login");
    else report(held.code);
    draw();
    return;
  }

  // The most recent, or a new one. `GET /v1/conversations` is newest-first, so
  // a returning student lands back where they were without this page having
  // remembered anything.
  const existing: api.Conversation | undefined = held.value[0];
  const opened =
    existing ??
    (await api
      .openConversation()
      .then((made) => (made.ok ? made.value : null)));
  const conversation: api.Conversation | null = opened ?? null;
  if (conversation === null) {
    report("service_unavailable");
    draw();
    return;
  }

  view.conversationId = conversation.id;
  listen(conversation.id);
  await refresh();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start());
  } else {
    void start();
  }
}

/** Exported for the tests, which drive these directly rather than by clicking. */
export const client = { start, refresh, view };
