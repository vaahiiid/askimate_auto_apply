/**
 * The conversation, drawn. PROVISIONAL — not an AskiMate interface.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Keep the UI deliberately provisional and clearly marked
 * as such. Do not make unrelated visual, copy, or interaction redesign
 * decisions."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every element, class name and sentence below is a placeholder. This file
 * exists so the architecture can be driven in a real browser: that the secure
 * request appears in its place in the conversation, that the composer behaves
 * exactly as `composerPolicy` says, and that no failure path destroys what a
 * student typed. A visual redesign should be able to replace all of it without
 * touching `useSecureTurn.ts` or `SecureControl.tsx`.
 *
 * ── The composer is UNCONTROLLED, and that is a security choice ────────────
 *
 * `useState` for the draft would be the idiomatic React composer, and it would
 * put every keystroke into component state. Usually harmless; not here. The
 * residual risk this whole design works to minimise is a student typing their
 * password into the ordinary box by mistake, and a controlled composer turns
 * that mistake into React state — visible to DevTools, serialisable by an error
 * boundary, captured by a reporter that snapshots the tree. Uncontrolled, the
 * text is a DOM value that nothing snapshots, and preserving a held draft costs
 * nothing because no code path ever writes to it.
 */

import { useCallback, useEffect, useRef } from "react";
import type { FormEvent, JSX } from "react";

import { renderKey } from "@askimate/aas-conversation";

import { SecureControl } from "./SecureControl.js";
import type { SecureTurnState } from "./useSecureTurn.js";

/** Where a chat client would persist an unsent draft across a reload. */
export const DRAFT_KEY = "askimate.draft";

export interface ChatViewProps {
  readonly state: SecureTurnState;
  readonly conversationId: number;
  readonly authToken: string;
}

