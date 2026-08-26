/**
 * The native shadow DOM regression.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The observer passed every test against the flattened capture while getting
 * the LIVE portal wrong, and the two could not be told apart from a saved
 * page: `page.content()` flattens shadow content when it serialises.
 *
 * The trace of `insp-…2026-08-26T18-10-46` recorded the live DOM as
 * `["template", {"__playwright_shadow_root_": "open"}, …]` around every
 * `lightning-input` — real, open shadow roots. `Element.parentElement` stops
 * at that boundary, so the asterisk walk never reached the marker sitting
 * beside the field wrapper in the light DOM.
 *
 * Live consequence: Date of Birth and the applicant-type combobox reported
 * `not_observed` against a screenshot showing both asterisked (7 required
 * instead of 9), and the marketing checkbox group came back with no label
 * because its `<legend>` is inside its own shadow root.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightInspectionSession } from "./playwright-inspection-session.js";
import type { LwcObservation } from "./lwc-observe-script.js";

const PORT = 4324;
let server: Server;
let traceDir: string;
let observation: LwcObservation;

beforeAll(async () => {
  const html = await readFile(
    join(import.meta.dirname, "..", "fixtures", "lwc-shadow", "shadow-registration.html"),
    "utf8",
  );
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  traceDir = await mkdtemp(join(tmpdir(), "aas-shadow-"));

  const session = await PlaywrightInspectionSession.open({
    runId: "shadow-fixture-1",
    capability: "read_only",
    allowedHosts: ["127.0.0.1"],
    traceDir,
    navigableUrlPatterns: [/^http:\/\/127\.0\.0\.1:4324\//],
  });
  try {
    await session.goto(`http://127.0.0.1:${String(PORT)}/s/login/SelfRegister`);
    await session.settle(3_000);
    observation = await session.observeLwc();
  } finally {
    await session.close();
  }
}, 90_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(traceDir, { recursive: true, force: true });
});

const find = (label: string) => observation.controls.find((control) => control.label === label);

describe("reading controls through real shadow roots", () => {
  it("confirms the fixture really does use shadow DOM", async () => {
    // Otherwise this whole file silently tests the flattened case again.
    const html = await readFile(
      join(import.meta.dirname, "..", "fixtures", "lwc-shadow", "shadow-registration.html"),
      "utf8",
    );
    expect(html).toContain("attachShadow");
    expect(html).toContain('mode: "open"');
  });

  it("finds every control despite two nested shadow boundaries", () => {
    expect(observation.controls.map((control) => control.label)).toEqual(
      expect.arrayContaining(["First Name", "Date of Birth", "Middle Name"]),
    );
  });

  it("reads required from the light-dom asterisk ACROSS the boundary", () => {
    // The bug. The marker is two shadow roots above the input, in the light
    // dom, and parentElement stops before reaching it.
    const dob = find("Date of Birth");
    expect(dob?.required).toBe(true);
    expect(dob?.requiredSource).toBe("asterisk_marker");
  });

  it("still reads required straight off the attribute where it exists", () => {
    const first = find("First Name");
    expect(first?.required).toBe(true);
    expect(first?.requiredSource).toBe("required_attribute");
  });

  it("does NOT mark an unmarked field required", () => {
    // The walk crosses boundaries now, so it must not go on to borrow a
    // neighbour's asterisk.
    const middle = find("Middle Name");
    expect(middle?.required).toBe(false);
    expect(middle?.requiredSource).toBe("not_observed");
  });

  it("reads a legend out of the component's OWN shadow root", () => {
    const group = observation.controls.find((control) => control.kind === "checkbox_group");
    expect(group?.label).toBe("Would like to receive marketing content?");
    expect(group?.required).toBe(false);
  });

  it("records the component ancestry across boundaries", () => {
    const dob = find("Date of Birth");
    expect(dob?.componentPath.join(" > ")).toContain("lightning-input");
  });

  it("still offers the data-id locator from the light-dom host", () => {
    expect(find("Date of Birth")?.locators[0]).toBe('[data-id="dateOfBirth"]');
  });
});
