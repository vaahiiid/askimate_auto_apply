/**
 * P19 — signing in, against a REAL OpenID Provider.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The provider here is `oidc-provider` — panva's certified OpenID Provider —
 * running on loopback. Not a mock, and deliberately not a mock OF COGNITO: the
 * thing under test is whether this system speaks the PROTOCOL, and a fake
 * shaped like one vendor's responses would prove only that it agrees with the
 * fake.
 *
 * Vahid, 2026-09-03: *"If a proper local fake OIDC provider or standards-compliant
 * test harness is needed to prove the protocol boundary, use that rather than
 * mocking Cognito-specific behaviour into the application."*
 *
 * No AWS identifier, domain, client id or secret appears anywhere in this file.
 * The client credentials below belong to the local provider and to nothing else.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import Provider from "oidc-provider";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import {
  ConversationEventStore,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  StudentIdentityStore,
  createConversationApp,
} from "@askimate/aas-conversation-service";
import { discoverAdapter, EMAIL_SCOPE, type OidcAdapter } from "@askimate/aas-oidc";

const OP_PORT = 4990;
const APP_PORT = 4991;
/**
 * A SECOND provider, and the reason there are two.
 *
 * OIDC Core §5.4: in the Authorization Code flow the claims a `scope` asks for
 * come from the UserInfo endpoint, because an access token was issued. A
 * conforming provider therefore sends an ID token carrying `sub` and nothing
 * else — which is what the pair on 4990 does.
 *
 * Cognito does the other legitimate thing and puts `email` and
 * `email_verified` straight in the ID token. That is the shape PRODUCTION will
 * meet, so testing only against the conforming provider would ship an adapter
 * whose production path had never run. `conformIdTokenClaims: false` is a
 * standard option of the same real provider — not a Cognito mock — and it
 * produces that shape honestly.
 */
const OP_IDTOKEN_PORT = 4992;
const APP_IDTOKEN_PORT = 4993;
const OP = `http://127.0.0.1:${String(OP_PORT)}`;
const APP = `http://127.0.0.1:${String(APP_PORT)}`;
const OP_IDTOKEN = `http://127.0.0.1:${String(OP_IDTOKEN_PORT)}`;
const APP_IDTOKEN = `http://127.0.0.1:${String(APP_IDTOKEN_PORT)}`;
const REDIRECT = `${APP}/auth/callback`;
const REDIRECT_IDTOKEN = `${APP_IDTOKEN}/auth/callback`;
const CLIENT_ID = "aas-local-test-client";
const CLIENT_SECRET = "a-local-test-client-secret-not-a-real-one";
const SESSION_SECRET = "a-p19-session-secret-that-is-long-enough-to-pass";
const DATABASE = "aas_p19_identity";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P19 — signing in, against a real OpenID Provider");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let servers: Server[] = [];
let identities: StudentIdentityStore;
/**
 * Why each refused sign-in was refused.
 *
 * A 400 says the callback said no; this says WHAT it said no to. Two different
 * defects both answer 400 — the state check failing, and a null dereference
 * further down — and a test that reads only the status cannot tell them apart.
 */
let failures: string[] = [];

/**
 * What the provider will say about the next person who signs in.
 *
 * Mutated per test so all four of ADR-0056's cases come from a REAL provider
 * response rather than from a stubbed function.
 */
let account: {
  sub: string;
  claims: Record<string, unknown>;
  /**
   * What UserInfo says, when it is to differ from the ID token.
   *
   * A provider is entitled to answer the two differently — `claims()` is given
   * the `use` precisely so it can — and the adapter's precedence rule is only
   * observable when they disagree. Absent, both answer the same.
   */
  userinfoClaims?: Record<string, unknown>;
};

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * A real OpenID Provider on loopback, and a Conversation Service pointed at it.
 *
 * `conformIdTokenClaims` is the only difference between the two pairs, and it
 * decides WHERE the provider puts `email` and `email_verified` — see the
 * constants above.
 */
