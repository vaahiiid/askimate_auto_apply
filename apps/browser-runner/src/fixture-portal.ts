/**
 * A controlled portal that actually requires an account.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The first end-to-end product test needs a target, and the choice between a
 * real university portal and one we own is not close. A real portal would make
 * the first integration test depend on a third party's uptime, its generated
 * Salesforce ids and its shadow DOM. The test would then be measuring THEIR
 * reliability, and a red build would say nothing about our architecture.
 *
 * So: a portal we own, and one that is genuinely gated.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The gate is the point ─────────────────────────────────────────────────
 *
 * `/apply` redirects to `/register` without a session cookie. That single rule
 * is what makes the secure interaction REAL rather than decorative: the run
 * cannot reach the application form without an account, the account cannot be
 * created without a password, and the password can only come from the student
 * through the Secure Plane. A fixture that served the form to anyone would let
 * the whole credential path be skipped while every test still passed.
 *
 * ── Why there is a login page ─────────────────────────────────────────────
 *
 * Nothing here ever renders a password back, so a test cannot assert "the right
 * password arrived" by reading a page — which is exactly the property we want.
 * `POST /login` is how it is proved instead: register with a password, then
 * sign in with it. That is the portal using the credential the way a real one
 * does, and it fails if a single character was mistyped, truncated or swapped.
 *
 * ── Deliberately not a mock ───────────────────────────────────────────────
 *
 * Sessions are real cookies. Validation is real refusal — a short password, a
 * mismatched confirmation and a duplicate email are all rejected the way a
 * portal rejects them, because an automation that has never met a refusal has
 * not been tested against one. `submissions()` exists so a test can assert the
 * one thing this system must never do: submit.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * What the portal stored for one applicant. Never rendered back.
 *
 * No `createdAt`: nothing reads one, and the lint rule that forbids reading the
 * ambient clock is right to catch it — a field added because a real portal
 * would have one is a field that has to be injected, tested and kept true.
 */
interface Account {
  readonly email: string;
  readonly password: string;
}

/** What an applicant filled in. Rendered back on the review page. */
export interface PortalApplication {
  readonly givenName: string;
  readonly familyName: string;
  readonly dateOfBirth: string;
  readonly nationality: string;
  readonly personalStatement: string;
}

export interface FixturePortal {
  readonly baseUrl: string;
  readonly host: string;
  /** Emails that successfully created an account. Never the passwords. */
  accounts(): readonly string[];
  /**
   * Whether these credentials work.
   *
   * The only way to check a password reached the portal intact, and it does not
   * reveal one: it answers a question that was already asked.
   */
  credentialsWork(email: string, password: string): boolean;
  /** What was filled in, for the account that signed in. */
  application(email: string): PortalApplication | null;
  /** Applications actually SUBMITTED. This must stay empty (ADR-0014). */
  submissions(): readonly string[];
  /** Every request the portal received, so a run can be checked afterwards. */
  readonly requests: readonly { readonly method: string; readonly path: string }[];
  stop(): Promise<void>;
}

const MINIMUM_PASSWORD_LENGTH = 8;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Constant-time comparison, in a fixture.
 *
 * Not because a test can be timed, but because a fixture that compares
 * passwords with `===` is a fixture someone eventually copies.
 */
