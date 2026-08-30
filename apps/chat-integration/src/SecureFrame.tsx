/**
 * The secure control, as the conversation page sees it: an iframe it cannot
 * read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0030 — the secure control runs on its own origin.
 * Vahid, 2026-08-28: *"Do not weaken origin isolation merely to simplify React
 * integration."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this component can and cannot do ─────────────────────────────────
 *
 * It renders an `<iframe>` pointing at `secure.askimate.com` and it talks to
 * that frame through the closed-set protocol in `@askimate/aas-contracts`. It
 * CANNOT read the frame's DOM, its storage, its cookies or its JavaScript heap
 * — the browser refuses, because they are different origins. That is the whole
 * design: the previous `SecureControl.tsx` rendered the password field in THIS
 * document, so "no script on the chat page can read the password" was a
 * property our code promised. Here it is a property the browser enforces.
 *
 * It also does not know the prompt text. The title and explanation are stored
 * by the secure service and rendered inside the frame, so a model's words about
 * a password never reach this plane at all.
 *
 * ── Every message is checked four ways ────────────────────────────────────
 *
 * Exact origin, exact source window, matching request id, closed-set parse.
 * `parseFrameOutbound` does all four and this component adds none of its own —
 * a second opinion about what a message means is a second place to be wrong.
 *
 * ── The bootstrap ─────────────────────────────────────────────────────────
 *
 * The token is sent by `postMessage` at the frame's exact origin, never in the
 * `src` URL. A capability in a URL appears in the `Referer` header, in browser
 * history, in server access logs and in a shared screenshot; a `postMessage`
 * payload appears in none of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import type { RejectionReason, SecretLifecycleWord } from "@askimate/aas-contracts";
import { FRAME_PROTOCOL_VERSION, parseFrameOutbound } from "@askimate/aas-contracts";

export interface SecureFrameProps {
  readonly requestId: string;
  /** `https://secure.askimate.com`. Compared with `===`, never a prefix. */
  readonly secureOrigin: string;
  /**
   * The one-time bootstrap capability, from the Conversation Service.
   *
   * Held in a prop and passed straight into one `postMessage`. It is NOT a
   * secret in the sense the password is — it authenticates a frame, not a
   * person — but it is a capability, so it is short-lived, single-use, and
   * never written anywhere this component controls.
   */
  readonly frameToken: string;
  readonly onLifecycle: (lifecycle: SecretLifecycleWord, handle?: string) => void;
  readonly onRejected: (reason: RejectionReason) => void;
  readonly onCancelled: () => void;
}

const INITIAL_HEIGHT = 220;

export function SecureFrame(props: SecureFrameProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [status, setStatus] = useState<"loading" | "live" | "unreachable">("loading");

  const { requestId, secureOrigin, frameToken, onLifecycle, onRejected, onCancelled } = props;

  // The token is held in a ref so the listener below does not need it as a
  // dependency — a listener that re-subscribed when the token changed would
  // detach mid-handshake.
  const tokenRef = useRef(frameToken);
  tokenRef.current = frameToken;

  const handle = useCallback(
    (event: MessageEvent): void => {
      const frame = frameRef.current;
      if (frame === null) return;

      const message = parseFrameOutbound(
        { origin: event.origin, source: event.source, data: event.data },
        {
          expectedOrigin: secureOrigin,
          // The window we rendered, and only that. A message from any other
          // frame on the page — an ad, a widget, a nested iframe — has a
          // different `source` and is refused before its content is read.
          expectedSource: frame.contentWindow,
          expectedRequestId: requestId,
        },
      );
      if (message === null) return;

      switch (message.kind) {
        case "ready":
          setStatus("live");
          setHeight(message.height || INITIAL_HEIGHT);
          // ── The bootstrap, by postMessage and at an EXACT origin ────────
          //
          // Never `"*"`. A wildcard delivers to whatever happens to be at the
          // other end, which is precisely the attacker in the threat model:
          // the frame may have been replaced, or navigated, between render and
          // now, and the browser is what checks — but only if we tell it what
          // to check against.
          frame.contentWindow?.postMessage(
            {
              v: FRAME_PROTOCOL_VERSION,
              requestId,
              kind: "bootstrap",
              frameToken: tokenRef.current,
            },
            secureOrigin,
          );
          break;
        case "resize":
          setHeight(message.height || INITIAL_HEIGHT);
          break;
        case "secret_status":
          // A lifecycle word and, on a receipt only, an opaque handle. This is
          // a UX ACCELERATOR: the authoritative transition arrives on the
          // conversation stream, written by the secure service through the
          // internal append. See `useSecureTurn`.
          onLifecycle(message.lifecycle, message.handle);
          break;
        case "secret_rejected":
          onRejected(message.reason);
          break;
        case "cancelled":
          onCancelled();
          break;
      }
    },
    [onCancelled, onLifecycle, onRejected, requestId, secureOrigin],
  );

  useEffect(() => {
    window.addEventListener("message", handle);
    return () => {
      window.removeEventListener("message", handle);
    };
  }, [handle]);

  // If the frame never says `ready`, the student is looking at a blank box.
  // Say so, rather than leaving them waiting for something that is not coming.
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus((current) => (current === "loading" ? "unreachable" : current));
    }, 10_000);
    return () => {
      clearTimeout(timer);
    };
  }, [requestId]);

  return (
    <div className="secure-frame" data-testid="secure-frame" data-status={status}>
      {status === "unreachable" ? (
        <p role="alert" data-testid="secure-frame-error">
          The secure password step could not be loaded. AskiMate will ask again.
        </p>
      ) : null}
      <iframe
        ref={frameRef}
        // The URL carries the request ID — an identifier, not a capability. On
        // its own it authenticates nobody, which is exactly why the token
        // exists and travels separately.
        src={`${secureOrigin}/control/${encodeURIComponent(requestId)}`}
        title="Secure password entry"
        data-testid="secure-iframe"
        width="100%"
        height={height}
        style={{ border: "0", display: "block" }}
        // Only what the control needs. No `allow-popups`, no
        // `allow-top-navigation`, no `allow-downloads`. `allow-same-origin` is
        // required for the frame to have its own origin's cookies and storage —
        // withholding it would give the frame an OPAQUE origin, which cannot
        // hold the `__Host-` session the bootstrap establishes.
        sandbox="allow-scripts allow-forms allow-same-origin"
        // No powerful feature is delegated. A password field needs none.
        allow=""
        referrerPolicy="no-referrer"
        loading="eager"
      />
    </div>
  );
}
