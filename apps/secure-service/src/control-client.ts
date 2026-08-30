/**
 * The script inside the secure frame. The only code that ever sees a password.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: the credential must *"exist only inside the Secure
 * Plane… never bind its value into React state… never cross the iframe
 * boundary… never be included in a postMessage payload."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Where the value exists ────────────────────────────────────────────────
 *
 * In the DOM value of one `<input type="password">`, and in one argument to
 * `fetch` inside the submit handler. That is the complete list.
 *
 * It is NOT in a variable that outlives the handler, not in a module-level
 * binding, not in component state — there is no framework here at all, which is
 * itself the point: React is what would have tempted someone to make the input
 * controlled. The field is read at the moment of submission with
 * `element.value`, passed straight into the request body, and the local goes
 * out of scope when the function returns.
 *
 * ── What crosses the boundary ─────────────────────────────────────────────
 *
 * Only the messages in `@askimate/aas-contracts`'s frame protocol: `ready`,
 * `resize`, `secret_status`, `secret_rejected`, `cancelled`. Every one is
 * content-free by construction, and `NO_FRAME_MESSAGE_CARRIES_A_SECRET` fails
 * the build if a field is added that could carry one.
 *
 * Every `postMessage` names the parent's exact origin. Never `"*"`: a wildcard
 * delivers to whatever happens to be embedding this page, which is precisely
 * the attacker in the threat model.
 *
 * ── Deliberately absent ───────────────────────────────────────────────────
 *
 * No storage of any kind. No `localStorage`, no `sessionStorage`, no
 * `IndexedDB`, no cookie written from script. Nothing retries a failed
 * submission, because a retry needs somewhere to keep the value between
 * attempts. A failed submission leaves the value where it already is — in the
 * input the student is looking at — and they press the button again.
 */

import { FRAME_PROTOCOL_VERSION, parseFrameInbound } from "@askimate/aas-contracts";
import type { FrameOutboundMessage } from "@askimate/aas-contracts";

interface Elements {
  readonly root: HTMLElement;
  readonly state: HTMLElement;
  readonly form: HTMLFormElement;
  readonly title: HTMLElement;
  readonly explanation: HTMLElement;
  readonly password: HTMLInputElement;
  readonly confirmation: HTMLInputElement;
  readonly confirmationLabel: HTMLElement;
  readonly error: HTMLElement;
  readonly cancel: HTMLButtonElement;
}

/** The sentence a student reads, chosen from a fixed table keyed by a code. */
const REFUSALS: Readonly<Record<string, string>> = {
  confirmation_mismatch: "Those did not match. Try again.",
  empty: "Enter your password.",
  expired: "This step timed out. AskiMate will ask again.",
  already_submitted: "This step is already finished.",
  not_your_request: "This step is not available.",
  wrong_conversation: "This step is not available.",
  unknown_request: "This step is no longer available.",
  server_error: "That did not send. Try again.",
  endpoint_unreachable: "That did not send. Try again.",
};

