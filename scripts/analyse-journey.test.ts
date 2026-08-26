/**
 * Tests for the journey analyser.
 *
 * Written after three bugs that all shared one shape: **a silent wrong answer
 * that read as a finding.**
 *
 *   1. `pages/index.json` is `{ pages: [...] }`, not a bare array, and `file`
 *      already carries the `pages/` prefix. Both readers swallowed the error
 *      and returned empty, so every page classified on no content at all — and
 *      the report still looked entirely plausible.
 *   2. A page was forced into ONE role, so a page that was both the
 *      application form and its registration got filed as registration, and its
 *      eight fields vanished from the application field list.
 *   3. A Salesforce static-resource rule ending `\.js$` sat above the CAPTCHA
 *      rule and swallowed `google.com/recaptcha/api.js` into "harmless
 *      framework noise" — filing a handoff we must never bypass as ignorable.
 *
 * A crash is recoverable. A confident wrong classification gets acted on.
 */

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "analyse-journey.ts");

let runDir: string;

/** A page that is the application form AND its registration, which is normal. */
const FORM_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Apply</title></head><body>
<h1>Create your account and start your application</h1>
<form>
  <label for="fn">First name</label><input id="fn" name="firstName">
  <label for="dob">Date of birth</label><input id="dob" name="dob" type="date">
  <label for="nat">Nationality</label><select id="nat" name="nationality"><option value="GB">UK</option></select>
  <label for="ps">Personal statement</label><textarea id="ps" name="personalStatement"></textarea>
  <label for="pw">Choose a password</label><input id="pw" name="password" type="password">
  <button type="submit">Submit application</button>
</form>
<p>Applicants must be aged 18 or over at the start of the course.</p>
</body></html>`;

const MARKETING_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Student life</title></head><body>
<h1>Student life in Birmingham</h1>
<form><label for="q">Search</label><input id="q" name="q"></form>
</body></html>`;

/**
 * Runs the analyser and returns its output with ANSI colour stripped.
 *
 * Stripping matters: the report interleaves escape codes mid-sentence
 * (`${BOLD}5${RESET} input(s)`), so a literal assertion against the raw output
 * fails for reasons that have nothing to do with the finding under test.
 */
async function run(dir: string): Promise<{ code: number; out: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn("npx", ["tsx", SCRIPT, dir], { cwd: join(import.meta.dirname, "..") });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) =>
      // eslint-disable-next-line no-control-regex -- stripping ANSI is the point
      resolvePromise({ code: code ?? -1, out: out.replace(/\u001b\[[0-9;]*m/g, "") }),
    );
  });
}

beforeAll(async () => {
  runDir = await mkdtemp(join(tmpdir(), "aas-journey-"));
  await mkdir(join(runDir, "pages"), { recursive: true });

  await writeFile(join(runDir, "pages", "001.html"), FORM_HTML);
  await writeFile(join(runDir, "pages", "002.html"), MARKETING_HTML);

  // The real shape: an object with a `pages` array, and `file` relative to the
  // RUN directory, already carrying the `pages/` prefix.
  await writeFile(
    join(runDir, "pages", "index.json"),
    JSON.stringify({
      runId: "disc-test-1",
      capturedAt: "2026-08-26T10:00:00.000Z",
      pages: [
        { url: "https://apply.example.test/s/application", file: "pages/001.html" },
        { url: "https://www.example.test/student-life", file: "pages/002.html" },
      ],
    }),
  );

  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({
      runId: "disc-test-1",
      target: {
        allowedHosts: ["example.test"],
        seedUrls: ["https://apply.example.test/s/login/", "https://www.example.test/"],
      },
      visited: ["https://apply.example.test/s/application", "https://www.example.test/student-life"],
      failed: [],
      blockedRequests: [
        { method: "POST", url: "https://apply.example.test/s/sfsites/aura?r=3&aura.Component" },
        { method: "POST", url: "https://apply.example.test/s/sfsites/aura?r=4&aura.Component" },
        { method: "GET", url: "https://www.google.com/recaptcha/api.js?render=explicit" },
        { method: "POST", url: "https://www.google-analytics.com/collect" },
        { method: "POST", url: "https://apply.example.test/services/apply/submitApplication" },
      ],
    }),
  );

  await writeFile(
    join(runDir, "blueprint.draft.json"),
    JSON.stringify({
      blueprintId: "bp-test",
      version: "0.1.0",
      status: "draft",
      institutionName: "Example University",
      courseName: "MSc Example",
      intake: "2026-09",
      route: "partner_portal",
      authentication: { required: true, accountCreationRequired: true, notes: "" },
      pages: [
        {
          pageRef: "page1",
          title: "Apply",
          url: "https://apply.example.test/s/application",
          sections: [
            {
              sectionRef: "s1",
              title: "About you",
              fields: [
                { fieldRef: "firstName", label: "First name", inputType: "text", locators: [], validations: [{ kind: "required" }] },
                { fieldRef: "dob", label: "Date of birth", inputType: "date", locators: [], validations: [{ kind: "required" }] },
                { fieldRef: "personalStatement", label: "Personal statement", inputType: "textarea", locators: [], validations: [{ kind: "required" }] },
                { fieldRef: "transcript", label: "Academic transcript", inputType: "file", locators: [], validations: [{ kind: "required" }] },
              ],
            },
          ],
          requiredDocuments: [],
        },
        {
          pageRef: "page2",
          title: "Student life",
          url: "https://www.example.test/student-life",
          sections: [
            {
              sectionRef: "s2",
              title: "",
              fields: [
                { fieldRef: "q", label: "Search", inputType: "text", locators: [], validations: [] },
              ],
            },
          ],
          requiredDocuments: [],
        },
      ],
      handoffPoints: [],
      provenance: {
        discoveryRunId: "disc-test-1",
        discoveredAt: "2026-08-26T10:00:00.000Z",
        observedUrls: [],
        unobservedClaims: [],
      },
      observedSignals: [
        { kind: "account_creation", evidence: "a password field and a create-account heading", url: "https://apply.example.test/s/application" },
        { kind: "login", evidence: "input[type=password]", url: "https://apply.example.test/s/application" },
        { kind: "submission", evidence: "button[type=submit]", url: "https://apply.example.test/s/application" },
      ],
    }),
  );
});

