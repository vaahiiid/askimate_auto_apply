# The password flow — audit and plan

**Date:** 2026-08-27 · **Repository version:** `0.6.0`
**Status: AUDIT AND PLAN ONLY. Nothing implemented, no code written, C2 not started.**

> ## The headline
>
> Every component exists and is well tested **in isolation**. **None of them is wired to anything.**
>
> Measured, not assumed:
>
> ```
> $ grep -rn "new InMemorySecretStore" --include=*.ts packages apps scripts | grep -v .test.ts
> (nothing)
>
> $ grep -rn "fillSecret" --include=*.ts apps packages scripts | grep -v .test.ts
> apps/browser-runner/src/index.ts:69         (an export)
> apps/browser-runner/src/secret-fill.ts:122  (the definition)
> ```
>
> The secret store is instantiated nowhere in product code. `fillSecret` is called by its own test
> and nothing else. `ApplicationSession` — the interface `executePlan` actually drives — has no
> secret capability at all.
>
> **The gap between "the secure secret infrastructure exists" and "a real student can safely provide
> a password" is not a missing security control. It is that nothing connects.**

---

## 1. Genuinely complete and proven

Each of these is real, tested against real artefacts, and has had deliberate regressions run against
it.

| Capability | Where | Evidence |
|---|---|---|
| **Ephemeral secret store** | `packages/secrets/src/store.ts` | 33 tests |
| **Single-use, destroyed before the callback runs** | `store.use` | a throwing task still spends it; two concurrent spends cannot both win |
| **No `getSecret` — no resolver exists** | by design | `scripts/check-boundaries.ts` fails the build if one appears |
| **Model blindness at the package level** | boundary rules | `packages/llm` may not depend on `aas-secrets`/`aas-account`, nor *name* `EphemeralCredential`, `InMemorySecretStore`, `useSecret`, `getSecret` — a source-level check, because a deep relative import resolves fine and pnpm never hears about it |
| **Five binding checks** | `store.use` | student · purpose · target host · case · expiry |
| **Indistinguishable refusals** | `store.use` | a spent handle and an invented one return byte-identical output |
| **Untraced browser consumption** | `sensitive.ts`, `secret-fill.ts` | tracing made unavailable (not merely unused); `page.video() === null` checked against the live page |
| **Trace/video/screenshot protection** | ADR-0025 | 8 tests scanning **every byte of every file**, including inside zip archives |
| **Error and log protection** | `redaction.ts`, `audit.ts` | errors carry shapes not values; audit accepts only `AuditSafeText` |
| **Shape-only fill verification** | `fillSecret` | length compared, never the characters |
| **Field existence established before spending** | `fillSecret` | a bad locator no longer burns the student's password |

**Deliberate regressions run against this layer: 6, all caught.**

---

## 2. Research/prototype only — NOT production

**`apps/chat-integration`** is labelled research in its `README.md` and `index.ts` header. It is a
working implementation of the secure endpoint, the secure control and the fail-closed render
decision, built against the **2026-06-18 archived** AskiMate codebase, tested with a real Chromium,
a real Express 5 stack and a real PostgreSQL — 31 tests.

It is **evidence the design is implementable**. It is **not** evidence about askimate.com, and
nothing in it is connected to the orchestrator.

---

## 3. Two corrections to the brief's framing

Both stated plainly rather than worked around.

### 3.1 "Session handoff via `storageState`" — **not implemented**

It appears exactly once in the repository:

```
apps/browser-runner/src/secret-fill.test.ts:172
  await context.storageState({ path: join(dir, "storage-state.json") });
```

That is a **leak-scan test artefact** — the file is written so the test can prove the marker is not
in it. There is no session-handoff capability, no product code that saves or restores a session,
and no design for one. Nothing was lost; it was never built.

### 3.2 The model **cannot** request a credential — and I recommend keeping it that way

Requirement 2 says *"the model requests a credential through a structured capability/tool/directive"*.

Measured: `ModelClient` has exactly three operations — `composeQuestion`,
`composeDocumentRequest`, and interpretation/extraction. **There is no `request_secret` capability
and the model cannot ask for one.**

Today `secretStepFor` in the orchestrator decides, deterministically:

