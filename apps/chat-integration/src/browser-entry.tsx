/**
 * The mount. PROVISIONAL — see ChatView.tsx.
 *
 * This is where the React client meets the page: it reads the token and the
 * conversation the host page put on `window`, builds the real transport, and
 * exposes ONE test seam — `window.__askimateReceive`.
 *
 * ── Why a seam and not a route ────────────────────────────────────────────
 *
 * Nothing in this application delivers a `directive` turn to a browser. There
 * is no route that opens a secret request either: both belong to the
 * orchestrator, which is Phase E and blocked on access to the production
 * client. So a test hands the page a directive the way a server would, and the
 * page's behaviour from that point on is the real thing. The seam is named and
 * visible rather than hidden, so nobody mistakes it for a delivery mechanism.
 */

import { StrictMode } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "./ChatView.js";
import {
  browserTransport,
  parseIncomingTurn,
  useSecureTurn,
  type ReceivedTurn,
} from "./useSecureTurn.js";

declare global {
  interface Window {
    __askimateToken?: string;
    __askimateConversationId?: number;
    __askimateReceive?: (turn: unknown) => void;
    /**
     * Capability overrides, for the browser tests.
     *
     * Named and visible rather than hidden, like `__askimateReceive`. There is
     * no other way to put a real browser into "this build has no secure
     * control" or "this page is not on https" — and those are precisely the
     * states whose refusal path has to be proven in a real browser rather than
     * only in jsdom.
     */
    __askimateCapabilities?: {
      supportsSecureControl?: boolean;
      secureContext?: boolean;
      endpointReachable?: boolean;
    };
    /** Everything the client holds, drawn order: durable then provisional. */
    __askimateTurns?: () => unknown;
    /** ONLY the events the server placed, in ordinal order. */
    __askimateDurable?: () => unknown;
    __askimateOpenRequest?: () => unknown;
  }
}

function App(): JSX.Element {
  const authToken = window.__askimateToken ?? "";
  const conversationId = window.__askimateConversationId ?? 0;

  const state = useSecureTurn({
    conversationId,
    // Reported by the page about itself, not assumed. `isSecureContext` is the
    // browser's own answer to "is this page allowed to hold a credential", and
    // it is false on plain http, which is exactly when the control must refuse.
    capabilities: () => {
      const overrides = window.__askimateCapabilities;
      return {
        supportsSecureControl: overrides?.supportsSecureControl ?? true,
        // `127.0.0.1` is a potentially-trustworthy origin, so this is already
        // true under the browser tests without special-casing anything.
        secureContext: overrides?.secureContext ?? window.isSecureContext,
        endpointReachable: overrides?.endpointReachable ?? true,
      };
    },
    transport: browserTransport(authToken),
    // The one legitimate ambient-clock read in the client. This runs inside the
    // student's browser, deciding whether a prompt has already expired before
    // it is shown; a page has only its own clock, and reading the server's
    // would mean trusting a timestamp over a round trip that already happened.
    // Everything downstream takes it as an argument.
    // eslint-disable-next-line no-restricted-syntax -- a page has only its own clock
    now: () => new Date(),
  });

  // Exposed for the browser tests to inspect. A getter over a deep copy rather
  // than the list itself, so a test cannot be fooled by a reference it captured
  // earlier — and so nothing in the page holds a mutable alias to the turns.
  window.__askimateReceive = (raw: unknown): void => {
    const turn: ReceivedTurn | null = parseIncomingTurn(raw);
    if (turn !== null) state.receive(turn);
  };
  // Everything the client holds — durable events AND what it is merely
  // drawing. A leak-scanning test must see both: a marker sitting in a
  // provisional entry is just as leaked as one in a placed event, and a seam
  // that showed only the durable list would quietly stop looking at half the
  // state the moment the client started drawing anything.
  window.__askimateTurns = () =>
    JSON.parse(
      JSON.stringify([
        ...state.log.durable,
        ...state.log.provisional.map((entry) => entry.event),
      ]),
    ) as unknown;
  // The durable half on its own, for the assertions that are ABOUT position.
  window.__askimateDurable = () => JSON.parse(JSON.stringify(state.log.durable)) as unknown;
  window.__askimateOpenRequest = () =>
    state.openPrompt === null ? null : { requestId: state.openPrompt.requestId };

  return <ChatView state={state} conversationId={conversationId} authToken={authToken} />;
}

const container = document.getElementById("root");
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
