/**
 * The replay harness.
 *
 * Serves pages captured during a discovery run from `127.0.0.1`, so the whole
 * chain — interview, mapping, fill, validate, preview, authorise — can be
 * driven end to end against **what the portal really looks like**, with nothing
 * live involved.
 *
 * ── Why this matters more than it sounds ──────────────────────────────────
 *
 * The alternative is debugging fill logic against a live admissions system:
 * every iteration creates or modifies a real record, every mistake is visible
 * to the university, and there is no undo. A replay costs nothing per run, can
 * be re-run a hundred times, and is deterministic — the same page every time,
 * so a failing test stays failing until it is fixed rather than depending on
 * what the portal happened to serve.
 *
 * ── What a replay is NOT ──────────────────────────────────────────────────
 *
 * Static HTML. It does not have the portal's server behind it, so anything the
 * portal computes — validation responses, conditional pages that depend on
 * saved state, a session that expires — does not happen. A replay proves the
 * fill logic can drive the page. It does not prove the application would be
 * accepted, and a run against it must never be described as an end-to-end
 * application.
 *
 * Requests the captured page makes to third parties (analytics, fonts, a CDN)
 * simply 404 here. That is correct: the host allow-list would refuse them on a
 * live run too.
 */

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/** One captured page. */
export interface CapturedPage {
  /** The URL it was captured from. */
  readonly url: string;
  /** The file it was written to, relative to the capture directory. */
  readonly file: string;
  readonly capturedAt: string;
}

export interface CaptureIndex {
  readonly runId: string;
  readonly capturedAt: string;
  readonly pages: readonly CapturedPage[];
}

export interface ReplayServer {
  readonly baseUrl: string;
  /** Maps an originally-captured URL onto its address on this server. */
  addressOf(originalUrl: string): string | null;
  /** Every request the replay received, so a run can be checked afterwards. */
  readonly requests: readonly { readonly method: string; readonly path: string }[];
  stop(): Promise<void>;
}

/**
 * Starts a replay server over a discovery run's output directory.
 *
 * Pages are addressed by the PATH of the URL they were captured from, so a
 * blueprint's recorded URLs map across by swapping the origin — which keeps the
 * blueprint usable against the replay without rewriting it. A rewritten
 * blueprint would be a different blueprint, and testing against it would prove
 * less than it appears to.
 */
export async function startReplayServer(captureDir: string): Promise<ReplayServer> {
  // The index lives in `pages/` alongside the captured HTML, and its `file`
  // entries are relative to the capture directory itself — which is a discovery
  // run's output directory, so a replay is started by pointing at a run.
  const index = JSON.parse(
    await readFile(join(captureDir, "pages", "index.json"), "utf8"),
  ) as CaptureIndex;

  const byPath = new Map<string, string>();
  for (const page of index.pages) {
    byPath.set(pathOf(page.url), join(captureDir, page.file));
  }

  const requests: { method: string; path: string }[] = [];

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    requests.push({ method: request.method ?? "GET", path });

    // A replay serves pages. It does not accept writes, because there is
    // nothing behind it that could store one — and pretending otherwise would
    // let a run appear to save a draft that went nowhere.
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain" });
      response.end("This is a replay of a captured portal. It cannot accept writes.");
      return;
    }

    const file = byPath.get(path);
    if (file === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end(`No captured page for ${path}.`);
      return;
    }

    void readFile(file, "utf8").then(
      (html) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
      },
      (error: unknown) => {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end(error instanceof Error ? error.message : String(error));
      },
    );
  });

  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The replay server did not bind a port."));
        return;
      }
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });

  return {
    baseUrl,
    addressOf(originalUrl: string): string | null {
      const path = pathOf(originalUrl);
      return byPath.has(path) ? `${baseUrl}${path}` : null;
    },
    get requests() {
      return [...requests];
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}