function samePassword(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

const REGISTER_PAGE = (error: string | null): string =>
  page(
    "Create your account",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/register" id="registerForm">
  <label for="email">Email address</label>
  <input type="email" id="email" name="email" required autocomplete="username">

  <label for="password">Password</label>
  <input type="password" id="password" name="password" required minlength="8"
         autocomplete="new-password">

  <label for="passwordConfirm">Confirm password</label>
  <input type="password" id="passwordConfirm" name="password_confirm" required minlength="8"
         autocomplete="new-password">

  <p>Your password must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.</p>
  <button type="submit" id="createAccount">Create account</button>
</form>
<p>Already registered? <a href="/login">Sign in</a></p>`,
  );

const LOGIN_PAGE = (error: string | null): string =>
  page(
    "Sign in",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/login" id="loginForm">
  <label for="email">Email address</label>
  <input type="email" id="email" name="email" required autocomplete="username">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">
  <button type="submit" id="signIn">Sign in</button>
</form>`,
  );

const APPLY_PAGE = (error: string | null): string =>
  page(
    "Your application",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/apply" id="applicationForm">
  <label for="givenName">First name</label>
  <input type="text" id="givenName" name="given_name" required maxlength="50">

  <label for="familyName">Last name</label>
  <input type="text" id="familyName" name="family_name" required maxlength="50">

  <label for="dob">Date of birth</label>
  <input type="text" id="dob" name="date_of_birth" required pattern="\\d{2}/\\d{2}/\\d{4}"
         placeholder="DD/MM/YYYY">

  <label for="nationality">Nationality</label>
  <select id="nationality" name="nationality" required>
    <option value="">Please select</option>
    <option value="IR">Iran (Islamic Republic of)</option>
    <option value="IQ">Iraq</option>
    <option value="GB">United Kingdom</option>
  </select>

  <label for="statement">Why do you want to study this course?</label>
  <textarea id="statement" name="personal_statement" maxlength="4000" required></textarea>

  <button type="submit" id="continueBtn">Save and continue</button>
</form>`,
  );

const REVIEW_PAGE = (application: PortalApplication): string =>
  page(
    "Review your application",
    `<dl id="review">
  <dt>First name</dt><dd id="reviewGivenName">${escapeHtml(application.givenName)}</dd>
  <dt>Last name</dt><dd id="reviewFamilyName">${escapeHtml(application.familyName)}</dd>
  <dt>Date of birth</dt><dd id="reviewDob">${escapeHtml(application.dateOfBirth)}</dd>
  <dt>Nationality</dt><dd id="reviewNationality">${escapeHtml(application.nationality)}</dd>
  <dt>Personal statement</dt>
  <dd id="reviewStatement">${escapeHtml(application.personalStatement)}</dd>
</dl>
<form method="post" action="/submit" id="submitForm">
  <button type="submit" id="submitBtn">Submit application</button>
</form>`,
  );

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sessionOf(request: IncomingMessage): string | null {
  const cookie = request.headers.cookie ?? "";
  return /portal_session=([^;]+)/.exec(cookie)?.[1] ?? null;
}

function send(response: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  response
    .writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers })
    .end(html);
}

/** Starts the portal on an ephemeral port. */
export async function startFixturePortal(): Promise<FixturePortal> {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, string>();
  const applications = new Map<string, PortalApplication>();
  const submissions: string[] = [];
  const requests: { method: string; path: string }[] = [];

  const server: Server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = request.method ?? "GET";
      requests.push({ method, path });

      const session = sessionOf(request);
      const signedInAs = session === null ? null : (sessions.get(session) ?? null);

      if (method === "GET" && (path === "/" || path === "/register")) {
        send(response, 200, REGISTER_PAGE(null));
        return;
      }

      if (method === "POST" && path === "/register") {
        const body = await readBody(request);
        const email = (body.get("email") ?? "").trim();
        const password = body.get("password") ?? "";
        const confirmation = body.get("password_confirm") ?? "";

        // Real refusals, in the order a portal makes them. An automation that
        // has never met a refusal has not been tested against one.
        if (email.length === 0 || !email.includes("@")) {
          send(response, 400, REGISTER_PAGE("Enter a valid email address."));
          return;
        }
        if (accounts.has(email.toLowerCase())) {
          send(response, 409, REGISTER_PAGE("An account already exists for that email."));
          return;
        }
        if (password.length < MINIMUM_PASSWORD_LENGTH) {
          send(
            response,
            400,
            REGISTER_PAGE(`Your password must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`),
          );
          return;
        }
        if (!samePassword(password, confirmation)) {
          // The message names neither value, because a fixture that echoed one
          // would be a fixture that taught the wrong habit.
          send(response, 400, REGISTER_PAGE("The two passwords do not match."));
          return;
        }

        accounts.set(email.toLowerCase(), { email, password });
        const id = randomBytes(16).toString("hex");
        sessions.set(id, email.toLowerCase());
        send(response, 302, "", {
          location: "/apply",
          "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
        });
        return;
      }

      if (method === "GET" && path === "/login") {
        send(response, 200, LOGIN_PAGE(null));
        return;
      }

      if (method === "POST" && path === "/login") {
        const body = await readBody(request);
        const email = (body.get("email") ?? "").trim().toLowerCase();
        const password = body.get("password") ?? "";
        const account = accounts.get(email);
        if (account === undefined || !samePassword(account.password, password)) {
          send(response, 401, LOGIN_PAGE("Those details do not match an account."));
          return;
        }
        const id = randomBytes(16).toString("hex");
        sessions.set(id, email);
        send(response, 302, "", {
          location: "/apply",
          "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
        });
        return;
      }

      // ── THE GATE ────────────────────────────────────────────────────────
      //
      // Everything below needs an account. This is what makes the secure
      // interaction real rather than decorative.
      if (signedInAs === null) {
        send(response, 302, "", { location: "/register" });
        return;
      }

      if (method === "GET" && path === "/apply") {
        send(response, 200, APPLY_PAGE(null));
        return;
      }

      if (method === "POST" && path === "/apply") {
        const body = await readBody(request);
        const application: PortalApplication = {
          givenName: body.get("given_name") ?? "",
          familyName: body.get("family_name") ?? "",
          dateOfBirth: body.get("date_of_birth") ?? "",
          nationality: body.get("nationality") ?? "",
          personalStatement: body.get("personal_statement") ?? "",
        };
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(application.dateOfBirth)) {
          send(response, 400, APPLY_PAGE("Enter your date of birth as DD/MM/YYYY."));
          return;
        }
        applications.set(signedInAs, application);
        send(response, 302, "", { location: "/review" });
        return;
      }

      if (method === "GET" && path === "/review") {
        const application = applications.get(signedInAs);
        if (application === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        send(response, 200, REVIEW_PAGE(application));
        return;
      }

      if (method === "POST" && path === "/submit") {
        // Recorded so a test can assert this never happened. ADR-0014: the
        // system stops before submission, and "it did not submit" has to be
        // provable rather than assumed.
        submissions.push(signedInAs);
        send(response, 200, page("Submitted", "<p id='submitted'>Application submitted.</p>"));
        return;
      }

      send(response, 404, page("Not found", "<p>No such page.</p>"));
    })().catch(() => {
      if (!response.headersSent) send(response, 500, page("Error", "<p>Something went wrong.</p>"));
    });
  });

  const address = await new Promise<{ port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const listening = server.address();
      if (listening === null || typeof listening === "string") throw new Error("no port");
      resolve({ port: listening.port });
    });
  });

  const host = `127.0.0.1:${String(address.port)}`;
  return {
    baseUrl: `http://${host}`,
    host,
    accounts: () => [...accounts.values()].map((account) => account.email),
    credentialsWork: (email, password) => {
      const account = accounts.get(email.toLowerCase());
      return account !== undefined && samePassword(account.password, password);
    },
    application: (email) => applications.get(email.toLowerCase()) ?? null,
    submissions: () => [...submissions],
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
