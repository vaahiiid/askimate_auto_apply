/**
 * The two browser bundles the local stack serves (P121).
 *
 * The student's page is served by the Conversation Service from
 * `AAS_PUBLIC_DIR`, and the secure control by the Secure Service from
 * `AAS_SECURE_ASSET_DIR`; both are built, never committed (ADR-0060, and the
 * reasoning at the top of each builder). P120's script started the five
 * processes without either — the API answered and the runbook read as
 * complete — and P121's journey through those processes found the frame
 * could not mount: there was no page to mount it in. This is the step that
 * builds both, with the same two functions the browser tests build from.
 *
 *   tsx scripts/local-stack-assets.ts <public dir> <secure asset dir>
 */

import { mkdir } from "node:fs/promises";

import { buildStudentClient } from "@askimate/aas-conversation-service";
import { buildSecureControl } from "@askimate/aas-secure-service";

const [publicDir, secureAssetDir] = process.argv.slice(2);
if (publicDir === undefined || secureAssetDir === undefined) {
  process.stderr.write("usage: local-stack-assets.ts <public dir> <secure asset dir>\n");
  process.exit(2);
}
await mkdir(publicDir, { recursive: true });
await mkdir(secureAssetDir, { recursive: true });
await buildStudentClient(publicDir);
await buildSecureControl(secureAssetDir);
process.stdout.write(`built the student page into ${publicDir} and the secure control into ${secureAssetDir}\n`);
