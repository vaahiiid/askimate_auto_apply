#!/usr/bin/env bash
#
# Runs every database-backed test suite against a REAL PostgreSQL.
#
#   apps/chat-integration  — a student's password reaches no database column,
#                            no log and no model prompt. The assertion is "scan
#                            every column of every row", which a fake makes
#                            vacuous.
#   apps/conversation-service — the CHECK constraints that make a secure event
#                            unable to hold what a student typed. A fake would
#                            be re-implementing the thing under test.
#   apps/secure-service    — that no column in that schema can hold a secret,
#                            read from information_schema after migrating; and
#                            (ADR-0042) the whole path from the student's
#                            submission through the fill agent to a real field,
#                            with every HTTP body on every wire scanned.
#   apps/secure-filler     — the fill agent against a real Chromium reached over
#                            real CDP. No database of its own, deliberately.
#   packages/case-store    — optimistic concurrency and duplicate-submission
#                            prevention. Both are enforced by CONSTRAINTS
#                            (PRIMARY KEY), so a fake would be re-implementing
#                            the thing under test.
#
# If $AAS_TEST_DATABASE_URL is already set, this uses it and starts nothing.
# Otherwise it starts a throwaway cluster on port 55432, runs the tests, and
# stops it again.
set -euo pipefail

if [ -n "${AAS_TEST_DATABASE_URL:-}" ]; then
  echo "Using AAS_TEST_DATABASE_URL"
  AAS_REQUIRE_DATABASE=1 pnpm exec vitest run apps/chat-integration apps/conversation-service apps/secure-service apps/secure-filler packages/case-store packages/orchestrator
  exit $?
fi

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/aas-pgdata}"
PGPORT=55432

if [ ! -x "$PGBIN/initdb" ]; then
  echo "No PostgreSQL binaries at $PGBIN." >&2
  echo "Install PostgreSQL 16, or point AAS_TEST_DATABASE_URL at a database." >&2
  exit 1
fi

started_here=0
if ! pg_isready -h /tmp -p "$PGPORT" >/dev/null 2>&1; then
  echo "Starting a throwaway PostgreSQL on port $PGPORT…"
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  # initdb refuses to run as root, so the cluster is owned by the postgres user
  # when this script is run as root (which is the case in the CI container).
  if [ "$(id -u)" -eq 0 ]; then
    chown -R postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/aas-pg.log -o '-p $PGPORT -k /tmp' start" >/dev/null
  else
    "$PGBIN/initdb" -D "$PGDATA" -A trust -U postgres >/dev/null
    "$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/aas-pg.log -o "-p $PGPORT -k /tmp" start >/dev/null
  fi
  started_here=1
  for _ in $(seq 1 30); do
    pg_isready -h /tmp -p "$PGPORT" >/dev/null 2>&1 && break
    sleep 1
  done
fi

cleanup() {
  if [ "$started_here" -eq 1 ]; then
    if [ "$(id -u)" -eq 0 ]; then
      su postgres -c "$PGBIN/pg_ctl -D $PGDATA -m immediate stop" >/dev/null 2>&1 || true
    else
      "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

# AAS_REQUIRE_DATABASE=1 turns a skip into a failure. A run of this script that
# quietly skipped would be worse than not running it.
export AAS_TEST_DATABASE_URL="postgresql://postgres@localhost:$PGPORT/postgres"
export AAS_REQUIRE_DATABASE=1
pnpm exec vitest run apps/chat-integration apps/conversation-service apps/secure-service apps/secure-filler packages/case-store packages/orchestrator
