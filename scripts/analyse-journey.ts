/**
 * Read a discovery run and work out the actual application journey.
 *
 *   pnpm run analyse-journey <path-to-discovery-run-directory>
 *
 * ── Why this exists separately from `inspect-discovery` ───────────────────
 *
 * `inspect-discovery` answers "what did the run see". This answers a harder
 * question: **which of what it saw is the application, and which is a
 * university website that happens to be in the way.**
 *
 * A crawl of a university's site returns course search, marketing pages,
 * newsletter sign-ups, cookie banners and a chat widget. Treating every input
 * it found as an application field is how you end up mapping a site-search box
 * to a student's surname. Treating every blocked POST as alarming is how a
 * Salesforce page-load analytics call gets escalated as an attempted
 * submission.
 *
 * So this classifies. And because classification is judgement, **every verdict
 * here is a PROPOSAL carrying the evidence that produced it.** Nothing in this
 * file promotes anything: the blueprint stays a draft, and a specialist
 * decides. The output is designed to be read next to the pages themselves.
 *
 * It changes nothing, reaches no network, and starts no browser.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ApplicationBlueprint, BlueprintField } from "@askimate/aas-blueprint";
import { allFields } from "@askimate/aas-blueprint";

const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const AMBER = "[33m";
const RED = "[31m";
const RESET = "[0m";

// ───────────────────────────────────────────────────────────────────────────
// What a run directory contains
// ───────────────────────────────────────────────────────────────────────────

interface BlockedRequest {
  readonly method: string;
  readonly url: string;
}

interface RunJson {
  readonly runId: string;
  readonly target: { readonly allowedHosts: readonly string[]; readonly seedUrls: readonly string[] };
  readonly visited: readonly string[];
  readonly failed: readonly { readonly url: string; readonly error: string }[];
  readonly blockedRequests: readonly BlockedRequest[];
}

interface ObservedSignal {
  readonly kind: string;
  readonly evidence: string;
  readonly url?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · What kind of page is this?
// ───────────────────────────────────────────────────────────────────────────

/**
 * The classification a page gets.
 *
 * Ordered roughly by how much it matters to the application journey.
 */
type PageRole =
  /** The form itself, or a step of it. */
  | "application_form"
  /** Sign in. */
  | "login"
  /** Create an account. */
  | "account_creation"
  /** Password reset. */
  | "password_reset"
  /** "How to apply" — instructions, not the form. */
  | "apply_guidance"
  /** Entry requirements, fees, documents needed. */
  | "requirements"
  /** The course itself. */
  | "course_page"
  /** Course search / listings. */
  | "course_search"
  /** Everything else on a university website. */
  | "marketing"
  /** Could not tell. */
  | "unclassified";

interface ClassifiedPage {
  readonly url: string;
  readonly file?: string;
  readonly role: PageRole;
  /**
   * Other roles the same page also plays.
   *
   * A page is very often two things at once: portals routinely put account
   * creation ON the first page of the application form, so "is this
   * registration or is it the form" has the answer "yes". Forcing one role
   * meant the form's fields stopped counting as application fields, which is
   * the exact separation this file exists to get right.
   */
  readonly alsoRoles: readonly PageRole[];
  /** Why. Quoted from the page or its URL, never asserted. */
  readonly evidence: readonly string[];
  /** How much of the classification rests on the URL alone. */
  readonly urlOnly: boolean;
  readonly fieldCount: number;
  readonly signals: readonly string[];
}

/** Signals that a page IS the application, in descending strength. */
const FORM_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/personal\s+statement/i, 'the page says "personal statement"'],
  [/qualification|previous\s+stud|academic\s+histor/i, "it asks about qualifications or academic history"],
  [/date\s+of\s+birth/i, 'it asks for a date of birth'],
  [/nationality|country\s+of\s+(birth|citizenship)/i, "it asks about nationality"],
  [/upload|attach\s+(your|a)\s+(document|transcript|passport)/i, "it asks for a document upload"],
  [/entry\s+(point|year)|start\s+date|intake/i, "it asks about an intake"],
];

const GUIDANCE_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/how\s+to\s+apply/i, 'the page says "how to apply"'],
  [/application\s+(process|deadline|guide)/i, "it describes the application process"],
];

const REQUIREMENT_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/entry\s+requirement/i, 'the page says "entry requirements"'],
  [/ielts|toefl|english\s+language\s+requirement/i, "it states an English language requirement"],
  [/tuition\s+fee|course\s+fee/i, "it states fees"],
];

/**
 * Classifies one captured page.
 *
 * URL first, because a URL is a claim the site makes about its own structure
 * and is cheap. Then content, because a URL can lie — `/apply` is as likely to
 * be a marketing page with a button as it is to be a form.
 */
