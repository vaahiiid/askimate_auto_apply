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
}

const view: View = {
  conversationId: null,
  events: [],
  run: { run: null, pending: null },
  targets: [],
  offer: null,
  preview: null,
  notice: "",
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

  const [events, run] = await Promise.all([
    api.readEvents(id),
    api.readRun(id),
  ]);

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

function draw(): void {
  const notice = el("notice");
  if (notice !== null) text(notice, view.notice);
  drawTranscript();
  drawTargets();
  drawOffer();
  drawPending();
  drawSecureStep();
  drawComposer();
}

// ───────────────────────────────────────────────────────────────────────────
// Acting. Each one posts, then RE-READS — never assumes what it did.
// ───────────────────────────────────────────────────────────────────────────

const REFUSALS: Readonly<Record<string, string>> = {
  not_found:
    "That is not available any more. Let me show you where things stand.",
  content_changed: "That changed since you looked at it. Here it is again.",
  validation_failed: "That did not go through. Try again.",
  forbidden: "That is not something you can do here.",
  service_unavailable: "That part of the service is not available right now.",
  contract_mismatch: "The server sent something this page did not understand.",
};

function report(code: string): void {
  view.notice =
    REFUSALS[code] ?? "That did not work. Let me show you where things stand.";
}

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
  if (!started.ok) report(started.code);
  else view.offer = null;
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
