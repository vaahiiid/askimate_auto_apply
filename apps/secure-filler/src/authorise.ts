/**
 * Asking the Secure Interaction Service for the authority to spend a handle.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the request that used to come from the runner. ADR-0042 moved it,
 * and moving it is most of the point: the component that can settle a use is
 * now the component that performs one, so "the fill happened but the report
 * was lost" is not a state this system can reach.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the authority is obtained BEFORE the plaintext ────────────────────
 *
 * The alternative — decrypt, type, then report — has a failure mode with no
 * good answer: a crash between the two leaves a spent password that the
 * conversation plane never learns about, and an audit trail with a use missing
 * from it. This order's failure mode is a settled use that did not happen,
 * which resolves as the student being asked again. Fail closed, in the
 * direction that leaves a record.
 *
 * It is also the order every other check on this plane follows: everything that
 * does not need the value runs first.
 *
 * ── What comes back ───────────────────────────────────────────────────────
 *
 * `SecretUseResult` — `{ status, lifecycle }`, and the contract states that
 * there is deliberately no field in it that could carry a value. Nothing here
 * reads a body looking for one, and there would be nothing to find.
 */

import type { SecretFillRequest } from "@askimate/aas-contracts";

/** Granted, or refused with a reason that names nothing about the secret. */
export type UseAuthorisation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_authorised" };

export interface AuthoriseOptions {
  /** The secure service's internal base URL, on the private subnet. */
  readonly baseUrl: string;
  /**
   * The agent's own mTLS identity, as a header in environments that terminate
   * client certificates at a proxy. In production this is a client certificate
   * and this header is not trusted on its own — see docs/secure-plane-deployment.md.
   */
  readonly serviceToken?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function httpUseAuthoriser(
  options: AuthoriseOptions,
): (request: SecretFillRequest) => Promise<UseAuthorisation> {
  const doFetch = options.fetch ?? globalThis.fetch;
  return async (request: SecretFillRequest): Promise<UseAuthorisation> => {
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}/internal/v1/secret-uses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.serviceToken === undefined
            ? {}
            : { "x-aas-service": options.serviceToken }),
        },
        // Exactly the fields `UseSecretRequest` declares, and no more. The
        // browser endpoint and the locator are the agent's business; the
        // service that settles the lifecycle has no use for either.
        body: JSON.stringify({
          handle: request.handle,
          studentRef: request.studentRef,
          caseRef: request.caseRef,
          purpose: request.purpose,
          targetHost: request.targetHost,
          consumer: request.consumer,
          noDiagnosticCapture: true,
        }),
      });
    } catch {
      // A refusal, not a retry. A handle whose authority we could not establish
      // is a handle we do not spend.
      return { ok: false, reason: "not_authorised" };
    }
    // 403 (binding mismatch), 404 (unknown), 409 (already spent) are all the
    // same instruction to this agent: do not type. They are distinguished in
    // the service's audit, where the distinction is useful; here it would only
    // widen what a refusal can say.
    if (response.status !== 200) return { ok: false, reason: "not_authorised" };
    return { ok: true };
  };
}
