/**
 * The inspection guard — a SEPARATE mode, not a weakened discovery mode.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26:
 *
 *   "You are authorised to DESIGN and IMPLEMENT a new controlled
 *    Salesforce-rendering discovery mode… It may allow the portal's own
 *    read-only/rendering traffic, including Salesforce Aura requests required
 *    to render the interface, while continuing to structurally prohibit
 *    [typing, filling, clicking, uploads, application creation, saving,
 *    payment, declarations, submission, account creation, authentication,
 *    MFA/OTP, CAPTCHA]… Do not merely weaken the existing safety guard
 *    globally. Build a separate capability/mode with explicit allow-lists and
 *    hard safety boundaries."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Salesforce Experience Cloud renders its UI over POST. Every component the
 * page needs is fetched by posting an action batch to `/s/sfsites/aura`. The
 * discovery guard blocks POST by method, so the real portal captured as a
 * 164 KB shell reading "Loading… Sorry to interrupt. CSS Error" — no form, no
 * inputs, nothing (Phase 3 report §C).
 *
 * So read-only-by-method cannot ever see this portal. Not this run, not a
 * better-configured one. The choice is between never seeing a Salesforce
 * portal's interface, and permitting exactly the traffic that draws it.
 *
 * ── The four boundaries ───────────────────────────────────────────────────
 *
 * 1. **METHOD.** GET/HEAD/OPTIONS as before. POST only to the Aura endpoint.
 *    PUT, PATCH and DELETE are refused unconditionally — no allow-list, no
 *    configuration, no exception.
 *
 * 2. **ENDPOINT.** A POST is permitted to exactly one path on exactly the
 *    hosts on the run's allow-list. A POST anywhere else is refused even on an
 *    allow-listed host: `/services/apply/submit` is not a rendering call.
 *
 * 3. **ACTION.** Aura batches named actions into one POST. Each is inspected.
 *    An action is permitted only if its descriptor matches the render
 *    allow-list AND nothing in the body matches the consequential deny-list.
 *    **Unknown descriptors are refused**, and recorded so a human can see what
 *    was refused rather than the run silently rendering less.
 *
 * 4. **CAPABILITY.** The session exposes no `fill`, `click`, `upload` or
 *    `submit`. Unchanged from discovery, and it is the boundary that does not
 *    depend on getting a regex right.
 *
 * ── The one rule doing real work: `cacheable` ─────────────────────────────
 *
 * `aura.ApexAction.execute` runs arbitrary server-side Apex, which could do
 * anything. Salesforce's own platform contract is the lever: a method declared
 * `@AuraEnabled(cacheable=true)` **cannot perform DML** — the platform refuses
 * it at runtime. The client marks such calls `cacheable: true` in the action
 * params.
 *
 * So: **Apex is permitted only when the call is marked cacheable.** That is
 * not a heuristic about names, it is a property the platform enforces on the
 * server. A non-cacheable Apex call is refused, and the run reports it.
 *
 * If a portal will not render without non-cacheable Apex, that is a finding
 * for a human — not something for this file to concede.
 */

import type { GuardDecision } from "./safety.js";
import { HostAllowList } from "./safety.js";

/** Methods that cannot change state on a well-behaved server. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The only path a POST may go to.
 *
 * Salesforce serves every Lightning component from here. Kept as a set rather
 * than a string so a second framework endpoint can be added by review, not by
 * loosening the check.
 */
const RENDER_ENDPOINTS: ReadonlySet<string> = new Set(["/s/sfsites/aura", "/sfsites/aura"]);

/**
 * Aura action descriptors permitted because they draw the page.
 *
 * ── Two forms, one allow-list ─────────────────────────────────────────────
 *
 * Aura names the same action two ways. The URL query carries a summary —
 * `?r=4&applauncher.LoginForm.getForgotPasswordUrl=1`, which is what the
 * Phase 3 capture recorded. The POST body carries the full descriptor —
 * `serviceComponent://applauncher.LoginFormController/ACTION$getForgotPasswordUrl`.
 *
 * I first wrote this list in the query form, against the only shape I had
 * seen, and it refused every real rendering call. `normaliseDescriptor` folds
 * the body form onto the query form — drop the URI scheme, drop the
 * `Controller` suffix, turn `/ACTION$` into `.` — so one list matches both.
 *
 * Every entry was observed in the real Phase 3 capture or is a documented
 * framework bootstrap call. Nothing speculative.
 */
