# Runbook: the local stack — the five deployables on one machine

**Date:** 2026-09-13 (P120) · **Proved by:** `scripts/local-stack.test.ts`, which runs the script
below against a real Postgres and Redis, checks every endpoint, and stops it · **For:** item 9 of
[`distance-to-a-reviewed-sheffield-run.md`](./distance-to-a-reviewed-sheffield-run.md).

One script stands up the Conversation Service, the Secure Interaction Service, the Fill Agent,
the Automation Runner and the Background Worker on one machine, against a Postgres and a Redis
you already run, with both databases created and migrated, and tells you where each is. It is
**not production** and refuses to be: the dev session route is mounted, the vault's data keys
are wrapped by a local provider, the service identities are plain strings on loopback, and
`NODE_ENV` is unset — each of which the processes refuse under `NODE_ENV=production`
([`deployables.md`](./deployables.md)).

## Prerequisites

- Node (see `.nvmrc`), `corepack enable`, `pnpm install` — which brings Playwright's Chromium,
  or set `AAS_CHROMIUM_PATH` to one of your own.
- A PostgreSQL you can create databases on, reachable by an admin URL.
- A Redis. The Secure Service and the Fill Agent are different processes sharing one envelope
  cache (ADR-0042); without a shared cache the agent cannot take what the service put.
- `curl`, `bash`.

## Start, check, stop

```bash
# Against a Postgres on 5432 and a Redis on 6379, the fixture portal's catalogue:
scripts/local-stack.sh start

# Or say where things are:
AAS_LOCAL_ADMIN_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres \
AAS_LOCAL_REDIS_URL=redis://127.0.0.1:6379 \
AAS_LOCAL_PORT_BASE=4870 \
scripts/local-stack.sh start

scripts/local-stack.sh status
scripts/local-stack.sh stop
```

`start` creates `aas_local_conversation` and `aas_local_secure` if they are absent, runs each
plane's own migration command, writes one env file per process (mode 600) into `.local-stack/`,
starts the five with `nohup`, logs each to `.local-stack/<app>.log`, and waits until:

| Process | Where | Up when |
|---|---|---|
| Conversation Service | `http://127.0.0.1:<base>` | `GET /healthz` answers |
| Secure Interaction Service | `http://127.0.0.1:<base+1>` | `GET /healthz` answers |
| Fill Agent | `http://127.0.0.1:<base+2>` | `GET /healthz` answers |
| Automation Runner | polls the Conversation Service; its browser listens at `http://127.0.0.1:<base+9>` | `GET /json/version` answers at the CDP endpoint |
| Background Worker | listens on nothing | its log says `worker running` |

The admin URL and the session secret are never printed; the secret is generated once into
`.local-stack/session.secret` (mode 600) and reused. `stop` sends `SIGTERM` to each and waits
for an orderly exit — the runner's waits for a turn in flight, so up to a minute.

## Every setting

| Variable | Default | Meaning |
|---|---|---|
| `AAS_LOCAL_DIR` | `.local-stack` | env files, pids, logs, the secret |
| `AAS_LOCAL_ADMIN_DATABASE_URL` | `postgresql://postgres@127.0.0.1:5432/postgres` | used to create the two databases; the same server and credentials become each plane's database URL |
| `AAS_LOCAL_REDIS_URL` | `redis://127.0.0.1:6379` | the shared envelope cache |
| `AAS_LOCAL_PORT_BASE` | `4870` | conversation = base, secure = base+1, agent = base+2, runner's browser CDP = base+9 |
| `AAS_LOCAL_DB_PREFIX` | `aas_local` | `<prefix>_conversation`, `<prefix>_secure` |
| `AAS_LOCAL_CATALOGUE` | `fixtures` | `fixtures` serves the gated test portal; `registry` serves reviewed entries |
| `AAS_CATALOGUE_DIR` | — | required with `registry`: `entries/*.json` and `approvals.json` (ADR-0057) |
| `AAS_PORTAL_ORIGINS` | — | optional `blueprintId=origin` pairs: which instance of a portal to run against, a deployment fact outside the reviewed artefact |
| `AAS_CHROMIUM_PATH` | Playwright's | the runner's browser |

## The Sheffield variant — what changes, and what this repository cannot do

The same script, pointed at a reviewed entry:

```bash
AAS_LOCAL_CATALOGUE=registry \
AAS_CATALOGUE_DIR=/path/to/catalogue \
scripts/local-stack.sh start
```

where `/path/to/catalogue/entries/` holds the reviewed Sheffield entry and `approvals.json`
carries an approval, by someone other than its author, whose canonical hash matches the entry
(P20; the loader refuses anything else, and the Conversation Service and the Worker refuse to
start on an entry no approval covers). `AAS_PORTAL_ORIGINS` is only needed to run the entry
against a different instance of the portal than the one it observed.

What the script does **not** settle, and what stands before it can be pointed at Sheffield at
all, is the rest of the distance list: the reviewed entry itself (items 1–6), `robots.txt`
(item 7 — the runner reads it before the browser opens and obeys it), the account and how a run
enters it (item 8), and Part 2 (item 10). This environment cannot reach `sheffield.ac.uk`; the
script is run from a machine that can.

## Found while writing this: the runner's CDP endpoint

`AAS_BROWSER_CDP_URL` is documented as *"its own browser's CDP endpoint, as the agent will dial
it"*, and the performer hands that URL to the Fill Agent for every credential fill. Every test
that had driven a runner injected a browser launched with a remote-debugging port; the entry
point's own launch opened none. From the deployable as started, the agent would have dialled an
endpoint nothing served, at the moment a student's password was to be typed. The entry point now
launches its browser listening at the host and port the URL names, refuses a URL with no port,
and `apps/browser-runner/src/main.test.ts` starts the real entry point and asks the endpoint
for `/json/version` — red before the fix, green after.

## Reading what happened

- `.local-stack/<app>.log` — each process's own lines; the runner logs turn kinds, never an
  error object (a page's text or a URL with a token could be in one).
- `pnpm run interventions` — stopped runs waiting for a person, against the conversation
  database.
- `scripts/local-stack.sh status` — pids and endpoints.
