/**
 * Opening a secure request, from the plane that owns the conversation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `POST /internal/v1/secret-requests` has existed and been tested since the
 * Secure Interaction Service was built, and until now it had **no production
 * caller**. This is it: the first code path by which a student is actually
 * asked for a password.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What crosses, and what deliberately does not come back ────────────────
 *
 * Out: identifiers, a purpose and a target host — both from the case and the
 * blueprint, never from model output (a prompt-injected model can ask for *a*
 * password; it cannot choose whose, or for which portal) — plus the title and
 * explanation the student reads inside the frame.
 *
 * Back: a request id, an expiry and a one-time frame token. The title and
 * explanation are stored by the secure service and are NOT returned, so the
 * conversation plane never holds text a model wrote about a password. Its event
 * log has nothing to hold and its schema needs no exception.
 *
 * ── The window this has, and why it fails in the safe direction ───────────
 *
 * The request is opened first and the `secret_requested` event appended second,
 * because the event needs the id the open produces. A crash between them leaves
 * a secure request the conversation log does not know about.
 *
 * That direction is the safe one: the student is never shown a box for a
 * request their log has no record of, the orphan expires within five minutes
 * (ADR-0034's ceiling), and the next call opens a fresh one. The opposite order
 * would put a request id in the durable log that no secure service ever minted
 * — a step the student could see and never complete.
 */

/** What the Secure Interaction Service is asked for. Metadata only. */
export interface SecureRequestInput {
  readonly studentRef: string;
  readonly conversationId: string;
  readonly caseRef: string;
  readonly purpose: "portal_account_creation" | "portal_password_reset";
  readonly targetHost: string;
  readonly title: string;
  readonly explanation: string;
  readonly ttlSeconds: number;
}

/** What comes back. There is no field here that could carry a value. */
export interface OpenedSecureRequest {
  readonly requestId: string;
  readonly expiresAt: string;
  /** One-time. Handed to the page that mounts the frame, never stored. */
  readonly frameToken: string;
}

/**
 * A PORT. The Conversation Service holds no vault and no credential of any
 * kind; it asks a service that does, over the internal API on the private
 * subnet, and learns an id and an expiry.
 */
export interface SecureRequestOpener {
  open(input: SecureRequestInput): Promise<OpenedSecureRequest | null>;
  /**
   * A fresh bootstrap capability for a request that is already open.
   *
   * Separate from `open` because a page that refreshes needs a new one, and
   * minting a second REQUEST for that would ask the student twice.
   */
  mintFrameToken(requestId: string): Promise<string | null>;
}

export interface SecureRequestClientOptions {
  /** The secure service's internal base URL, on the private subnet. */
  readonly baseUrl: string;
  /** mTLS in production; a header here, exactly as the fill agent's client. */
  readonly serviceToken?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function httpSecureRequestOpener(
  options: SecureRequestClientOptions,
): SecureRequestOpener {
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers = {
    "content-type": "application/json",
    ...(options.serviceToken === undefined ? {} : { "x-service-cert": options.serviceToken }),
  };

  return {
    open: async (input: SecureRequestInput): Promise<OpenedSecureRequest | null> => {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}/internal/v1/secret-requests`, {
          method: "POST",
          headers,
          // Exactly the fields `OpenSecretRequest` declares. `requiresConfirmation`
          // is left to the service's own default of true: asking a student to
          // type a password twice is the secure plane's decision about its own
          // form, not this plane's.
          body: JSON.stringify({
            studentRef: input.studentRef,
            conversationId: input.conversationId,
            caseRef: input.caseRef,
            purpose: input.purpose,
            targetHost: input.targetHost,
            title: input.title,
            explanation: input.explanation,
            ttlSeconds: input.ttlSeconds,
          }),
        });
      } catch {
        // A refusal, not a throw. A thrown error here would carry the request
        // object — including the explanation — into whatever logs it.
        return null;
      }
      if (response.status !== 201) return null;
      const body: unknown = await response.json();
      return parseOpened(body);
    },

    mintFrameToken: async (requestId: string): Promise<string | null> => {
      let response: Response;
      try {
        response = await doFetch(
          `${options.baseUrl}/internal/v1/secret-requests/${requestId}/frame-tokens`,
          { method: "POST", headers, body: "{}" },
        );
      } catch {
        return null;
      }
      if (response.status !== 201) return null;
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) return null;
      const token = (body as Record<string, unknown>)["frameToken"];
      return typeof token === "string" && token.length > 0 ? token : null;
    },
  };
}

/**
 * Bytes from the network to an opened request, or `null`.
 *
 * Rebuilt field by field rather than cast, so a service that answered with
 * something extra — a value-shaped field it should never have — has nowhere to
 * put it. The contract forbids one; this is what makes the forbidding hold on
 * this side of the wire too.
 */
function parseOpened(body: unknown): OpenedSecureRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const requestId = record["requestId"];
  const expiresAt = record["expiresAt"];
  const frameToken = record["frameToken"];
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (typeof expiresAt !== "string" || expiresAt.length === 0) return null;
  if (typeof frameToken !== "string" || frameToken.length === 0) return null;
  return { requestId, expiresAt, frameToken };
}