export function ChatView(props: ChatViewProps): JSX.Element {
  const { state } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);

  const say = useCallback((message: string): void => {
    if (hintRef.current !== null) hintRef.current.textContent = message;
  }, []);

  // ── CONTAINMENT ─────────────────────────────────────────────────────────
  //
  // No draft may reach browser storage while a secure request is open. A chat
  // client that persists drafts would otherwise write a mistyped password into
  // storage that outlives the five-minute TTL governing everything else here.
  // The key is REMOVED as well as not written, in case a draft was saved a
  // moment before the request opened.
  useEffect(() => {
    if (state.composer.draftPersistence !== "suspended") return;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Private mode, blocked storage. Nothing to clean up is also fine.
    }
  }, [state.composer.draftPersistence]);

  const onDraftChanged = useCallback((): void => {
    if (state.composer.draftPersistence !== "normal") return;
    try {
      window.localStorage.setItem(DRAFT_KEY, inputRef.current?.value ?? "");
    } catch {
      // Storage unavailable. A draft that is not persisted is not a failure.
    }
  }, [state.composer.draftPersistence]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();

      // ── PREVENTION ──────────────────────────────────────────────────────
      //
      // Returns before anything is read or sent. No bytes leave the browser,
      // and the draft is left exactly where the student put it: nothing is
      // cleared, nothing is queued, nothing is destroyed.
      //
      // It is not queued for later delivery on purpose. Releasing a buffer when
      // the card closes would transmit a password that had been typed into the
      // wrong box, turning a contained accident into a persisted one.
      if (state.composer.send === "blocked") {
        say("Held — finish the password step above and your message will still be here.");
        return;
      }

      const content = inputRef.current?.value ?? "";
      if (content.length === 0) return;
      say("");

      // ── Cleared on ACKNOWLEDGEMENT, never optimistically ────────────────
      //
      // Clearing the box the moment Send is pressed means a server refusal
      // destroys the message. The text stays put until the server says
      // "accepted", so even the fail-closed path is lossless.
      void state.send(content).then((result) => {
        if (result.outcome === "accepted") {
          if (inputRef.current !== null) inputRef.current.value = "";
          try {
            window.localStorage.removeItem(DRAFT_KEY);
          } catch {
            // Nothing to remove is fine.
          }
          say("");
          return;
        }
        say(
          result.outcome === "held"
            ? "Held — there is a password step open above. Your message is still here."
            : "That did not send. Your message is still here.",
        );
      });
    },
    [say, state],
  );

  return (
    <main>
      <h1>AskiMate</h1>
      <p className="provisional" data-testid="provisional-banner">
        <strong>Provisional test surface.</strong> Deliberately unstyled. This is not the AskiMate
        interface and no visual or UX decision should be read from it.
      </p>

      <div id="transcript" data-testid="transcript">
        {/*
          `renderKey`, not the position itself. A position is now either a
          server ordinal or a client-local id, and the two share no number
          space — the prefix is what stops durable ordinal 1 and a provisional
          entry colliding on a key, which would make React reuse one item's DOM
          node for the other.
        */}
        {state.items.map((item) => {
          switch (item.render) {
            case "message":
              return (
                <div key={renderKey(item.position)} className={`turn ${item.actor}`} data-testid="turn">
                  {item.content}
                </div>
              );
            case "secure_control":
              // ── Live only while it is the OPEN one ────────────────────
              //
              // `projectTranscript` keeps every directive as an item forever,
              // which is right: the transcript drops nothing, and a settled
              // secure step is part of what happened. But a live form for a
              // settled request is a form a student could still submit to, and
              // my first version rendered exactly that — the card stayed on
              // screen after `secret_received`, and the test caught it.
              //
              // Which request is open is not decided here. `openSecureRequest`
              // decided it; this only compares ids.
              return state.openPrompt?.requestId === item.requestId ? (
                <SecureControl
                  key={renderKey(item.position)}
                  prompt={state.openPrompt}
                  conversationId={props.conversationId}
                  authToken={props.authToken}
                  onSubmitted={state.submitted}
                  onRejected={state.rejected}
                  onCancelled={state.cancel}
                />
              ) : (
                // One item, one thing rendered — the transcript still drops
                // nothing. Content-free: the position and the fact, no more.
                <div key={renderKey(item.position)} className="turn status" data-testid="secure-step-settled">
                  Secure password step.
                </div>
              );
            case "secret_status":
              return (
                <div
                  key={renderKey(item.position)}
                  className="turn status"
                  data-lifecycle={item.lifecycle}
                  data-testid="status"
                >
                  {item.lifecycle === "secret_received"
                    ? "Password received securely. I never saw it."
                    : `Secure step: ${item.lifecycle}`}
                </div>
              );
            case "secret_rejected":
              // The sentence is chosen HERE, from a fixed table keyed by the
              // code. It is never carried on the turn — a display string on a
              // turn is a field somebody eventually assembles from input.
              return (
                <div
                  key={renderKey(item.position)}
                  className="turn status"
                  data-rejected={item.reason}
                  data-testid="rejection"
                >
                  {item.reason === "confirmation_mismatch"
                    ? "Those did not match — you can try again above."
                    : "That password step did not complete. I will ask again."}
                </div>
              );
          }
        })}
      </div>

      <form id="composer" onSubmit={onSubmit} data-testid="composer">
        <input
          ref={inputRef}
          id="chat-input"
          data-testid="chat-input"
          type="text"
          autoComplete="off"
          onChange={onDraftChanged}
          // No `disabled` prop, and there could not be a useful one: the
          // linter rejected `disabled={state.composer.typing !== "live"}` as a
          // comparison that is always false, because `ComposerPolicy.typing`
          // is the literal type `"live"`. The type makes "disable the
          // composer" unrepresentable, so the attribute has nothing to say.
          data-typing={state.composer.typing}
          data-send={state.composer.send}
          placeholder={
            state.composer.send === "blocked"
              ? "You can keep typing — your reply goes in the box above"
              : "Ask AskiMate…"
          }
        />
        <button
          id="chat-send"
          data-testid="chat-send"
          type="submit"
          disabled={state.composer.send === "blocked"}
        >
          Send
        </button>
      </form>
      <p ref={hintRef} id="composer-hint" className="hint" role="status" data-testid="hint" />

      {/*
        Always in the DOM, empty when there is nothing to refuse. Rendering it
        conditionally would mean `data-reason` was absent in two different
        situations — "no refusal" and "no element" — and the browser tests read
        that attribute to tell a real refusal from a misconfigured harness.
      */}
      <div
        id="refusal"
        className="error"
        role="alert"
        data-testid="refusal"
        {...(state.refusal === null ? {} : { "data-reason": state.refusal.reason })}
      >
        {state.refusal?.say ?? ""}
      </div>
    </main>
  );
}
