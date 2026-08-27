# ADR-0028 — Versioning policy: what counts as a release, and what does not

**Status:** **Accepted** — Vahid's instruction, 2026-08-27
**Refines:** [ADR-0027](./0027-one-version-for-the-whole-repository.md) (one version for the whole repository)

## Why this exists separately from ADR-0027

ADR-0027 chose *one version, locked across the repository*, and built the mechanism. It did not say
**what earns a version number**. That gap is the one Vahid named:

> *"I want strict version discipline for every meaningful change, but I do not want arbitrary
> version numbers or version bumps that make the version meaningless… For documentation-only,
> test-only, internal refactoring, research-only, or tooling-only changes, do not simply invent a
> rule. Define explicitly whether they trigger a release version or are tracked separately."*

Both failure modes are real, and they pull in opposite directions:

- **Under-versioning** — meaningful changes accumulate unnamed, and "which state is this?" has no
  answer but a commit hash.
- **Over-versioning** — a bump for every typo, so within a month the version is a build counter and
  nobody can tell `0.4.0` from `0.7.0` in terms of what actually changed.

## The decision

### 1. A release is a change to what the system DOES

**A version bump is earned by a change in observable behaviour or in the public surface of a
package.** Everything else is tracked by commit, and named in the *next* release's changelog entry
if it is worth reading about.

That is the line. It is not "how much work was it" or "how many files changed" — a one-line fix to
the fill guard is a release; a 900-line test file is not.

### 2. The increments

| Increment | For | Examples from this repository |
|---|---|---|
| **MAJOR** | breaking changes; incompatible architectural or product changes; anything requiring a consumer to change behaviour | removing `SecretStore.use`'s consumer argument; changing `ConfirmedValue` so existing values no longer typecheck |
| **MINOR** | new backward-compatible functionality; meaningful new capabilities | the Postgres case store; the secret channel; a new `RunStep` kind |
| **PATCH** | bug fixes; security fixes with no API change; backward-compatible corrections | `tracingIsForbidden` no longer starting tracing; `fillSecret` no longer spending a secret on a missing field |

While the version is `0.y.z`, SemVer's own rule holds: anything may change. This is honest —
nothing here has been released or deployed.

### 3. Changes that do NOT earn a version

**Tracked by commit only.** They appear in the next release's changelog under a
`### Internal` heading when a reader would want to know, and are otherwise found through
`git log`.

| Category | Rationale |
|---|---|
| **Documentation-only** | A doc corrects the record; it does not change what the system does. *Exception:* a documentation change that corrects a **wrong safety claim** is a **PATCH** — the claim was part of the product's contract and it was wrong. |
| **Test-only** | Adding or improving tests changes confidence, not behaviour. *Exception:* if a test change is inseparable from the fix it proves, it rides along with that fix's bump. |
| **Internal refactoring** | No observable change and no public-surface change. If either moves, it was not a refactor. |
| **Research-only** | Work explicitly labelled research or prototype — currently `apps/chat-integration`. It is not part of the product's behaviour and must not imply that it is. |
| **Tooling-only** | Lint config, CI, scripts, editor settings. *Exception:* a change that alters what `pnpm run verify` **enforces** is a **PATCH**, because the guarantees the repository makes have changed. |
| **Dependency bumps** | PATCH-level and no behaviour change: commit only. A dependency bump that fixes a security issue affecting this system is a **PATCH**. A major dependency upgrade that changes behaviour follows the change it causes. |

### 4. Traceability is required regardless

Every change — versioned or not — must be traceable and documented. What differs is *where*:

- **Versioned changes** → CHANGELOG entry, version bump, git tag, commit.
- **Unversioned changes** → commit message saying what and why, and a note in the next release's
  `### Internal` section if a reader would want it.

**No change is untracked.** The distinction is about what the version number *means*, not about
whether the work is recorded.

### 5. Batching, and its one rule

Several unversioned changes may sit between releases. Several *versioned* changes may not be
silently merged into one version: if two independent capabilities land, that is either two MINOR
bumps or one MINOR whose changelog entry lists both as separate `### Added` items. What is
forbidden is a version whose entry hides that two unrelated things happened.

### 6. Reporting

Every release-level change reports, in the response and in the commit:

```
Previous version:
New version:
Version bump:
Reason for bump:
Changed components:
Breaking changes:
Migration required:
```

An unversioned change reports `Version bump: none` and why — so the decision was visibly *made*
rather than skipped.

### 7. This policy does not change silently

Changing the policy requires a new ADR superseding this one. Vahid: *"Do not silently change the
versioning strategy in the future."*

## Worked examples

| Change | Bump | Why |
|---|---|---|
| Postgres case store behind the existing port | **MINOR** | new capability, backward compatible; the in-memory store still works |
| `tracingIsForbidden` no longer starts tracing | **PATCH** | security fix, no API change |
| ADR-0028 (this document) | **none** | documentation. But it is *tooling-policy* documentation with no enforcement change |
| Wiring `version:check` into `pnpm run verify` | **PATCH** | changes what the repository enforces |
| Relabelling `apps/chat-integration` as research | **none** | documentation correcting a claim about scope — no safety claim was wrong, the tests always said what they tested |
| Renaming a private function | **none** | internal refactor |
| Removing `SecretStore.use` | **MAJOR** | breaking |

## Consequences

- The version number keeps meaning "what does this system do differently".
- `git log` remains the record for everything else, and nothing is lost.
- A contributor has a rule to apply rather than a judgement to make alone, and the exceptions are
  written down rather than folklore.