async function startPair(
  issuer: string,
  opPort: number,
  redirectUri: string,
  appPort: number,
  conformIdTokenClaims: boolean,
): Promise<readonly Server[]> {
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
    // The claims this provider will put in an ID token for the `email` scope.
    claims: { openid: ["sub"], email: ["email", "email_verified"] },
    conformIdTokenClaims,
    // No built-in login form. This test drives the interaction endpoint
    // itself, below, which is the provider's real extension point rather than
    // a way around it.
    features: { devInteractions: { enabled: false } },
    // The account the test controls. `claims()` is what ends up in the
    // response, so omitting a key here genuinely omits it — which is how the
    // "no email" and "no claim" cases are produced honestly.
    findAccount: (_ctx, id) =>
      Promise.resolve({
        accountId: id,
        claims: (use) => ({
          sub: id,
          ...(use === "userinfo" && account.userinfoClaims !== undefined
            ? account.userinfoClaims
            : account.claims),
        }),
      }),
    // Consent is not what is under test, so the provider is told this client
    // already holds a grant for the scopes it asks for. The LOGIN interaction
    // is still performed for real, below.
    // Annotated, and reached through `ctx.oidc.provider`, because referring to
    // the `provider` being constructed from inside its own options is a
    // circular inference TypeScript cannot resolve.
    loadExistingGrant: async (ctx): Promise<InstanceType<Provider["Grant"]> | undefined> => {
      const accountId = ctx.oidc.session?.accountId;
      const clientId = ctx.oidc.client?.clientId;
      if (accountId === undefined || clientId === undefined) return undefined;
      const grant = new ctx.oidc.provider.Grant({ accountId, clientId });
      grant.addOIDCScope(EMAIL_SCOPE);
      await grant.save();
      return grant;
    },
  });

  // ═════════════════════════════════════════════════════════════════════════
  // The interaction endpoint. `oidc-provider` deliberately does not ship a
  // login UI: it redirects to the host application, which decides who the
  // person is and hands the answer back. Here the answer is whatever the test
  // put in `account`, so all four of ADR-0056's cases are produced by a real
  // provider following the real protocol — the shortcut is WHO logs in, never
  // what the protocol does with them.
  // ═════════════════════════════════════════════════════════════════════════
  const handle = provider.callback();
  const opServer = await new Promise<Server>((resolve) => {
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", issuer).pathname;
      if (path.startsWith("/interaction/")) {
        provider.interactionFinished(req, res, { login: { accountId: account.sub } }).catch(() => {
          res.statusCode = 500;
          res.end();
        });
        return;
      }
      // `void`: the Koa handler answers the request itself, and its promise
      // resolving is not something this server has anything to do after.
      void handle(req, res);
    });
    server.listen(opPort, "127.0.0.1", () => resolve(server));
  });

  const adapter: OidcAdapter = await discoverAdapter({
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri,
    // Loopback, no certificate. The Conversation Service refuses this in
    // production (ADR-0055's configuration layer).
    allowInsecureHttp: true,
  });

  const app = createConversationApp({
    store: new ConversationEventStore(pool),
    sessionSecret: SESSION_SECRET,
    authorise: () => Promise.resolve(true),
    now: () => new Date(),
    auth: {
      adapter,
      sessionSecret: SESSION_SECRET,
      resolve: async (claims) => await identities.resolve(claims),
      now: () => new Date(),
      afterLoginPath: "/signed-in",
      onFailure: (reason) => failures.push(reason),
    },
  });
  const appServer = await new Promise<Server>((resolve) => {
    const listening = app.listen(appPort, "127.0.0.1", () => resolve(listening));
  });

  return [opServer, appServer];
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  pool = new pg.Pool({ connectionString: urlFor(DATABASE), max: 8 });
  await migrate(pool, CASE_MIGRATIONS);
  await migrate(pool, CONVERSATION_MIGRATIONS);
  identities = new StudentIdentityStore(pool);

  account = { sub: "op-subject-1", claims: { email: "student@example.test", email_verified: true } };

  servers = [
    ...(await startPair(OP, OP_PORT, REDIRECT, APP_PORT, true)),
    ...(await startPair(OP_IDTOKEN, OP_IDTOKEN_PORT, REDIRECT_IDTOKEN, APP_IDTOKEN_PORT, false)),
  ];
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await pool.end();
});

/** One cookie value out of a `set-cookie` list. */
function cookieValue(headers: Headers, name: string): string | null {
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    if (pair === undefined) continue;
    const separator = pair.indexOf("=");
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1);
  }
  return null;
}

/**
 * A whole sign-in, driven the way a browser would: follow every redirect by
 * hand, carrying the cookies each side sets.
 *
 * Returns the final response and the session cookie, if one was minted.
 */