const RENDER_ACTIONS: readonly string[] = [
  "hostConfig.HostConfig.getConfigData",
  "aura.Component.reportFailedAction",   // telemetry for a component that failed
  "RichTextComponent.getRichText",
  "RichText.getParsedRichTextValue",
  "forceCommunity.richText",
  "aura.Component.getComponent",
  "aura.Component.getComponentDef",
  "aura.Label.getLabel",
  "getPageContext",
  "bootstrap",

  // ── applauncher.LoginForm — the platform's own login component ──────────
  //
  // Four getters on one Salesforce-managed controller, all fired at component
  // init to decide what the login page should draw. Added on evidence from the
  // run of 2026-08-26T17:45:55Z, which blocked the last two and rendered a
  // login page with NO username/password fields and NO register link:
  //
  //  1. The batch the portal actually sent was these three together —
  //     getForgotPasswordUrl + getSelfRegistrationUrl +
  //     getUsernamePasswordSelfRegEnabled — one page-configuration read. An
  //     Aura batch executes as a unit, so refusing two killed all three.
  //  2. getLoginRightFrameUrl, from the same controller, was PERMITTED in the
  //     same run and the server answered:
  //       {"state":"SUCCESS","returnValue":null,"error":[],"storable":true}
  //     `storable: true` is Aura's own marker that a response may be cached
  //     and replayed without contacting the server — a property the framework
  //     only applies to side-effect-free reads. That is the server asserting
  //     read-only, the same class of guarantee `cacheable` gives for Apex.
  //  3. `applauncher` is a Salesforce-managed namespace: this is the
  //     platform's Identity login component, not customer Apex.
  //  4. They run before any user input exists. There is no form yet, so there
  //     is nothing for them to persist.
  //  5. Behaviourally, the UI that vanished is exactly what these two values
  //     gate: whether username/password self-registration is on, and where the
  //     self-registration page lives.
  //
  // Named individually. NOT a namespace wildcard, and not a rule about
  // getters — `applauncher.LoginForm.login` would still be refused.
  "applauncher.LoginForm.getLoginRightFrameUrl",
  "applauncher.LoginForm.getForgotPasswordUrl",
  "applauncher.LoginForm.getSelfRegistrationUrl",
  "applauncher.LoginForm.getUsernamePasswordSelfRegEnabled",
];

/**
 * Folds a POST-body descriptor onto the query-summary form.
 *
 * `serviceComponent://applauncher.LoginFormController/ACTION$getForgotPasswordUrl`
 *   → `applauncher.LoginForm.getForgotPasswordUrl`
 */
