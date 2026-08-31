# Production repository audit — askimate.com

**Date:** 2026-08-27
**Question:** where does the current production source for askimate.com live, and can this session
reach it?

## Verdict

> ## ⛔ The production AskiMate repository could NOT be located or accessed.
>
> There is strong positive evidence that it **is not on GitHub under this account at all**, rather
> than merely being outside this session's permissions.
>
> **Phases 2 and 3 are blocked.** No audit of the production data path has been performed, and no
> production integration has been done. Nothing in this repository supports a claim that
> production is secure or that the integration is complete.

---

## 1. What was searched — **Measured**

Every check below was actually run.

| # | Check | Result |
|---|---|---|
| 1 | `get_me` | `vaahiiid` · Vahid Mohammadi · company "AskiMate and Universitio LTD" · blog askimate.com · **`public_repos: 1`** |
| 2 | `get_teams` | **`null`** — no organisation membership visible to this credential |
| 3 | `search_repositories user:vaahiiid` (sees private repos the credential can access) | **`total_count: 3`** |
| 4 | `list_repos` | same 3 · **`has_more: false`** |
| 5 | `search_repositories askimate in:name` across all of GitHub | 4 results — `Imanbehravan/askimate-django`, `kosarbehravan/Askimate-django`, `askimatetst/Askimate-test` (all 2025, unrelated third parties), and this repo |
| 6 | `add_repo vaahiiid/askimate` | *"you don't have access"* |
| 7 | `add_repo vaahiiid/askimate-platform` | *"you don't have access"* |
| 8 | `add_repo vaahiiid/askimate-app` | *"you don't have access"* |
| 9 | `list_branches vaahiiid/ai-admissions-platform` | **`[]`** — zero branches, genuinely empty |
| 10 | `curl -I https://askimate.com` and `www.askimate.com` | **`CONNECT tunnel failed, 403`** — policy-denied at the session's egress proxy |
| 11 | Environment variables | No AskiMate `DATABASE_URL`, no Replit token, no deployment credential of any kind |
| 12 | `archive/askimate/ARCHIVE-REPORT.md` and `RESTORE.md` | Name askimate.com as the destination; **name no repository** |
| 13 | Deployment manifests in Universitio (`artifacts/*/.replit-artifact/artifact.toml`) | Universitio's three services only — `api-server`, `universitio`, `mockup-sandbox`. Nothing for AskiMate |

### The three repositories that exist

| Repository | Visibility | Default branch | State |
|---|---|---|---|
| `vaahiiid/askimate_auto_apply` | public | `claude/askimate-application-automation-ab22hz` | this repo (AAS) |
| `vaahiiid/Universitio` | private | `main` | the monorepo. HEAD `58a2c62`, 2026-07-16. Contains `archive/askimate/` |
| `vaahiiid/ai-admissions-platform` | private | `main` | **empty** — created 2026-07-28, zero branches, never pushed to |

## 2. The most likely explanation — **Inferred**

Universitio is deployed from **Replit** (`.replit-artifact/artifact.toml` manifests; the HEAD
commit message is literally *"Published your App"*). That is a Replit-first workflow with GitHub
as a mirror.

AskiMate was separated out on **2026-06-18** into a standalone product. The most probable reading
of the evidence is that it went into **a Replit project that was never connected to GitHub** —
which would explain checks 3, 4, 5, 6–8 and 13 simultaneously, and explains why
`ai-admissions-platform` was created a month later and left empty.

This is **Inferred**, not established. It is consistent with everything measured, and it is not
proof.

## 3. What this does NOT mean

- It does not mean the code does not exist. It means **this session cannot see it**.
- It does not mean production is insecure. **No claim about production security is made here in
  either direction.**
- The `err.body` finding (see `docs/chat-integration-report.md` §2) is a property of Express 5 +
  body-parser 2.3.0, not of the archive. It is worth acting on wherever AskiMate runs — but
  whether AskiMate today has a logger that would serialise an error is **Unverifiable** from here.

## 4. What is needed to unblock Phases 2 and 3

Any **one** of these:

1. **Push the production AskiMate source to a GitHub repository on this account** (public or
   private), then say so — `add_repo` attaches it and the audit proceeds.
2. **Grant this session access** to wherever it already lives, if it is on GitHub under a different
   account or organisation. Repository access is granted at
   <https://claude.ai/admin-settings/claude-tag>; a personal GitHub authorisation is reconnected
   under claude.ai Settings → Connectors.
3. **Export the relevant subtree** — the chat routes, message schema, middleware, app entry point,
   auth, and the manifests — and attach it here. Less good than the repository, and enough for the
   Phase 2 audit.

Option 1 is the only one that supports Phase 3, because the integration has to be *committed
somewhere*.

## 5. Evidence labelling used in this document

| Label | Meaning |
|---|---|
| **Measured** | I ran the check and this is its output |
| **Read** | Confirmed by reading current source available to this session |
| **Inferred** | Reasoned from evidence, not directly proven |
| **Unverifiable** | Cannot be confirmed with the access available |

## 6. A separate finding, in this repository — **Measured**

**Original finding (2026-08-27).** `vaahiiid/askimate_auto_apply` has **no `main` branch**. Its
GitHub default branch is `claude/askimate-application-automation-ab22hz` — a working branch. There
are also no git tags.

This matters now that versioning exists (ADR-0027): a release process needs a trunk to tag on, and
tagging a release on a feature branch is workable but wrong. **This is your call**, so it is raised
rather than fixed: creating `main` from the current branch and making it the default would take a
minute, and it changes where every future PR targets.

**Update, 2026-08-31 — partly closed.** You approved it, and `main` now exists on the remote at the
tip of the working branch; no commit was rewritten. Two parts remain open:

- The **default branch is still the working branch**. Flipping it is a repository-settings write,
  which this session's network path refuses (`403 Repository settings writes are not permitted
  through this proxy`), so it needs you: *Settings → General → Default branch*. Deleting the
  working branch has to follow the flip, because GitHub will not delete a default branch.
- **The remote still has no tags.** Unchanged, and unchanged for the same reason recorded in
  ADR-0029 §7 — tag pushes are refused. `v0.1.0`–`v0.9.1` remain local-only, so the repository
  still has no published release.