async function signIn(
  op: string = OP,
  app: string = APP,
): Promise<{ status: number; session: string | null; location: string | null }> {
  const started = await fetch(`${app}/auth/login`, { redirect: "manual" });
  const loginCookie = started.headers.getSetCookie().join("; ");
  let next = started.headers.get("location");
  if (next === null) throw new Error("no authorization redirect");

  // The provider's own hops. Its session cookie is carried between them.
  let opCookies = "";
  for (let hop = 0; hop < 6; hop += 1) {
    const target = next.startsWith("http") ? next : `${op}${next}`;
    if (target.startsWith(app)) break;
    const response = await fetch(target, { redirect: "manual", headers: { cookie: opCookies } });
    const set = response.headers
      .getSetCookie()
      .map((raw) => raw.split(";")[0] ?? "")
      .filter((value) => value.length > 0);
    if (set.length > 0) opCookies = [opCookies, ...set].filter((v) => v.length > 0).join("; ");
    const location = response.headers.get("location");
    if (location === null) throw new Error(`provider stopped at ${String(response.status)}`);
    next = location;
  }

  const callback = await fetch(next, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  return {
    status: callback.status,
    session: cookieValue(callback.headers, "__Host-aas-session"),
    location: callback.headers.get("location"),
  };
}

/**
 * Drives a sign-in up to — but not through — the callback, and hands back the
 * genuine callback URL together with the cookie that belongs to it.
 *
 * The tampering tests need a REAL authorization code: a callback carrying a
 * code the provider would reject is refused for that reason whatever the rest
 * of it says, which would let a missing `state` check pass unnoticed.
 */
async function authorizedCallback(): Promise<{ url: URL; cookie: string }> {
  const started = await fetch(`${APP}/auth/login`, { redirect: "manual" });
  const cookie = started.headers.getSetCookie().join("; ");
  let next = started.headers.get("location");
  if (next === null) throw new Error("no authorization redirect");
  let opCookies = "";
  for (let hop = 0; hop < 6; hop += 1) {
    const target = next.startsWith("http") ? next : `${OP}${next}`;
    if (target.startsWith(APP)) break;
    const response = await fetch(target, { redirect: "manual", headers: { cookie: opCookies } });
    const set = response.headers
      .getSetCookie()
      .map((raw) => raw.split(";")[0] ?? "")
      .filter((value) => value.length > 0);
    if (set.length > 0) opCookies = [opCookies, ...set].filter((v) => v.length > 0).join("; ");
    const location = response.headers.get("location");
    if (location === null) throw new Error(`provider stopped at ${String(response.status)}`);
    next = location;
  }
  return { url: new URL(next), cookie };
}

describeIfDatabase("Authorization Code + PKCE, against a real provider", () => {
  it("signs a student in and mints OUR session, not the provider's token", async () => {
    account = { sub: "op-verified", claims: { email: "a@example.test", email_verified: true } };
    const result = await signIn();

    expect(result.status, "a redirect, not a page").toBe(302);
    expect(result.location).toBe("/signed-in");
    expect(result.session, "our own __Host- cookie").not.toBeNull();
    // ADR-0038: provider tokens never reach the browser. Whatever the provider
    // returned, what came back here is a signed subject and nothing else.
    expect(result.session).not.toContain("eyJ");
  }, 120_000);

  it("persists the provider's SUBJECT, and nothing else, as identity", async () => {
    const rows = await pool.query<{ subject: string; email_verified: boolean }>(
      "SELECT subject, email_verified FROM students WHERE subject = $1",
      ["op-verified"],
    );
    expect(rows.rows[0]?.subject).toBe("op-verified");
    expect(rows.rows[0]?.email_verified).toBe(true);
    // The address is profile data, not identity (ADR-0038). There is no column
    // for it here, and this asserts that stays true.
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'students'",
    );
    expect(columns.rows.map((r) => r.column_name)).not.toContain("email");
  }, 120_000);

  it("REFUSES a callback with no login state — no PKCE verifier, no exchange", async () => {
    // Somebody replaying a callback URL, or arriving at it directly. Without
    // the short-lived cookie there is no verifier and no `state` to compare.
    const response = await fetch(`${APP}/auth/callback?code=whatever&state=whatever`, {
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    expect(cookieValue(response.headers, "__Host-aas-session"), "no session is minted").toBeNull();
  }, 120_000);

  it("REFUSES a callback whose state does not match the one we issued", async () => {
    // The CSRF defence. The cookie is real; the `state` in the URL is not the
    // one it holds, so the exchange must not happen.
    const started = await fetch(`${APP}/auth/login`, { redirect: "manual" });
    const loginCookie = started.headers.getSetCookie().join("; ");
    const response = await fetch(`${APP}/auth/callback?code=abc&state=not-the-issued-state`, {
      redirect: "manual",
      headers: { cookie: loginCookie },
    });
    expect(response.status).toBe(400);
    expect(cookieValue(response.headers, "__Host-aas-session")).toBeNull();
  }, 120_000);

  it("asks for S256 and never for a plain challenge", async () => {
    const started = await fetch(`${APP}/auth/login`, { redirect: "manual" });
    const authorize = new URL(started.headers.get("location") ?? "");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).not.toBeNull();
    expect(authorize.searchParams.get("state")).not.toBeNull();
    expect(authorize.searchParams.get("nonce")).not.toBeNull();
    expect(authorize.searchParams.get("scope")).toContain("email");
    // ADR-0038: authorization code only.
    expect(authorize.searchParams.get("response_type")).toBe("code");
  }, 120_000);
});

describeIfDatabase("what the provider said about the email address", () => {
  /** Signs a fresh subject in and reads back what was persisted. */
  async function signInAs(
    sub: string,
    claims: Record<string, unknown>,
    op: string = OP,
    app: string = APP,
  ): Promise<{ verified: boolean; studentId: string }> {
    account = { sub, claims };
    const result = await signIn(op, app);
    expect(result.session, "every outcome is still AUTHENTICATED").not.toBeNull();
    const rows = await pool.query<{ id: string; email_verified: boolean }>(
      "SELECT id, email_verified FROM students WHERE subject = $1",
      [sub],
    );
    const row = rows.rows[0];
    if (row === undefined) expect.unreachable(`no student for ${sub}`);
    return { verified: row.email_verified, studentId: row.id };
  }

  it("VERIFIED — persists true", async () => {
    const { verified } = await signInAs("case-verified", {
      email: "v@example.test",
      email_verified: true,
    });
    expect(verified).toBe(true);
  }, 120_000);

  it("UNVERIFIED — persists false", async () => {
    const { verified } = await signInAs("case-unverified", {
      email: "u@example.test",
      email_verified: false,
    });
    expect(verified).toBe(false);
  }, 120_000);

  it("NO EMAIL — persists false", async () => {
    const { verified } = await signInAs("case-no-email", { email_verified: true });
    expect(verified, "no address means nothing to verify").toBe(false);
  }, 120_000);

  it("NO VERIFICATION CLAIM — persists false", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The case that decides whether "fail safe" is a real property. The
    // provider returns an address and says nothing about verification, and
    // this system must not read silence as consent.
    // ═══════════════════════════════════════════════════════════════════
    const { verified } = await signInAs("case-no-claim", { email: "q@example.test" });
    expect(verified, "absence is not verification").toBe(false);
  }, 120_000);

  it("UPDATES on a later sign-in, which is how a student clears it", async () => {
    // ADR-0056 §4: verification is as fresh as the last sign-in, and this is
    // the line that notices when they come back.
    const first = await signInAs("case-later", { email: "l@example.test", email_verified: false });
    expect(first.verified).toBe(false);
    const second = await signInAs("case-later", { email: "l@example.test", email_verified: true });
    expect(second.verified).toBe(true);
    expect(second.studentId, "the same person, not a new one").toBe(first.studentId);
  }, 120_000);

  it("is NOT taken from anything the client controls", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The provider says the address is unverified. The browser then asserts
    // otherwise in every way a browser can — query string, and a cookie of its
    // own naming. What is persisted is what the PROVIDER said.
    // ═══════════════════════════════════════════════════════════════════
    account = { sub: "case-client-lies", claims: { email: "c@example.test", email_verified: false } };

    const started = await fetch(`${APP}/auth/login?email_verified=true`, { redirect: "manual" });
    const loginCookie = started.headers.getSetCookie().join("; ");
    let next = started.headers.get("location");
    if (next === null) throw new Error("no authorization redirect");

    let opCookies = "";
    for (let hop = 0; hop < 6; hop += 1) {
      const target = next.startsWith("http") ? next : `${OP}${next}`;
      if (target.startsWith(APP)) break;
      const response = await fetch(target, { redirect: "manual", headers: { cookie: opCookies } });
      const set = response.headers
        .getSetCookie()
        .map((raw) => raw.split(";")[0] ?? "")
        .filter((value) => value.length > 0);
      if (set.length > 0) opCookies = [opCookies, ...set].filter((v) => v.length > 0).join("; ");
      const location = response.headers.get("location");
      if (location === null) throw new Error("provider stopped");
      next = location;
    }

    // Everything the client can say, said at once.
    const tampered = new URL(next);
    tampered.searchParams.set("email_verified", "true");
    const callback = await fetch(tampered.href, {
      redirect: "manual",
      headers: { cookie: `${loginCookie}; email_verified=true; aas_email_verified=true` },
    });
    expect(callback.status).toBe(302);

    const rows = await pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM students WHERE subject = $1",
      ["case-client-lies"],
    );
    expect(rows.rows[0]?.email_verified, "the provider said false, and false is what is stored").toBe(
      false,
    );
  }, 120_000);
});

