/**
 * Attached inspection against the fixture portal's login (P79).
 *
 * The "person" here is Playwright driving a Chromium launched with a
 * remote-debugging port and its own profile — the same thing a person does
 * by hand on the day. The TOOL is `PlaywrightAttachedInspection`, attaching
 * to that browser over CDP and reading the page behind the gate. The two are
 * kept apart in the code below the way they are apart on the day: only the
 * person registers and signs in; only the tool reads.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { BrowserContext } from "playwright";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightAttachedInspection, scrubValues } from "./attached-inspection.js";
import { startFixturePortal } from "./fixture-portal.js";
import type { FixturePortal } from "./fixture-portal.js";

const CDP_PORT = 4909;
const CDP = `http://127.0.0.1:${String(CDP_PORT)}`;

let portal: FixturePortal;
let traceDir: string;
/** The person's browser: a persistent context, as a hand-launched Chrome has. */
let theirs: BrowserContext;
let profileDir: string;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function attach(urls: readonly string[]): Promise<PlaywrightAttachedInspection> {
  return PlaywrightAttachedInspection.open({
    runId: "attached-test",
    capability: "read_only",
    allowedHosts: ["127.0.0.1"],
    traceDir,
    cdpEndpoint: CDP,
    navigableUrlPatterns: urls.map((url) => new RegExp(`^${escapeRegExp(url)}`)),
  });
}

beforeAll(async () => {
  portal = await startFixturePortal();
  traceDir = await mkdtemp(join(tmpdir(), "aas-attached-"));
  profileDir = await mkdtemp(join(tmpdir(), "aas-attached-profile-"));
  theirs = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: [`--remote-debugging-port=${String(CDP_PORT)}`, "--remote-debugging-address=127.0.0.1"],
  });
  // The person creates the account and is signed in by it — in THEIR browser.
  const page = theirs.pages()[0] ?? (await theirs.newPage());
  await page.goto(`${portal.baseUrl}/register`);
  await page.fill("#email", "person@example.test");
  await page.fill("#password", "correct horse battery");
  await page.fill("#passwordConfirm", "correct horse battery");
  await Promise.all([page.waitForURL(/\/apply$/), page.click("#createAccount")]);
  expect(portal.accounts()).toEqual(["person@example.test"]);
}, 60_000);

afterAll(async () => {
  await theirs.close();
  await portal.stop();
  await rm(traceDir, { recursive: true, force: true });
  await rm(profileDir, { recursive: true, force: true });
});

