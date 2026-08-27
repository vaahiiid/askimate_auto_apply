# ADR-0027 — One version for the whole repository, and a changelog that does not invent history

**Status:** **Accepted** — Vahid's instruction, 2026-08-27

## What was wrong

There was no versioning mechanism at all. All eighteen manifests said `0.0.0`. No git tags, no
changelog, no release tooling. There was no way to answer *"which state of this system are we
looking at?"* other than a commit hash.

Vahid: *"If the current repository does not yet have a proper release/versioning mechanism, stop
and establish one first before continuing with significant implementation work."*

## The decision

**One version, locked across every package**, with the root `package.json` as the authoritative
source and a drift check that fails the build.

### Why not independent per-package versions

Changesets-style independent versioning is the default recommendation for a monorepo, and it is
wrong here for a specific, checkable reason: **every package is `private: true` and linked by
`workspace:*`**, so the version field plays no part in resolution. pnpm links the directory
regardless of what the number says. Nothing consumes these packages individually and nothing ever
will unless one is published, at which point this ADR gets superseded.

So independent versions would buy nothing and cost accuracy. Seventeen numbers nobody reads,
drifting apart, each needing a judgement about whether a shared change was MINOR here and PATCH
there. The failure mode is not picking a wrong number — it is that the numbers stop meaning
anything and people stop reading them.

One number answers the question someone actually asks.

### The mechanism

| Command | What it does |
|---|---|
| `pnpm run version:check` | fails if any manifest has drifted from the root |
| `pnpm run version:set 0.2.0` | sets the version in all eighteen |
| `pnpm run version:bump minor` | computes the next version and sets it |

`version:check` runs inside `pnpm run verify`, so drift fails at development time rather than at
release time — which is when nobody wants to find it. `scripts/version.test.ts` covers the SemVer
arithmetic (including the resets that people get wrong by hand) and asserts the invariant; a
deliberate drift was introduced to confirm both the script and the test fail, then reverted.

### Which increment, for what

Vahid's rules, restated so they are in the repository rather than only in a message:

| Increment | For |
|---|---|
| **PATCH** | bug fixes, security fixes with no API change, internal fixes, regression fixes, doc corrections tied to an existing release |
| **MINOR** | new functionality, new features, backward-compatible APIs, meaningful new capabilities |
| **MAJOR** | breaking architectural or API changes, incompatible behaviour, migrations requiring consumers to change |

While the version is `0.y.z`, SemVer's own rule applies: anything may change. This repository has
never been released or deployed, and `1.0.0` should wait until something has.

### The starting version, and what it does *not* claim

**`0.1.0`**, not a reconstructed history.

The repository already contained a great deal of work when versioning was introduced — 885 tests,
26 ADRs, the whole domain core. The tempting move is to backfill `0.1.0 … 0.9.0` so the changelog
looks like a project that had always been versioned. That would be fabricated release notes, and
Vahid was explicit: *"Do not create fake release notes. Only include actual changes that were
implemented and verified."*

So `0.1.0`'s changelog entry says plainly that everything under **Added** predates the mechanism,
and lists it so the version names a real state rather than an empty one. Only the mechanism itself
is dated to today.

## Consequences

- Every meaningful change now determines its increment **before** committing, updates the
  authoritative source, records what changed and why that increment, and ties the commit to it.
- Unrelated changes do not accumulate under one version.
- A release is tagged `v<version>`.
- `pnpm run verify` fails on version drift.
- If a package is ever published independently, this is superseded by a new ADR and Changesets is
  the tool to reach for. Nothing here makes that hard.

## What this does not fix

The repository has **no `main` branch** — GitHub's default branch is
`claude/askimate-application-automation-ab22hz`, the working branch. Tagging a release on a
feature branch is workable but wrong, and a release process needs a trunk to tag on. That is
Vahid's call, not something to fix silently, and it is raised in
`docs/production-repository-audit.md` §6.