describeIfDatabase("when the provider puts the claims in the ID TOKEN instead", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // The shape PRODUCTION will meet. Cognito returns `email` and
  // `email_verified` in the ID token rather than only from UserInfo, and an
  // adapter proved against one shape only is an adapter whose deployed path
  // has never run. Same code, same assertions, a differently-configured real
  // provider.
  //
  // This is not hypothetical: the first version of this adapter read the ID
  // token alone and reported `no_email` for every student against the
  // conforming provider above. The reverse mistake — reading UserInfo alone —
  // would fail here and nowhere else.
  // ═══════════════════════════════════════════════════════════════════════

  async function signInAs(sub: string, claims: Record<string, unknown>): Promise<boolean> {
    account = { sub, claims };
    const result = await signIn(OP_IDTOKEN, APP_IDTOKEN);
    expect(result.session, "still authenticated, whatever it said").not.toBeNull();
    const rows = await pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM students WHERE subject = $1",
      [sub],
    );
    const row = rows.rows[0];
    if (row === undefined) expect.unreachable(`no student for ${sub}`);
    return row.email_verified;
  }

  it("VERIFIED in the ID token — persists true", async () => {
    expect(
      await signInAs("idtoken-verified", { email: "v@example.test", email_verified: true }),
    ).toBe(true);
  }, 120_000);

  it("UNVERIFIED in the ID token — persists false", async () => {
    expect(
      await signInAs("idtoken-unverified", { email: "u@example.test", email_verified: false }),
    ).toBe(false);
  }, 120_000);

  it("NO VERIFICATION CLAIM in the ID token — persists false", async () => {
    expect(await signInAs("idtoken-no-claim", { email: "q@example.test" })).toBe(false);
  }, 120_000);
});

