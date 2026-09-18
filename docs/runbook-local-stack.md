# Runbook: the local stack — the five deployables on one machine

**Date:** 2026-09-13 (P120; P121) · **Proved by:** `scripts/local-stack.test.ts`, which runs the
script below against a real Postgres and Redis, checks every endpoint, and stops it; and
`scripts/local-stack-journey.test.ts`, which drives one whole application through the five
processes it started — HTTP, the real frame, the worker's clock, the runner's browser, the
handover — and reads the portal · **For:** item 9 of
[`distance-to-a-reviewed-sheffield-run.md`](./distance-to-a-reviewed-sheffield-run.md).

One script stands up the Conversation Service, the Secure Interaction Service, the Fill Agent,
the Automation Runner and the Background Worker on one machine, against a Postgres and a Redis
you already run, with both databases created and migrated, and tells you where each is. It is
**not production** and refuses to be: the dev session route is mounted, the vault's data keys
are wrapped by one local master key both secure-plane processes are handed (never KMS), the
service identities are plain strings on loopback, and
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
plane's own migration command, builds the student page and the secure control into
`.local-stack/public/` and `.local-stack/secure-assets/` (`scripts/local-stack-assets.ts`, the
same two builders the browser tests use), writes one env file per process (mode 600) into
`.local-stack/`, starts the five with `nohup`, logs each to `.local-stack/<app>.log`, and waits
until:

