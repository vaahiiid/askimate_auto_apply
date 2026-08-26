# The model-blind secret channel — implementation report

**Date:** 2026-08-26
**Status:** Built, tested, and **not connected to anything live.**
**Decision record:** [ADR-0026](./decisions/0026-a-password-the-model-can-ask-for-and-never-see.md)
**Verification:** `pnpm run verify` — 44 test files, 885 tests passing; typecheck, lint and
dependency boundaries green.

---

## 1. The exact data flow

```
  ┌─ THE MODEL ────────────────────────────────────────────────────────────┐
  │                                                                        │
  │  1. issues request_secret { studentRef, purpose, target,               │
  │                             explanation, singleUse: true, ttlSeconds } │
  │     ── metadata only. No field on this type can hold a password. ──    │
  └──────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
  ┌─ THE STORE (packages/secrets) ─────────────────────────────────────────┐
  │  2. validates the request → mints sr_<32 hex>                          │
  │  3. returns SecretPrompt { channel: "secure_control", title,           │
  │                            explanation, requiresConfirmation,          │
  │                            portalHost, expiresAt, observedRules }      │
  └──────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
  ┌─ ASKIMATE CHAT ────────────────────────────────────────────────────────┐
  │  4. renders a DEDICATED PASSWORD CONTROL — not a chat message          │
  │  5. student types it (+ confirmation, on account creation)             │
  │  6. POSTs it to the secure endpoint. It never becomes a chat turn.     │
  └──────────────────────────────┬─────────────────────────────────────────┘
                                 │  ◄── plaintext exists from here
                                 ▼
  ┌─ THE STORE ────────────────────────────────────────────────────────────┐
  │  7. submit(requestId, secret, now) → SecretHandle  sh_<32 hex>         │
  │     plaintext held in a #private field of a non-exported class         │
  │     lifecycle: secret_requested → secret_received                      │
  └──────────────────────────────┬─────────────────────────────────────────┘
                                 │
              handle ────────────┼──────────► the model may see this,
                                 │            and it resolves to nothing
                                 ▼
  ┌─ THE AUTOMATION (apps/browser-runner) ─────────────────────────────────┐
  │  8. fillSecret({ page, store, claim, locator })                        │
  │     • refuses unless tracingIsForbidden(page.context())                │
  │     • refuses unless page.video() === null                             │
  │     • establishes the field EXISTS before spending anything            │
  │  9. store.use(claim, consumer, task)                                   │
  │     • five checks: student, purpose, host, case, expiry                │
  │     • entry TAKEN AND FORGOTTEN — synchronously, before the task runs  │
  │     • lifecycle: secret_received → secret_consumed                     │
  │ 10. task: target.fill(secret) → verify LENGTH only → return            │
  └──────────────────────────────┬─────────────────────────────────────────┘
                                 │  ◄── plaintext unreachable from here
                                 ▼
                      account created · student owns the password
```

---

## 2. Where plaintext exists, and for how long

| Location | Lifetime | Reachable by |
|---|---|---|
| The student's own keyboard and browser | theirs | them |
| The HTTPS request body to the secure endpoint | one request | TLS-protected; never logged |
| `SecretEntry.#secret`, a private field of a non-exported class | **≤ 5 minutes** (TTL), or until spent — whichever is first | only `SecretStore.use` |
| The `task` callback's parameter in `secret-fill.ts` | **one `fill()` call** | the callback body, ~9 lines, reviewable in full |
| Chromium's password input in an untraced, unrecorded context | until the page closes | the page |

**The TTL ceiling is 15 minutes and the orchestrator asks for 5.** A request that is never answered
is destroyed by `sweep()`; one that is answered and never spent is destroyed at expiry.

### The honest limits

- **A JavaScript string cannot be wiped.** Dropping the reference makes it unreachable and eligible
  for collection, but the bytes may sit in the heap until the collector runs. A heap dump taken in
  that window would contain them. This is a property of the runtime; no in-process JavaScript design
  avoids it.
- **An operator with a debugger attached to the process can read anything.** The claim is narrower
  and still worth having: nothing an operator can reach *through the product* — a record, a log, an
  event, a trace, an export — contains it.
