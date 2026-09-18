/**
 * What the runner presents to a portal, named once (ADR-0128).
 *
 * `sign-in.ts`, `create-account.ts` and `session-hold.ts` open their contexts
 * with this user agent and Playwright's default viewport. The `--as-runner`
 * read presents the same, so "the page the runner sees" is the page this
 * describes and not a guess at it; `sign-in-settle.test.ts` pins the two
 * together so they cannot drift apart silently.
 *
 * In a module of its own because the CLI that uses it runs `main()` on import,
 * and a test that wanted the constant would otherwise run the command.
 */
import type { FieldLocator } from "@askimate/aas-blueprint";

export const RUNNER_PRESENTS = {
  userAgent: "AskiMate-Runner/1.0",
  viewport: { width: 1280, height: 720 },
} as const;

/** `id=signIn`, `name=loginBtn`, `label=Sign in`: one control to read the point of. */
export function parseCoveringLocator(typed: string): FieldLocator | null {
  const at = typed.indexOf("=");
  if (at <= 0) return null;
  const strategy = typed.slice(0, at);
  const value = typed.slice(at + 1);
  if (value.length === 0) return null;
  if (strategy !== "id" && strategy !== "name" && strategy !== "label" && strategy !== "css") return null;
  return { strategy, value };
}
