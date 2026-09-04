/**
 * Bundles the student's page, and writes the document and stylesheet beside it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0060. The same shape as `secure-service/src/build-control.ts`, because
 * the same rule applies: a plane's browser client is built by the app that
 * serves its origin, and the output is served by that app's `express.static`.
 * Point `AAS_PUBLIC_DIR` at whatever directory this writes into.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Not committed, for the reason the secure control's bundle is not: a
 * committed bundle is a second copy that can be stale, and the tests build
 * from the sources in the tree so what is tested is what is written.
 */

import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The page.
 *
 * Deliberately plain, and deliberately EMPTY of content: every sentence a
 * student reads comes from the server — their conversation's messages, the
 * server's rendering of an offer, the server's preview. What is here is the
 * shape those go into. A visual design should be able to replace all of it
 * without touching `journey.ts`.
 *
 * No inline script. The bundle is a file this origin serves, which is what
 * lets a deployment set a `script-src 'self'` policy in front of it — the same
 * reason the secure control's script is a separate file.
 */
const DOCUMENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<title>Your application</title>
<link rel="stylesheet" href="/journey.css">
</head>
<body>
<main>
  <p id="notice" role="status"></p>
  <section id="targets"></section>
  <section id="offer"></section>
  <section id="pending"></section>
  <ul id="transcript"></ul>
  <section id="secure"></section>
  <form id="composer" autocomplete="off">
    <!--
      UNCONTROLLED, and that is a security choice. The residual risk this whole
      design minimises is a student typing their password into the ordinary box
      by mistake; an uncontrolled input keeps that text a DOM value nothing
      snapshots, where component state would be readable by an error boundary
      or a state-serialising reporter.
    -->
    <input id="say" name="say" type="text" autocomplete="off" placeholder="Type a message">
    <button type="submit">Send</button>
  </form>
  <p id="composer-hint"></p>
</main>
<script src="/journey.js"></script>
</body>
</html>
`;

const STYLESHEET = `:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; }
main { max-width: 44rem; margin: 0 auto; }
h2 { font-size: 1rem; margin: 1rem 0 .25rem; }
pre { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: .85rem;
      border: 1px solid currentColor; padding: .75rem; }
#transcript { list-style: none; padding: 0; max-height: 24rem; overflow-y: auto; }
.msg { padding: .4rem .6rem; margin: .3rem 0; border-radius: .4rem; border: 1px solid currentColor; }
.msg.student { margin-left: 4rem; }
.msg.assistant { margin-right: 4rem; }
.target { border: 1px solid currentColor; padding: .6rem; margin: .4rem 0; }
.warn { font-size: .85rem; }
.position { font-size: .85rem; }
button { padding: .4rem .8rem; margin: .25rem .25rem .25rem 0; }
button.quiet { opacity: .75; }
textarea, #say { width: 100%; padding: .4rem; box-sizing: border-box; }
.secure-frame { width: 100%; height: 18rem; border: 1px solid currentColor; }
#notice:empty { display: none; }
`;

/** Writes `journey.js`, `journey.css` and `index.html` into `outDir`. */
export async function buildStudentClient(outDir: string): Promise<void> {
  await build({
    entryPoints: [new URL("./client/journey.ts", import.meta.url).pathname],
    outfile: join(outDir, "journey.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  await writeFile(join(outDir, "journey.css"), STYLESHEET, "utf8");
  await writeFile(join(outDir, "index.html"), DOCUMENT, "utf8");
}