function classify(
  url: string,
  html: string,
  signals: readonly ObservedSignal[],
  fieldCount: number,
): ClassifiedPage {
  const evidence: string[] = [];
  const text = stripTags(html);
  const kinds = new Set(signals.map((signal) => signal.kind));
  const path = safePath(url);

  const note = (why: string): void => {
    if (!evidence.includes(why)) evidence.push(why);
  };

  // Roles ACCUMULATE. An earlier version returned on the first match, and on
  // the fixture that meant a page which was plainly the application form —
  // personal statement, date of birth, two document uploads — was filed as
  // "account_creation" because it also had a sign-up box, and its eight fields
  // then vanished from the application field list. Portals put registration on
  // the first page of the form all the time; the answer to "is it the form or
  // is it registration" is usually "yes".
  const roles = new Set<PageRole>();
  /** Roles that rest on the URL alone, so the report can say so. */
  const guessed = new Set<PageRole>();

  // ── What the observer already evidenced, which outranks any guessing ────
  if (kinds.has("account_creation")) {
    roles.add("account_creation");
    note("discovery observed an account-creation form here");
  }
  if (kinds.has("login")) {
    roles.add("login");
    note("discovery observed a password field here");
  }
  if (kinds.has("submission")) note("discovery observed a submission control here");

  // ── The URL's own claims ────────────────────────────────────────────────
  if (/forgot|reset[-_]?password|recover/i.test(path)) {
    roles.add("password_reset");
    guessed.add("password_reset");
    note("the URL is a password-reset route");
  }
  if (/forgot\s+(your\s+)?password/i.test(text)) {
    roles.add("password_reset");
    note('the page text says "forgot password"');
  }
  if (/register|sign[-_]?up|create[-_]?account|new[-_]?account/i.test(path)) {
    if (!roles.has("account_creation")) guessed.add("account_creation");
    roles.add("account_creation");
    note("the URL is a registration route");
  }
  if (/\/login|sign[-_]?in/i.test(path)) {
    if (!roles.has("login")) guessed.add("login");
    roles.add("login");
    note("the URL is a sign-in route");
  }

  // ── The form itself ─────────────────────────────────────────────────────
  //
  // Two independent markers, because one is too easy to hit by accident: a
  // marketing page can mention a personal statement without being a form.
  const formHits = FORM_MARKERS.filter(([pattern]) => pattern.test(text));
  if (formHits.length >= 2 && fieldCount > 0) {
    roles.add("application_form");
    for (const [, why] of formHits) note(why);
  }

  // ── Requirements and guidance ───────────────────────────────────────────
  for (const [pattern, why] of REQUIREMENT_MARKERS) {
    if (!pattern.test(text)) continue;
    roles.add("requirements");
    note(why);
  }
  for (const [pattern, why] of GUIDANCE_MARKERS) {
    if (!pattern.test(text)) continue;
    roles.add("apply_guidance");
    note(why);
  }

  // ── Course pages, only when nothing stronger applies ────────────────────
  if (roles.size === 0) {
    if (/\/courses?\/?$|search|\/find|browse/i.test(path)) {
      roles.add("course_search");
      guessed.add("course_search");
      note("the URL is a course listing or search route");
    } else if (/\/course|\/programme|msc|\/study\//i.test(path)) {
      roles.add("course_page");
      guessed.add("course_page");
      note("the URL names a course or programme");
    }
  }

  if (roles.size === 0) {
    note("nothing on this page identified it as part of the application");
    return page(url, "marketing", evidence, fieldCount, signals, true);
  }

  // ── Which role leads ────────────────────────────────────────────────────
  //
  // The form wins when a page is both. It is the thing the mapping set is
  // authored from, and burying it under "account_creation" is how its fields
  // got lost.
  const PRIMACY: readonly PageRole[] = [
    "application_form",
    "account_creation",
    "login",
    "password_reset",
    "requirements",
    "apply_guidance",
    "course_page",
    "course_search",
    "marketing",
    "unclassified",
  ];
  const ordered = PRIMACY.filter((role) => roles.has(role));
  const primary = ordered[0] ?? "unclassified";

  return page(
    url,
    primary,
    evidence,
    fieldCount,
    signals,
    guessed.has(primary),
    ordered.slice(1),
  );
}

function page(
  url: string,
  role: PageRole,
  evidence: readonly string[],
  fieldCount: number,
  signals: readonly ObservedSignal[],
  urlOnly: boolean,
  alsoRoles: readonly PageRole[] = [],
): ClassifiedPage {
  return {
    url,
    role,
    alsoRoles,
    evidence,
    urlOnly,
    fieldCount,
    signals: [...new Set(signals.map((signal) => signal.kind))],
  };
}

/** Every role a page plays, primary first. */
function rolesOf(page: ClassifiedPage): readonly PageRole[] {
  return [page.role, ...page.alsoRoles];
}

function plays(page: ClassifiedPage, role: PageRole): boolean {
  return rolesOf(page).includes(role);
}

