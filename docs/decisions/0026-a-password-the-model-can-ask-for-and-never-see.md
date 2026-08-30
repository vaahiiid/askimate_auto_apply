# ADR-0026 — A password the model can ask for and never see

**Status:** **Accepted** — Vahid's instruction, 2026-08-26
**Extends:** [ADR-0004](./0004-branded-types-for-confirmed-values.md) (branded values),
[ADR-0020](./0020-the-account-belongs-to-the-student.md) (the account belongs to the student),
[ADR-0025](./0025-sensitive-data-never-reaches-a-trace.md) (nothing sensitive reaches a trace)

## The problem

The portal at `apply.qahighereducation.com` requires a password at account creation, and discovery
found no passwordless mechanism. ADR-0020 ranks four ways to deal with that; the second,
`student_chosen`, means the student types their own password — but into **the portal's own form**,
which requires them to leave the conversation and go and drive a university website.

The product is a conversation. So Vahid asked:

> *"Could AskiMate ask the student in the chat to enter/generate a password, and then pass that
> password directly to the browser automation layer as an opaque secret, without the AI model ever
> being able to read, interpret, store, log, or retrieve the actual password?"*

The requirement, in his words:

> *"The password must NEVER become part of the LLM conversation, model context, chat transcript,
> normal message payload, `ConfirmedValue`, profile, audit event, log, trace, screenshot, video, or
> diagnostic artefact."*

## The decision

A password reaches exactly one place: a callback inside an ephemeral in-memory store, called by a
browser context that has proved it captures no diagnostics. Everything else in the system sees an
opaque handle.

> **Amended by [ADR-0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md), 2026-08-30.**
> The callback model is unchanged and so is the absence of a getter. What changed is WHICH PROCESS
> calls `use`: the Secure Plane's fill agent, not the automation runner. The store became the
> envelope vault (ADR-0034), and the browser context is now reached over CDP — so the consumer's
> assertion that it captures no diagnostics is joined by a check the agent makes against the live
> page, which is stronger, because the component performing it is the one holding the plaintext.

### 1. The handle contains nothing

`SecretHandle` is `sh_` plus 32 hex characters of randomness. Not a hash of the secret, not a
prefix, not a length. Two students choosing the same password get unrelated handles.

This is what makes it safe to show the model. A redacted string is a string that has been redacted
*by something*, and behaviours get bypassed — someone reads the private field in a debugger, someone
spreads the object, someone writes `String(value)` in a template. A handle has nothing to redact.
Logging it, putting it in an event, sending it to a model: all harmless, because it confers nothing.

### 2. There is no getter, and there must never be one

```ts
use<T>(claim, consumer, task: (secret: string) => T | Promise<T>, now): Promise<SecretUse<T>>
```

`getSecret(handle): string` would be one line and would undo the whole design: once a plaintext
string is in a caller's scope it is in their closures, their error objects, their stack traces and
whatever they pass it to next. "The caller promises to be careful" is not a property a system has.

`use` does not make it *impossible* for a task to keep a copy — `(secret) => secret` is valid code
and no type system stops it. It moves the problem from "everywhere a string can go" to "the small,
countable, reviewable set of call sites that pass a callback here". `scripts/check-boundaries.ts`
fails the build if `getSecret`, `peekSecret` or `revealSecret` appears in `packages/secrets`.

### 3. Destroyed **before** the callback runs

`use` removes the entry synchronously, with no `await` between the lookup and the removal, and only
then calls the task. Three things follow from the order:

- a task that throws has still spent the secret — a failed login attempt is a spent password, not a
  retryable one
- a task that re-enters `use` with the same handle finds nothing
- **two concurrent consumptions cannot both succeed**, which is the one that would be a real bug:
  `await store.use(...)` twice without awaiting between them is exactly the shape a retry loop takes

### 4. Four checks, all of which must pass

| Check | What it stops |
|---|---|
| student | two cases crossed upstream |
| purpose | a secret given for account creation spent on something else |
| target host + case | **a password typed into the wrong site** |
| expiry | an abandoned conversation leaving a live password in memory |
| consumer confirms no capture | a password reaching a context that could be recording |

A spent handle and an invented one produce the *identical* refusal, byte for byte. Distinguishing
them would tell a caller that a handle was once real.

### 5. The consumer proves it cannot capture

`packages/secrets` cannot see a browser context, and packages may not depend on apps, so the check
is inverted: the consumer asserts and the store demands the assertion.
`apps/browser-runner`'s `untracedPageConsumer` implements it as a **live check against the live
objects** — `tracingIsForbidden(page.context())` and `page.video() === null` — not a flag set at
construction.

