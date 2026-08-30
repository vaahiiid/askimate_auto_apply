/**
 * Asking the Secure Plane to type a secret into a portal field.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-30: *"The runner component that actually consumes and fills
 * the secret must execute within the Secure Plane's trust boundary."*
 *
 * So it does, and this file is what is left on this side of the boundary: a
 * request, and an answer that cannot contain a value.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this file used to be ─────────────────────────────────────────────
 *
 * It used to call `store.use(claim, consumer, task)` against an in-process
 * `SecretStore`, which meant the plaintext existed in the runner's heap — the
 * heap of the one component that loads pages we do not control, runs
 * blueprint-driven logic against a site we cannot audit, and is the most likely
 * thing in the system to be compromised. It also could not work in production:
 * the instance that received the submission and the one spending the handle are
 * different processes, so the handle resolved to nothing on any real run.
 *
 * `scripts/check-boundaries.ts` now fails the build if this app declares
 * `@askimate/aas-secrets` at all. That is the control; this comment is not.
 *
 * ── What the runner can and cannot learn ──────────────────────────────────
 *
 * It sends identifiers, a selector and the address of its own browser. It gets
 * back one of two words and, on a refusal, a reason from a closed set that
 * names a fact about the page or the handle. There is no field in the response
 * that could carry the value, and no field that could carry its length.
 *
 * ── The honest residual ───────────────────────────────────────────────────
 *
 * The runner still OWNS the browser the agent types into, so a runner that has
 * been compromised can read the field afterwards — `readValue` on this app's own
 * `FillableSession` is one call. ADR-0042 records this deliberately: what this
 * change protects is the password's existence outside the browser (in a heap, a
 * log, an error object, a crash dump, a KMS grant), not the live page. Moving
 * the page as well would mean moving the automation, which is a different and
 * much larger decision.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { AuditSafeText } from "@askimate/aas-domain";
import { auditLabel } from "@askimate/aas-domain";
import type {
  FillPurpose,
  FillRefusalReason,
  SecretFillRequest,
  SecretFillResult,
} from "@askimate/aas-contracts";
import { parseSecretFillResult } from "@askimate/aas-contracts";
import type { Page } from "playwright";

import { tracingIsForbidden } from "./sensitive.js";

/** Raised when something tries to type a secret into a context that could record it. */
export class SecretIntoTracedContextError extends Error {
  public override readonly name = "SecretIntoTracedContextError";
  public constructor() {
    super(
      "Refusing to ask for a secret to be typed into a browser context that has tracing " +
        "available. Playwright writes typed values verbatim into trace.trace — including values " +
        "typed by a DIFFERENT process over CDP, because the leak is the DOM snapshot rather than " +
        "the action. Open the context with openSensitiveContext(), which makes tracing throw " +
        "(ADR-0025). The fill agent checks this too, against the live page; this check exists so " +
        "the failure is a loud local error rather than a remote refusal.",
    );
  }
}

/** Everything the runner must know to ask for a fill. No secret is among it. */
export interface SecretFillClaim {
  readonly handle: string;
  readonly studentRef: string;
  readonly caseRef: string;
  readonly purpose: FillPurpose;
  readonly targetHost: string;
}

export interface SecretFillOutcome {
  readonly ok: boolean;
  readonly reason?: FillRefusalReason;
  /**
   * Whether the handle is now dead.
   *
   * A `no_such_field` refusal leaves it ALIVE — the agent establishes the
   * field's existence before obtaining any plaintext — so a blueprint fix can
   * retry without asking the student for a new password. Every other refusal
   * that reached the vault has spent it.
   */
  readonly handleSpent: boolean;
}

/**
 * Asks the Secure Plane's fill agent to type a secret into a field.
 *
 * The `page` argument is here for two reasons and neither is to receive a
 * value: the local ADR-0025 check runs against its context, and its URL is what
 * disambiguates which of the browser's pages the agent should act on.
 */
export async function fillSecret(input: {
  readonly page: Page;
  readonly claim: SecretFillClaim;
  readonly locator: FieldLocator;
  /** The agent's internal base URL, on the private subnet. */
  readonly agentBaseUrl: string;
  /** This browser's CDP endpoint, reachable by the agent and by nothing else. */
  readonly browserEndpoint: string;
  readonly consumerName?: AuditSafeText;
  readonly serviceToken?: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<SecretFillOutcome> {
  const { page, locator, claim } = input;

  // Checked here as well as by the agent. The agent's check is the one that
  // protects the secret — it is performed by the process that holds it — and
  // this one exists so a mistake on this side fails as a loud, specific local
  // error rather than as a refusal that has to be traced back across a network.
  if (!tracingIsForbidden(page.context())) throw new SecretIntoTracedContextError();

  const request: SecretFillRequest = {
    handle: claim.handle,
    studentRef: claim.studentRef,
    caseRef: claim.caseRef,
    purpose: claim.purpose,
    targetHost: claim.targetHost,
    consumer: input.consumerName ?? auditLabel("untraced_portal_fill"),
    noDiagnosticCapture: true,
    browserEndpoint: input.browserEndpoint,
    pageUrl: page.url(),
    locator: { strategy: locator.strategy, value: locator.value },
  };

  const doFetch = input.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(`${input.agentBaseUrl}/internal/v1/secret-fills`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.serviceToken === undefined ? {} : { "x-aas-service": input.serviceToken }),
      },
      body: JSON.stringify(request),
    });
  } catch {
    // The agent was unreachable, so nothing was authorised and nothing was
    // spent. Reported as a refusal rather than thrown, because a thrown error
    // here would carry the request object — including the handle — into
    // whatever logs it.
    return { ok: false, reason: "browser_unreachable", handleSpent: false };
  }

  if (response.status !== 200) {
    return { ok: false, reason: "not_authorised", handleSpent: false };
  }

  const parsed: SecretFillResult | null = parseSecretFillResult(await response.json());
  if (parsed === null) return { ok: false, reason: "not_authorised", handleSpent: false };
  if (parsed.status === "filled") return { ok: true, handleSpent: true };
  return {
    ok: false,
    reason: parsed.reason,
    handleSpent: parsed.lifecycle === "secret_consumed",
  };
}