function normaliseDescriptor(descriptor: string): string {
  return descriptor
    .replace(/^[a-z]+:\/\//i, "")        // drop serviceComponent:// or aura://
    .replace(/\/ACTION\$/i, ".")         // /ACTION$foo → .foo
    .replace(/Controller\./i, ".")       // FooController.bar → Foo.bar
    .replace(/^\u2026/, "")              // a leading ellipsis in a test fixture
    .replace(/\.{2,}/g, ".");
}

/**
 * Anything matching these in the request body refuses the whole batch.
 *
 * Deliberately broad and checked against the ENTIRE body rather than only the
 * descriptor, because a benign-looking descriptor can carry a consequential
 * payload. A false positive costs a refused render and a line in the report; a
 * false negative creates a record against a real institution.
 *
 * Word-boundary anchored so `getConfigData` does not trip on "Data" and
 * `richText` does not trip on "create".
 */
const CONSEQUENTIAL_PATTERNS: readonly RegExp[] = [
  /\bcreate\w*\b/i,
  /\bsave\w*\b/i,
  /\bsubmit\w*\b/i,
  /\bupsert\w*\b/i,
  /\binsert\w*\b/i,
  /\bupdate\w*\b/i,
  /\bdelete\w*\b/i,
  /\bregister\b/i,
  /\bselfRegister\b/i,
  /\bsetPassword\b/i,
  /\bresetPassword\b/i,
  /\blogin\b(?!Form\.get)/i,
  /\bauthenticate\b/i,
  /\bupload\b/i,
  /\bpayment\b/i,
  /\bcheckout\b/i,
  /\benrol\w*\b/i,
  /\bdeclaration\b/i,
  /\bverifyCode\b/i,
  /\bsendOtp\b/i,
  /\bapply\b/i,
];

/** Why one Aura action was refused, or allowed. */
export interface ActionVerdict {
  readonly descriptor: string;
  readonly allowed: boolean;
  readonly reason: string;
  /** For Apex only: `Class.method`. Names, never parameter values. */
  readonly apex?: string;
}

export interface InspectionDecision extends GuardDecision {
  /** Per-action verdicts, when the request was an Aura batch. */
  readonly actions?: readonly ActionVerdict[];
}

/**
 * Decides one request in inspection mode.
 *
 * Fails closed at every step: an unparseable URL, an unparseable body, an
 * unrecognised descriptor and an unknown method are all refusals.
 */
export function decideInspectionRequest(input: {
  readonly method: string;
  readonly url: string;
  readonly postData: string | null;
  readonly allowList: HostAllowList;
}): InspectionDecision {
  const method = input.method.toUpperCase();
  const { url } = input;

  // ── Host, first and always ──────────────────────────────────────────────
  if (!input.allowList.permits(url)) {
    return {
      allowed: false,
      method,
      url,
      reason:
        `Inspection blocked a request to ${url}: the host is not on this run's allow-list ` +
        `(${input.allowList.hosts.join(", ")}).`,
    };
  }

  // ── Safe methods, unchanged from discovery ──────────────────────────────
  if (SAFE_METHODS.has(method)) {
    return { allowed: true, method, url };
  }

  // ── Everything except POST is refused outright ──────────────────────────
  if (method !== "POST") {
    return {
      allowed: false,
      method,
      url,
      reason:
        `Inspection blocked a ${method} request to ${url}. Only GET, HEAD, OPTIONS and a ` +
        `rendering POST to the framework endpoint are permitted. There is no configuration that ` +
        `enables ${method}.`,
    };
  }

  // ── POST: the endpoint must be the framework's ──────────────────────────
  const path = pathOf(url);
  if (path === null || !RENDER_ENDPOINTS.has(path)) {
    return {
      allowed: false,
      method,
      url,
      reason:
        `Inspection blocked a POST to ${url}. POST is permitted only to the component-rendering ` +
        `endpoint (${[...RENDER_ENDPOINTS].join(", ")}). A POST to any other path on this host is ` +
        `an application action, not a render.`,
    };
  }

  // ── POST: the body must contain only rendering actions ──────────────────
  return inspectAuraBody(method, url, input.postData);
}

function inspectAuraBody(
  method: string,
  url: string,
  postData: string | null,
): InspectionDecision {
  if (postData === null || postData.length === 0) {
    return {
      allowed: false,
      method,
      url,
      reason:
        `Inspection blocked a POST to the render endpoint with no readable body. A request whose ` +
        `contents cannot be inspected cannot be permitted.`,
    };
  }

  const actions = parseAuraActions(postData);
  if (actions === null) {
    return {
      allowed: false,
      method,
      url,
      reason:
        `Inspection blocked a POST to the render endpoint: the Aura action batch could not be ` +
        `parsed, so its contents are unknown. Failing closed.`,
    };
  }

  if (actions.length === 0) {
    return {
      allowed: false,
      method,
      url,
      reason: `Inspection blocked a POST to the render endpoint carrying no recognisable actions.`,
    };
  }

  const verdicts = actions.map(judgeAction);

  // ── The consequential scan, over the ACTIONS only ───────────────────────
  //
  // Scanning the whole request body was wrong, and wrong in the worst
  // direction: an Aura POST carries `aura.pageURI` — the URL of the page
  // being rendered. On the page we most needed to inspect that is
  // `/s/login/SelfRegister`, so `\bselfRegister\b` and `\blogin\b` matched the
  // page's own address and refused all 17 render batches. The interface drew
  // anyway from its bootstrap payload, which is why the mistake nearly went
  // unnoticed — the run reported zero refusals while blocking everything.
  //
  // The actions are where a payload would actually live, so that is what is
  // scanned. The hidden-payload case (a permitted descriptor carrying
  // `saveRecord` in its params) is still caught, because params are included.
  const scanned = actions
    .map((action) => `${action.descriptor} ${JSON.stringify(action.params)}`)
    .join(" ");

  const bodyHit = CONSEQUENTIAL_PATTERNS.find((pattern) => pattern.test(scanned));
  if (bodyHit !== undefined) {
    const matched = bodyHit.exec(scanned)?.[0] ?? "";
    return {
      allowed: false,
      method,
      url,
      actions: verdicts,
      reason:
        `Inspection blocked a POST to the render endpoint: an action matches a consequential ` +
        `pattern (${String(bodyHit)} matched "${matched}"). Rendering a page does not create, ` +
        `save, submit, register, authenticate, upload or pay.`,
    };
  }

  const refused = verdicts.filter((verdict) => !verdict.allowed);
  if (refused.length > 0) {
    return {
      allowed: false,
      method,
      url,
      actions: verdicts,
      reason:
        `Inspection blocked an Aura batch: ${String(refused.length)} of ` +
        `${String(verdicts.length)} action(s) are not rendering calls. ` +
        refused.map((verdict) => `[${verdict.descriptor}] ${verdict.reason}`).join(" · ") +
        ` The whole batch is refused, because Aura executes a batch together and permitting the ` +
        `safe half is not a thing this protocol offers.`,
    };
  }

  return { allowed: true, method, url, actions: verdicts };
}

interface AuraAction {
  readonly descriptor: string;
  readonly params: Record<string, unknown>;
}

/**
 * Pulls the action list out of an Aura POST body.
 *
 * The body is form-encoded with a `message` field carrying JSON. Returns
 * `null` on anything unexpected — the caller refuses on null, so a shape we do
 * not understand is a refusal rather than a pass.
 */
function parseAuraActions(postData: string): readonly AuraAction[] | null {
  try {
    const params = new URLSearchParams(postData);
    const message = params.get("message");
    if (message === null) return null;

    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== "object" || parsed === null) return null;

    const actions = (parsed as Record<string, unknown>)["actions"];
    if (!Array.isArray(actions)) return null;

    const result: AuraAction[] = [];
    for (const entry of actions) {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const descriptor = record["descriptor"];
      if (typeof descriptor !== "string") return null;
      const actionParams = record["params"];
      result.push({
        descriptor,
        params:
          typeof actionParams === "object" && actionParams !== null
            ? (actionParams as Record<string, unknown>)
            : {},
      });
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Judges one action.
 *
 * Apex is handled first and separately, because it is the only descriptor that
 * runs arbitrary server code and the only one where the verdict rests on a
 * platform guarantee rather than on a name.
 */
function judgeAction(action: AuraAction): ActionVerdict {
  const { descriptor } = action;

  const normalised = normaliseDescriptor(descriptor);

  // Both forms: `aura.ApexAction.execute` in a query summary, and
  // `aura://ApexActionController/ACTION$execute` in a body.
  if (/ApexAction\.execute/i.test(normalised) || /ApexAction/i.test(descriptor)) {
    // Name the class and method in the verdict. NOT the params — those could
    // carry data — but a refusal that says only "some Apex" cannot be
    // reviewed, and the 2026-08-26 run refused three Apex calls that nobody
    // could identify afterwards.
    const apexClass = typeof action.params["classname"] === "string" ? action.params["classname"] : "?";
    const apexMethod = typeof action.params["method"] === "string" ? action.params["method"] : "?";
    const named = `${apexClass}.${apexMethod}`;

    const cacheable = action.params["cacheable"];
    if (cacheable === true) {
      return {
        descriptor,
        apex: named,
        allowed: true,
        reason:
          `Apex ${named} is marked cacheable. Salesforce refuses DML in an ` +
          `@AuraEnabled(cacheable=true) method, so this cannot write.`,
      };
    }
    return {
      descriptor,
      apex: named,
      allowed: false,
      reason:
        `Apex ${named} is not marked cacheable, so the platform permits it to write. Arbitrary ` +
        `server-side code is exactly what this mode must not run. The class and method are named ` +
        `here so a specialist can decide whether this specific one is safe.`,
    };
  }

  const matched = RENDER_ACTIONS.find((allowed) =>
    normalised.toLowerCase().includes(allowed.toLowerCase()),
  );
  if (matched !== undefined) {
    return { descriptor, allowed: true, reason: `Rendering call (matched "${matched}").` };
  }

  return {
    descriptor,
    allowed: false,
    reason:
      `Not on the rendering allow-list. Unknown descriptors are refused rather than assumed ` +
      `harmless — the page renders less and the report says so.`,
  };
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

/** Re-exported so a caller configures one allow-list for both modes. */
export { HostAllowList };
