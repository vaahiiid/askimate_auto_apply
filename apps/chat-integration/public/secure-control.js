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

  function renderTranscript() {
    el("transcript").innerHTML = "";
    for (const turn of turns) {
      if (turn.kind !== "message") continue;
      const div = document.createElement("div");
      div.className = `turn ${turn.sender}`;
      div.textContent = turn.content;
      el("transcript").append(div);
    }
  }

  function setChatEnabled(enabled) {
    el("chat-input").disabled = !enabled;
    el("chat-send").disabled = !enabled;
  }

  el("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    // Reads ONLY the chat input. There is no branch here that could reach the
    // secure inputs, and none that could be reached while one is open.
    if (openRequest !== null) return;
    const content = el("chat-input").value;
    if (content.length === 0) return;
    turns.push({ kind: "message", sender: "user", content });
    el("chat-input").value = "";
    renderTranscript();
    window.__askimateSent = window.__askimateSent || [];
    window.__askimateSent.push({ path: "chat", body: { message: content } });
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
      setChatEnabled(true);
      return;
    }

    openRequest = { requestId: prompt.requestId, conversationId: prompt.conversationId };
    el("refusal").textContent = "";
    el("secure-title").textContent = prompt.title;
    el("secure-explanation").textContent = prompt.explanation;
    el("secure-host").textContent = `For your account on ${prompt.portalHost}.`;
    el("confirm-field").hidden = !prompt.requiresConfirmation;
    el("secure-confirmation").required = prompt.requiresConfirmation;
    el("secure-error").textContent = "";
    el("secure-control").hidden = false;
    setChatEnabled(false);
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
    clearInputs();
    el("secure-control").hidden = true;
    openRequest = null;
    setChatEnabled(true);
  }

  // Exposed for the test harness to inspect. Deliberately a getter over the
  // turn list rather than the list itself, so a test cannot be fooled by a
  // reference it captured earlier.
  window.__askimateTurns = () => JSON.parse(JSON.stringify(turns));
  window.__askimateOpenRequest = () => (openRequest === null ? null : { ...openRequest });
})();