describeIfDatabase("the value the secure step will read", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // The JOIN between this file and the driver's guard.
  //
  // `run-driver.test.ts` proves what the driver does with a verification
  // value; everything above proves what a real provider's answer turns into.
  // The seam between them is `verificationOf`, and the only way to be sure
  // they are talking about the same thing is to call — here, after a real
  // sign-in — the exact method the guard calls.
  // ═══════════════════════════════════════════════════════════════════════

  it("is what a real sign-in left, read through the guard's own method", async () => {
    account = { sub: "seam-unverified", claims: { email: "s@example.test", email_verified: false } };
    await signIn();
    const unverified = await pool.query<{ id: string }>(
      "SELECT id FROM students WHERE subject = $1",
      ["seam-unverified"],
    );
    const unverifiedId = unverified.rows[0]?.id;
    if (unverifiedId === undefined) expect.unreachable("no student");
    expect(await identities.verificationOf(unverifiedId)).toBe(false);

    account = { sub: "seam-verified", claims: { email: "t@example.test", email_verified: true } };
    await signIn();
    const verified = await pool.query<{ id: string }>(
      "SELECT id FROM students WHERE subject = $1",
      ["seam-verified"],
    );
    const verifiedId = verified.rows[0]?.id;
    if (verifiedId === undefined) expect.unreachable("no student");
    expect(await identities.verificationOf(verifiedId)).toBe(true);
  }, 120_000);

  it("is NOT true for a student this system has never seen", async () => {
    // The guard treats anything other than `true` as a refusal, and this is
    // the value it gets for an id that resolves to nobody.
    expect(await identities.verificationOf("00000000-0000-0000-0000-000000000000")).toBeNull();
  }, 120_000);
});

