/**
 * Bundles the secure control's script, and writes its stylesheet.
 *
 * The document's CSP is `script-src 'self'`, so the control cannot be an inline
 * block — it must be a file this origin serves. That is deliberate: allowing
 * `'unsafe-inline'` to save one request would re-admit exactly the class of
 * script the Secure Plane exists to exclude.
 *
 * Not committed, for the same reason the chat client's bundle is not: a
 * committed bundle is a second copy that can be stale, and the browser tests
 * build from the sources in the tree so what is tested is what is written.
 */

import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function buildSecureControl(outDir: string): Promise<void> {
  await build({
    entryPoints: [new URL("./control-client.ts", import.meta.url).pathname],
    outfile: join(outDir, "control.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  // Plain, unbranded, and deliberately not a design. What matters here is the
  // origin the document is served from, not how it looks.
  await writeFile(
    join(outDir, "control.css"),
    `body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; }
h2 { font-size: 1rem; margin: 0 0 .25rem; }
p { margin: .25rem 0; font-size: .9rem; }
label { display: block; margin-top: .5rem; font-size: .85rem; }
input { width: 100%; padding: .4rem; box-sizing: border-box; }
button { margin-top: .5rem; margin-right: .5rem; padding: .4rem .8rem; }
#secure-error { color: #b91c1c; }
`,
    "utf8",
  );
}