A caller could write a consumer that lies. What it cannot do is *forget*: there is no default, no
optional parameter and no overload without one, so a call that has not thought about capture does
not compile.

### 6. Four words, and nothing else, may be written down

`secret_requested` → `secret_received` → `secret_consumed` | `secret_expired`. Nothing leads out of
the last two; that is what "single-use" and "expires" mean written as data rather than as a comment.

There is deliberately no `secret_length` and no `secret_strength`. A length is a fact about the
password and a strength score is derived from it, and neither belongs in a durable record.

### 7. Not a `ConfirmedValue`, in either direction

A `ConfirmedValue<string>` is something a student read back and approved for a university form. It
enters the profile, appears in the submission preview, and `unwrapConfirmed` hands it out as a plain
string. A password is none of those things. There is no conversion either way, pinned by
`@ts-expect-error` directives that fail the build if one is ever added.

### 8. The chat renders a control, not a message

`SecretPrompt.channel` is the literal `"secure_control"`. A chat client that does not understand it
must refuse rather than fall back to a text message; a client that ignored the field and printed the
title would show a heading with no input under it — **visibly broken rather than silently collecting
a password into the transcript.**

`RunStep.request_secret` is a different kind from `RunStep.interview`, and `FIELD_SPECS` has a test
asserting no interview field is credential-shaped. Nobody is going to write
`askStudent("what is your password?")` on purpose; what happens is that the password becomes one
more field in an interview that already asks fifteen questions, because that is the path of least
resistance and the interview already works.

## Why the secure channel is a *delivery mechanism*, not a fifth approach

The obvious move was to add `student_chosen_via_secure_channel` to ADR-0020's `RANKED` list. It is
wrong, and the reason is not obvious until you try it.

`RANKED` is walked in order and the first supported approach wins. The secure channel and bare
`student_chosen` have the **same precondition** — the student is present and the portal lets an
applicant choose a password — so a fifth rank below `student_chosen` could never be reached, and one
above it would silently replace the safer option everywhere.

They are not two points on one scale. They are two answers to a different question: once we know the
student chooses their own password, **who types it into the portal's form?**

```
student_types_into_portal   they do — AskiMate never holds it, not for an instant   (default)
askimate_secure_channel     they type it into chat; our automation types it once
```

The default is the cautious one. Where a student is willing to open the portal and type a password
into its own form, that is better than any mechanism we could build, because the best mechanism
still holds the secret for a moment and this holds it for none.

## What this does NOT claim

- **The secret exists in memory while it is alive.** A JavaScript string cannot be wiped; dropping
  the reference makes it unreachable and eligible for collection, but the bytes may sit in the heap
  until the collector runs. A heap dump taken in that window would contain them. This is a property
  of the runtime, not of this code, and no in-process JavaScript design avoids it.
- **An operator with a debugger attached can read anything.** The claim is narrower and still worth
  having: nothing an operator can reach *through the product* — a record, a log, an event, a trace,
  an export — contains it.
- **A callback could keep a copy.** See §2.

## A defect found while building this

`tracingIsForbidden` answered its question by **calling `context.tracing.start()`** and reporting
whether it threw. On a sensitive context that is harmless. On an ordinary context it *started
tracing* — a function whose only job is to detect the leak mechanism was switching it on, and then
returning `false` as though it had merely observed something. The real `start()` is async, so the
resulting rejection escaped the `try` entirely.

It surfaced as an unhandled rejection in the test that checks an ordinary context is refused: the
second call reported "Tracing has been already started", which is only possible if the first call
succeeded.

The probe is now a **module-private symbol mark** carrying the identities of the two functions
installed by `openSensitiveContext`. Reading it touches nothing, and a context that was marked and
then had `start` quietly restored fails the identity check rather than passing on the mark alone.

## Consequences

- `packages/llm` may not depend on `@askimate/aas-secrets` or `@askimate/aas-account`, and may not
  so much as *name* `EphemeralCredential`, `InMemorySecretStore`, `useSecret` or `getSecret` — a
  source-level check, because `import "../../secrets/src/store.js"` resolves fine and pnpm never
  hears about it.
- `packages/secrets` may not depend on a model SDK, a database driver, or `@askimate/aas-profile`
  — the last because it would be a route for a password to become a `ConfirmedValue` and appear in
  a submission preview.
- The in-memory store is the only implementation. A KMS-backed adapter implements the same port and
  nothing above it changes.
- **Nothing here has been used against a live portal.** No account has been created, no registration
  attempted, no live fill run. That waits on Vahid's approval.
