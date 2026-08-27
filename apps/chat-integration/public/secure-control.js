/**
 * The secure password control, as it behaves in a real browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"The password must NOT be sent as: a normal chat
 * message, a message attachment, a tool argument containing plaintext, a
 * streaming token, conversation state."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The four rules this file follows ──────────────────────────────────────
 *
 *  1. The password value is read from the input at the moment of submission,
 *     posted, and the inputs are cleared. It is never assigned to a
 *     module-scope variable, never put in `window`, never in `localStorage`,
 *     and never in the turn list.
 *
 *  2. `sendChatMessage` — the ordinary path — reads only `#chat-input`. It has
 *     no access to the secure inputs, and the chat input is disabled while a
 *     box is open, so there is no state in which a keystroke lands in both.
 *
 *  3. The secure inputs are in their OWN `<form>`, outside the composer. A
 *     stray Enter key in the password field submits the secure form, not the
 *     chat form — which is the accident that would otherwise post a password
 *     as a message.
 *
 *  4. On any failure the box closes, the value is cleared, and the student is
 *     told **not to type it into the chat**. There is no path from a failed
 *     submission to the ordinary message input.
 */

(() => {
  "use strict";

  /** Turns the client holds. Used to build history. Never holds a password. */
  const turns = [];
  /** The open request, if any. Holds ids and display text only. */
  let openRequest = null;

  const el = (id) => document.getElementById(id);

  // ── The ordinary chat path ─────────────────────────────────────────────

  /**
   * How many turns have been drawn. The list only grows, so rendering is
   * APPEND-ONLY.
   *
   * This is not an optimisation. The secure card lives inside the transcript
   * now, and the previous implementation began with `innerHTML = ""` — which
   * would tear the card out of the DOM every time any turn arrived, mid-typing,
   * discarding whatever the student had entered. Appending only what is new
   * means the card is never touched by an unrelated message.
   */
  let rendered = 0;

  /**
   * Draws the turns that have not been drawn yet, IN ORDER.
   *
   * Note the absence of a `continue`. The previous version skipped every turn
   * that was not a message, which is what removed the secure request from the
   * conversation and pushed it into a detached panel below the composer. Each
   * turn now produces exactly one thing in its real position — mirroring
   * `projectTranscript` in ../src/transcript.ts, which is the tested authority.
   */
  function renderTranscript() {
    for (; rendered < turns.length; rendered += 1) {
      const turn = turns[rendered];
      if (turn.kind === "message") {
        const div = document.createElement("div");
        div.className = `turn ${turn.sender}`;
        div.textContent = turn.content;
        el("transcript").append(div);
      } else if (turn.kind === "secret_status") {
        // A settled secure step, shown in place so the conversation reads as
        // one sequence. The lifecycle word and the opaque handle only — there
        // is nothing else on the turn to show.
        const div = document.createElement("div");
        div.className = "turn status";
        div.dataset["lifecycle"] = turn.lifecycle;
        div.textContent =
          turn.lifecycle === "secret_received"
            ? "Password received securely. I never saw it."
            : `Secure step: ${turn.lifecycle}`;
        el("transcript").append(div);
      }
      // A `directive` draws nothing here: `showSecureControl` has already moved
      // the card into this position in the transcript. Counting it keeps the
      // ordinals aligned with the turn list.
    }
  }

  /**
   * Applies the composer policy. Mirrors `composerPolicy` in
   * ../src/render-decision.ts, which is the tested authority.
   *
   * TYPING stays live in every state. Only SENDING is blocked. The previous
   * version disabled the whole composer, which is safer — a disabled input
   * cannot receive a password — and is also the modal freeze that breaks the
   * one-continuous-conversation requirement. The trade is deliberate and the
   * residual risk is stated in docs/composer-during-secure-turn.md §13.
   */
  function applyComposerPolicy(awaitingSecret) {
    // Never disabled. The student can keep writing.
    el("chat-input").disabled = false;
    el("chat-send").disabled = awaitingSecret;
    el("chat-input").dataset["send"] = awaitingSecret ? "blocked" : "enabled";
    el("chat-input").placeholder = awaitingSecret
      ? "You can keep typing — your password goes in the box above"
      : "Ask AskiMate…";
  }

  el("composer").addEventListener("submit", (event) => {
    event.preventDefault();

    // ── PREVENTION ────────────────────────────────────────────────────────
    //
    // While a secure request is open, this returns before anything is read or
    // sent. NO BYTES LEAVE THE BROWSER, and — the part that answers Vahid's
    // objection — the draft is left exactly where the student put it. Nothing
    // is cleared, nothing is queued, nothing is destroyed.
    //
    // It is NOT queued for later delivery on purpose. Releasing a buffer when
    // the card closes would transmit a password that had been typed into the
    // wrong box, turning a contained accident into a persisted one. When the
    // card closes the composer simply becomes live again with the draft still
    // in it, and the student's next send is a fresh, deliberate act.
    if (openRequest !== null) {
      el("composer-hint").textContent =
        "Held — finish the password step above and your message will still be here.";
      return;
    }
    el("composer-hint").textContent = "";

    const content = el("chat-input").value;
    if (content.length === 0) return;

    // ── Cleared on ACKNOWLEDGEMENT, never optimistically ──────────────────
    //
    // Clearing the box the moment Send is pressed means a server refusal — a
    // stale client, a guard that threw, a direct call — destroys the message.
    // That is the exact failure this design exists to avoid, so the text stays
    // put until the server says "accepted".
    //
    // The consequence is worth stating plainly: even the fail-closed path is
    // lossless. The student sees their message still in the box, and the card
    // they did not know about appears.
    window.__askimateSent = window.__askimateSent || [];
    window.__askimateSent.push({ path: "chat", body: { message: content } });

    fetch("/api/askimate/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${window.__askimateToken}`,
      },
      body: JSON.stringify({
        conversationId: window.__askimateConversationId,
        content,
      }),
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || data.status !== "accepted") {
          // REFUSED. The draft stays exactly as typed. If the server named an
          // open request, this client was stale — so show the card it did not
          // know about rather than leaving the student to guess.
          window.__askimateChatRefusal = data;
          el("composer-hint").textContent =
            data.reason === "secret_request_open"
              ? "Held — there is a password step open above. Your message is still here."
              : "That did not send. Your message is still here.";
          if (data.reason === "secret_request_open" && openRequest === null) {
            openRequest = { requestId: data.requestId, conversationId: window.__askimateConversationId };
            applyComposerPolicy(true);
          }
          return;
        }
        el("chat-input").value = "";
        el("composer-hint").textContent = "";
        turns.push({ kind: "message", sender: "user", content });
        renderTranscript();
      })
      .catch(() => {
        // A dropped connection is not a reason to lose what they wrote.
        el("composer-hint").textContent = "That did not send. Your message is still here.";
      });
  });

  // ── The directive path ─────────────────────────────────────────────────

  /**
   * Handles a turn from the server.
   *
   * A `directive` never becomes a message. The transcript shows the control,
   * and the turn list records that a box was shown — not what went into it.
   */
  window.__askimateReceive = (turn) => {
    if (turn.kind === "directive" && turn.directive === "request_secret") {
      showSecureControl(turn.prompt, turn.capabilities);
      return;
    }
    turns.push(turn);
    renderTranscript();
  };

  function decideRendering(prompt, capabilities, now) {
    // Mirrors `decideRendering` in ../src/render-decision.ts. There is no
    // `chat_message` outcome here either — a client that wanted to fall back
    // would have to write the code to do it.
    if (prompt.channel !== "secure_control") return { render: "refuse", reason: "unknown_channel" };
    if (!capabilities.supportsSecureControl)
      return { render: "refuse", reason: "client_does_not_support_secure_control" };
    if (!capabilities.secureContext) return { render: "refuse", reason: "insecure_context" };
    if (!capabilities.endpointReachable) return { render: "refuse", reason: "endpoint_unreachable" };
    if (now >= Date.parse(prompt.expiresAt)) return { render: "refuse", reason: "prompt_expired" };
    return { render: "secure_control" };
  }

  const REFUSAL_TEXT = {
    client_does_not_support_secure_control:
      "I need a password, but this version of the app cannot show a secure password box. " +
      "Do not type a password into the chat.",
    insecure_context:
      "I need a password, but this page is not on a secure connection. " +
      "Do not type a password into the chat.",
    endpoint_unreachable:
      "I cannot reach the secure service that would receive your password. " +
      "Do not type a password into the chat.",
    prompt_expired:
      "The password box timed out before it opened. Do not type a password into the chat.",
    unknown_channel:
      "I was asked to collect something in a way this app does not recognise. " +
      "Do not type a password into the chat.",
  };

  function showSecureControl(prompt, capabilities) {
    // The one legitimate ambient-clock read in the repository. This runs inside
    // the student's browser, deciding whether a prompt has already expired
    // before it is shown; there is no clock to inject into a page, and reading
    // the server's would mean trusting a timestamp over a network round-trip
    // that has already happened. The pure version of this decision lives in
    // ../src/render-decision.ts and DOES take the clock as an argument.
    // eslint-disable-next-line no-restricted-syntax -- a page has only its own clock
    const decision = decideRendering(prompt, capabilities, Date.now());

    if (decision.render === "refuse") {
      // FAIL CLOSED. The chat input stays enabled — the student can carry on
      // talking — but nothing has asked them for a password, and the text says
      // plainly not to type one.
      el("refusal").textContent = REFUSAL_TEXT[decision.reason];
      el("refusal").dataset["reason"] = decision.reason;
      el("secure-control").hidden = true;
      openRequest = null;
      applyComposerPolicy(false);
      return;
    }

    openRequest = { requestId: prompt.requestId, conversationId: prompt.conversationId };
    // CONTAINMENT: no draft may reach browser storage while a request is open.
    // A chat client that persists drafts would otherwise write a mistyped
    // password into storage that outlives the five-minute TTL governing
    // everything else here. The key is removed as well as not written, in case
    // a draft was saved a moment before the card opened.
    try {
      window.localStorage.removeItem("askimate.draft");
    } catch {
      // Private mode, blocked storage. Nothing to clean up is also fine.
    }
    window.__askimateDraftPersistence = "suspended";
    el("refusal").textContent = "";
    el("secure-title").textContent = prompt.title;
    el("secure-explanation").textContent = prompt.explanation;
    el("secure-host").textContent = `For your account on ${prompt.portalHost}.`;
    el("confirm-field").hidden = !prompt.requiresConfirmation;
    el("secure-confirmation").required = prompt.requiresConfirmation;
    el("secure-error").textContent = "";
    // ── Into the conversation, not beside it ────────────────────────────
    //
    // The card is MOVED rather than recreated, so the element keeps its
    // identity and its input values across every re-render. Appending it at
    // the end of the transcript places it exactly where the directive turn
    // sits in the sequence, which is what "inline" means in the DOM.
    //
    // It stays a separate <form> with its own submit handler while it is
    // there. Nesting a form inside a transcript container does not join it to
    // the composer's form, and that separation is what keeps a stray Enter in
    // the password field away from the message pipeline.
    el("transcript").append(el("secure-control"));
    el("secure-control").hidden = false;
    applyComposerPolicy(true);
    el("secure-password").focus();
  }

  // ── Submission ─────────────────────────────────────────────────────────

  el("secure-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (openRequest === null) return;

    // Read at the moment of use. Not stored, not closed over, not logged.
    const password = el("secure-password").value;
    const confirmation = el("secure-confirmation").value;

    if (password.length === 0) {
      el("secure-error").textContent = "Please enter a password.";
      return;
    }
    // Checked here for a fast answer; checked AGAIN on the server, which is the
    // check that counts. "The UI compared them" is not a property the server has.
    if (!el("confirm-field").hidden && password !== confirmation) {
      clearInputs();
      el("secure-error").textContent = "The two passwords did not match. Please try again.";
      return;
    }

    const requestId = openRequest.requestId;
    const conversationId = openRequest.conversationId;

    fetch(`/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${window.__askimateToken}`,
      },
      // The ONE request in the whole client that carries a password.
      body: JSON.stringify({ password, confirmation, conversationId }),
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        clearInputs();
        if (!ok || data.status !== "secret_received") {
          // Fail closed. The box stays open for a mismatch so the student can
          // retry; for anything else it closes and the run asks again.
          const retryable = data.reason === "confirmation_mismatch";
          el("secure-error").textContent = retryable
            ? "The two passwords did not match. Please try again."
            : "I could not accept that password. I will ask you again in a moment. " +
              "Do not type it into the chat.";
          if (!retryable) closeSecureControl();
          window.__askimateStatus = { status: "secret_rejected", reason: data.reason };
          return;
        }
        closeSecureControl();
        // The model learns exactly this: a word and an opaque handle.
        turns.push({ kind: "secret_status", lifecycle: "secret_received", handle: data.handle });
        window.__askimateStatus = { status: "secret_received", handle: data.handle };
      })
      .catch(() => {
        // A dropped connection mid-submission. Clear, close, say nothing about
        // what was typed, and never route it to the chat.
        clearInputs();
        closeSecureControl();
        el("refusal").textContent = REFUSAL_TEXT.endpoint_unreachable;
        el("refusal").dataset["reason"] = "endpoint_unreachable";
        window.__askimateStatus = { status: "secret_rejected", reason: "endpoint_unreachable" };
      });
  });

  function clearInputs() {
    el("secure-password").value = "";
    el("secure-confirmation").value = "";
  }

  function closeSecureControl() {
    window.__askimateDraftPersistence = "normal";
    clearInputs();
    el("secure-control").hidden = true;
    openRequest = null;
    applyComposerPolicy(false);
  }

  // Exposed for the test harness to inspect. Deliberately a getter over the
  // turn list rather than the list itself, so a test cannot be fooled by a
  // reference it captured earlier.
  window.__askimateTurns = () => JSON.parse(JSON.stringify(turns));
  window.__askimateOpenRequest = () => (openRequest === null ? null : { ...openRequest });
})();
