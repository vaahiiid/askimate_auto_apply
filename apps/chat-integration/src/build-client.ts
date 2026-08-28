/**
 * Bundles the React chat client into a single script the browser tests serve.
 *
 * Lives inside the app rather than in `scripts/` because the browser tests
 * import it, and `tsc`'s project references will not let a file under
 * `apps/chat-integration/src` reach outside its own `rootDir`.
 *
 * ── Why a build step exists at all now ────────────────────────────────────
 *
 * The vanilla harness needed none: it was a plain `<script>` a browser could
 * load directly. The React client is TypeScript and JSX, so something has to
 * turn it into what a browser runs. esbuild does it in one call and is already
 * present in the workspace as vite's own bundler, so this adds a script rather
 * than a technology.
 *
 * ── Why the output is not committed ───────────────────────────────────────
 *
 * A committed bundle is a second copy of the client that can be stale, and the
 * whole point of retiring the vanilla harness was to stop having two clients.
 * The browser tests call `buildChatClient()` in `beforeAll` and serve what it
 * produces, so what is tested is always built from the sources in the tree.
 */

import { build } from "esbuild";

export interface BuildResult {
  readonly outfile: string;
}

/**
 * @param outfile Where to write the bundle. The browser tests point this at a
 *   temporary directory that is also the static root, so nothing lands in the
 *   repository.
 */
export async function buildChatClient(outfile: string): Promise<BuildResult> {
  await build({
    entryPoints: [new URL("./browser-entry.tsx", import.meta.url).pathname],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    // Development React, deliberately. `SecureControl.test.tsx` walks the fibre
    // tree for a typed password, and a production build renames the very
    // internals that test reads. The browser tests scan the live page for the
    // same marker, so the build they scan has to be the one where those
    // internals are present and findable — otherwise "not found" would mean
    // "minified away" rather than "not there".
    jsxDev: true,
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
  });
  return { outfile };
}

