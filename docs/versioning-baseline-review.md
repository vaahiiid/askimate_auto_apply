# Review of the `0.1.0` baseline and the locked single-version strategy

**Date:** 2026-08-27
**Asked for by Vahid:** *"Review the decision to establish `0.1.0` and the locked single-version
strategy across the monorepo. Do not automatically undo it, but clearly report…"*
**Outcome: both decisions stand.** Reasoning below, including the conditions that would reverse the
second one.

---

## 1. Was `0.1.0` the correct baseline?

**Yes — with one thing I would state more plainly than I did.**

### Why not `1.0.0`

`1.0.0` in SemVer means *this public API is stable and I will break it only on a MAJOR*. Nothing
here has been released, deployed, or consumed by anything outside the repository, and the
architecture is still moving — three ADRs landed today. Declaring stability we do not have would
make the first breaking change either a lie or a `2.0.0` within a week.

### Why not `0.0.1`

PATCH means *a fix to something that existed*. There was no previous version to fix. The first
version of a thing is not a patch of nothing.

### Why not backfilling `0.1.0 … 0.9.0`

Tempting, because the repository already held 26 ADRs and 885 tests when versioning arrived, and a
reconstructed history would look tidier. It would be **fabricated release notes** — Vahid was
explicit — and it would assign dates and boundaries to releases that never happened.

### The one thing I would state more plainly

`0.1.0`'s changelog entry lists the whole pre-existing system under **Added**. That is accurate in
the sense that the version *names a state containing all of it*, but "Added" is the wrong verb for
work that predates the mechanism. The entry says so in prose. **A cleaner form would have been a
separate `### Baseline` heading**, and future entries will not have this problem because they will
describe only what changed. I am not rewriting the entry — churn on a released number for a
presentational point is not worth it — but it is worth naming rather than defending.

### Verdict

**`0.1.0` stands.**

---

## 2. Why is one repository-wide version currently appropriate?

Four reasons, in order of how load-bearing they are.

**1. Version numbers play no part in resolution here.** Every package is `private: true` and every
internal dependency is `workspace:*`. pnpm links the directory regardless of what the version field
says. Independent versions would be seventeen numbers that affect nothing.

**2. Nothing is published.** There is no registry, no consumer outside this repository, and no
install that could pin `@askimate/aas-domain@0.3.1`. The audience for a version number is currently
one team reading one repository.

**3. The packages ship as one system.** `aas-domain`, `aas-secrets` and `aas-browser-runner` are not
three products — they are three layers of one application-automation system that is always deployed
together. A change to the domain's `ConfirmedValue` is a change to the browser runner's behaviour.

**4. Independent versions cost accuracy at this size.** Every shared change would need a per-package
judgement: MINOR for `secrets`, PATCH for `orchestrator`, none for `domain`? The realistic outcome
is not wrong numbers but *meaningless* ones — they drift, nobody reconciles them, and people stop
reading them.

### The honest counter-argument

Independent versioning gives finer-grained changelogs: a consumer of `aas-domain` alone would see
only what affected them. That is a real benefit and it is worth **zero** today, because there is no
such consumer. It becomes worth something the moment there is one — which is §3.

---

## 3. When would independent package versioning become necessary?

Any **one** of these should trigger a new ADR superseding ADR-0027:

| # | Condition | Why it forces the change |
|---|---|---|
| **1** | **Any package is published to a registry** — npm, a private registry, a GitHub package | A consumer pins a version. `@askimate/aas-domain@0.1.0` must then mean something specific about *that package*, not about a repository the consumer cannot see. **This is the decisive one.** |
| **2** | **A package is consumed by a separate repository** — for instance AskiMate Chat importing `aas-secrets` directly | Same reason as 1, even without a registry: a git-ref dependency needs a meaningful version. |
| **3** | **Deploy cadences diverge** — the browser runner ships weekly while the domain core ships monthly | One version cannot describe two release trains; it would bump for changes that did not reach the other. |
| **4** | **A package is extracted or open-sourced** | It acquires its own audience and its own compatibility promises. |
| **5** | **The repository exceeds roughly 30 packages with several teams** | Per-package judgement stops being overhead and starts being the only tractable way to describe change. |

**When one of these arrives, the tool is [Changesets](https://github.com/changesets/changesets)** —
it is the mature answer for a pnpm workspace, handles inter-package dependency bumps, and generates
per-package changelogs. Nothing in the current mechanism obstructs adopting it: `scripts/version.ts`
is 230 lines and would be deleted.

**Condition 2 is the plausible near-term one.** If the production AskiMate application ends up
importing `@askimate/aas-secrets` rather than having the secure endpoint ported into it, that is
condition 2 and this decision is revisited.

---

## 4. What exactly constitutes a release?

Defined in full in **[ADR-0028](./decisions/0028-versioning-policy.md)**. In short:

> **A release is a change to what the system does, or to the public surface of a package.**

- **Earns a version:** new capabilities (MINOR), behaviour and security fixes (PATCH), breaking
  changes (MAJOR).
- **Does not earn a version:** documentation, tests, internal refactoring, research/prototype work,
  tooling — each with a stated exception where the change alters a safety claim or what
  `pnpm run verify` enforces.
- **Everything is traceable either way.** Versioned changes get a changelog entry, a bump and a
  tag; unversioned ones get a commit message and, where a reader would want it, an `### Internal`
  note in the next release.

A release is **marked** by: the version in all eighteen manifests, a `CHANGELOG.md` entry, a commit
carrying the version report, and a `v<version>` tag on the trunk.

### A release is not a deployment

Nothing in this repository has been deployed. A version marks a **state of the source**, and
`CHANGELOG.md` says so at the top. When something is deployed, the two concepts separate and this
needs revisiting.

---

## 5. Summary

| Question | Answer |
|---|---|
| Was `0.1.0` the correct baseline? | **Yes.** One presentational point noted, not worth rewriting. |
| Is one repository-wide version appropriate? | **Yes**, for four reasons, the strongest being that `workspace:*` makes version numbers inert. |
| When would independent versioning be needed? | Five named conditions; publication or external consumption are decisive. Changesets is the tool. |
| What is a release? | A change to what the system does or to a package's public surface — ADR-0028. |

**No change recommended. Both decisions stand.**