```ts
if (approach !== "student_chosen") return null;
if (state.inputs.passwordDelivery !== "askimate_secure_channel") return null;
```

**This is stronger than the requirement, not weaker.** *"Is a credential needed right now?"* is a
security-relevant decision. A model that can raise a password prompt can be talked into raising one
— by a hostile portal page, by an injected document, by an unlucky turn of conversation — and a
student who is asked for a password by a chatbot has been trained that being asked is normal, which
is precisely what a phishing attempt relies on.

**Recommendation: the orchestrator keeps the decision; the model keeps the wording.** The model
composes the explanation the student reads (as it composes interview questions) and cannot decide
that the moment has arrived.

**This differs from your stated requirement, so I am stopping on it rather than assuming.** If you
want the model to hold the trigger, say so and I will build it that way.

---

## 4. Not implemented

| # | Gap | Consequence today |
|---|---|---|
| **G1** | **No product code path.** The store is instantiated nowhere; `fillSecret` is called by no product code | The flow cannot run at all |
| **G2** | **`ApplicationSession` has no secret capability.** It has `fill`, `fillConstant`, `click`, `attach` — no `fillSecret` | `executePlan` structurally cannot use a secret |
| **G3** | **The account-creation path never touches a secret.** `packages/account` has no `SecretHandle` anywhere | `create_account` cannot set a password |
| **G4** | **No cancellation.** The lifecycle is `requested → received → consumed \| expired`. There is no `secret_cancelled` | A student who changes their mind has no modelled outcome; the box waits for the TTL |
| **G5** | **A handle that died with the process is not reconciled.** The store is in-memory; after a restart the database says `secret_received` for a handle that resolves to nothing. `secretStepFor` returns `null` for `secret_received`, so the run proceeds | The run walks into `create_account` holding a dead handle. It fails at fill time as `unknown_handle` — late and confusing rather than early and clear. A comment in `bindings.ts` names this; no code handles it |
| **G6** | **A password typed into the ordinary chat box is not detected.** `looksLikeAPassword` scans only the *model's own explanation*, never the student's message | The single most likely leak in the whole design is unmitigated |
| **G7** | **Phase 4 is not wired.** `consume_secret` is a domain enum value; `performOnce` is called from nowhere in the secret flow | A crash mid-fill does not escalate as designed |
| **G8** | **`storageState` session handoff** — see §3.1 | Every automation step needs its own sign-in |

---

## 5. What can and cannot be structurally prevented (G6)

You asked for this explicitly, so here is the honest analysis.

**Cannot be prevented.** A student can type anything into a text box. No client-side control stops a
determined or confused person pasting a password into a chat message, and once the message is sent
the plaintext has left their machine.

**Can be done, in decreasing order of value:**

| Measure | Prevents | Cost |
|---|---|---|
| **Disable the chat input while the secure control is open** | The likeliest case by far: the box is right there and the student uses it | ✅ **already built** in the research control |
| **Client-side detection *before* send** — refuse to transmit a message the secure control is expecting, and re-focus the password field | The next likeliest: student types it in the wrong box and hits Enter | Small. Needs no server round trip, and **the plaintext never leaves the browser** |
| **Server-side detection on the chat endpoint** — reject a message that looks credential-shaped while a request is open | A modified or old client | Medium — **and note the plaintext has already crossed the network by then.** Mitigation, not prevention |
| **Never storing a rejected message** | Turning a leak into a transient one | Small, and it is the difference between "a password reached a log" and "a password reached the permanent transcript and is replayed into every future prompt" |

**What detection cannot be:** a reliable password classifier. `looksLikeAPassword` catches a lone
mixed-case token with a digit and a symbol. It will miss `my dog's name is Rex` and will
occasionally flag a course code. It is a **backstop behind the architecture, never the defence** —
and a false negative must not be treated as proof the message is safe.

**The honest summary:** the architecture makes the leak *unlikely and shallow*, not impossible.

---

## 6. The user flow (product, not only backend)

Specified now so the implementation has something to build to.

