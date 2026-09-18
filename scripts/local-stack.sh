#!/usr/bin/env bash
#
# The local stack (P120): the five deployables, on one machine, against a
# Postgres and a Redis you already run — migrated, started, checked, stopped.
#
#   scripts/local-stack.sh start     create the two databases if absent, migrate
#                                    both, build the student page and the secure
#                                    control, start the five processes, wait
#                                    until each says it is up, print where they are
#   scripts/local-stack.sh status    which are running, and whether they answer
#   scripts/local-stack.sh stop      SIGTERM each, wait for an orderly exit
#   scripts/local-stack.sh finish-stopped <conversationId>
#                                    ADR-0126: finishes a case whose stop was
#                                    recorded before the stop could finish it.
#                                    Refuses any case not at WINDING_DOWN, and
#                                    concludes only when nothing is outstanding —
#                                    the same guard every other path goes through.
#
# Configuration, all by environment, all optional except where a value names
# something only you know:
#
#   AAS_LOCAL_DIR                  state: env files, pids, logs, the two built
#                                  browser bundles                  (.local-stack)
#   AAS_LOCAL_ADMIN_DATABASE_URL   a Postgres admin URL, used to create the two
#                                  databases and never printed
#                                  (postgresql://postgres@127.0.0.1:5432/postgres)
#   AAS_LOCAL_REDIS_URL            the cache the Secure Service and the Fill
#                                  Agent SHARE (redis://127.0.0.1:6379)
#   AAS_LOCAL_PORT_BASE            conversation=base, secure=base+1, agent=base+2,
#                                  the runner's browser CDP=base+9        (4870)
#   AAS_LOCAL_DB_PREFIX            <prefix>_conversation, <prefix>_secure (aas_local)
#   AAS_LOCAL_CATALOGUE            fixtures | registry                  (fixtures)
#   AAS_CATALOGUE_DIR              required with registry: entries/ + approvals.json
#   AAS_PORTAL_ORIGINS             optional blueprintId=origin pairs (a deployment fact)
#   AAS_CHROMIUM_PATH              optional; Playwright's Chromium otherwise
#
# What this is NOT: production. The dev session route is mounted, the vault's
# keys are wrapped by a local master key both secure-plane processes are handed
# (never by KMS), the service identities are plain
# strings on loopback, and NODE_ENV is unset — every one of which the processes
# refuse under NODE_ENV=production (docs/deployables.md). It exists so that a
# reviewed entry can be run against a portal from one machine, which is item 9
# of docs/distance-to-a-reviewed-sheffield-run.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIR="${AAS_LOCAL_DIR:-.local-stack}"
ADMIN_URL="${AAS_LOCAL_ADMIN_DATABASE_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"
REDIS_URL="${AAS_LOCAL_REDIS_URL:-redis://127.0.0.1:6379}"
BASE="${AAS_LOCAL_PORT_BASE:-4870}"
PREFIX="${AAS_LOCAL_DB_PREFIX:-aas_local}"
CATALOGUE="${AAS_LOCAL_CATALOGUE:-fixtures}"

CONVERSATION_PORT="$BASE"
SECURE_PORT=$((BASE + 1))
AGENT_PORT=$((BASE + 2))
CDP_PORT=$((BASE + 9))
CONVERSATION_URL="http://127.0.0.1:$CONVERSATION_PORT"
SECURE_URL="http://127.0.0.1:$SECURE_PORT"
AGENT_URL="http://127.0.0.1:$AGENT_PORT"
CDP_URL="http://127.0.0.1:$CDP_PORT"

APPS="conversation-service secure-service secure-filler browser-runner worker"

database_url() {
  # The admin URL with its path replaced: same server, same credentials.
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; process.stdout.write(u.toString());' "$ADMIN_URL" "$1"
}

session_secret() {
  local file="$DIR/session.secret"
  if [ ! -f "$file" ]; then
    umask 077
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$file"
  fi
  cat "$file"
}

master_key() {
  # The local master key BOTH secure-plane processes wrap and unwrap data keys
  # with (P121). Without KMS each process would make its own, and the Fill
  # Agent could not open the envelope the Secure Service put in the cache:
  # the use authorised, the handle spent, the password never typed. Generated
  # once, mode 600, never printed.
  local file="$DIR/master.key"
  if [ ! -f "$file" ]; then
    umask 077
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$file"
  fi
  cat "$file"
}