- **A callback could keep a copy.** `(secret) => secret` is valid code and no type system stops it.
  What the design removes is the *accidental* copy: `use` is conspicuous at the call site, and there
  is exactly one call site in the repository.

---

## 3. Where plaintext is structurally impossible

| Place | Why it cannot be there |
|---|---|
| Model context / chat transcript | The model's only surface is `request_secret` (metadata) and the handle. `packages/llm` cannot depend on the secrets or account packages, and a source check fails the build if it so much as names `EphemeralCredential`, `InMemorySecretStore`, `useSecret` or `getSecret`. |
| `ConfirmedValue` / profile / submission preview | No conversion exists in either direction, pinned by `@ts-expect-error`. `packages/secrets` may not depend on `@askimate/aas-profile`. |
| Playwright trace | The consumer refuses unless `tracingIsForbidden(context)` — and `openSensitiveContext` makes `tracing.start` throw. ADR-0025 established that stopping tracing around the fill does *not* work; only "never started" does. |
| Video | The consumer refuses unless `page.video() === null`, checked against the live page rather than the options we think we passed. |
| Screenshots | Every screenshot on the sensitive path masks `input, textarea, select`. |
| Storage state | Asserted empty of the marker against a real `storageState()` dump. |
| Orchestration state / case record | `RunState.secret` is typed as exactly `{ requestId, lifecycle, handle? }`. There is no field a password fits in. |
| Audit records | `describeSecretUse` returns `AuditSafeText` only, so a raw string cannot be smuggled in beside it. |
| Any serialisation of the store | The store exposes no enumerable state: `JSON.stringify` → `{}`, `inspect({showHidden: true})` → one getter. |
| Interview questions | `FIELD_SPECS` has a test asserting no field is credential-shaped. `request_secret` is a different `RunStep` kind from `interview`, with no conversion. |
| Error messages, stacks, refusal reasons | Asserted against real thrown errors, including one constructed *inside* the callback while it holds the plaintext. |

---

## 4. What the model can and cannot see

**Can see, and it confers nothing:**

- `sh_7f3a…` — 32 random hex characters. Not a hash, not a prefix, not a length. Two students
  choosing the same password get unrelated handles.
- The four lifecycle words: `secret_requested`, `secret_received`, `secret_consumed`,
  `secret_expired`.
- The request metadata it wrote itself: purpose, target host, case, explanation, TTL.

**Cannot see, and has no capability that would obtain it:**

- The password, in any encoding.
- Its length, a hash of it, a masked preview, or a strength score. None of these exists as a field
  anywhere — a length is a fact about the password and would travel wherever the metadata travels.
- Any function that resolves a handle. `getSecret` does not exist, and the build fails if one
  appears.

---

## 5. How single-use destruction works

```ts
const secret = entry.take();          // takes AND nulls, in one step
this.#byHandle.delete(claim.handle);  // still synchronous — no await yet
if (secret === null) return { ok: false, ... };
const result = await task(secret);    // only now
```

`take()` cannot succeed twice: it reads the field, nulls it, and returns what it read. The removal
happens with **no `await` between the lookup and the removal**, which is what makes concurrency safe
— `Promise.all([use(h), use(h)])` cannot have both win, and that is the shape a parallel retry
takes.

Three consequences follow from doing it *before* the task rather than in a `finally`:

1. A task that throws has still spent the secret. **A failed login attempt is a spent password, not
   a retryable one** — retrying means asking the student again, which is the honest response.
2. A task that re-enters `use` with the same handle finds nothing.
3. A spent handle and an invented handle produce byte-identical refusals. Distinguishing them would
   tell a caller that a handle was once real.

---

## 6. The adversarial tests

Marker: `SECRET-PASSWORD-DO-NOT-LEAK-123!`

### `packages/secrets/src/adversarial.test.ts` — 14 tests