// ───────────────────────────────────────────────────────────────────────────
// 2 · The blocked requests
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a blocked state-changing request appears to be.
 *
 * The guard blocks by METHOD, which is correct and deliberately dumb — it
 * refuses anything that is not a safe read without needing to understand the
 * site. But a count of 864 tells a specialist nothing, and "the portal attempts
 * writes" reads as alarming when most of it is a JavaScript framework talking
 * to its own server about which components to render.
 *
 * These buckets are the reading, not the rule. The guard's behaviour does not
 * change: everything here was blocked either way.
 */
type RequestClass =
  /** Salesforce Lightning/Aura framework RPC. Renders components; not a record write. */
  | "framework_rpc"
  /** Analytics, telemetry, error reporting. */
  | "telemetry"
  /** CAPTCHA, bot detection, fraud scoring. */
  | "bot_defence"
  /** Session, CSRF token, cookie consent. */
  | "session_or_consent"
  /** Search, autocomplete, typeahead — a POST because the query is long. */
  | "search"
  /** Looks like it creates, updates or submits something. */
  | "possibly_consequential"
  /** Could not tell from the URL. */
  | "unknown";

const REQUEST_RULES: readonly (readonly [RegExp, RequestClass, string])[] = [
  // Bot defence FIRST. An earlier ordering put a Salesforce static-resource
  // rule ending `\.js$` above this, and it swallowed
  // `google.com/recaptcha/api.js` into "framework_rpc" — filing a CAPTCHA, one
  // of the handoffs we must never bypass, as harmless framework noise.
  [/recaptcha|hcaptcha|turnstile|arkoselabs|friendlycaptcha|perimeterx|datadome|imperva|botmanager/i, "bot_defence", "CAPTCHA or bot detection"],

  [/google-analytics|googletagmanager|doubleclick|\/collect\b|\banalytics\b|segment\.io|mixpanel|hotjar|clarity\.ms|sentry|bugsnag|newrelic|datadoghq/i, "telemetry", "analytics or error reporting"],

  // Salesforce Experience Cloud. `/s/sfsites/aura` and `/webruntime/api` are
  // how a Lightning page renders at all — every interaction is a POST to them.
  [/\/s\/sfsites\/aura|\/aura\b|aura\.ApexAction|\/webruntime\/api\//i, "framework_rpc", "Salesforce Aura/Lightning component RPC"],
  // Scoped to Salesforce's own resource paths. Deliberately NOT a bare
  // extension match — that is what caused the reCAPTCHA misfile above.
  [/\/sfsites\/(l|c)\/|\/resource\/\d+\/|\/lightning\/|\/webruntime\//i, "framework_rpc", "Salesforce static resource route"],

  [/csrf|\/token\b|\/session\b|cookie.?consent|onetrust|cookiebot|\/keepalive|\/heartbeat|\/ping\b/i, "session_or_consent", "session, CSRF token or cookie consent"],

  [/\/search|\/autocomplete|\/typeahead|\/suggest|coveo|algolia|\/query\b/i, "search", "search or autocomplete"],

  // Deliberately last, and deliberately broad. A false positive here costs a
  // specialist thirty seconds; a false negative hides a real write.
  [/\/apply|\/application|\/submit|\/register|\/signup|\/create|\/save|\/enrol|\/enroll|\/upload|\/payment|\/checkout|\/lead|\/enquir/i, "possibly_consequential", "the URL names an application, registration, save, upload or payment action"],
];

function classifyRequest(request: BlockedRequest): { readonly kind: RequestClass; readonly why: string } {
  for (const [pattern, kind, why] of REQUEST_RULES) {
    if (pattern.test(request.url)) return { kind, why };
  }
  return { kind: "unknown", why: "no rule matched this URL" };
}

// ───────────────────────────────────────────────────────────────────────────
// 3 · Age and minors
// ───────────────────────────────────────────────────────────────────────────

const AGE_PATTERNS: readonly RegExp[] = [
  /must\s+be\s+(?:at\s+least\s+)?(?:aged\s+)?\d{2}/i,
  /(?:aged?|age)\s+\d{2}\s+(?:or\s+(?:over|above)|and\s+over|\+)/i,
  /under\s+1[68]|over\s+1[68]/i,
  /minimum\s+age/i,
  /parental\s+(?:consent|permission)|guardian/i,
];

// ───────────────────────────────────────────────────────────────────────────
// Reading the run
// ───────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runDir = process.argv[2];
  if (runDir === undefined) {
    process.stderr.write("Usage: pnpm run analyse-journey <discovery-run-directory>\n");
    process.exitCode = 2;
    return;
  }

  const dir = resolve(runDir);
  const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as RunJson;
  const raw = JSON.parse(await readFile(join(dir, "blueprint.draft.json"), "utf8")) as
    ApplicationBlueprint & { readonly observedSignals?: readonly ObservedSignal[] };
  const signals = raw.observedSignals ?? [];
  const pageIndex = await readPageIndex(dir);

  process.stdout.write(
    `\n${BOLD}Application journey — ${raw.institutionName}${RESET}\n` +
      `${DIM}${raw.courseName}, ${raw.intake}\n` +
      `Run ${run.runId}${RESET}\n`,
  );

  // ── Classify every captured page ────────────────────────────────────────
  const classified: ClassifiedPage[] = [];
  for (const url of run.visited) {
    const file = pageIndex.get(url);
    if (file === undefined) {
      throw new Error(
        `${url} was visited but has no captured file in pages/index.json. Classifying it on no ` +
          `content would produce a confident answer about a page nobody has.`,
      );
    }
    const html = await readCaptured(dir, file);
    const pageSignals = signals.filter((signal) => signal.url === url);
    classified.push(classify(url, html, pageSignals, fieldsOn(raw, url).length));
  }

  section("1", "The application entry point");
  reportEntryPoint(classified, run);

  section("2", "The real application flow, separated from everything else");
  reportFlow(classified);

  section("3", "Where account creation starts, and what it needs");
  reportAccount(classified, raw);

  section("4", "Login, registration and password reset");
  reportAuthFlow(classified);

  section("5", "Reachable WITHOUT authentication");
  reportUnauthenticated(classified);

  section("6", "Behind authentication — not discoverable by this run");
  reportBehindAuth(classified, run);

  section("7", `The ${String(run.blockedRequests.length)} blocked state-changing requests`);
  reportBlocked(run.blockedRequests);

  section("8", "Application fields, separated from every other input on the site");
  reportFields(classified, raw);

  section("9", "Age and minors");
  await reportAge(dir, pageIndex, run);

  section("10", "The exact point a real student account is needed");
  reportAccountNeededAt(classified);

  process.stdout.write(
    `\n${DIM}  Every classification above is a PROPOSAL with the evidence that produced it.\n` +
      `  Nothing here promotes anything: the blueprint is still a draft, and a specialist\n` +
      `  decides. Read it next to the captured pages in ${join(runDir, "pages")}.${RESET}\n\n`,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The sections
// ───────────────────────────────────────────────────────────────────────────

function reportEntryPoint(pages: readonly ClassifiedPage[], run: RunJson): void {
  const candidates = pages.filter(
    (page) => plays(page, "application_form") || plays(page, "account_creation") || plays(page, "login"),
  );

  if (candidates.length === 0) {
    console.log(
      `  ${AMBER}No application entry point was reached.${RESET}\n\n` +
        `  ${DIM}No captured page is a form, a registration route or a sign-in route. Either the\n` +
        `  apply host was unreachable, or the entry point is not linked from where the crawl\n` +
        `  started. Check the failed URLs below and the seed list.${RESET}\n`,
    );
    if (run.failed.length > 0) {
      console.log(`  Failed URLs:`);
      for (const failure of run.failed.slice(0, 10)) {
        console.log(`    ${RED}✗${RESET} ${failure.url}\n      ${DIM}${failure.error.split("\n")[0] ?? ""}${RESET}`);
      }
    }
    return;
  }

  // The form outranks the login page: if the form is reachable anonymously,
  // that is where the journey starts and the account comes later.
  const form = candidates.find((page) => plays(page, "application_form"));
  const chosen = form ?? candidates[0];
  if (chosen === undefined) return;

  console.log(`  ${GREEN}▸${RESET} ${BOLD}${chosen.url}${RESET}`);
  console.log(`    ${DIM}classified: ${rolesOf(chosen).join(" + ")}${RESET}`);
  for (const why of chosen.evidence) console.log(`    ${DIM}· ${why}${RESET}`);
  if (chosen.urlOnly) {
    console.log(
      `    ${AMBER}This rests on the URL alone — the page content did not confirm it.${RESET}`,
    );
  }

  if (candidates.length > 1) {
    console.log(`\n  ${DIM}Other candidates:${RESET}`);
    for (const other of candidates.filter((page) => page !== chosen)) {
      console.log(`    ${rolesOf(other).join("+").padEnd(24)} ${other.url}`);
    }
  }
}

function reportFlow(pages: readonly ClassifiedPage[]): void {
  const APPLICATION: readonly PageRole[] = [
    "application_form",
    "account_creation",
    "login",
    "password_reset",
    "apply_guidance",
    "requirements",
  ];

  const inFlow = pages.filter((page) => rolesOf(page).some((role) => APPLICATION.includes(role)));
  const notInFlow = pages.filter((page) => !rolesOf(page).some((role) => APPLICATION.includes(role)));

  console.log(
    `  ${GREEN}${String(inFlow.length)}${RESET} page(s) are part of the application journey. ` +
      `${DIM}${String(notInFlow.length)} are not.${RESET}\n`,
  );

  for (const role of APPLICATION) {
    const matching = inFlow.filter((page) => plays(page, role));
    if (matching.length === 0) continue;
    console.log(`  ${BOLD}${role}${RESET}`);
    for (const page of matching) {
      const flag = page.urlOnly ? `${AMBER} (URL only)${RESET}` : "";
      console.log(`    ${page.url}${flag}`);
      for (const why of page.evidence.slice(0, 2)) console.log(`      ${DIM}· ${why}${RESET}`);
    }
  }

  const byRole = new Map<PageRole, number>();
  for (const page of notInFlow) byRole.set(page.role, (byRole.get(page.role) ?? 0) + 1);
  if (byRole.size > 0) {
    console.log(
      `\n  ${DIM}Excluded: ` +
        [...byRole.entries()].map(([role, n]) => `${role}×${String(n)}`).join(", ") +
        `${RESET}`,
    );
  }
}

function reportAccount(pages: readonly ClassifiedPage[], blueprint: ApplicationBlueprint): void {
  const creation = pages.filter((page) => plays(page, "account_creation"));

  if (creation.length === 0) {
    console.log(
      `  ${AMBER}No account-creation page was captured.${RESET}\n\n` +
        `  ${DIM}That does NOT mean the portal has no registration. It means this run did not\n` +
        `  reach it — commonly because the link only appears after clicking something, and\n` +
        `  discovery does not click. Question 2 of ADR-0020 stays unobserved, and\n` +
        `  chooseApproach will refuse rather than default to a password.${RESET}\n`,
    );
    return;
  }

  for (const page of creation) {
    console.log(`  ${BOLD}${page.url}${RESET}`);
    for (const why of page.evidence) console.log(`    ${DIM}· ${why}${RESET}`);

    const fields = fieldsOn(blueprint, page.url);
    if (fields.length === 0) {
      console.log(`    ${AMBER}No fields were recorded on this page.${RESET}`);
      continue;
    }
    console.log(`\n    ${DIM}What it asks for:${RESET}`);
    for (const field of fields) {
      const required = field.validations.some((rule) => rule.kind === "required") ? " (required)" : "";
      console.log(`      ${field.fieldRef.padEnd(24)} ${DIM}${field.inputType} · ${field.label}${required}${RESET}`);
    }

    // From the SIGNAL, not the field list. The blueprint has no `password`
    // input type — a password box is not an application field and is
    // deliberately not modelled as one — so asking the field list produced a
    // confident "no" on a page discovery had explicitly evidenced a password
    // field on. The observation is the source of truth here.
    const hasPassword = page.signals.includes("login");
    console.log(
      `\n    ${hasPassword ? AMBER : GREEN}Password field present: ${hasPassword ? "YES" : "no"}${RESET}`,
    );
    console.log(
      hasPassword
        ? `    ${DIM}The applicant appears to choose a password here — ADR-0020 question 1.\n` +
          `    Whether the portal ALSO offers passwordless sign-in is question 3, and a\n` +
          `    registration form cannot answer it.${RESET}`
        : `    ${DIM}No password field was recorded, which would point at a portal-issued or\n` +
          `    passwordless flow. Do not conclude it from an absence — the field may be on a\n` +
          `    later step this run did not reach.${RESET}`,
    );
  }
}

function reportAuthFlow(pages: readonly ClassifiedPage[]): void {
  const roles: readonly [PageRole, string][] = [
    ["login", "Sign in"],
    ["account_creation", "Register"],
    ["password_reset", "Forgot password"],
  ];

  for (const [role, label] of roles) {
    const matching = pages.filter((page) => plays(page, role));
    console.log(
      matching.length === 0
        ? `  ${AMBER}?${RESET} ${label.padEnd(18)} ${DIM}not reached by this run${RESET}`
        : `  ${GREEN}▸${RESET} ${label.padEnd(18)} ${matching.map((page) => page.url).join("\n" + " ".repeat(23))}`,
    );
  }

  console.log(
    `\n  ${DIM}Reaching a password-reset page is not the same as knowing the reset works or\n` +
      `  where it sends. That is ADR-0020 question 7, and answering it means triggering a\n` +
      `  reset on an account we are permitted to use.${RESET}`,
  );
}

function reportUnauthenticated(pages: readonly ClassifiedPage[]): void {
  // Everything captured is unauthenticated by construction: discovery has no
  // credentials and cannot log in. Saying so explicitly matters, because
  // "these pages are reachable anonymously" is a real and useful finding.
  console.log(
    `  ${DIM}Discovery never signs in and holds no credentials, so EVERY page below was\n` +
      `  reached anonymously. This list is the answer to "what can we see without an\n` +
      `  account", and it is exhaustive for the URLs the crawl reached.${RESET}\n`,
  );

  const inFlow = pages.filter((page) =>
    rolesOf(page).some((role) =>
      (["application_form", "account_creation", "login", "password_reset", "apply_guidance", "requirements"] as const).includes(
        role as "application_form",
      ),
    ),
  );

  if (inFlow.length === 0) {
    console.log(`  ${AMBER}No application page was reachable anonymously.${RESET}`);
    console.log(
      `  ${DIM}If the apply host was reached at all, that points at the form being entirely\n` +
        `  behind login — which is the single most important thing this run can tell us.${RESET}`,
    );
    return;
  }

  for (const page of inFlow) {
    console.log(
      `  ${GREEN}✓${RESET} ${rolesOf(page).join("+").padEnd(26)} ${page.url}  ` +
        `${DIM}${String(page.fieldCount)} field(s)${RESET}`,
    );
  }
}

function reportBehindAuth(pages: readonly ClassifiedPage[], run: RunJson): void {
  // The apply host comes from the TARGET's own seed list, not from a guess
  // about subdomain naming. A portal served from `admissions.example.ac.uk`
  // or a path on the main site would fail a hardcoded `apply.` check and the
  // report would confidently say the host was never reached.
  const applyHosts = new Set(
    run.target.seedUrls
      .filter((seed) => /apply|admission|portal/i.test(seed))
      .map((seed) => hostOf(seed))
      .filter((host): host is string => host !== null),
  );
  const reachedApplyHost =
    applyHosts.size === 0
      ? run.visited.length > 0
      : run.visited.some((url) => {
          const host = hostOf(url);
          return host !== null && applyHosts.has(host);
        });
  const formPages = pages.filter((page) => plays(page, "application_form"));

  console.log(
    `  ${DIM}This can only ever be an inference. A page behind a login leaves no trace in a\n` +
      `  capture — its absence is the only evidence there is.${RESET}\n`,
  );

  if (!reachedApplyHost) {
    console.log(`  ${AMBER}The apply host was not reached at all.${RESET}`);
    console.log(
      `  ${DIM}So nothing can be said about what is behind its login, including whether it has\n` +
        `  one. Not "the form is behind auth" — "we have not seen the apply host".${RESET}`,
    );
    return;
  }

  if (formPages.length === 0) {
    console.log(`  ${AMBER}The apply host was reached, but no application form was captured.${RESET}`);
    console.log(
      `  ${DIM}The most likely reading: the form is behind the login. That makes the ENTIRE\n` +
        `  field list, every validation rule, every dropdown's options and every document\n` +
        `  requirement undiscoverable by this run — and the mapping set cannot be authored\n` +
        `  from it. A specialist should confirm by looking at the captured login page.${RESET}`,
    );
    return;
  }

  console.log(
    `  ${GREEN}Part of the form is anonymous.${RESET} ${DIM}${String(formPages.length)} form page(s) captured.\n` +
      `  Whether there are FURTHER steps after sign-in cannot be told from here: a\n` +
      `  multi-step form shows step 1 and nothing else until you advance, and discovery\n` +
      `  does not advance.${RESET}`,
  );
}

function reportBlocked(requests: readonly BlockedRequest[]): void {
  if (requests.length === 0) {
    console.log(`  ${GREEN}✓${RESET} No state-changing request was attempted. The portal inspected cleanly.`);
    return;
  }

  const buckets = new Map<RequestClass, { count: number; why: string; examples: Set<string> }>();
  for (const request of requests) {
    const { kind, why } = classifyRequest(request);
    const bucket = buckets.get(kind) ?? { count: 0, why, examples: new Set<string>() };
    bucket.count += 1;
    if (bucket.examples.size < 4) bucket.examples.add(`${request.method} ${trim(request.url)}`);
    buckets.set(kind, bucket);
  }

  const ORDER: readonly RequestClass[] = [
    "possibly_consequential",
    "unknown",
    "framework_rpc",
    "bot_defence",
    "session_or_consent",
    "telemetry",
    "search",
  ];

  for (const kind of ORDER) {
    const bucket = buckets.get(kind);
    if (bucket === undefined) continue;
    const alarming = kind === "possibly_consequential" || kind === "unknown";
    const colour = alarming ? AMBER : DIM;
    console.log(
      `  ${colour}${String(bucket.count).padStart(5)}${RESET}  ${BOLD}${kind}${RESET} ${DIM}— ${bucket.why}${RESET}`,
    );
    for (const example of bucket.examples) console.log(`         ${DIM}${example}${RESET}`);
  }

  const worrying =
    (buckets.get("possibly_consequential")?.count ?? 0) + (buckets.get("unknown")?.count ?? 0);

  console.log(
    `\n  ${worrying === 0 ? GREEN : AMBER}${String(worrying)}${RESET} of ${String(requests.length)} ` +
      `need a human to look at them.\n`,
  );
  console.log(
    `  ${DIM}All of them were blocked either way — the guard refuses by METHOD and does not\n` +
      `  consult these buckets. This is the READING, so a specialist reviews the handful\n` +
      `  that matter instead of ${String(requests.length)} lines. A large framework_rpc count is\n` +
      `  expected on Salesforce Experience Cloud: that is how a Lightning page renders.${RESET}`,
  );

  if (worrying > 0) {
    console.log(
      `\n  ${AMBER}Worth saying plainly:${RESET} ${DIM}a page that attempts a consequential write on load\n` +
        `  cannot be inspected without side effects on a live portal. If any of the above is\n` +
        `  real, execution against this portal needs that understood first.${RESET}`,
    );
  }
}

function reportFields(pages: readonly ClassifiedPage[], blueprint: ApplicationBlueprint): void {
  const all = allFields(blueprint);
  const applicationUrls = new Set(
    pages
      .filter((page) => plays(page, "application_form") || plays(page, "account_creation"))
      .map((page) => page.url),
  );

  const application = all.filter((field) => onOneOf(blueprint, field, applicationUrls));
  const rest = all.length - application.length;

  console.log(
    `  ${BOLD}${String(all.length)}${RESET} input(s) were found across the whole crawl.\n` +
      `  ${GREEN}${String(application.length)}${RESET} are on a page classified as the application or its ` +
      `registration.\n  ${DIM}${String(rest)} are on marketing, search and course pages — site search boxes,\n` +
      `  newsletter sign-ups, cookie banners, chat widgets. Mapping any of those to a\n` +
      `  student's data is the failure this separation exists to prevent.${RESET}\n`,
  );

  if (application.length === 0) {
    console.log(
      `  ${AMBER}Nothing to map yet.${RESET} ${DIM}No page was classified as the application form, so there\n` +
        `  is no field list to author a mapping set against.${RESET}`,
    );
    return;
  }

  const required = application.filter((field) => field.validations.some((rule) => rule.kind === "required"));
  console.log(`  ${BOLD}Required (${String(required.length)})${RESET}`);
  for (const field of required) console.log(`    ${describe(field)}`);

  const optional = application.filter((field) => !required.includes(field));
  if (optional.length > 0) {
    console.log(`\n  ${BOLD}Optional (${String(optional.length)})${RESET}`);
    for (const field of optional) console.log(`    ${DIM}${describe(field)}${RESET}`);
  }

  const uploads = application.filter((field) => field.inputType === "file");
  console.log(
    `\n  ${BOLD}Document uploads:${RESET} ${uploads.length === 0 ? `${DIM}none recorded${RESET}` : ""}`,
  );
  for (const field of uploads) console.log(`    ${field.fieldRef} — ${field.label}`);
  if (uploads.length === 0) {
    console.log(
      `    ${DIM}A form can ask for documents on a later step, or after sign-in. An absence\n` +
        `    here is not evidence that none are required — the requirements pages are the\n` +
        `    other place to look, and they are a Requirements Service question, not a\n` +
        `    blueprint one.${RESET}`,
    );
  }
}

async function reportAge(
  dir: string,
  pageIndex: ReadonlyMap<string, string>,
  run: RunJson,
): Promise<void> {
  const hits: { url: string; quote: string }[] = [];

  for (const url of run.visited) {
    const file = pageIndex.get(url);
    if (file === undefined) continue;
    const text = stripTags(await readCaptured(dir, file));
    for (const pattern of AGE_PATTERNS) {
      const match = pattern.exec(text);
      if (match === null) continue;
      hits.push({ url, quote: context(text, match.index) });
      break;
    }
  }

  if (hits.length === 0) {
    console.log(
      `  ${DIM}No age or parental-consent wording was found on any captured page.${RESET}\n\n` +
        `  ${AMBER}That is an absence, not a finding.${RESET} ${DIM}The claim "applicants must be 18 at course\n` +
        `  start" is in the target's list precisely because it is UNVERIFIED. It stays\n` +
        `  unverified.${RESET}`,
    );
  } else {
    for (const hit of hits) {
      console.log(`  ${BOLD}${hit.url}${RESET}`);
      console.log(`    ${DIM}"…${hit.quote}…"${RESET}`);
    }
  }

  console.log(
    `\n  ${DIM}On whether it blocks: being a minor is NOT an automatic blocker (ADR-0013). It\n` +
      `  triggers the minor workflow — additional safeguards, and a lawful basis that is\n` +
      `  not the student's own consent. What would block is a portal rule refusing the\n` +
      `  application outright, and that is a different claim needing its own evidence.${RESET}`,
  );
}

function reportAccountNeededAt(pages: readonly ClassifiedPage[]): void {
  const form = pages.find((page) => plays(page, "application_form"));
  const login = pages.find((page) => plays(page, "login"));
  const creation = pages.find((page) => plays(page, "account_creation"));

  if (form === undefined && (login !== undefined || creation !== undefined)) {
    console.log(
      `  ${AMBER}Immediately.${RESET} ${DIM}A sign-in or registration page was captured and no form was\n` +
        `  reachable without one, so an account is needed before ANY application content is\n` +
        `  visible. Everything downstream — the field list, the mapping set, the validation\n` +
        `  rules — waits on one real account.${RESET}\n`,
    );
  } else if (form !== undefined) {
    console.log(
      `  ${GREEN}Not immediately.${RESET} ${DIM}Application content is reachable anonymously at:\n` +
        `    ${form.url}\n` +
        `  So the blueprint, the field list and the mapping set can be authored from this\n` +
        `  capture. An account is needed at the point the form is SAVED or advanced —\n` +
        `  which this run cannot locate, because locating it means clicking.${RESET}\n`,
    );
  } else {
    console.log(
      `  ${AMBER}Cannot say.${RESET} ${DIM}Neither an application form nor a sign-in page was captured, so\n` +
        `  there is nothing to reason from. Check what the crawl actually reached.${RESET}\n`,
    );
  }

  console.log(
    `  ${DIM}Whatever the answer, the account is the student's own: their email, and control\n` +
      `  handed back before the case can close (ADR-0020). A consenting applicant's real\n` +
      `  account satisfies this. A fabricated one is not an option.${RESET}`,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Plumbing
// ───────────────────────────────────────────────────────────────────────────

function section(number: string, title: string): void {
  console.log(`\n${BOLD}${number}  ${title}${RESET}`);
  console.log(`${DIM}${"─".repeat(74)}${RESET}`);
}

function describe(field: BlueprintField): string {
  const parts = [field.fieldRef.padEnd(24), field.inputType.padEnd(10), field.label];
  if (field.options !== undefined) {
    parts.push(`${DIM}[${field.options.map((option) => option.value).join("|")}]${RESET}`);
  }
  return parts.join(" ");
}

/** Fields the blueprint records on a given URL. */
function fieldsOn(blueprint: ApplicationBlueprint, url: string): readonly BlueprintField[] {
  const page = blueprint.pages.find((candidate) => candidate.url === url);
  if (page === undefined) return [];
  return page.sections.flatMap((sectionOfPage) => sectionOfPage.fields);
}

function onOneOf(
  blueprint: ApplicationBlueprint,
  field: BlueprintField,
  urls: ReadonlySet<string>,
): boolean {
  for (const url of urls) {
    if (fieldsOn(blueprint, url).includes(field)) return true;
  }
  return false;
}

/**
 * url → captured file, from `pages/index.json`.
 *
 * Note `file` is recorded RELATIVE TO THE RUN DIRECTORY and already carries the
 * `pages/` prefix. The first version of this joined `pages/` on again and read
 * `<run>/pages/pages/001.html`, which does not exist — and because both this
 * and `readCaptured` swallowed their errors and returned empty, every page
 * classified on no content at all. The report still looked entirely plausible.
 * Hence `readCaptured` now throws.
 */
async function readPageIndex(dir: string): Promise<ReadonlyMap<string, string>> {
  const raw = JSON.parse(await readFile(join(dir, "pages", "index.json"), "utf8")) as unknown;
  const entries = new Map<string, string>();

  const list =
    Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | null)?.["pages"] ?? []);
  if (!Array.isArray(list)) {
    throw new Error(
      `pages/index.json has no page list. Analysing a run with no captured pages would produce ` +
        `a confident report about nothing.`,
    );
  }

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const url = record["url"];
    const file = record["file"];
    if (typeof url === "string" && typeof file === "string") entries.set(url, file);
  }

  if (entries.size === 0) {
    throw new Error(`pages/index.json lists no pages. There is nothing to analyse.`);
  }

  return entries;
}

/**
 * Reads one captured page.
 *
 * Throws rather than returning empty. An unreadable capture makes every
 * content-based classification silently wrong, and a silently wrong
 * classification is worse than a crash — it reads as a finding.
 */
async function readCaptured(dir: string, file: string): Promise<string> {
  // `file` is relative to the run directory and already includes `pages/`.
  const path = join(dir, file);

  // `stat` throws ENOENT on its own, which is a fine failure but an unhelpful
  // message — it names a path and not what the path was for.
  let isFile = false;
  try {
    isFile = (await stat(path)).isFile();
  } catch {
    isFile = false;
  }

  if (!isFile) {
    throw new Error(
      `Captured page missing: ${path}. The run index lists it but the file is not there, so ` +
        `this page would be classified on no content — which reads as a finding rather than a ` +
        `gap. Re-run discovery, or send the complete run directory.`,
    );
  }

  return await readFile(path, "utf8");
}

/** Text content, roughly. Enough for keyword evidence, not for parsing. */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function context(text: string, index: number): string {
  return text.slice(Math.max(0, index - 60), index + 120).trim();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function trim(url: string): string {
  return url.length <= 96 ? url : `${url.slice(0, 93)}…`;
}

/** Directory listing, so a wrong path fails with something useful. */
export async function runsIn(root: string): Promise<readonly string[]> {
  try {
    return await readdir(join(root, "discovery-runs"));
  } catch {
    return [];
  }
}

await main();