afterAll(async () => {
  await rm(runDir, { recursive: true, force: true });
});

describe("the journey analyser, run for real", () => {
  it("reads the captured pages at all", async () => {
    const { code, out } = await run(runDir);
    expect(code).toBe(0);
    // Content-based evidence only appears if the HTML was actually read. Bug 1
    // made every page classify on an empty string while looking fine.
    expect(out).toContain('the page says "personal statement"');
  }, 60_000);

  it("treats a page as BOTH the form and its registration", async () => {
    // Bug 2. A portal putting sign-up on page one of the form is normal, and
    // forcing one role dropped the form's fields from the mapping list.
    const { out } = await run(runDir);
    expect(out).toContain("application_form + account_creation + login");
  }, 60_000);

  it("counts the form's fields as application fields, not site noise", async () => {
    const { out } = await run(runDir);
    expect(out).toContain("5 input(s) were found across the whole crawl");
    // Four on the form, one site-search box excluded.
    expect(out).toContain("4 are on a page classified as the application");
    expect(out).toContain("Required (4)");
    expect(out).toContain("personalStatement");
    // The site-search box must NOT be counted as an application field.
    expect(out).not.toContain("Required (5)");
  }, 60_000);

  it("does NOT file a CAPTCHA as harmless framework noise", async () => {
    // Bug 3, and the one that mattered most: a CAPTCHA is a handoff we must
    // never bypass, and burying it in a bucket labelled "expected on
    // Salesforce" is how it stops being reviewed.
    const { out } = await run(runDir);
    const captchaLine = out.split("\n").find((line) => line.includes("recaptcha"));
    expect(captchaLine).toBeDefined();
    expect(out).toContain("bot_defence");
  }, 60_000);

  it("separates Salesforce Aura RPC from a genuine submit endpoint", async () => {
    const { out } = await run(runDir);
    expect(out).toContain("framework_rpc");
    expect(out).toContain("possibly_consequential");
    expect(out).toContain("submitApplication");
  }, 60_000);

  it("finds the apply host from the target's seeds, not a hardcoded subdomain", async () => {
    const { out } = await run(runDir);
    expect(out).not.toContain("The apply host was not reached at all");
  }, 60_000);

  it("quotes the age wording it found rather than paraphrasing it", async () => {
    const { out } = await run(runDir);
    expect(out).toContain("aged 18 or over");
  }, 60_000);

  it("says a minor is not automatically blocked", async () => {
    const { out } = await run(runDir);
    expect(out).toContain("NOT an automatic blocker");
  }, 60_000);

  it("REFUSES a run whose captured pages are missing", async () => {
    // The failure mode that produced bug 1. A missing capture must crash, not
    // quietly classify everything as marketing.
    const broken = await mkdtemp(join(tmpdir(), "aas-journey-broken-"));
    await mkdir(join(broken, "pages"), { recursive: true });
    await writeFile(
      join(broken, "pages", "index.json"),
      JSON.stringify({ pages: [{ url: "https://x.test/a", file: "pages/nope.html" }] }),
    );
    await writeFile(
      join(broken, "run.json"),
      JSON.stringify({
        runId: "r",
        target: { allowedHosts: [], seedUrls: [] },
        visited: ["https://x.test/a"],
        failed: [],
        blockedRequests: [],
      }),
    );
    await writeFile(
      join(broken, "blueprint.draft.json"),
      JSON.stringify({
        blueprintId: "b",
        version: "0.1.0",
        status: "draft",
        institutionName: "X",
        route: "partner_portal",
        authentication: { required: false, accountCreationRequired: false, notes: "" },
        pages: [],
        handoffPoints: [],
        provenance: { discoveryRunId: "r", discoveredAt: "", observedUrls: [], unobservedClaims: [] },
      }),
    );

    const { code, out } = await run(broken);
    expect(code).not.toBe(0);
    expect(out).toContain("Captured page missing");
    await rm(broken, { recursive: true, force: true });
  }, 60_000);
});