| What it proves | How |
|---|---|
| The handle contains nothing of the secret | value, prefix and substring assertions; format pinned |
| The same password gives different handles | two runs, compared |
| A handle survives a JSON round-trip and still cannot be spent twice | `JSON.parse(JSON.stringify(claim))` |
| **The store exposes no state at all** | `JSON.stringify(store) === "{}"`, exact `inspect` output |
| A structured-clone walk finds nothing | `structuredClone`, which walks differently from JSON |
| The prompt, the status and the audit line are clean | every route out of each |
| **Every refusal reason is clean** — including the ones that compare the secret's binding | five refusal paths |
| **An error thrown inside the callback is clean, message and stack** | the one place a secret could be interpolated into a message |
| Orchestration state holds three keys and no password | the exact object a case record would persist |
| A handle is not a `ConfirmedValue`, in either direction | `@ts-expect-error` ×2 |
| A plain string is not a handle | `@ts-expect-error`, plus a runtime refusal |
| A password cannot be proposed into the profile | `@ts-expect-error` |

### `apps/browser-runner/src/secret-fill.test.ts` — 8 tests, real Chromium

| What it proves | How |
|---|---|
| The password reaches the field **and appears in no file the run wrote** | real fill, then every byte of every file — **including inside zip archives** |
| Not as UTF-16, base64 or URL-encoding either | three encodings scanned |
| No trace, no video | file-type scan |
| The handle is spent — a retry needs a fresh prompt | second `fillSecret` refused |
| A truncating field is reported **without reporting what was truncated** | `maxlength="8"`; message says "32 characters were typed and 8" |
| A missing field does **not** spend the secret | the bug found and fixed while writing this |
| An ordinary (traced) context is refused, loudly, before anything is typed | `SecretIntoTracedContextError`; field still empty, handle still live |
| The store's own check refuses it too, not just the call site | belt and braces, asserted separately |
| A **video-recording** context is refused even though tracing is off | `page.video()` check |
| The sensitive context **does** pass — so this is not proving nothing | the other half |

### `packages/secrets/src/secrets.test.ts` — 33 tests

Every request refusal (TTL bounds, missing explanation, credential-shaped explanation, missing
host), every submit refusal (unknown, expired, already-submitted, empty), every consumption refusal
(unknown, expired, wrong student, wrong purpose, wrong host, wrong case, unsafe consumer, consumer
whose check *throws*), sweep, discard, and the lifecycle transition table.

### Two regressions, run to prove the tests are not vacuous

| Regression | Result |
|---|---|
| `packages/llm` imports `InMemorySecretStore` | boundary check **fails**, naming the file and the symbol |
| a `getSecret` is added to the store | boundary check **fails** |
| `#entries` → `entries` (the ordinary refactor) | 2 adversarial tests **fail** |
| plaintext made a public field with every redaction deleted | 2 adversarial tests **fail** |

---

## 7. A correction worth recording

**My first adversarial test of the store was worthless.** It asserted
`assertClean("the store", store)`, and I deliberately regressed the store — public plaintext field,
every redaction override deleted — and **all 46 tests still passed.**

The reason: `#entries` is a private field, and nothing in Node can see through one.

```
JSON.stringify(store)                          →  {}
String(store)                                  →  [object Object]
inspect(store, {depth: 10, showHidden: true})  →  InMemorySecretStore {}
```

A scan that a regression can walk past is not a proof. The assertion is now positive — the store
must expose *nothing* — and both regressions fail it.

This is the same lesson as the trace investigation, where every marker assertion passed on a
reverted fix because a trace is a zip and compression hides plaintext from a substring scan.

---

## 8. Two defects found while building this

### `tracingIsForbidden` was starting tracing

It answered its question by **calling `context.tracing.start()`** and reporting whether it threw. On
a sensitive context that is harmless — the replacement throws before doing anything. On an ordinary
context it *started tracing*: a function whose only job is to detect the leak mechanism was
switching it on, then returning `false` as though it had merely observed something. The real
`start()` is async, so the rejection also escaped the `try` entirely.

Found by an unhandled rejection: the second call reported "Tracing has been already started", which
is only possible if the first one succeeded.

