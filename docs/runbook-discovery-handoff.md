# Discovery — one command on your Mac

**Target:** Ulster University Birmingham · MSc International Business · September 2026
**Time:** about three minutes, most of it `pnpm install`.
**Why you and not me:** this environment's network policy denies the portal hosts at the gateway
(`403` on CONNECT, confirmed today), and I am not going to work around that.

---

## The command

Paste this into Terminal. One line.

```bash
git clone -b claude/askimate-application-automation-ab22hz https://github.com/vaahiiid/askimate_auto_apply.git ~/askimate-discovery && cd ~/askimate-discovery && ./scripts/discover.sh
```

If you have already cloned it:

```bash
cd ~/askimate-discovery && git pull && ./scripts/discover.sh
```

That is the whole procedure. The script installs what it needs, runs discovery, reads the result
back to you, and leaves a zip.

## What to send me

The last thing it prints is the answer:

```
Done
  Run directory:  discovery-runs/disc-ulster-birmingham-msc-ib-2026-09-<timestamp>
  Send me:        /Users/you/askimate-discovery/disc-ulster-birmingham-msc-ib-2026-09-<timestamp>.zip
```

**Send the `.zip`.** It is at the top of `~/askimate-discovery/`. Nothing is committed —
`discovery-runs/` is gitignored, because a capture of a real portal is evidence, not source.

**Send it even if the run reports failures.** A URL that 404s or a host that refuses is a finding
about the route, and `run.json` records exactly which and why. Several of the seed URLs are
guesses; some are expected to miss.

---

## What it does, and does not

**Does:** open the permitted hosts read-only, follow in-scope links, record what each page contains,
save every page's HTML, take screenshots and a Playwright trace, and write a **draft** blueprint.

**Does not:** create an account, enter any data, click anything, log in, or send any request that
could change something. The runner intercepts every request and aborts anything that is not a safe,
idempotent read on an allow-listed host — including requests the portal's own JavaScript makes. That
is [ADR-0014](./decisions/0014-discovery-cannot-submit.md), and it is tested against a fixture that
deliberately tries to POST on page load.

If the portal *does* attempt a write during ordinary browsing, the run records it and says so. That
is a finding about the portal, and an important one.

**It does not need a QA sandbox.** This run is entirely about the public flow.

---

## Prerequisites

The script checks all of these and stops with a clear message rather than half-working.

- **Node 22 or newer** — `node --version`. If you need it: [nodejs.org](https://nodejs.org).
- **pnpm** — the script enables it via corepack. If corepack complains about permissions, run
  `sudo corepack enable` once and re-run.
- **Network access** to `ulster.ac.uk` and `qahighereducation.com`.
- `git` and `zip`, both of which macOS has.

## Before you send it

**Have a quick look at `discovery-runs/<run>/pages/*.html`.** Discovery never logs in, so nothing
personal should be in there — but if a session cookie leaked in somehow, it would be in those files.
Thirty seconds.

---

## What I do with it

```bash
pnpm run inspect-discovery <run-directory>
```

The script already runs this and shows you the output, so you will have seen it. It reports:

1. **What the run saw** — pages visited, anything that failed, and whether the portal attempted to
   write during ordinary browsing.
2. **What the draft blueprint says** — pages, sections, every field with its type, validations and
   dropdown options, and the documents asked for.
3. **Where the real portal differs from what the replay proved** — the honest question. Fields with
   no locator, unrecognised input types, dropdowns needing an option map, pages with no advance
   control, and anything recorded without first-hand observation.
4. **The eight authentication questions** — what the capture evidences for each, and what it cannot.
5. **What the mapping set must cover** — every required field, each needing a source a specialist
   decides.

Then the capture becomes a local replay, and the whole chain runs against **the real portal's pages**
offline, repeatedly, with nothing live involved.

---

## The four questions this run cannot answer

Discovery reads pages. Four of ADR-0020's eight authentication questions cannot be answered that
way, and they are the ones deciding whether we ever hold a password to a student's university
account:

| | Question | Why a capture cannot answer it |
|---|---|---|
| 2 | Does the portal generate a credential and email it to the applicant? | Only visible after an account exists |
| 3 | Is there passwordless sign-in — a magic link or emailed code? | Only visible if offered on the login page, and often it is not |
| 7 | Does "Forgot password" work, and does the reset reach the account's own address? | Requires triggering it |
| 8 | Can control be handed back cleanly — no lingering session, no second factor bound to us? | Requires an account to hand back |

**This does not block the run, and it does not block anything downstream except the account step.**
Everything else — the blueprint, the field list, the mapping set, the replay, the whole chain up to
Preview and Authorisation — proceeds on what this run captures.

Those four are answered on an account we are permitted to use: a sandbox if QA HE offer one, or the
consenting applicant's own account at the point the run reaches account creation. Either way it is
one short session, not a dependency to wait on.

---

## If something goes wrong

**A host is unreachable.** Send the zip. The failure is recorded per URL in `run.json`. It may be
geo-blocked, or the route may have moved, which is itself worth knowing.

**Chromium will not launch.** `pnpm --filter @askimate/aas-browser-runner exec playwright install chromium`,
or set `AAS_CHROMIUM_PATH` to a Chromium you already have.

**The run finds nothing on the apply host.** Likely the application form is behind a login, which
discovery cannot and must not pass. That is a real finding: the blueprint then describes only the
anonymous pages, and the logged-in flow needs an account.

**Anything at all looks like it created something.** Stop, keep the trace, and tell me. The guard
should make it impossible, but "should" is why the trace is recorded.

---

## Running it against something else

The target file is reviewable data, not code:
[`targets/ulster-birmingham-msc-ib-2026.json`](../targets/ulster-birmingham-msc-ib-2026.json). It
lists the permitted hosts, the seed URLs, which links may be followed, and the eighteen claims this
run exists to confirm or refute. Edit it and re-run; adding a university is adding a file like it.

```bash
./scripts/discover.sh <name-of-target>
```

A bare name works, as does a prefix: `./scripts/discover.sh ulster`.
