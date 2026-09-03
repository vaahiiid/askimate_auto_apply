# P19 — deliberate regression audit

Eleven mutations, each applied to a source file on disk, **read back from disk to
prove the edit landed**, run against the suites that should catch it, and then
restored from a byte copy taken before the edit — never from `git checkout`,
because a restore that consults version control cannot distinguish "put back"
from "was never changed".

Ten were caught. The eleventh is not reachable, for a reason recorded below
rather than papered over.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | A missing `email_verified` is read as `verified` | `packages/oidc/src/adapter.ts` | **CAUGHT** | `adapter.test.ts`, `p19-identity.test.ts` |
| R2 | The string `"true"` is coerced into verification | `packages/oidc/src/adapter.ts` | **CAUGHT** | `adapter.test.ts`, `p19-identity.test.ts` |
| R3 | UserInfo is never consulted (ID token only) | `packages/oidc/src/adapter.ts` | **CAUGHT** | `p19-identity.test.ts` |
| R4 | UserInfo overrides the signed ID token | `packages/oidc/src/adapter.ts` | **CAUGHT** | `p19-identity.test.ts` |
| R5 | UserInfo is not bound to the ID token's subject | `packages/oidc/src/adapter.ts` | **SURVIVED** | — (see below) |
| R6 | Every outcome but `unverified` is stored as verified | `identity-store.ts` | **CAUGHT** | `p19-identity.test.ts` |
| R7 | An unknown student reads as verified | `identity-store.ts` | **CAUGHT** | `p19-identity.test.ts` |
| R8 | A missing identity store is a skip, not a refusal | `run-driver.ts` | **CAUGHT** | `run-driver.test.ts` |
| R9 | Only an explicit `false` refuses; `null` passes | `run-driver.ts` | **CAUGHT** | `run-driver.test.ts` |
| R10 | The callback compares `state` to the URL's own value | `auth-routes.ts` | **CAUGHT** | `p19-identity.test.ts` |
| R11 | A callback with no login state still signs in | `auth-routes.ts` | **CAUGHT** | `p19-identity.test.ts` |

## What the survivors and the near-misses taught

### R5 — the one that survived, and why it cannot be caught here

`fetchUserInfo` is given the ID token's `sub` as `expectedSubject`, so a UserInfo
response describing a different person is rejected rather than merged. Replacing
that argument with `client.skipSubjectCheck` changes nothing any test can see.

The reason is structural, and it was measured rather than assumed. A test was
written to produce the condition — the local provider's `claims()` hook returning
a different `sub` for the `userinfo` use — and it failed. Reading
`oidc-provider`'s `lib/helpers/account_claims.js` says why:

```js
return {
  ...await ctx.oidc.account.claims(use, scope, claims, rejected),
  sub: ctx.oidc.account.accountId,
};
```

`sub` is forced back **after** the account's own claims. No conforming provider
can be made to return a mismatched subject, so the condition the check defends
against cannot be produced by one. Proving it would mean standing up a
deliberately broken hand-written provider — a fake whose only purpose is to
misbehave — and the check is one argument delegated to a certified library.

The misleading test was **deleted rather than kept**. It passed for a reason
unrelated to its name, and a test like that is worse than no test: it would have
been read later as coverage of a property it never touched.

### R2 — a mutation that measured nothing

The first R2 changed the ternary at the bottom of `identityFromClaims` to accept
the string `"true"`, and survived. Not because the property was untested — there
is a test feeding `"true"`, `1`, `null`, `{}` and `[]` — but because the `typeof`
check above it means that ternary **only ever sees booleans**. The mutation was
in unreachable code.

This is the fifth phase running in which the same shape has appeared: a control
that looks load-bearing, shadowed by another. The fix is the same each time —
follow a survivor to *why* it survived, and only then decide whether the answer
is a missing test or a mutation that never ran. R2 was rewritten to mutate the
`typeof` guard itself, which is reachable, and the existing test caught it.

### R11 — caught by the typechecker before the tests

Removing the `held === null` guard makes `held.state` a type error, so
`pnpm run typecheck` — part of `pnpm run verify` — rejects it three times over.
It was **not** caught by `vitest`, which transpiles without typechecking: the
mutation threw on the null dereference and the surrounding `catch` answered 400,
the same status the correct code returns.

That is the distinction between an assertion of *appearance* and one of
*consequence*. A test reading only the status could not tell a working state
check from a null dereference. `onFailure` was added so the reason is asserted:
the no-cookie test now requires exactly `["no_login_state"]`, and a refusal
arriving from anywhere else fails it.

### R9, R10 — properties that were real but untested

Both were closed with tests rather than argued away:

- **R9** — `verificationOf` has three answers, and `null` (a student this plane
  has no row for) is the third. The guard compares against `true` rather than
  against `false` precisely so `null` refuses, and only a store that actually
  answers `null` can tell the two spellings apart. The real store cannot be made
  to: `conversations.student_id` is a foreign key, so a conversation whose
  student does not exist cannot be created. The driver's `identities` option is
  a one-method port, so the test supplies one that answers `null`.

- **R10** — the pre-existing state-mismatch test sent a *fabricated* code, so the
  exchange failed for that reason whatever the state check did. The new test
  drives a real sign-in to a genuine callback URL, tampers only the `state`, and
  presents it with the real cookie. A service comparing the URL's `state` to
  itself would exchange that code happily.

## What the exercise found in the implementation

R3 and R4 are not hypotheticals — they describe defects that were **present and
shipped-adjacent** until this suite existed.

The adapter's first version read `email` and `email_verified` from the ID token
alone. Against a certified provider it reported `no_email` for **every student**,
verified ones included, because OIDC Core §5.4 returns a scope's claims from the
UserInfo endpoint when an access token was issued. Cognito — the production
provider — does the other legitimate thing and puts them in the ID token, so the
defect would have been invisible in production and total against anything else.

The four "expects false" tests all passed while this was broken. They were
passing for the wrong reason, and only the *verified* case failing exposed it.
That is why the suite now runs two provider shapes and a disagreement case: the
ID-token block alone would still pass against an adapter that read UserInfo only.