describe("attached inspection reads a form behind a login (P79)", () => {
  it("reads the gated page through the person's session, and sends nothing but GETs", async () => {
    const before = portal.requests.length;
    const session = await attach([`${portal.baseUrl}/apply`]);
    try {
      await session.goto(`${portal.baseUrl}/apply`);
      await session.settle(5_000);
      expect(await session.currentUrl(), "not bounced to /register: the session carried").toBe(
        `${portal.baseUrl}/apply`,
      );

      const observation = await session.observe();
      const names = observation.forms.flatMap((form) => form.fields.map((field) => field.name));
      expect(names).toEqual(expect.arrayContaining(["given_name", "family_name", "date_of_birth", "nationality"]));

      const html = await session.html();
      expect(html).toContain('name="given_name"');
      const shot = await session.screenshot("apply");
      expect((await readFile(shot)).length).toBeGreaterThan(0);

      expect(session.refusedNavigations).toEqual([]);
      expect(session.blockedLog.portalAttemptedWrite).toBe(false);
    } finally {
      await session.close();
    }
    const made = portal.requests.slice(before);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((request) => request.method === "GET"), "the tool only ever reads").toBe(true);
  }, 60_000);

  it("refuses a page not on its list, in the tool and at the guard", async () => {
    const session = await attach([`${portal.baseUrl}/apply`]);
    try {
      await expect(session.goto(`${portal.baseUrl}/review`)).rejects.toThrow(/not on this attached run's list/);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("makes the person's OWN tabs read-only while attached, and gives them back on close", async () => {
    const page = theirs.pages()[0] ?? (await theirs.newPage());
    await page.goto(`${portal.baseUrl}/apply`);
    const session = await attach([`${portal.baseUrl}/apply`]);
    let postsWhileAttached = 0;
    try {
      const before = portal.requests.length;
      // The person tries to save page one in their own tab while we hold it.
      await page.fill("#givenName", "Niloofar");
      await page.fill("#familyName", "Hosseini");
      await page.fill("#dob", "02/04/1999");
      await page.selectOption("#nationality", { index: 1 });
      // The passport-country list arrives after the nationality (P94); the
      // person waits for it, as a person does, and chooses. Its GET is a read.
      await page.waitForSelector('#passportCountry option[value="IR"]', { state: "attached" });
      await page.selectOption("#passportCountry", "IR");
      await page.click("#continueBtn").catch(() => undefined);
      await page.waitForTimeout(500);
      postsWhileAttached = portal.requests.slice(before).filter((r) => r.method === "POST").length;
      expect(postsWhileAttached, "the POST never left the machine").toBe(0);
      expect(session.blockedLog.portalAttemptedWrite, "and the guard recorded it").toBe(true);
      expect(portal.application("person@example.test"), "nothing was saved").toBeNull();
    } finally {
      await session.close();
    }
    // Detached: their browser is theirs again, session intact.
    await page.goto(`${portal.baseUrl}/apply`);
    expect(page.url()).toBe(`${portal.baseUrl}/apply`);
    await page.fill("#givenName", "Niloofar");
    await page.fill("#familyName", "Hosseini");
    await page.fill("#dob", "02/04/1999");
    await page.selectOption("#nationality", { index: 1 });
    await page.waitForSelector('#passportCountry option[value="IR"]', { state: "attached" });
    await page.selectOption("#passportCountry", "IR");
    await Promise.all([page.waitForURL(/\/study$/), page.click("#continueBtn")]);
    expect(portal.application("person@example.test")?.givenName).toBe("Niloofar");
  }, 60_000);

  it("records a redirect to the login page as a refused navigation — the login boundary, as a finding", async () => {
    // A SECOND browser, signed in to nothing. Attached inspection must not
    // see the form there; what it sees instead is the bounce, and it says so.
    const strangerDir = await mkdtemp(join(tmpdir(), "aas-attached-stranger-"));
    const stranger = await chromium.launchPersistentContext(strangerDir, {
      headless: true,
      args: [`--remote-debugging-port=${String(CDP_PORT + 1)}`, "--remote-debugging-address=127.0.0.1"],
    });
    try {
      const session = await PlaywrightAttachedInspection.open({
        runId: "attached-stranger",
        capability: "read_only",
        allowedHosts: ["127.0.0.1"],
        traceDir,
        cdpEndpoint: `http://127.0.0.1:${String(CDP_PORT + 1)}`,
        navigableUrlPatterns: [new RegExp(`^${escapeRegExp(`${portal.baseUrl}/apply`)}`)],
      });
      try {
        await session.goto(`${portal.baseUrl}/apply`).catch(() => undefined);
        expect(session.refusedNavigations).toEqual([`${portal.baseUrl}/register`]);
        expect(session.blockedLog.portalAttemptedWrite).toBe(false);
      } finally {
        await session.close();
      }
    } finally {
      await stranger.close();
      await rm(strangerDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses any capability but read_only, and an empty navigation list", async () => {
    await expect(
      PlaywrightAttachedInspection.open({
        runId: "x",
        capability: "fillable",
        allowedHosts: ["127.0.0.1"],
        traceDir,
        cdpEndpoint: CDP,
        navigableUrlPatterns: [/./],
      }),
    ).rejects.toThrow(/read-only/);
    await expect(
      PlaywrightAttachedInspection.open({
        runId: "x",
        capability: "read_only",
        allowedHosts: ["127.0.0.1"],
        traceDir,
        cdpEndpoint: CDP,
        navigableUrlPatterns: [],
      }),
    ).rejects.toThrow(/explicit list/);
  });
});

describe("through the REAL command, under tsx — not vitest's transform", () => {
  // ── Why this test exists ──────────────────────────────────────────────
  //
  // The six tests above passed, and the first real run failed on its first
  // page: `page.evaluate: ReferenceError: __name is not defined`. tsx (esbuild)
  // rewrites the serialised in-page script to call a `__name` helper the page
  // has no definition for; vitest's transform does not, so every test that
  // calls `observe()` in-process is blind to it. The three launching sessions
  // learned this the same way and shim the helper with `addInitScript`; the
  // attached session did not, because it attaches to a context it did not
  // create. Vahid: *"Whatever you change, make the test fail first without
  // the fix — I do not want a fix I cannot prove."* This spawns the command
  // the person runs, under the transform the person runs it under.
  it("reads the gated page when run as `node --import tsx …inspect-attached-cli.ts`", async () => {
    const root = resolve(import.meta.dirname, "..", "..", "..");
    const outRoot = await mkdtemp(join(tmpdir(), "aas-attached-cli-"));
    const targetFile = join(outRoot, "fixture.json");
    await writeFile(
      targetFile,
      JSON.stringify({
        targetId: "fixture-attached",
        institutionName: "Gated University",
        courseName: "MSc Controlled Studies",
        intake: "2026-09",
        route: "direct_portal",
        routeNotes: [],
        allowedHosts: ["127.0.0.1"],
        seedUrls: [`${portal.baseUrl}/apply`],
        linkPatterns: ["apply"],
        maxPages: 1,
        claimsToVerify: [],
      }),
    );
    try {
      // Spawned ASYNCHRONOUSLY. The fixture portal is served by this very
      // process, and `spawnSync` would block the event loop that answers the
      // browser's requests — the command would then time out on its first
      // navigation and never reach the read, which is exactly what the first
      // version of this test did. Found the same way as the bug it exists for:
      // by the real command not doing what the in-process tests did.
      const result = await new Promise<{ status: number | null; out: string }>((done) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve(root, "apps", "browser-runner", "src", "inspect-attached-cli.ts"),
            targetFile,
            "--cdp",
            CDP,
            "--out",
            outRoot,
            `${portal.baseUrl}/apply`,
          ],
          { cwd: root, env: { ...process.env } },
        );
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
        const timer = setTimeout(() => child.kill(), 120_000);
        child.on("close", (status) => {
          clearTimeout(timer);
          done({ status, out });
        });
      });
      const out = result.out;
      expect(out, out).not.toContain("__name is not defined");
      expect(out).toContain("Pages read         1 of 1");
      expect(result.status, out).toBe(0);

      const runDir = (await readdir(outRoot)).map((name) => join(outRoot, name)).find((dir) => existsSync(join(dir, "run.json")));
      if (runDir === undefined) expect.unreachable(`no run directory written under ${outRoot}`);
      const draft = JSON.parse(await readFile(join(runDir, "blueprint.draft.json"), "utf8")) as {
        status: string;
        pages: { sections: { fields: { fieldRef: string }[] }[] }[];
      };
      expect(draft.status).toBe("draft");
      const refs = draft.pages.flatMap((page) => page.sections.flatMap((section) => section.fields.map((f) => f.fieldRef)));
      expect(refs).toEqual(expect.arrayContaining(["given_name", "family_name", "date_of_birth", "nationality"]));
      const html = await readFile(join(runDir, "pages", "001.html"), "utf8");
      expect(html).toContain('name="given_name"');
    } finally {
      await rm(outRoot, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("the capture is scrubbed of the person's values", () => {
  it("blanks input values and textarea bodies, and keeps select options", () => {
    const html =
      `<input type="text" name="given_name" value="Niloofar" required>` +
      `<input value='Hosseini' name="family_name">` +
      `<textarea name="statement">Because it is the course I want.</textarea>` +
      `<select name="nationality"><option value="IR">Iran</option></select>`;
    const scrubbed = scrubValues(html);
    expect(scrubbed).not.toContain("Niloofar");
    expect(scrubbed).not.toContain("Hosseini");
    expect(scrubbed).not.toContain("Because it is");
    expect(scrubbed).toContain('name="given_name" value=""');
    expect(scrubbed).toContain('<option value="IR">Iran</option>');
    expect(scrubbed).toContain("<textarea name=\"statement\"></textarea>");
  });
});
