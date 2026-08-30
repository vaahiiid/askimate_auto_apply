/**
 * The secure control, as a document served by THIS origin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0030 — the secure control runs on its own origin.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This page is embedded by the conversation page as a cross-origin iframe. The
 * conversation origin cannot read this document's DOM, its storage, or its
 * JavaScript heap — which is what makes "no script on the chat page can read
 * the password" a property THE BROWSER ENFORCES rather than one our code
 * promises. Every other control in this design is a promise; this one is a
 * boundary.
 *
 * ── The headers are the security, not the markup ──────────────────────────
 *
 *   default-src 'none'          nothing loads unless named below
 *   script-src 'self'           no inline script, no CDN, no analytics tag
 *   connect-src 'self'          the password can be POSTed to THIS origin only
 *   form-action 'self'          an injected <form action="https://…"> is inert
 *   frame-ancestors <parent>    only the conversation page may embed this
 *   base-uri 'none'             an injected <base> cannot re-point a relative URL
 *
 * `connect-src 'self'` is the one that matters most: even if an attacker got
 * script into this document, there is no origin it could send the value to.
 * ADR-0036 forbids third-party scripts on authenticated surfaces, and here the
 * browser enforces it rather than a policy document asserting it.
 *
 * ── Why the script is a separate file ─────────────────────────────────────
 *
 * `script-src 'self'` refuses inline script, and deliberately: an inline
 * `<script>` is what an injection produces, and allowing `'unsafe-inline'` here
 * to save one request would remove the protection that makes the rest of the
 * policy worth having.
 */

export interface ControlDocumentOptions {
  readonly requestId: string;
  /** The ONE origin permitted to embed this document. */
  readonly parentOrigin: string;
  /**
   * The conversation this request belongs to.
   *
   * Sent back on submission and checked server-side, so a session for one
   * conversation cannot answer a prompt opened for another. It is an
   * identifier, not a capability — it authenticates nobody on its own.
   */
  readonly conversationId: string;
}

/** The CSP, assembled from the parts the contract publishes. */
export function controlCsp(parentOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    `frame-ancestors ${parentOrigin}`,
  ].join("; ");
}

/**
 * The headers every response carrying this document must have.
 *
 * Exported so a test can assert them against the contract rather than against
 * a copy of them written into the test.
 */
export function controlHeaders(parentOrigin: string): Readonly<Record<string, string>> {
  return {
    "Content-Security-Policy": controlCsp(parentOrigin),
    // The frame must not be able to reach the opener, and nothing must be able
    // to load this as a subresource.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // No Referer at all. The URL carries a request id rather than a capability,
    // but a URL that never leaves is a URL that cannot leak.
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // Deny every powerful feature. A password field needs none of them, and an
    // injected script that could open a camera is worse than one that cannot.
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), " +
      "microphone=(), payment=(), usb=()",
  };
}

/**
 * Escapes a value for an HTML attribute.
 *
 * The only interpolated value is the request id, which the router has already
 * matched against the store — but it arrived in a URL, so it is escaped anyway.
 * "It cannot be hostile because we looked it up" is an argument that stops
 * being true the first time someone reorders two lines.
 */
function attribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export function controlDocument(options: ControlDocumentOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Secure password entry</title>
<link rel="stylesheet" href="/control.css">
</head>
<body>
<main id="control"
      data-request-id="${attribute(options.requestId)}"
      data-parent-origin="${attribute(options.parentOrigin)}"
      data-conversation-id="${attribute(options.conversationId)}">
  <p id="state" data-testid="secure-state">Loading…</p>
  <form id="secure-form" data-testid="secure-form" hidden autocomplete="off">
    <h2 id="secure-title" data-testid="secure-title"></h2>
    <p id="secure-explanation" data-testid="secure-explanation"></p>
    <label for="secure-password">Password</label>
    <input id="secure-password" data-testid="secure-password" type="password"
           autocomplete="new-password" autocapitalize="off" spellcheck="false">
    <label for="secure-confirmation" id="confirmation-label">Type it again</label>
    <input id="secure-confirmation" data-testid="secure-confirmation" type="password"
           autocomplete="new-password" autocapitalize="off" spellcheck="false">
    <button type="submit" id="secure-submit" data-testid="secure-submit">Send securely</button>
    <button type="button" id="secure-cancel" data-testid="secure-cancel">Cancel</button>
    <p id="secure-error" data-testid="secure-error" role="alert"></p>
  </form>
</main>
<script src="/control.js"></script>
</body>
</html>
`;
}