write_env() {
  # One env file per process, mode 600. Nothing here is a production
  # credential; the session secret is generated once and lives only in $DIR.
  local conversation_db secure_db secret master
  conversation_db="$(database_url "${PREFIX}_conversation")"
  secure_db="$(database_url "${PREFIX}_secure")"
  secret="$(session_secret)"
  master="$(master_key)"
  local catalogue_lines="AAS_CATALOGUE=$CATALOGUE"
  if [ "$CATALOGUE" = "registry" ]; then
    [ -n "${AAS_CATALOGUE_DIR:-}" ] || { echo "AAS_LOCAL_CATALOGUE=registry needs AAS_CATALOGUE_DIR" >&2; exit 2; }
    catalogue_lines="$catalogue_lines
AAS_CATALOGUE_DIR=$AAS_CATALOGUE_DIR"
  fi
  umask 077
  cat > "$DIR/conversation-service.env" <<ENV
AAS_PORT=$CONVERSATION_PORT
AAS_CONVERSATION_DATABASE_URL=$conversation_db
AAS_SESSION_SECRET=$secret
AAS_SECURE_ORIGIN=$SECURE_URL
AAS_SECURE_INTERNAL_URL=$SECURE_URL
AAS_SECURE_SERVICE_TOKEN=conversation-service
AAS_SERVICE_CERT_SECURE=secure-service
AAS_SERVICE_CERT_RUNNER=browser-runner
AAS_DEV_SESSION=1
AAS_PUBLIC_DIR=$DIR/public
$catalogue_lines
${AAS_PORTAL_ORIGINS:+AAS_PORTAL_ORIGINS=$AAS_PORTAL_ORIGINS}
ENV
  cat > "$DIR/secure-service.env" <<ENV
AAS_PORT=$SECURE_PORT
AAS_SECURE_DATABASE_URL=$secure_db
AAS_SECURE_SELF_ORIGIN=$SECURE_URL
AAS_CONVERSATION_ORIGIN=$CONVERSATION_URL
AAS_CONVERSATION_INTERNAL_URL=$CONVERSATION_URL
AAS_CONVERSATION_SERVICE_TOKEN=secure-service
AAS_SERVICE_CERT_CONVERSATION=conversation-service
AAS_SERVICE_CERT_AGENT=secure-filler
AAS_ENVELOPE_CACHE_URL=$REDIS_URL
AAS_SECURE_LOCAL_MASTER_KEY=$master
AAS_SECURE_ASSET_DIR=$DIR/secure-assets
ENV
  cat > "$DIR/secure-filler.env" <<ENV
AAS_PORT=$AGENT_PORT
AAS_SECURE_INTERNAL_URL=$SECURE_URL
AAS_SECURE_SERVICE_TOKEN=secure-filler
AAS_SERVICE_CERT_RUNNER=browser-runner
AAS_ENVELOPE_CACHE_URL=$REDIS_URL
AAS_SECURE_LOCAL_MASTER_KEY=$master
ENV
  cat > "$DIR/browser-runner.env" <<ENV
AAS_CONVERSATION_INTERNAL_URL=$CONVERSATION_URL
AAS_RUNNER_SERVICE_TOKEN=browser-runner
AAS_RUNNER_HOLDER=runner-local-1
AAS_AGENT_INTERNAL_URL=$AGENT_URL
AAS_RUNNER_SERVICE_TOKEN_AGENT=browser-runner
AAS_BROWSER_CDP_URL=$CDP_URL
${AAS_CHROMIUM_PATH:+AAS_CHROMIUM_PATH=$AAS_CHROMIUM_PATH}
ENV
  cat > "$DIR/worker.env" <<ENV
AAS_CONVERSATION_DATABASE_URL=$conversation_db
AAS_WORKER_HOLDER=worker-local-1
AAS_SECURE_INTERNAL_URL=$SECURE_URL
AAS_SECURE_SERVICE_TOKEN=conversation-service
$catalogue_lines
${AAS_PORTAL_ORIGINS:+AAS_PORTAL_ORIGINS=$AAS_PORTAL_ORIGINS}
ENV
}
# The worker's catalogue lines above carry the SAME origins as the service's.
# Found by P121's journey through these processes: without it the worker's
# catalogue served the fixture blueprint at its observed host while the
# service's served it at the origin named here; the worker's tick rebuilt a
# preview that differed from the one the student had authorised and voided
# their yes as `content_changed`, every five seconds — the second opinion
# ADR-0041 forbids, produced by two env files.

