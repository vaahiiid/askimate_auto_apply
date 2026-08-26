#!/usr/bin/env bash
#
# Controlled inspection of the QA Higher Education portal.
#
#   ./scripts/inspect.sh              # the Ulster Birmingham entry point
#   ./scripts/inspect.sh <target>
#
# Renders the portal's real Salesforce interface and captures it. It creates
# nothing, signs in to nothing, types nothing, uploads nothing and submits
# nothing — the session has no method to do any of those (ADR-0024).
#
# Before touching the real portal this re-proves the safety properties against
# the hostile local fixture. If that fails, nothing goes near the portal.

set -euo pipefail

TARGET="${1:-ulster}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || {
  echo "pnpm unavailable. Run 'sudo corepack enable' once, then re-run." >&2; exit 1; }

say "Installing dependencies…"
pnpm install --silent
pnpm --filter @askimate/aas-browser-runner exec playwright install chromium

# ── The gate ──────────────────────────────────────────────────────────────
say "Proving the safety properties against the hostile fixture"
dim "Application creation, data persistence, submission, file upload,"
dim "self-navigation to a consequential endpoint, non-cacheable Apex, PUT/PATCH/DELETE."
if ! pnpm exec vitest run apps/browser-runner/src/inspection.test.ts; then
  echo >&2
  echo "SAFETY PROOF FAILED. Not going near the real portal." >&2
  exit 1
fi

say "Safety proof passed. Inspecting the real portal."
set +e
pnpm run inspect "$TARGET"
STATUS=$?
set -e

RUN_DIR="$(ls -1dt inspection-runs/*/ 2>/dev/null | head -1 || true)"
if [ -z "$RUN_DIR" ]; then
  echo "No output directory produced. Send me everything printed above." >&2
  exit 1
fi
RUN_DIR="${RUN_DIR%/}"

ZIP="$ROOT/$(basename "$RUN_DIR").zip"
rm -f "$ZIP"
( cd inspection-runs && zip -qr "$ZIP" "$(basename "$RUN_DIR")" )

say "Done"
echo "  Run directory:  $RUN_DIR"
echo "  Send me:        $ZIP"
echo
dim "  Have a quick look at $RUN_DIR/pages/*.html before sending."
dim "  Nothing was created, signed into, filled, uploaded or submitted."

[ "$STATUS" -ne 0 ] && echo && echo "  The run exited non-zero — send the zip anyway; inspection.json records why."
exit 0