| Process | Where | Up when |
|---|---|---|
| Conversation Service | `http://127.0.0.1:<base>` | `GET /healthz` answers, and `GET /journey.js` (the student's page) |
| Secure Interaction Service | `http://127.0.0.1:<base+1>` | `GET /healthz` answers, and `GET /control.js` (the frame's control) |
| Fill Agent | `http://127.0.0.1:<base+2>` | `GET /healthz` answers |
| Automation Runner | polls the Conversation Service; its browser listens at `http://127.0.0.1:<base+9>` | `GET /json/version` answers at the CDP endpoint |
| Background Worker | listens on nothing | its log says `worker running` |

The admin URL, the session secret and the local master key are never printed; the secret and
the key are generated once into `.local-stack/session.secret` and `.local-stack/master.key`
(mode 600) and reused. The key is handed to the Secure Service and the Fill Agent alike
(`AAS_SECURE_LOCAL_MASTER_KEY`), because a data key wrapped by one process must be unwrapped
by the other. `stop` sends `SIGTERM` to each and waits
for an orderly exit — the runner's waits for a turn in flight, so up to a minute.

## Every setting

| Variable | Default | Meaning |
|---|---|---|
| `AAS_LOCAL_DIR` | `.local-stack` | env files, pids, logs, the session secret, the master key, the two built bundles |
| `AAS_LOCAL_ADMIN_DATABASE_URL` | `postgresql://postgres@127.0.0.1:5432/postgres` | used to create the two databases; the same server and credentials become each plane's database URL |
| `AAS_LOCAL_REDIS_URL` | `redis://127.0.0.1:6379` | the shared envelope cache |
| `AAS_LOCAL_PORT_BASE` | `4870` | conversation = base, secure = base+1, agent = base+2, runner's browser CDP = base+9 |
| `AAS_LOCAL_DB_PREFIX` | `aas_local` | `<prefix>_conversation`, `<prefix>_secure` |
| `AAS_LOCAL_CATALOGUE` | `fixtures` | `fixtures` serves the gated test portal; `registry` serves reviewed entries |
| `AAS_CATALOGUE_DIR` | — | required with `registry`: `entries/*.json` and `approvals.json` (ADR-0057) |
| `AAS_PORTAL_ORIGINS` | — | optional `blueprintId=origin` pairs: which instance of a portal to run against, a deployment fact outside the reviewed artefact. Written into the Conversation Service's env file AND the Worker's: the two must serve one catalogue (ADR-0041), and P121 found what happens when they do not |
| `AAS_CHROMIUM_PATH` | Playwright's | the runner's browser |

## The Sheffield variant — what changes, and what this repository cannot do

The same script, pointed at a reviewed entry:

```bash
AAS_LOCAL_CATALOGUE=registry \
AAS_CATALOGUE_DIR=/path/to/catalogue \
scripts/local-stack.sh start
```

where `/path/to/catalogue/entries/` holds the reviewed Sheffield entry and `approvals.json`
carries an approval whose canonical hash matches the entry (P20; the loader refuses anything
else, and the Conversation Service and the Worker refuse to start on an entry no approval
covers). `AAS_PORTAL_ORIGINS` is only needed to run the entry against a different instance of
the portal than the one it observed.

### Run A: the signed catalogue (P154)

The entry Vahid signed on 2026-09-16 is `docs/run-a/catalogue/` in this repository. The stack
serves it, and nothing else, with:

```sh
scripts/local-stack.sh stop
AAS_LOCAL_CATALOGUE=registry \
AAS_CATALOGUE_DIR="$PWD/docs/run-a/catalogue" \
scripts/local-stack.sh start
```

`start` refuses if any of the five is still running (*"is already running … stop it first"*), so
the `stop` comes first. Its last lines then read `catalogue  registry (…/docs/run-a/catalogue)`
instead of `catalogue  fixtures`; the Conversation Service and the Worker both load the
directory at start and refuse to come up on an entry no approval covers. No `AAS_PORTAL_ORIGINS`:
Run A runs against the origin the blueprint observed, `www.sheffield.ac.uk`.

### Found on a real machine — Vahid's step 5, 2026-09-16

The runbook had been run only where Postgres and Redis were already there. On a machine with
Node and pnpm and nothing else it found four things, each with its fix:

1. **Homebrew was not installed.** It is the way the two services below arrive on a Mac:
   `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.
2. **PostgreSQL was not installed, and the script wanted a role named `postgres`** that
   Homebrew's install does not create (it creates a superuser named after the macOS user).
   `brew install postgresql@16 && brew services start postgresql@16`, then either
   `createuser -s postgres` once, or point the script at the role that exists:
   `AAS_LOCAL_ADMIN_DATABASE_URL=postgresql://$(whoami)@127.0.0.1:5432/postgres`.
3. **Redis was not installed.** `brew install redis && brew services start redis`.
4. **Redis's default save-to-disk, and the Secure Service refused to start against it** —
   `save` must be empty and `appendonly` must be `no`: *ciphertext must not reach disk*
   (`secure-plane-deployment.md` §3.2; the check is in `packages/envelope-cache-redis`). This
   was a control doing its job on a real machine for the first time: it stopped the stack rather
   than let an envelope of every credential exchange be written to a disk nobody decided to
   keep. **`redis-cli CONFIG SET save ""` clears it for the running server only — it does NOT
   survive a Redis restart.** After a reboot, or `brew services restart redis`, the next start
   meets the same refusal with no idea why. The persistent fix is the server's own file,
   `/opt/homebrew/etc/redis.conf` on Apple silicon (`/usr/local/etc/redis.conf` on Intel): replace
   the `save 3600 1 300 100 60 10000` line with `save ""`, make sure `appendonly no` stands, and
   `brew services restart redis`. `redis-cli CONFIG GET save` then answers an empty string every
   time the server comes up. `maxmemory-policy noeviction` is Redis's default and needs nothing.


Since 2026-09-16 the approval may be signed by the entry's author, on one condition the loader
enforces: it names the one account it admits, and the service serves the entry to that student
and to nobody else. The shape, written by hand into `approvals.json` (there is no `approve`
subcommand, on purpose):

```json
[
  {
    "contentHash": "sha256:<the output of `pnpm run catalogue hash entries/sheffield.json`>",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "2026-09-16T10:00:00Z",
    "ownAccountOnly": { "studentId": "<your studentId — see below>" },
    "note": "One signature (ADR-0118): my own account only."
  }
]
```

`studentId` is the identity the session carries, and it depends on how you signed in:

- **`AAS_DEV_SESSION=1`** (what `local-stack.sh` sets): it is the `subject` you post to the
  dev-session route — and that subject must be a `students.id` UUID, not a label of your own:
  `profile_entries.student_id` is a uuid referencing `students`, so a session whose subject is
  any other string has no profile and the store cannot read one for it. **Corrected in P150** —
  this paragraph used to say "the string you chose", which the local-stack journey never relied
  on (it inserts a `students` row and posts its UUID). `pnpm run profile:seed … --write` creates
  the row and prints the UUID; post that as `subject`, and write the same UUID into the approval.
- **A real OIDC provider:** it is the `students.id` row for your subject —
  `SELECT id FROM students WHERE subject = '<your sub>'` on the conversation database, after your
  first sign-in.

A self-signed approval with no `ownAccountOnly` is refused at load (`self_approval_unbounded`).
An approval by a second person needs no `ownAccountOnly` and admits any applicant.
`pnpm run catalogue check /path/to/catalogue` prints, per entry, whom its approval admits — read
it before starting the processes.

What the script does **not** settle, and what stands before it can be pointed at Sheffield at
all, is the rest of the distance list: the reviewed entry itself (items 1–6), `robots.txt`
(item 7 — the runner reads it before the browser opens and obeys it), the account and how a run
enters it (item 8), and Part 2 (item 10). This environment cannot reach `sheffield.ac.uk`; the
script is run from a machine that can.

### The synthetic profile for Run A (P150)

The run fills from a confirmed profile, and on a fresh database there is none. The profile for
Run A is synthetic — `docs/run-a/synthetic-profile.json`, eighteen values, described in
`docs/run-a/README.md` — and it is shown before it is written, at Vahid's word:

```sh
pnpm run profile:seed docs/run-a/synthetic-profile.json            # prints the values, writes nothing
AAS_CONVERSATION_DATABASE_URL=postgresql://…/aas_local_conversation \
  pnpm run profile:seed docs/run-a/synthetic-profile.json --write --subject run-a
```

The second form creates the `students` row for `run-a` (e-mail marked verified, as the secure
step requires), writes the eighteen entries through the same store the interview writes to, and
prints the `studentId` UUID to post to `/dev/session` and to put in the approval. It refuses to
write for a student who already holds any profile entry. Every entry's provenance says it was
seeded from the file by this command on that date and that no interview took place.

**Getting the session into a browser by hand (found by Vahid at Run A's step 1, 2026-09-17).**
The journey tests mint the session through Playwright's request API, which writes into the
browser's own cookie jar; no person had done it in a browser before. Two things go wrong for a
person. `curl` to `/dev/session` keeps the cookie in curl, not the browser. And the console on
`http://127.0.0.1:4870` cannot run the fetch: without a session the student page sends the
browser to `/auth/login`, which the local stack has no route for, and Express's own 404 carries
`Content-Security-Policy: default-src 'none'` — the framework's default for a 404, not a header
this service sets — so the page refuses every fetch. The Secure attribute is not the problem:
Chromium accepts the `__Host-` cookie over plain HTTP on `127.0.0.1` (a loopback origin is
trustworthy to it) and sends it on the next navigation, proved on a real page rather than through
Playwright. So open a page of ours that sets no policy and run the fetch there:

```js
// on http://127.0.0.1:4870/healthz, in the console
await fetch("/dev/session", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ subject: "<the studentId UUID>" }) });   // Response { status: 204 }
```

Then open `http://127.0.0.1:4870/`. `document.cookie` stays empty whatever happens — the cookie is
`HttpOnly` — so that is not evidence either way; the student page loading is.

**Run A signs in with his account's e-mail (blocker 31, decided 2026-09-17).** The resume path
uses the profile's `contact.email` as the account's address (ADR-0110), and the file's address
is synthetic, so for Run A the profile is seeded from a copy outside the repository whose
`contact.email` is the one his Sheffield account holds — the file in the repository is not
changed. The seed refuses a student who already holds entries, so the synthetic entries go first:

```sh
cp docs/run-a/synthetic-profile.json "$HOME/run-a-profile.json"          # outside the repository, at his word
#   edit "$HOME/run-a-profile.json": "contact.email" → the address the Sheffield account holds
psql "$AAS_CONVERSATION_DATABASE_URL"   -c "DELETE FROM profile_entries WHERE student_id = '<the studentId the first seed printed>'"
AAS_CONVERSATION_DATABASE_URL=postgresql://…/aas_local_conversation   pnpm run profile:seed "$HOME/run-a-profile.json" --write --subject run-a
#   prints "existing students row" and the SAME studentId — the approval does not change
```

The `students` row is kept, so the UUID in `approvals.json` still names the account; only the
eighteen entries are rewritten, and each one's provenance now names the copy's file name.

## Found while writing this: the runner's CDP endpoint

`AAS_BROWSER_CDP_URL` is documented as *"its own browser's CDP endpoint, as the agent will dial
it"*, and the performer hands that URL to the Fill Agent for every credential fill. Every test
that had driven a runner injected a browser launched with a remote-debugging port; the entry
point's own launch opened none. From the deployable as started, the agent would have dialled an
endpoint nothing served, at the moment a student's password was to be typed. The entry point now
launches its browser listening at the host and port the URL names, refuses a URL with no port,
and `apps/browser-runner/src/main.test.ts` starts the real entry point and asks the endpoint
for `/json/version` — red before the fix, green after.

## Found by driving the journey through it (P121)

The stack that P120 proved answered on every endpoint, and could not have taken a student from
a conversation to a filled form. Five things stood in the way, each invisible to the journey
that builds every plane in one process, each proved red before its fix:

1. **The worker's catalogue was not the service's.** Its env file did not carry
   `AAS_PORTAL_ORIGINS`; its tick rebuilt a preview that differed from the one the student had
   authorised and voided the yes as `content_changed` every five seconds. The case log showed
   `AuthorisationCaptured`, `AuthorisationVoided`, and the case back at authorisation.
2. **No page, no frame.** Nothing served the student's page or the secure control, so the
   password box had nowhere to mount. Both are built and served now.
3. **The Fill Agent's certificate went under the wrong header.** It wrote `x-aas-service`; the
   Secure Service reads `x-service-cert`; every in-process test had added the right one by hand
   in a fetch wrapper. One constant now, `SERVICE_CERTIFICATE_HEADER`, at every hop.
4. **`__name` under `tsx`, at a second door.** P80 shimmed the session classes; the account
   creation and sign-in open their contexts through `openSensitiveContext`, which had no shim,
   so the runner process threw on its first challenge read and reported the account UNCERTAIN.
5. **Two local master keys.** Each secure-plane process made its own random master, so after the
   Secure Service had authorised the use and spent the handle, the Fill Agent could not open the
   envelope: `secret_unavailable`, nothing typed. `AAS_SECURE_LOCAL_MASTER_KEY`, the same bytes
   in both, generated once by the script.

And one thing observed, not fixed here: a failed account creation is re-claimed about twice a
second once the secret is spent, refused `already_spent` each time, without limit and without
asking the student again (blocker 26 in `state-of-the-system.md`). Decided by Vahid and built
in P137 (ADR-0114): two attempts, the box reopened between them, then a person.

## Reading what happened

- `AAS_LOCAL_STACK_KEEP=1 pnpm exec vitest run --project chromium scripts/local-stack-journey.test.ts`
  drives the journey and leaves the stack, its state directory and both databases in place for
  reading by hand; the test's own failure message carries the five logs, the intent ledger, any
  intervention with its reason, the portal's record and the last things the student was told.
- `.local-stack/<app>.log` — each process's own lines; the runner logs turn kinds, never an
  error object (a page's text or a URL with a token could be in one).
- `pnpm run interventions` — stopped runs waiting for a person, against the conversation
  database.
- `scripts/local-stack.sh status` — pids and endpoints.

## Finishing a case whose stop was recorded before P158 (ADR-0126)

A cancellation is two acts. Before commit 412d001 the second act was performed only by an
advance, and the Worker advances `running` and `suspended` runs only — so a case stopped while
a person was holding the run stayed at `WINDING_DOWN` for ever. The student saw a stop that said
it had stopped, and a re-application refused with a bare 403.

412d001 fixed the STOP. It does not reach a case whose stop is already in the past: that case's
stop has been and gone, and nothing re-examines it. This is the missing caller.

Read the state first — the case state is folded from `case_events`, never a column on `cases`:

```bash
psql "$CONVERSATION_DATABASE_URL" -c "
  SELECT event->>'to' AS state, occurred_at
    FROM case_events
   WHERE case_id = 'case_<your conversation id, lower-cased>'
     AND event->>'type' = 'CaseStateChanged'
   ORDER BY \"sequence\" DESC LIMIT 3;"
```

`WINDING_DOWN` on the top row and no `CANCELLED` above it is the stuck state. Then:

```bash
scripts/local-stack.sh finish-stopped <CONVERSATION id, as the client shows it>
```

It takes the **conversation** id, not the case id — the case id is `case_` plus that id
lower-cased. What it prints is one of three things:

- `is CONCLUDED. The case is closed.` — done; the re-application will now be offered.
- `is NOT concluded, and that is the guard working. Still owed: …` — the case owes the student
  their portal account. That is ADR-0050 holding, not a failure: finish the handover and run it
  again.
- `is at <STATE>, not stopped. Nothing was done.` — it acts on `WINDING_DOWN` and nothing else,
  so it can never move a live application.

It performs no transition of its own: it runs the ordinary wind-down, which asks `decide`, which
applies the same obligations guard as every other path. Running it twice is safe.

