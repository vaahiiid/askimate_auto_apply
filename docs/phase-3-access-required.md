# Phase 3 — Live discovery access required

**Date:** 2026-08-26
**Status:** ⛔ **Blocked.** Everything else is built, tested and ready to run.

---

## The short version

The discovery run is **one command**:

```bash
pnpm install
pnpm run discover targets/ulster-birmingham-msc-ib-2026.json
```

It cannot run *here*, because this session's environment blocks the target hosts. It will run
anywhere with normal internet access, including your own laptop.

---

## 1. Why I could not "use a permitted environment"

You offered that as the first option. I checked, and it is not available to me:

**There is exactly one environment on the account** — `Default — trusted network access`. A new
session created from here inherits that same environment and therefore the same policy, so
spawning one would only reproduce the block. There is no second environment to move to.

## 2. What the policy actually is

I characterised it rather than guessing. It is an **allow-list, not a block-list**:

| Host | Result |
|---|---|
| `registry.npmjs.org` | ✅ 200 |
| `github.com` | ✅ reachable |
| `example.com` | ⛔ blocked |
| `www.gov.uk` | ⛔ blocked |
| `www.ulster.ac.uk` | ⛔ blocked |
| `apply.qahighereducation.com` | ⛔ blocked |

So this is not Ulster being singled out — the environment permits package registries, GitHub and
Anthropic APIs, and denies the rest of the internet. That is a sensible default for a coding
environment. It just cannot do live portal discovery.

The proxy's own documentation is explicit that a 403 is an organisation policy denial to be
reported rather than worked around, so I stopped there.

## 3. Option A — open egress for three hosts

Environments and their network policy are configured per the
[Claude Code on the web documentation](https://code.claude.com/docs/en/claude-code-on-the-web).
Either widen this environment's policy or create a second environment with a permissive policy and
run the session there.

**The exact hosts needed — nothing more:**

```
apply.qahighereducation.com
qahighereducation.com
www.ulster.ac.uk
```

Subdomains of the first two would help if the portal redirects. **No other host is required**, and
the runner enforces that itself: navigation is confined to the target's `allowedHosts`, so even a
fully open environment would not let this run wander (ADR-0014).

Once that is in place, say so and I will run discovery immediately.

## 4. Option B — run it yourself, in about two minutes

The runner is self-contained and does not depend on where it executes.

```bash
git clone <this repo> && cd askimate_auto_apply
corepack enable && pnpm install
pnpm --filter @askimate/aas-browser-runner exec playwright install chromium

pnpm run discover targets/ulster-birmingham-msc-ib-2026.json
```

It writes to `discovery-runs/<run-id>/`:

| File | What it is |
|---|---|
| `blueprint.draft.json` | The first real Application Blueprint |
| `run.json` | Pages visited, failures, blocked requests |
| `001-page-N.png` | Full-page screenshot of every page |
| `trace.zip` | Playwright trace — open with `npx playwright show-trace` |
| `video/` | Video of the whole run |

Commit that directory back, or send it to me, and I will review it and produce the Phase 3 report.

## 5. What it will and will not do

**Will:** load the seed URLs, follow in-scope links matching the target's patterns, read every
form's structure, record field types and validation attributes as the portal declares them,
identify file inputs as required documents, screenshot everything, and produce a **draft**
blueprint.

**Will not — and structurally cannot:**

- ❌ create an account
- ❌ create an application
- ❌ enter student data
- ❌ submit anything
- ❌ visit any host outside the target's allow-list

Enforced two ways (ADR-0014): the session type has no `fill`, `click` or `submit` method, **and**
every non-GET request is aborted before it leaves the machine — including requests the portal's own
JavaScript initiates. That second layer is tested against real Chromium with a fixture that POSTs
on page load; the request never reaches the server.

The runner also identifies itself honestly in its User-Agent rather than pretending to be an
ordinary browser.

## 6. What the run is trying to settle

Recorded in the target file as `claimsToVerify`, so the output can be checked against them:

1. **Are Birmingham applications handled at `apply.qahighereducation.com`, not by Ulster's own system?** — the central question
2. Is the portal Salesforce Experience Cloud? *(inferred from a `/s/login/` path; unverified)*
3. Must an account exist before the form is even visible? *(decides how far read-only discovery can go)*
4. IELTS 6.0, no band below 5.5
5. **"Applicants must be 18 at course start"** — directly relevant to ADR-0011/0013; verify before relying on it
6. Required documents: transcripts, certified translations, English test
7. Whether the September 2026 intake is open, and its deadline

## 7. A limit worth knowing in advance

If the portal requires an account before showing the application form, **read-only discovery stops
at the login page.** That is not a failure — it is a finding, and an important one, because it
tells us the blueprint cannot be completed without an authenticated session.

Going further would need a decision from you about a test account, which is a separate
authorisation from the one you have given. I will report and stop rather than assume.
