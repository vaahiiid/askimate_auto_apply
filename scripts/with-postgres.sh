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
#                            be re-implementing the thing under test. And (P1)
#                            the conversation ↔ case binding, plus a real
#                            restart that resumes a run rather than restarting
#                            it.
#   apps/secure-service    — that no column in that schema can hold a secret,
#                            read from information_schema after migrating;
#                            (ADR-0042) the whole path from the student's
#                            submission through the fill agent to a real field,
#                            with every HTTP body on every wire scanned; and
#                            (P6) a REAL account created on the gated portal,
#                            proved by asking the portal whether the student's
#                            password lets them in.
#   apps/secure-filler     — the fill agent against a real Chromium reached over
#                            real CDP. No database of its own, deliberately.
#   scripts/journey        — P7. The whole journey across four planes and two
#                            databases: a student asks, is interviewed, types a
#                            password into the Secure Plane, and a runner creates
#                            their account on a real portal. Nothing else in the
#                            repository crosses all of them at once.
#   scripts/runner-supervisor — P16. Two real runner supervisors against one
#                            real Conversation Service: competing claims,
#                            duplicate polling, a lease lapsing under a dead
#                            runner, and a report refused because somebody else
#                            now holds the run. All four are decided by
#                            PostgreSQL, which is why a fake proves none of them.
#   scripts/p20-catalogue  — P20. A catalogue on disk, and real processes that
#                            refuse to start on an entry nobody approved.
#   scripts/p21-target-selection — P21. The two gates (ADR-0058) over a real
#                            catalogue loaded through P20's registry: a case
#                            opens only when the student names the hash of an
#                            offer this server actually made them, here.
#   scripts/p19-identity   — P19. A REAL OpenID Provider on loopback, in both
#                            standard claim shapes, and what each of the four
#                            verification outcomes persists.
#   scripts/p18-startup    — P18. The five deployables started as REAL child
#                            processes: what they refuse, what they print, and
#                            the Secure Service and Fill Agent sharing one
#                            Redis. Set AAS_TEST_REDIS_URL for the last group.
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
  AAS_REQUIRE_DATABASE=1 pnpm exec vitest run apps/chat-integration apps/conversation-service apps/secure-service apps/secure-filler packages/case-store packages/orchestrator scripts/journey.test.ts scripts/runner-supervisor.test.ts scripts/p18-startup.test.ts scripts/p19-identity.test.ts scripts/p20-catalogue.test.ts scripts/p21-target-selection.test.ts
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
pnpm exec vitest run apps/chat-integration apps/conversation-service apps/secure-service apps/secure-filler packages/case-store packages/orchestrator scripts/journey.test.ts scripts/runner-supervisor.test.ts scripts/p18-startup.test.ts scripts/p19-identity.test.ts scripts/p20-catalogue.test.ts scripts/p21-target-selection.test.ts