| Moment | What happens |
|---|---|
| **Before** | The model, in its own words, explains what is about to happen and why — that a password box will appear in the chat, that it is used once, that the password stays theirs. It does **not** say "type your password". |
| **The control** | A distinct panel, not a message. Title, explanation, **the portal host shown explicitly** ("For your account on apply.qahighereducation.com"), a masked password field, a masked confirmation field on account creation, and any password rules **that discovery actually observed** — never invented ones. |
| **Masked** | Yes, both fields. No reveal toggle in v1: a revealed password is a password on a screen in a library. |
| **While open** | The ordinary chat input is **disabled**. |
| **On success** | The box closes, both fields are cleared, the chat re-enables, and the model is told `secret_received` plus an opaque handle. The student sees a plain confirmation — *"Thanks. I have what I need and I'll set your account up now."* |
| **On mismatch** | The box stays open, both fields clear, one line explaining. |
| **On expiry** | The box closes itself, and the student is told the window passed and it will be asked again. **Never silently.** |
| **On cancel** | An explicit "Not now" that closes the box, records `secret_cancelled`, and returns the run to the student with the automation paused — not failed. |
| **If automation cannot use it** | The student is told the password could not be used, is **not** asked to re-enter it automatically, and the run escalates. A second prompt after a failure is how a student ends up entering a password three times into something that is broken. |
| **A new session** | Yes, they enter it again. AskiMate does not hold it, which is the whole point — and this must be said in the first explanation so it is not a surprise. |

---

## 7. The smallest safe plan, independent of Replit

Five steps. Each is testable here, and none requires production access.

### Step 1 — Close the lifecycle gaps *(MINOR)*
`secret_cancelled` as a fifth lifecycle word with its transitions; dead-handle reconciliation so a
resumed run treats a handle from a dead process as expired and asks again, **early and clearly**.
Tests: cancellation; restart-with-dead-handle; every new transition.

### Step 2 — Give `ApplicationSession` a secret capability *(MINOR)*
`fillSecret(locator, claim)` on the interface, implemented by `PlaywrightPreparationSession`
delegating to the existing, proven `fillSecret`. This is G2, and it is what makes the flow
*possible* rather than merely designed. Tests: the interface refuses a traced context; a fake
session cannot obtain plaintext.

### Step 3 — Wire the account-creation path *(MINOR)*
`packages/account` gains a **handle-shaped** account-creation input — never plaintext. The plaintext
still reaches only the callback inside `store.use`. Tests: `@ts-expect-error` that plaintext cannot
enter; the boundary check extended to `packages/account`.

### Step 4 — Wire Phase 4 to the secret consumption *(MINOR)*
`consume_secret` through `performOnce`, so a crash mid-fill escalates instead of silently retrying.
Tests: the restart scenarios, against real PostgreSQL.

### Step 5 — Chat-side mitigations for G6 *(MINOR)*
Client-side pre-send detection in the research control, with the plaintext never leaving the
browser; a documented server-side check for the production adapter to adopt.

**Then, and only then, C2.**

---

## 8. What still requires Replit access

Unchanged, and still exactly three things:

| | Blocked | Why |
|---|---|---|
| **B1** | Audit the live chat/message data path, middleware, logging, telemetry | The question *is* what the live code does |
| **B2** | Insert the secure endpoint into the live application, ordered ahead of its real middleware | It must be committed into that repository |
| **B3** | Connect the real chat UI to the secure control | Same |

Everything in §7 proceeds without them. **No claim about production is made anywhere.**

---

## 9. Version impact

**This document: no version bump** — documentation only, ADR-0028 §3. Recorded under
`[Unreleased] ### Internal`.

Steps 1–5 are each **MINOR** unless implementation reveals a breaking change, which would be
reported before committing.

**Release-state language, kept precise:** repository version `0.6.0`; local tags `v0.1.0` … `v0.6.0`
exist; **no tag has been pushed and there is no published release.**

---

## 10. What I need from you

1. **§3.2 — who holds the trigger?** I recommend the orchestrator decides and the model only writes
   the words. Your requirement 2 says the model requests it. This is a genuine security decision and
   I have not changed direction on my own.
2. **Approve §7 steps 1–5** as the order, or move the boundary.
3. The `student_chosen` principle is **unchanged**: this remains a delivery mechanism, the student
   owns the password, and AskiMate holds plaintext only inside one callback.