run_with_env() {
  # Runs a command with exactly the process's env file plus PATH and HOME:
  # the processes refuse variables they must not see, and the shell's own
  # environment is not theirs to inherit.
  local app="$1"; shift
  env -i PATH="$PATH" HOME="${HOME:-/}" ${PLAYWRIGHT_BROWSERS_PATH:+PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"} \
    "$ROOT/node_modules/.bin/tsx" --env-file="$DIR/$app.env" "$@"
}

alive() {
  local pidfile="$DIR/$1.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

wait_for() {
  # $1 what, $2 a command that succeeds when it is up, $3 seconds
  local what="$1" check="$2" seconds="$3" i
  for i in $(seq 1 "$seconds"); do
    if eval "$check" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "$what did not come up within ${seconds}s — see $DIR/*.log" >&2
  return 1
}

cmd_start() {
  mkdir -p "$DIR"
  for app in $APPS; do
    if alive "$app"; then echo "$app is already running (pid $(cat "$DIR/$app.pid")); stop it first" >&2; exit 1; fi
  done
  write_env
  echo "databases: ${PREFIX}_conversation, ${PREFIX}_secure"
  "$ROOT/node_modules/.bin/tsx" scripts/local-stack-db.ts ensure "$ADMIN_URL" "${PREFIX}_conversation"
  "$ROOT/node_modules/.bin/tsx" scripts/local-stack-db.ts ensure "$ADMIN_URL" "${PREFIX}_secure"
  echo "migrating"
  run_with_env conversation-service apps/conversation-service/src/bin.ts migrate
  run_with_env secure-service apps/secure-service/src/bin.ts migrate
  echo "building the student page and the secure control"
  "$ROOT/node_modules/.bin/tsx" scripts/local-stack-assets.ts "$DIR/public" "$DIR/secure-assets"
  for app in $APPS; do
    : > "$DIR/$app.log"
    nohup env -i PATH="$PATH" HOME="${HOME:-/}" ${PLAYWRIGHT_BROWSERS_PATH:+PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"} \
      "$ROOT/node_modules/.bin/tsx" --env-file="$DIR/$app.env" "apps/$app/src/bin.ts" \
      >> "$DIR/$app.log" 2>&1 &
    echo $! > "$DIR/$app.pid"
  done
  wait_for "the conversation service" "curl -fsS $CONVERSATION_URL/healthz" 90
  wait_for "the student page"         "curl -fsS $CONVERSATION_URL/journey.js" 30
  wait_for "the secure service"       "curl -fsS $SECURE_URL/healthz" 90
  wait_for "the secure control"       "curl -fsS $SECURE_URL/control.js" 30
  wait_for "the fill agent"           "curl -fsS $AGENT_URL/healthz" 90
  wait_for "the runner's browser"     "curl -fsS $CDP_URL/json/version" 90
  wait_for "the worker"               "grep -q 'worker running' $DIR/worker.log" 90
  cat <<SUMMARY
up:
  conversation service  $CONVERSATION_URL   (student page and API; dev session ON)
  secure service        $SECURE_URL
  fill agent            $AGENT_URL
  runner                polling $CONVERSATION_URL, browser CDP at $CDP_URL
  worker                advancing runs
  catalogue             $CATALOGUE${AAS_CATALOGUE_DIR:+ ($AAS_CATALOGUE_DIR)}
  state                 $DIR  (env files 600, logs, pids, public/, secure-assets/)
SUMMARY
}

cmd_status() {
  local rc=0
  for app in $APPS; do
    if alive "$app"; then echo "$app: running (pid $(cat "$DIR/$app.pid"))"; else echo "$app: not running"; rc=1; fi
  done
  for pair in "conversation:$CONVERSATION_URL/healthz" "secure:$SECURE_URL/healthz" "agent:$AGENT_URL/healthz" "browser:$CDP_URL/json/version"; do
    local name="${pair%%:*}" url="${pair#*:}"
    if curl -fsS "$url" >/dev/null 2>&1; then echo "$name answers at $url"; else echo "$name does not answer at $url"; rc=1; fi
  done
  return $rc
}

cmd_stop() {
  local app pid i
  for app in $APPS; do
    if alive "$app"; then kill -TERM "$(cat "$DIR/$app.pid")" 2>/dev/null || true; fi
  done
  for app in $APPS; do
    if [ -f "$DIR/$app.pid" ]; then
      pid="$(cat "$DIR/$app.pid")"
      for i in $(seq 1 70); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      kill -0 "$pid" 2>/dev/null && { echo "$app did not stop in 70s; killing" >&2; kill -KILL "$pid" 2>/dev/null || true; }
      rm -f "$DIR/$app.pid"
      echo "$app: stopped"
    fi
  done
}

cmd_finish_stopped() {
  # ADR-0126. The repair runs through the SERVICE's own binary and env file, so
  # it is judged against the same catalogue and the same database the running
  # service uses. It does not need the service to be up — it opens its own pool
  # — but it must not be pointed at a different one, which is what reusing the
  # env file guarantees.
  local conversation="${1:-}"
  if [ -z "$conversation" ]; then
    echo "usage: scripts/local-stack.sh finish-stopped <conversationId>" >&2
    exit 2
  fi
  if [ ! -f "$DIR/conversation-service.env" ]; then
    echo "no env file at $DIR/conversation-service.env — run start first" >&2
    exit 2
  fi
  run_with_env conversation-service apps/conversation-service/src/bin.ts \
    finish-stopped "$conversation"
}

case "${1:-}" in
  start) cmd_start ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  finish-stopped) shift; cmd_finish_stopped "${1:-}" ;;
  *) echo "usage: scripts/local-stack.sh start|status|stop|finish-stopped <conversationId>" >&2; exit 2 ;;
esac
