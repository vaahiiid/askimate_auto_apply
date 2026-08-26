#!/usr/bin/env bash
#
# One command: set up, run read-only discovery against the real portal, and
# produce a zip to send back.
#
#   ./scripts/discover.sh                # the Ulster Birmingham target
#   ./scripts/discover.sh <target-name>  # any file in targets/
#
# ── What this does ────────────────────────────────────────────────────────
#
# Opens the permitted hosts READ-ONLY, records what the pages contain, saves
# each page's HTML, takes screenshots and a Playwright trace, and writes a
# DRAFT blueprint. It cannot fill, click or submit — every request is
# intercepted and anything that is not a safe, idempotent read on an
# allow-listed host is aborted, including requests the portal's own JavaScript
# makes (ADR-0014).
#
# It creates no account, enters no data, and bypasses nothing.

set -euo pipefail

TARGET="${1:-ulster}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

# ── 1. Node ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Install Node 22 or newer (https://nodejs.org) and re-run." >&2
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "Node $(node --version) is too old — this needs 22 or newer." >&2
  exit 1
fi
say "Node $(node --version)"

# ── 2. pnpm ───────────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  dim "Enabling pnpm via corepack…"
  corepack enable >/dev/null 2>&1 || {
    echo "Could not enable corepack. Run 'sudo corepack enable' once, then re-run this." >&2
    exit 1
  }
fi
say "pnpm $(pnpm --version)"

# ── 3. Dependencies ───────────────────────────────────────────────────────
say "Installing dependencies (about a minute the first time)…"
pnpm install --silent

say "Installing Chromium for Playwright…"
pnpm --filter @askimate/aas-browser-runner exec playwright install chromium

# ── 4. Discovery ──────────────────────────────────────────────────────────
say "Running discovery — read-only, cannot fill, click or submit"

# A run that reaches no pages exits non-zero. That is a real finding (usually
# the hosts are unreachable) and the output is still worth sending, so it is
# reported rather than aborting the script.
set +e
pnpm run discover "$TARGET"
DISCOVERY_STATUS=$?
set -e

RUN_DIR="$(ls -1dt discovery-runs/*/ 2>/dev/null | head -1 || true)"
if [ -z "$RUN_DIR" ]; then
  echo "Discovery produced no output directory. Send me everything printed above." >&2
  exit 1
fi
RUN_DIR="${RUN_DIR%/}"

# ── 5. What it found ──────────────────────────────────────────────────────
say "Reading the run back"
set +e
pnpm run inspect-discovery "$RUN_DIR"
set -e

# ── 6. Zip ────────────────────────────────────────────────────────────────
ZIP="$ROOT/$(basename "$RUN_DIR").zip"
rm -f "$ZIP"
( cd discovery-runs && zip -qr "$ZIP" "$(basename "$RUN_DIR")" )

say "Done"
echo "  Run directory:  $RUN_DIR"
echo "  Send me:        $ZIP"
echo
dim "  Before sending, have a quick look at $RUN_DIR/pages/*.html — discovery never"
dim "  logs in, so nothing personal should be in there, but a capture is worth"
dim "  thirty seconds of checking."

if [ "$DISCOVERY_STATUS" -ne 0 ]; then
  echo
  echo "  Discovery exited non-zero — usually 'no pages reached'. Send the zip anyway;"
  echo "  run.json records exactly which URL failed and why, which is itself a finding."
fi