describeIfDatabase("when the ID token and UserInfo DISAGREE", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // The precedence rule, and the only test that can see it.
  //
  // Both providers above answer the two sources identically, so an adapter
  // that read UserInfo alone would pass every test in this file — the
  // ID-token block included. This is the one that separates them: the ID
  // token is signature-verified and therefore authoritative, and UserInfo
  // fills only what it did not carry.
  //
  // A provider answering the two differently is not a contrivance: the
  // `claims()` hook is given the `use` for exactly this reason.
  // ═══════════════════════════════════════════════════════════════════════

  it("takes the SIGNED ID token's answer, not UserInfo's", async () => {
    account = {
      sub: "disagree-idtoken-true",
      claims: { email: "d@example.test", email_verified: true },
      userinfoClaims: { email: "d@example.test", email_verified: false },
    };
    const result = await signIn(OP_IDTOKEN, APP_IDTOKEN);
    expect(result.session).not.toBeNull();
    const rows = await pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM students WHERE subject = $1",
      ["disagree-idtoken-true"],
    );
    expect(rows.rows[0]?.email_verified, "the signed answer wins").toBe(true);
  }, 120_000);

  it("does not let UserInfo REVERSE a `false` the ID token stated", async () => {
    // The direction that matters. If UserInfo could overwrite the ID token,
    // this is the shape an attacker with any influence over the unsigned
    // response would use, and `false` is the answer that must survive.
    account = {
      sub: "disagree-idtoken-false",
      claims: { email: "e@example.test", email_verified: false },
      userinfoClaims: { email: "e@example.test", email_verified: true },
    };
    const result = await signIn(OP_IDTOKEN, APP_IDTOKEN);
    expect(result.session).not.toBeNull();
    const rows = await pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM students WHERE subject = $1",
      ["disagree-idtoken-false"],
    );
    expect(rows.rows[0]?.email_verified, "UserInfo cannot promote it").toBe(false);
  }, 120_000);
});

describeIfDatabase("what the callback refuses, and for the RIGHT reason", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Both tests here carry a REAL authorization code the provider has just
  // issued, so the callback cannot refuse them for the trivial reason. What
  // is wrong is exactly one thing, and the reason recorded says the check
  // under test is the one that fired.
  // ═══════════════════════════════════════════════════════════════════════

  it("REFUSES a real code whose `state` is not the one we issued", async () => {
    account = { sub: "tamper-state", claims: { email: "x@example.test", email_verified: true } };
    const { url, cookie } = await authorizedCallback();
    const tampered = new URL(url.href);
    tampered.searchParams.set("state", "a-state-this-service-never-issued");

    failures = [];
    const response = await fetch(tampered.href, { redirect: "manual", headers: { cookie } });
    expect(response.status).toBe(400);
    // The CSRF defence, not a coincidence: a service that compared the URL's
    // `state` to itself would exchange this code happily.
    expect(failures, "the exchange is what refused it").toContain("exchange_failed");
    expect(cookieValue(response.headers, "__Host-aas-session")).toBeNull();
    const rows = await pool.query("SELECT 1 FROM students WHERE subject = $1", ["tamper-state"]);
    expect(rows.rowCount, "no student is created by a refused callback").toBe(0);
  }, 120_000);

  it("REFUSES a real code presented with NO login cookie, saying so", async () => {
    account = { sub: "tamper-nocookie", claims: { email: "y@example.test", email_verified: true } };
    const { url } = await authorizedCallback();

    failures = [];
    const response = await fetch(url.href, { redirect: "manual" });
    expect(response.status).toBe(400);
    // Named, not inferred. Without the cookie there is no PKCE verifier and no
    // `state` to compare, and this must be refused BEFORE any exchange is
    // attempted — a later failure would answer 400 too, and mean something
    // else entirely.
    expect(failures).toEqual(["no_login_state"]);
    expect(cookieValue(response.headers, "__Host-aas-session")).toBeNull();
    const rows = await pool.query("SELECT 1 FROM students WHERE subject = $1", ["tamper-nocookie"]);
    expect(rows.rowCount).toBe(0);
  }, 120_000);
});