function start(): void {
  const root = document.getElementById("control");
  if (root === null) return;
  const requestId = root.dataset["requestId"] ?? "";
  const parentOrigin = root.dataset["parentOrigin"] ?? "";
  if (requestId === "" || parentOrigin === "") return;

  const found = collect(root);
  if (found === null) return;
  // A second const, non-null by the check above. A `function` declaration is
  // hoisted, so TypeScript will not carry a narrowing into one — the handlers
  // below are `const` arrows for the same reason.
  const elements: Elements = found;

  /** Sends one protocol message to the parent, at its EXACT origin. */
  const tell = (message: Omit<FrameOutboundMessage, "v" | "requestId">): void => {
    // `parent.postMessage(payload, exactOrigin)` — never `"*"`. The browser
    // refuses to deliver if the embedder is not that origin, which is what
    // makes this a control rather than an intention.
    window.parent.postMessage(
      { ...message, v: FRAME_PROTOCOL_VERSION, requestId },
      parentOrigin,
    );
  };

  const measure = (): number => Math.ceil(document.body.getBoundingClientRect().height);
  const tellHeight = (kind: "ready" | "resize"): void => {
    tell({ kind, height: measure() } as Omit<FrameOutboundMessage, "v" | "requestId">);
  };

  // ── The bootstrap: wait for the token, exchange it for a cookie ──────────
  //
  // The token arrives by postMessage and is used immediately. It is never
  // written anywhere, never put in a URL, and the local holding it goes out of
  // scope when this handler returns.
  const onMessage = (event: MessageEvent): void => {
    const message = parseFrameInbound(
      { origin: event.origin, source: event.source, data: event.data },
      {
        expectedOrigin: parentOrigin,
        // The parent window, and only that. A message from a nested frame or
        // an opener has a different `source` and is refused.
        expectedSource: window.parent,
        expectedRequestId: requestId,
      },
    );
    if (message === null) return;

    void exchange(message.frameToken);
  };
  window.addEventListener("message", onMessage);

  const exchange = async (frameToken: string): Promise<void> => {
    try {
      const response = await fetch("/v1/frame-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same-origin: this is the secure plane calling itself, which is what
        // `connect-src 'self'` permits and nothing else.
        credentials: "same-origin",
        body: JSON.stringify({ requestId, frameToken }),
      });
      if (!response.ok) {
        show(elements, "This step could not be started.");
        return;
      }
      await load();
    } catch {
      show(elements, "This step could not be started.");
    }
  };

  const load = async (): Promise<void> => {
    const response = await fetch(`/v1/secret-requests/${encodeURIComponent(requestId)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      show(elements, "This step is no longer available.");
      return;
    }
    const state = (await response.json()) as {
      lifecycle?: string;
      requiresConfirmation?: boolean;
      title?: string | null;
      explanation?: string | null;
      targetHost?: string;
    };
    if (state.lifecycle !== "secret_requested") {
      show(elements, "This step is already finished.");
      tell({ kind: "secret_status", lifecycle: "secret_expired" } as never);
      return;
    }

    // The prompt text is rendered HERE, inside the secure plane. It never
    // reaches the conversation page, so a model's words about a password never
    // enter the conversation log. `textContent`, not `innerHTML`: this is text
    // a model wrote.
    elements.title.textContent = state.title ?? "Enter your password";
    elements.explanation.textContent =
      state.explanation ?? `AskiMate needs a password for ${state.targetHost ?? "the portal"}.`;
    const needsConfirmation = state.requiresConfirmation !== false;
    elements.confirmation.hidden = !needsConfirmation;
    elements.confirmationLabel.hidden = !needsConfirmation;
    elements.state.hidden = true;
    elements.form.hidden = false;
    // Focus lands in the field the student came here to fill. Keyboard users
    // reach it without tabbing through a document they cannot see the rest of.
    elements.password.focus();
    tellHeight("resize");
  };

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  const submit = async (): Promise<void> => {
    elements.error.textContent = "";
    // ── The only two reads of the value, both here ────────────────────────
    //
    // Into consts that die with this function. Not assigned to anything on
    // `window`, not closed over by a listener, not stored for a retry.
    const secret = elements.password.value;
    const confirmation = elements.confirmation.hidden ? undefined : elements.confirmation.value;
    if (secret.length === 0) {
      elements.error.textContent = REFUSALS["empty"] ?? "";
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `/v1/secret-requests/${encodeURIComponent(requestId)}/secret`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            secret,
            ...(confirmation === undefined ? {} : { confirmation }),
            conversationId: conversationIdOf(),
          }),
        },
      );
    } catch {
      elements.error.textContent = REFUSALS["endpoint_unreachable"] ?? "";
      tell({ kind: "secret_rejected", reason: "endpoint_unreachable" } as never);
      return;
    }

    if (response.ok) {
      const accepted = (await response.json()) as { handle?: string };
      // Both fields cleared the moment the server has it. The value is gone
      // from the DOM as well as from this scope.
      elements.password.value = "";
      elements.confirmation.value = "";
      elements.form.hidden = true;
      elements.state.hidden = false;
      elements.state.textContent = "Password received securely.";
      // The HANDLE crosses, and it is the one capability permitted over this
      // boundary: random rather than derived, single-use, and bound to student,
      // case, purpose and target, re-checked when it is spent.
      tell({
        kind: "secret_status",
        lifecycle: "secret_received",
        ...(typeof accepted.handle === "string" ? { handle: accepted.handle } : {}),
      } as never);
      tellHeight("resize");
      return;
    }

    const problem = (await response.json().catch(() => null)) as { reason?: string } | null;
    const reason = typeof problem?.reason === "string" ? problem.reason : "server_error";
    // A CODE crosses, and the sentence is chosen from the table above. The
    // response body is never rendered: it is the one thing on this page that
    // came off a network.
    elements.error.textContent = REFUSALS[reason] ?? REFUSALS["server_error"] ?? "";
    // A mismatch clears BOTH fields — retyping both is the point of confirming.
    if (reason === "confirmation_mismatch") {
      elements.password.value = "";
      elements.confirmation.value = "";
      elements.password.focus();
    }
    tell({ kind: "secret_rejected", reason } as never);
    tellHeight("resize");
  };

  elements.cancel.addEventListener("click", () => {
    void (async (): Promise<void> => {
      elements.password.value = "";
      elements.confirmation.value = "";
      await fetch(`/v1/secret-requests/${encodeURIComponent(requestId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      }).catch(() => undefined);
      elements.form.hidden = true;
      elements.state.hidden = false;
      elements.state.textContent = "Cancelled.";
      tell({ kind: "cancelled" } as never);
    })();
  });

  /**
   * The conversation this frame belongs to, per the document.
   *
   * Read off `elements.root`, not the outer `root` — a hoisted function
   * declaration does not carry the outer narrowing, and the compiler was right
   * to say so.
   */
  function conversationIdOf(): string {
    return elements.root.dataset["conversationId"] ?? "";
  }

  // Announced last, when every listener is attached. A parent that sent the
  // bootstrap before the listener existed would be answered by nothing.
  tellHeight("ready");
}

function collect(root: HTMLElement): Elements | null {
  const state = document.getElementById("state");
  const form = document.getElementById("secure-form");
  const title = document.getElementById("secure-title");
  const explanation = document.getElementById("secure-explanation");
  const password = document.getElementById("secure-password");
  const confirmation = document.getElementById("secure-confirmation");
  const confirmationLabel = document.getElementById("confirmation-label");
  const error = document.getElementById("secure-error");
  const cancel = document.getElementById("secure-cancel");
  if (
    state === null || form === null || title === null || explanation === null ||
    password === null || confirmation === null || confirmationLabel === null ||
    error === null || cancel === null
  ) {
    return null;
  }
  return {
    root,
    state,
    form: form as HTMLFormElement,
    title,
    explanation,
    password: password as HTMLInputElement,
    confirmation: confirmation as HTMLInputElement,
    confirmationLabel,
    error,
    cancel: cancel as HTMLButtonElement,
  };
}

function show(elements: Elements, message: string): void {
  elements.form.hidden = true;
  elements.state.hidden = false;
  elements.state.textContent = message;
}

start();