Now a module-private symbol mark carrying the identities of the two installed functions. Reading it
touches nothing, and a context that was marked and then had `start` quietly restored fails the
identity check rather than passing on the mark alone.

### `fillSecret` spent the secret on a missing field

It relied on `toPlaywrightLocator` returning null. **Playwright locators are lazy** — building one
for a selector that matches nothing succeeds, and the failure only arrives when an action times out
thirty seconds later. So the sequence was: secret taken → `fill` hangs → timeout, and the student's
single-use password had been spent on a field that was never there, because of a *blueprint*
mistake.

Existence is now established first, on a 5-second timeout, outside the consumption.

---

## 9. Remaining risks

| Risk | Severity | Mitigation, and what is left |
|---|---|---|
| A callback keeps a copy of the secret | Medium | One call site, 9 lines, reviewable. No type system can prevent it. |
| A `SecretConsumer` that returns `true` and lies | Medium | There is no default and no overload without one, so a caller cannot *forget*. Every implementation is a named type; a boundary test asserts the traced path has none. Not proof against deliberate subversion. |
| Heap residue after the reference is dropped | Low | Inherent to the runtime. A KMS-backed adapter behind the same port would reduce but not remove it. |
| An operator with a debugger on the process | Low | Out of scope by design; the claim is about the product surface. |
| **The chat client renders the prompt as text** | **Medium — not yet closed** | `channel: "secure_control"` exists so a client can refuse. **Nothing on the AskiMate Chat side has been built or verified.** This is the largest open item. |
| The secure endpoint logs the request body | **Medium — not yet closed** | Outside this repository. The endpoint that receives the POST must not log bodies. Needs verifying in AskiMate's infrastructure. |
| `looksLikeAPassword` is a crude check | Low | It is a backstop behind the architecture, not the defence. It catches a lone mixed-case token in prose and nothing more, deliberately. |
| No production secret backend | Accepted | Vahid: *"No production AWS infrastructure. In-memory implementation behind a port."* Done as specified. |

---

## 10. Is it ready to connect to AskiMate Chat?

**The AAS side is ready. Two things outside this repository are not, and both are on the Chat side.**

Ready here:

- `request_secret` is a distinct `RunStep`, emitted only under `student_chosen` with the secure
  channel deliberately selected, and never twice while a box is open.
- The prompt carries everything a control needs to render, including `expiresAt` and only the
  password rules that were actually observed.
- The store, the handle, the single-use destruction and the consumer check are built and tested.
- The one consumer is the untraced browser context, and it refuses everything else.

**Needed on the AskiMate Chat side before this can be switched on:**

1. **A real password control.** It must render on `channel: "secure_control"` and **refuse** to fall
   back to a text message if it does not understand the field. A client that printed the title as a
   message would show a heading with no input under it — visibly broken, which is the intended
   failure mode, but it is still broken.
2. **A secure endpoint that does not log request bodies.** It receives the only plaintext that
   crosses the network. This needs checking against AskiMate's actual logging and APM
   configuration, not assumed.

**One decision for you, and it is the reason I am flagging it rather than deciding it:**

The secure channel is modelled as a **delivery mechanism** for ADR-0020's `student_chosen`, not as a
fifth ranked approach — ranking it does not work, because it shares a precondition with bare
`student_chosen`, so a lower rank is unreachable and a higher one silently replaces the safer
option. The default is `student_types_into_portal`, where AskiMate holds nothing at all.

That means **the secure channel is never chosen automatically.** Someone sets
`passwordDelivery: "askimate_secure_channel"` on the run, deliberately. If you would rather it be
the default for orchestrated runs, that is a one-line change — but it is your call, because it is
the difference between AskiMate holding a student's password for one keystroke and never holding it
at all.

---

## 11. What has NOT been done

Per your instruction — *"No live Ulster integration. Architecture + tests + local fixture only. No
account creation. No registration. No live fill. No live submission."*

- No account has been created on any portal.
- No registration form has been submitted anywhere.
- No live fill has been run.
- Nothing has been submitted.
- No production AWS infrastructure exists for this.
- The only pages touched are local fixtures served from `127.0.0.1` in tests.
