# ADR-0029 — Git workflow, branches and releases

**Status:** **PROPOSED — awaiting Vahid's decision. Nothing in this document has been done.**
**Relates to:** [ADR-0027](./0027-one-version-for-the-whole-repository.md), [ADR-0028](./0028-versioning-policy.md)

> Vahid, 2026-08-27: *"The absence of a proper `main` branch should be treated as a repository
> governance issue that needs a deliberate solution. Do not make structural changes blindly…
> The current Claude-named branch should not automatically become the permanent long-term release
> trunk without a deliberate decision."*

**I have not created any branch, changed any default, or moved any tag.** This is a recommendation.

## The current state — measured

| Fact | Value |
|---|---|
| Branches | one: `claude/askimate-application-automation-ab22hz` |
| GitHub default branch | the same one |
| Tags on the remote | none |
| Tags locally | `v0.1.0` → `11629f4`, **could not be pushed** (see §7) |
| Protection rules | none observed |

Every commit in the repository's history is on that branch. It is not a feature branch that
diverged from a trunk — **it is the entire history**, and the repository has no trunk.

## Recommendation

### 1. `main` is the trunk, created from the current branch

```
git branch main claude/askimate-application-automation-ab22hz
git push -u origin main
# then, in GitHub settings: set `main` as the default branch
```

This preserves every commit — `main` starts at exactly today's HEAD, so nothing is rewritten,
re-authored or lost. The Claude-named branch then becomes an ordinary branch that can be deleted or
kept as a historical reference.

**Why `main` and not the current branch renamed:** the branch name encodes *who* did the work and
*which task*, which is right for a feature branch and wrong for a trunk that will outlive both. A
trunk named after one agent's session is a name that stops making sense in a month.

### 2. No `develop` branch — recommended against

GitFlow's `develop` earns its place when a team must stabilise a release while feature work
continues, and cannot ship from trunk. Neither applies here: one contributor at a time, nothing
released, nothing deployed, and no need to freeze.

A `develop` branch here would mean every change merged twice, two branches that drift, and a
recurring question about which one is true. **Trunk-based, with short-lived feature branches, is
the right shape at this size.** Revisit if there is ever a deployed version that must be patched
while `main` has moved on — at which point release branches (`release/0.4.x`) are the answer, not
`develop`.

### 3. Feature branch naming

```
feat/<short-kebab-description>      new capability          → MINOR
fix/<short-kebab-description>       bug or security fix     → PATCH
chore/<short-kebab-description>     tooling, deps, CI       → usually none
docs/<short-kebab-description>      documentation           → usually none
research/<short-kebab-description>  prototype work          → none (ADR-0028 §3)
```

The prefix states the intended version impact, so the bump is decided when the branch is opened
rather than argued about at merge time. Agent-created branches keep whatever prefix the harness
requires and add the intent in the PR title.

### 4. Merge rules

- **Squash-merge into `main`.** One commit per change, so `git log main` is the list of changes and
  bisect is meaningful. The branch keeps its detailed history until it is deleted.
- **`pnpm run verify` must pass.** Already enforced by CI on every push.
- **`pnpm run verify:integration` must pass** for any change touching persistence, the secret
  channel or the browser runner. Not yet wired into CI — see §8.
- **Never force-push `main`.**
- **Protect `main`** once it exists: require CI green, disallow force-push, disallow deletion.

Review: with one contributor there is nobody to review, and requiring an approval would mean
self-approving, which is worse than not requiring one. Revisit when a second person joins.

### 5. Release process

A release is a change that earned a version under ADR-0028.

```
1. On the feature branch: make the change, with tests.
2. pnpm run verify          (and verify:integration where it applies)
3. Decide the increment     per ADR-0028 §2
4. pnpm run version:bump <major|minor|patch>
5. Write the CHANGELOG.md entry — Added / Changed / Fixed / Security / Breaking
6. Commit. The commit message carries the version report block (ADR-0028 §6).
7. Merge to main (squash).
8. Tag the MERGE COMMIT on main:
       git tag -a v0.2.0 -m "v0.2.0 — <one line>"
       git push origin v0.2.0
9. Create a GitHub Release from the tag, body = the changelog entry.
```

**Step 8 tags `main`, not the feature branch.** The tag must point at a commit that is on the
trunk, or `git describe` on `main` will not find it and the release will not be reachable from the
branch it claims to describe.

### 6. Changelog

Hand-written, in `CHANGELOG.md`, Keep-a-Changelog format. **Not generated from commit messages.**

Generated changelogs read like commit messages, because they are commit messages, and a reader
wants to know what changed *for them* — not that a function was renamed. The entry is written by
whoever made the change, when they still remember why.

`## [Unreleased]` accumulates entries between releases; the bump renames it.

### 7. The unpushed `v0.1.0` tag — what to do about it

**Measured:** `git push origin refs/tags/v0.1.0` returns **HTTP 403**. A branch push to the same
remote succeeded seconds earlier, so this session's credential can write branch refs but not tag
refs.

The tag exists locally at `11629f4`, which is the tagged object for commit `d985ec4`.

**Recommended reconciliation, in this order — do not create a second `v0.1.0`:**

1. Create `main` (§1). `d985ec4` will be on it.
2. Vahid, or a credential with tag-write permission, pushes the existing tag:
   `git push origin refs/tags/v0.1.0` — the same object, so no conflict.
3. If that is impractical, create the tag through GitHub's UI **pointing at `d985ec4`**, and delete
   the local tag rather than keeping a second object with the same name.

**What must not happen:** re-tagging `v0.1.0` at a different commit later. Two objects with one
name is the state that produces "works on my machine" arguments about which `v0.1.0` is real.

Until it is pushed, `v0.1.0` is **local-only** and the repository has no published release. That is
recorded in CHANGELOG.md rather than glossed over.

### 8. What CI should gain

Not part of this proposal's approval, but named so it is not forgotten:

- run `verify:integration` with the existing Postgres service (the job exists, disabled by
  `if: false`, waiting for a Postgres adapter — which C1 provides);
- fail a push to `main` whose version does not match a tag, or whose CHANGELOG has no entry for it.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep the Claude branch as trunk | A trunk named after one agent's session stops making sense quickly, and encodes task-specific detail permanently. |
| GitFlow with `develop` | Two long-lived branches, every change merged twice, for a benefit (stabilising a release while work continues) that does not exist yet. |
| Rename the current branch to `main` | Equivalent in effect and loses the branch name from the record. Creating `main` from it is reversible; renaming is slightly less so. |
| Generated changelog (`conventional-changelog`) | Produces a list of commit subjects. The changelog's readers want what changed for them. |

## Decision required from Vahid

1. Create `main` from the current branch and make it the default? **(recommended: yes)**
2. Trunk-based with no `develop`? **(recommended: yes)**
3. Squash-merge, protect `main`, no review requirement while solo? **(recommended: yes)**
4. Push the existing `v0.1.0` object rather than re-tagging? **(recommended: yes)**
5. Hand-written changelog? **(recommended: yes)**

Nothing happens until these are answered.
