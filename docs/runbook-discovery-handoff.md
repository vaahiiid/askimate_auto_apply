# Runbook — running discovery on your own machine

**For:** Vahid
**Target:** Ulster University Birmingham · MSc International Business · September 2026
**Why:** this environment cannot reach the portal (see [access required](./phase-3-access-required.md)),
and I am not going to work around that. You run it; I analyse the output.

**Time:** about five minutes, most of it `pnpm install`.

---

## What this does and does not do

**Does:** open the three permitted hosts read-only, record what the pages contain, save each page's
HTML, take screenshots and a Playwright trace, and write a **draft** blueprint.

**Does not:** create an account, enter any data, click anything, or send any request that could
change something. The runner intercepts every request and aborts anything that is not a safe,
idempotent read on an allow-listed host — including requests the portal's own JavaScript makes. This
is [ADR-0014](./decisions/0014-discovery-cannot-submit.md), and it is tested against a fixture that
deliberately tries to POST on page load.

If the portal *does* attempt a write during ordinary browsing, the run records it and says so. That
is a finding about the portal, and an important one.

---

## 1. Prerequisites

- **Node** — the version in `.nvmrc` (22.20.0) or newer. `node --version` to check.
- **pnpm** — `corepack enable` is enough.
- **Network access** to `www.ulster.ac.uk`, `qahighereducation.com`, `apply.qahighereducation.com`.

## 2. Get the code and install

```bash
git clone https://github.com/vaahiiid/askimate_auto_apply.git
cd askimate_auto_apply
git checkout claude/askimate-application-automation-ab22hz

corepack enable
pnpm install
pnpm --filter @askimate/aas-browser-runner exec playwright install chromium
```

## 3. Check it works before pointing it at anything real

```bash
pnpm run verify
```

Typecheck, lint, boundary checks and the full test suite. All green means the guards are intact on
your machine, not just on mine. **If this fails, stop and send me the output** rather than running
discovery with something broken.

## 4. Run discovery

```bash
pnpm run discover targets/ulster-birmingham-msc-ib-2026.json
```

You will see it print each page as it visits it. It stops after at most 12 pages.

The target file is reviewable data, not code — `targets/ulster-birmingham-msc-ib-2026.json`. It
lists the three permitted hosts, the seed URLs, which links may be followed, and the seven claims
this run exists to confirm or refute. Worth a look before you run it; change it if anything is
wrong.

## 5. What comes back

```
apps/browser-runner/discovery-runs/disc-ulster-birmingham-msc-ib-2026-<timestamp>/
├── blueprint.draft.json     the machine-readable reading of the portal
├── run.json                 what was visited, what failed, what was blocked
├── pages/
│   ├── index.json           url → file, so the run can be replayed
│   └── NNN.html             every page, as rendered
├── NNN-page-N.png           screenshots
├── trace.zip                Playwright trace — open at trace.playwright.dev
└── video/                   screen recording of the run
```

## 6. Send it back

Zip the whole run directory and send it. It is not committed — `discovery-runs/` is gitignored,
because a capture of a real portal is evidence, not source.

```bash
cd apps/browser-runner/discovery-runs
zip -r ulster-discovery.zip disc-ulster-birmingham-msc-ib-2026-*
```

**Before you send it, have a quick look at `pages/*.html`.** If you had a session cookie for
anything, or the portal echoed anything personal into a page, it is in there. Nothing should be —
discovery does not log in — but a capture is worth thirty seconds of checking.

## 7. What I do with it

```bash
pnpm run inspect-discovery <run-directory>
```

Which reports:

1. **What the run saw** — pages visited, anything that failed, and whether the portal attempted to
   write during ordinary browsing.
2. **What the draft blueprint says** — pages, sections, every field with its type, validations and
   dropdown options, the documents asked for, and the authentication model.
3. **Where the real portal differs from what the replay proved** — the honest question. Fields with
   no locator, unrecognised input types, dropdowns needing an option map, pages with no advance
   control, and anything recorded without first-hand observation.
4. **The eight authentication questions** — with what the capture evidences for each, and what it
   cannot. See below; this is the section that decides whether AskiMate ever holds a credential.
5. **What the mapping set must cover** — every required field, each needing a source a specialist
   decides.

Then the capture becomes a local replay, and the whole chain runs against **the real portal's pages**
with nothing live involved.

---

## 8. The four questions the capture cannot answer

Discovery reads pages. Four of ADR-0020's eight authentication questions cannot be answered that
way, and they are the ones that decide whether we ever hold a password to a student's university
account:

| | Question | Why a capture cannot answer it |
|---|---|---|
| 2 | Does the portal generate a credential and email it to the applicant? | Only visible after creating an account |
| 3 | Is there passwordless sign-in — a magic link or emailed code? | Only visible if it is offered on the login page, and often it is not |
| 7 | Does "Forgot password" work, and does the reset reach the account's own address? | Requires triggering it |
| 8 | Can control be handed back cleanly — no lingering session, no second factor bound to us? | Requires an account to hand back |

**Do not answer these from the capture, and do not answer them from what seems likely.** Leaving
them unanswered is the designed state: `chooseApproach` refuses rather than falling through to the
password path, and the orchestrator escalates to a specialist. An unanswered question is not a "no".

They are answered on a portal we are permitted to try, which is what
[the sandbox request](./qa-higher-education-sandbox-request.md) is for.

---

## If it fails

**A host is unreachable.** Send me `run.json` — the failure is recorded per URL. It may be
geo-blocked, or the route may have moved, which is itself worth knowing.

**Chromium will not launch.** `pnpm --filter @askimate/aas-browser-runner exec playwright install chromium`
again, or set `AAS_CHROMIUM_PATH` to a Chromium you already have.

**The run finds nothing.** Likely the application form is behind a login, which discovery cannot and
must not pass. That is a real finding: it means the blueprint describes only the anonymous pages, and
the logged-in flow needs the QA Higher Education sandbox (see
[the sandbox request](./qa-higher-education-sandbox-request.md)).

**Anything at all looks like it created something.** Stop, keep the trace, and tell me. The guard
should make it impossible, but "should" is why the trace is recorded.
