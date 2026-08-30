/**
 * Turning a blueprint locator into a Playwright one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Extracted from `apps/browser-runner` by ADR-0042, because two processes in
 * two different trust boundaries now resolve the SAME locator: the runner, for
 * ordinary form fields, and the Secure Plane's fill agent, for the one field a
 * password goes into.
 *
 * Copying it into the agent was the obvious alternative and the wrong one. The
 * question "which element does this blueprint mean" is security-relevant on the
 * agent's side — the answer decides where a password is typed — and two
 * implementations of it would eventually disagree in some corner (`role:` with
 * a colon in the name, an id needing escaping), with no test able to notice
 * because each copy would be tested against itself.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { Locator, Page } from "playwright";

/**
 * How long to wait for a field.
 *
 * Short, deliberately. On the secret path the field's existence is established
 * before the secret is spent, and Playwright's thirty-second default would mean
 * half a minute of a live password sitting in scope waiting for a field that is
 * not coming.
 */
export const FIELD_TIMEOUT_MS = 5_000;

/**
 * Translates a blueprint locator into a Playwright one.
 *
 * `role` is encoded as `role:name` in the blueprint (e.g. `button:Continue`),
 * because a role on its own rarely identifies one control.
 */
export function toPlaywrightLocator(page: Page, locator: FieldLocator): Locator | null {
  switch (locator.strategy) {
    case "label":
      return page.getByLabel(locator.value, { exact: false });
    case "placeholder":
      return page.getByPlaceholder(locator.value, { exact: false });
    case "name":
      return page.locator(`[name=${JSON.stringify(locator.value)}]`);
    case "id":
      return page.locator(`#${cssEscape(locator.value)}`);
    case "css":
      return page.locator(locator.value);
    case "role": {
      const [role, ...rest] = locator.value.split(":");
      const name = rest.join(":");
      if (role === undefined || role.length === 0) return null;
      return name.length > 0
        ? page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
        : page.getByRole(role as Parameters<Page["getByRole"]>[0]);
    }
  }
}

/** Escapes an id for use in a CSS selector. */
function cssEscape(value: string): string {
  return value.replace(/([^\w-])/g, "\\$1");
}
