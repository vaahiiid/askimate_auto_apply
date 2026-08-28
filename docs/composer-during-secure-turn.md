# The composer during a secure turn: prevention, containment, fail-closed

**Status:** design proposal. Nothing implemented.
**Date:** 2026-08-27
**Builds on:** `docs/inline-secure-turn-architecture.md` (central finding approved 2026-08-27)
**UI/UX status:** **PROVISIONAL — NOT APPROVED.** See §0.1.

---

## 0. What changed, and why the previous answer was wrong

The previous document recommended **server-side quarantine** as the primary mechanism: the
composer stays live, and a message sent while a secure request is open is dropped by the server.

Vahid, 2026-08-27:

> *"I do not want the final product experience to silently destroy a genuine student message as
> the normal cost of keeping the composer available."*

That objection is correct, and it exposes a real weakness I understated. Quarantine has two
defects as a *primary* mechanism:

1. **It destroys text as the normal path.** Not an error case — the ordinary consequence of
   typing while a card is open.
2. **The bytes still leave the browser.** Quarantine prevents *persistence and model exposure*. It
   does nothing about *transit*. The password reaches `req.body` on the server, where a future
   request logger would see it. Quarantine was never the strong defence I presented it as.

**Vahid's suggestion — keep composer content local until the secure step finishes — is strictly
stronger on both counts.** It prevents transit entirely and destroys nothing. This document adopts
it and demotes quarantine to what it should always have been: the last line, not the first.

### 0.1 UI/UX is provisional

Vahid, 2026-08-27:

> *"do not finalise, lock in, or treat the UI/UX design as approved without coordinating with me
> first… If a temporary UI is needed to test the architecture, make that explicit and keep it
> clearly provisional."*

Everything in this document about **visual states, copy, layout, placement, wording of hints and
refusals, and interaction detail is provisional and requires Vahid's review.** Where copy appears
below it is there to make a mechanism concrete and testable, not to propose final wording.

What is **not** provisional and is being proposed for approval: the transport boundaries, the
state machine, the persistence boundaries, the model-visibility boundaries, and the server's
fail-closed rules. Those can be implemented and tested behind a deliberately plain provisional UI.

---

## 1. Recommended final architecture: three layers, named honestly

The mistake worth avoiding is treating one mechanism as "the" defence. Three distinct things are
doing three distinct jobs, and conflating them is how a design ends up with a weak primary and an
unexercised backstop.

### Layer 1 — PREVENTION (client): the composer does not transmit

While a secure request is open on this conversation:

- The composer **accepts typing normally.** It is not disabled, not read-only, not hidden.
- The **send action is blocked** — the button is inert and Enter does not transmit.
- **No bytes leave the browser.** Not deferred-and-queued-for-auto-send; simply not sent.
- The text **stays exactly where the student put it**, as an ordinary draft in the input.

This is the whole of the normal path. Nothing is destroyed because nothing is transmitted.

**The critical rule: the buffer is never auto-sent.** Releasing a queue when the secure step
completes would transmit a password that had been typed into the wrong box — converting a
contained accident into a persisted one. When the card closes, the composer simply becomes live
again with the draft still in it. The student's next send is a fresh, deliberate act.

### Layer 2 — CONTAINMENT (client): where the draft may live

- The draft lives in the **input element's own value**, the same place composer text always lives.
  No new exposure surface is created.
- **Draft persistence to `localStorage`/`sessionStorage` is suspended while a secure request is
  open.** Many chat clients persist drafts; doing so here would write a mistyped password to
  durable browser storage. This is a concrete rule with a concrete test.
- The draft is **not** put into a store, a context, or any state container that telemetry or an
  error boundary can serialise — the same reasoning that makes the secure input uncontrolled.
- On refresh or crash the draft is gone. That is a small, accepted UX cost of not persisting it.

### Layer 3 — FAIL-CLOSED (server): the last line, for when the client is wrong

If a message arrives at the ordinary chat endpoint for a conversation with an open secret request,
the server **refuses it**:

- not written to `askimate_messages`,
- not placed in `message` or `history`,
- never sent to the model,
- answered with a typed refusal naming the open `requestId`.

**This is now an abnormal path, not the normal experience.** It fires when the client is stale,
bypassed, crashed mid-guard, or malicious — not when a student types a sentence.

**And it no longer destroys text.** The client does not clear the composer until the server
*acknowledges acceptance*. A refusal therefore restores the draft rather than losing it, and the
client re-synchronises its view of the open request.

### Why three layers rather than one

| | Stops transit? | Preserves text? | Survives a broken client? |
|---|---|---|---|
| Prevention alone | yes | yes | **no** |
| Fail-closed alone | **no** | only with ack-gating | yes |
| **Both** | yes, normally | yes | yes |

Neither is sufficient. Prevention is the good path; fail-closed is the guarantee.

---

## 2. Alternatives considered

### A. Fully disabled composer *(current prototype)*

The composer is `disabled` while a card is open. `fail-closed.test.ts:321` pins this.

- **Security:** strongest client-side — the student *cannot* type a password into it.
- **UX:** the modal freeze Vahid rejected. The chat stops being a chat.
- **Text loss:** cannot type at all, so nothing to lose — but also no way to say *"wait, I don't
  have my password"*, which is a real thing a student needs to say at exactly that moment.
- **Verdict: rejected on product grounds**, and note honestly that it is the *most* secure option.
  We are trading a real margin of safety for a real product requirement, with eyes open.

### B. Visually live but locally buffered *(adopted as Layer 1)*

- **Security:** no transit. Strong.
- **UX:** continuous. Nothing lost.
- **Weakness:** entirely client-side, so it is worth nothing if the client is stale or bypassed —
  hence Layer 3.
- **Verdict: adopted.**

### C. Guarded composer with explicit local blocking

Mechanically the same as B; the difference is whether the block is silent or *signalled* — a
visible indication that the message is held rather than sent.

- **Security:** identical to B.
- **UX:** better than silent blocking, which reads as a bug. A student who presses send and sees
  nothing happen will press it again, then assume the app is broken.
- **Verdict: adopted as the presentation of B.** The exact signalling is **provisional UI** and
  needs Vahid's review.

### D. Server-side quarantine alone *(previous recommendation)*

- **Security:** bytes reach the server. Prevents persistence and model exposure only.
- **UX:** destroys a genuine message as the normal path.
- **Verdict: rejected as primary. Retained as Layer 3.**

### E. Auto-send the buffer on completion

Considered and **rejected on security grounds.** It converts a contained accident into a persisted
one: a password typed into the composer would be transmitted the moment the secure step succeeded,
with no human in the loop. This is worse than every other option including doing nothing.

### F. Clear the composer when the secure step completes

Rejected: it destroys a genuine message, which is the objection this pass exists to answer.

### G. Prompt the student — *"you have an unsent message, send it?"*

Rejected as a default: it is a modal at exactly the moment we are trying to remove modality, and
it trains people to click through. Leaving the draft visible in the composer achieves the same
noticing without the interruption. **Presentation detail — provisional.**

---

## 3. Exact client-side data flow

```
STATE: no open secret request
  composer: live · send: enabled · draft persistence: normal
  send → POST /api/askimate/ai { message, history }
       → composer cleared ONLY on 2xx acknowledgement

  ── directive turn arrives: { kind: "directive", prompt } ──
        │
        ├─ decideRendering(prompt, capabilities, now)
        │    ├─ "refuse"  → no input rendered · composer stays fully live · FAIL CLOSED
        │    └─ "secure_control" → ↓
        ▼
STATE: secure request open
  card:     rendered INLINE in transcript · secure input AUTOFOCUSED
  composer: live for typing · SEND BLOCKED · Enter does not transmit
  draft:    in the input element only · localStorage persistence SUSPENDED
  bytes leaving the browser: NONE from the composer

  secure submit → POST /api/askimate/secret/:requestId  ← the only request carrying plaintext
        │           { password, confirmation, conversationId }
        ├─ 200 secret_received → inputs cleared · card settles · status turn appended
        ├─ 400 confirmation_mismatch → card stays open · BOTH fields cleared · retry
        └─ any other → card closes · status turn appended · run asks again
        │
        ▼
STATE: no open secret request
  composer: live again · send re-enabled · DRAFT STILL PRESENT, NOT SENT
  student's next send is a fresh deliberate act
```

**Three structural rules in this flow:**

1. **The composer's transport is an explicit `fetch`, never a native form submission.** If the
   guard throws and a native submit ran, a form with no `action` navigates to the current URL with
   the field in the query string — putting composer text into browser history, the `Referer`
   header, and the server's access log. That is a worse leak than the one we are preventing, and
   it is avoided structurally by not having a submitting form at all.
2. **The secure input and the composer are in separate `<form>` elements with no shared submit
   handler and no shared `name`.** A stray Enter in the password field submits the secure form.
3. **The composer clears on acknowledgement, never optimistically.** This is what makes a
   fail-closed refusal restore rather than destroy.

---

## 4. Exact server-side data flow

### `POST /api/askimate/ai` — the ordinary message endpoint

```
1. authenticate (Bearer JWT)
2. openRequestFor(conversationId)   ← READS THE DATABASE, not a process-local cache
3. if an open, unexpired request exists:
       → do NOT parse the message into anything retained
       → do NOT write to askimate_messages
       → do NOT include in `message` or `history`
       → 409 { refused: "secret_request_open", requestId, expiresAt }
       → return
4. otherwise: normal path — persist, build history, call the model
```

Step 2 is the whole security value, and it is exactly the finding in
`inline-secure-turn-architecture.md` §8 Finding B. Today `find()` reads only an in-memory `Map`,
so after a restart this guard would **fail open** at precisely the wrong moment.

### `POST /api/askimate/secret/:requestId` — unchanged

Already implemented and tested: JWT → binding ownership → conversation match → server-side
confirmation comparison → `store.submit` → handle. The plaintext dies with the call frame.

### `DELETE /api/askimate/secret/:requestId` — **new, must be built**

Cancellation. Calls `store.discard`, which destroys the entry and sets `secret_expired`. No new
lifecycle word is needed — the existing vocabulary already reads *"The TTL passed, **or the
student abandoned it**"*.

---

## 5. Exact model visibility boundaries

**The model receives:**

| | Value |
|---|---|
| That a box was shown | the fixed literal `[A secure password box was shown to the student.]` |
| Lifecycle | `[secret_requested]` · `[secret_received · sh_…]` · `[secret_consumed]` · `[secret_expired]` |
| Rejection | `[secret_rejected · <reason_code>]` — a code from a closed set, never assembled text |
| Metadata it authored | `explanation`, `purpose`, `targetHost`, TTL |

**The model never receives:**

- the password, or its length, hash, strength, or any masked or derived form;
- anything typed into the composer while a request was open — that never left the browser, and if
  it did (abnormal path) it was refused before reaching `history`;
- the content of a refused message;
- anything from `DELETE` beyond the lifecycle word.

`buildModelRequest` remains the single funnel and can only read `content`, which only `message`
turns have. That property is unchanged by everything in this document.

---

## 6. Exact persistence boundaries

| Store | Written | Never written |
|---|---|---|
| `askimate_messages` | `kind: "message"` turns only, via `persistableContent` | directives, statuses, refused messages |
| `askimate_secret_requests` | requestId, userId, conversationId, caseRef, purpose, targetHost, lifecycle, handle, expiresAt, updatedAt | plaintext, hash, length, encrypted copy — **no such column exists** |
| **`askimate_conversation_events`** *(new)* | a content-free directive record: turn ordinal, kind, requestId, timestamp | any text, any prompt copy that could hold input |
| Browser `localStorage` | composer drafts **only while no request is open** | anything at all while a request is open |
| Server memory | the `SecretEntry`, ≤ TTL, in a `#private` field | — |

The new table exists for one reason: so a refresh shows the request **in place in the transcript**
rather than leaving a hole. It stores an ordinal and a foreign key. Rendering is reconstructed
from `askimate_secret_requests` at read time, so no copy of prompt text is persisted twice and no
row can carry input.

---

## 7. Composer behaviour while a secure turn is active

| Aspect | Behaviour | Status |
|---|---|---|
| Visible | yes, in its normal position | mechanism fixed |
| Accepts typing | yes | mechanism fixed |
| Send button | inert | mechanism fixed |
| Enter | does not transmit | mechanism fixed |
| Focus on card open | moves to the secure input | mechanism fixed |
| Draft on card close | preserved, **not auto-sent** | mechanism fixed |
| Draft persistence | suspended | mechanism fixed |
| How the block is signalled | *(a hint, a tooltip, a state change — TBD)* | **PROVISIONAL — Vahid's review** |
| Copy of that signal | *(placeholder text used in tests is not final)* | **PROVISIONAL — Vahid's review** |
| Visual treatment of the card | *(inline card styling, collapse states)* | **PROVISIONAL — Vahid's review** |

---

## 8. The final role of server-side quarantine

**Demoted from primary mechanism to last-line guarantee.** It exists for four situations and no
others:

1. a **stale** client that has not learned a request is open;
2. a client whose **JS guard failed** partway;
3. a **direct API call** bypassing the client entirely;
4. a **malicious** client.

In all four it refuses without persisting or modelling. In none of them is it the normal student
experience, and in none of them does it lose text — the client still holds the draft because it
had not cleared on acknowledgement.

**Honest limit:** in every one of those four cases the bytes *did* leave the browser and *were*
parsed into `req.body`. Quarantine cannot undo that. If a request logger is ever added ahead of
this route it will see them. This is the same live risk already documented in `app.ts`, and the
same mitigation applies — it is a reason to keep the middleware-order discipline, not a reason to
believe the server erases what it refuses.

---

## 9. The ten scenarios

For each: **browser · bytes out · server · model · persisted.**

### 1. Ordinary text typed into the composer while the card is open
- **Browser:** text accumulates in the input; send inert.
- **Bytes out:** **none.**
- **Server:** nothing happens.
- **Model:** sees nothing.
- **Persisted:** nothing — not even a `localStorage` draft.

### 2. The password accidentally typed into the composer
- **Browser:** identical to (1). It sits in the input.
- **Bytes out:** **none.**
- **Server / model / persisted:** nothing.
- **On card close:** the composer becomes live with the text still visible. **Not auto-sent.**
- **Residual risk, stated plainly:** if the student then deliberately presses send, it becomes an
  ordinary message and is persisted and modelled. **This is not structurally preventable** — it is
  a human typing their password into a text box and choosing to send it. Autofocus, the inert send
  button, and the visible draft all reduce its likelihood; none eliminates it. Password detection
  is explicitly *not* used as the defence.

### 3. The student presses Enter
- **In the composer, card open:** intercepted. No transmission. The held state is signalled
  *(signal is provisional UI)*.
- **In the secure input:** submits the **secure** form — separate `<form>`, separate handler,
  separate endpoint. This is the correct destination and the reason the forms are separate.
- **Bytes out:** only in the secure case, only to `/secret/:id`.

### 4. JavaScript or the UI guard fails
- **Total SPA failure:** nothing renders; no send path exists.
- **Partial failure (an exception inside the guard):** a send may fire.
  - **Bytes out: yes.**
  - **Server:** fail-closed refusal — not persisted, not modelled.
  - **Model:** nothing.
  - **Client:** shows the refusal, re-syncs, **restores the draft**.
- **Structurally prevented:** the "native form submit puts the text in the URL" failure, because
  the composer never uses a native form submission (§3, rule 1).

### 5. Stale client knowledge
- **Client believes no request is open, server knows one is:** client sends → bytes leave →
  server refuses with `{ requestId, expiresAt }` → client re-renders the card and restores the
  draft. Nothing persisted, nothing modelled.
- **Client believes a request is open, server says it expired:** the composer would stay blocked
  forever. Prevented by the client holding `expiresAt` and self-healing when it passes, plus
  reconciliation on any server response. **This is the failure mode that traps a student in a
  blocked composer, and it needs an explicit test.**

### 6. Page refresh
- **Browser:** draft gone (deliberately not persisted). Card re-opens **empty** from
  `GET /askimate/secret/:id`.
- **Bytes out:** an ordinary authenticated GET; no secret material in either direction.
- **Server:** returns lifecycle and binding metadata only.
- **Model:** unchanged.
- **Persisted:** the content-free directive record keeps the request **in place** in the transcript.
- **Cost, honestly:** a genuine draft is lost on refresh. Suspending draft persistence is what
  buys that, and the trade — lose an unsent sentence rather than durably store a possible password
  in the browser — is the right way round.

### 7. Connection reconnects
- **Browser:** page never unloaded, so the draft survives in memory.
- **Bytes out:** a state re-fetch.
- **Server:** returns the open request if still live.
- **Resolution:** same as (5).

### 8. Browser crash, session resumes
- **Browser:** everything in memory is gone — draft, and anything typed into the secure field.
- **Server memory:** the `SecretEntry` survives only if the server did not restart. The binding
  row always survives.
- **Outcome:** the student is asked again. Correct, and already the documented behaviour.
- **Persisted:** binding row; no secret material anywhere.

### 9. The secure request expires
- **Browser:** the card collapses to an expired state on `expiresAt`; composer unblocks; draft
  intact.
- **Server:** `sweep` destroys the entry; later submissions to that id are refused *(already
  implemented and tested)*.
- **Model:** `[secret_expired]`, so it can offer to try again rather than stalling.
- **Persisted:** lifecycle updated to `secret_expired`.

### 10. The student cancels
- **Browser:** card closes; composer unblocks; draft intact.
- **Bytes out:** `DELETE /askimate/secret/:requestId` — **new endpoint, must be built.**
- **Server:** `store.discard` destroys the entry; lifecycle becomes `secret_expired` — the
  existing vocabulary already covers *"or the student abandoned it"*, so no new word is needed.
- **Model:** `[secret_expired]`.
- **Persisted:** lifecycle only.

---

## 10. Resolving the five existing findings

### 10.1 `DatabaseSecretBindingStore.find` must not fail open

**Today:**
```ts
public find(requestId: SecretRequestId): SecretBinding | null {
  return this.#open.get(requestId) ?? null;   // no database read, despite the comment
}
```

**Design.** Split the port by what each caller actually needs, because the two callers have
genuinely different requirements and one signature cannot serve both honestly:

- **`findSync(requestId): SecretBinding | null`** — retained for the secret endpoint, where the
  synchronous read exists so no `await` sits between reading the body and checking ownership. A
  cache miss here **fails closed** (submission refused), which is already the safe direction.
- **`openRequestFor(conversationId): Promise<SecretBinding | null>`** — **new, async, reads the
  database.** This is what the quarantine guard uses. It must never consult the cache, because a
  cache miss here would fail *open*.

The distinction is the design: **a guard whose failure mode is "allow" may not be served by a
cache.** Making that explicit in the type — one sync method that may fail closed, one async method
that must be authoritative — means the next person cannot accidentally reuse the wrong one.

Additionally: the cache-warming comment claiming a "read-through cache" is wrong and is removed
rather than made true, since `findSync` does not need one.

### 10.2 `secret_rejected` must become a status turn

**Today** the client sets `window.__askimateStatus` and pushes **no turn**, so the model never
learns the attempt failed and the conversation stalls.

**Design.** Widen `ChatTurn`:

```ts
| { kind: "secret_status"; lifecycle: SecretLifecycle; handle?: string }
| { kind: "secret_rejected"; reason: SecretRejectionReason }   // new
```

`SecretRejectionReason` is the **existing closed union** from `SecretSubmitResponse` plus the two
client-side outcomes (`endpoint_unreachable`, `prompt_expired`). `buildModelRequest` renders it as
`[secret_rejected · <code>]` — a code from a closed set, never text assembled from input. A
separate turn kind rather than a variant of `secret_status` because `SecretLifecycle` has four
words that are load-bearing elsewhere, and a rejection is not a lifecycle transition: after a
mismatch the request is still `secret_requested`.

### 10.3 Directive state that survives refresh without persisting content

**Design.** A new table, `askimate_conversation_events`:

| column | holds |
|---|---|
| `conversation_id` | which conversation |
| `ordinal` | where in the transcript |
| `kind` | `directive` \| `secret_status` \| `secret_rejected` |
| `request_id` | FK to `askimate_secret_requests` |
| `reason_code` | for rejections; from the closed union only |
| `created_at` | ordering |

**No text column, by construction.** Display content is reconstructed at read time from
`askimate_secret_requests` plus the fixed title/copy table. Nothing that could hold student input
has anywhere to be written, which is the same discipline that makes the secret table safe.

### 10.4 Error boundaries, telemetry and session replay

Four rules, each with a test:

1. **Uncontrolled input, read through a ref at submit.** Never `useState`, never a form library
   that holds values. *(Approved as a hard requirement.)*
2. **The secure card must not be inside a component whose props or state carry the value** — there
   is nothing to carry, but an error boundary serialising the subtree must find nothing regardless.
3. **Telemetry allowlist, not denylist.** Analytics from the secure card emit `requestId` and
   lifecycle only. A denylist is a list someone forgets to extend.
4. **Session replay and error SDK masking must be verified, not assumed.** Replay tools can record
   keystrokes, and SDK defaults change between versions. **Currently unverifiable — the production
   client is on Replit and inaccessible.** Recorded as a blocked item, not as a solved one.

### 10.5 Testing the separation of the two transport paths

Not "read the code and agree it looks separate". Executable:

- A **DOM-structural test**: the secure input's closest `<form>` is not the composer's form, and
  the two forms share no `name`.
- A **transport test**: with the network intercepted, typing into the composer and firing every
  send affordance while a card is open produces **zero requests**.
- A **regression test**: deliberately wire the composer's submit handler to read the secure input
  and assert the suite goes red. If it stays green the separation was never being tested.
- A **type-level test**: `@ts-expect-error` that no `RenderDecision` has a `chat_message` outcome
  *(exists)*, extended to assert no turn kind other than `message` has a `content` field.

---

## 11. Required changes to existing components

| Component | Change | Kind |
|---|---|---|
| `render-decision.ts` `chatInputEnabled` | **removed**, replaced by `composerPolicy(state) → { typing: "live"; send: "blocked" \| "enabled" }` | behaviour |
| `fail-closed.test.ts:321` | **replaced**, not deleted — asserts local buffering instead of disabling | test |
| `bindings.ts` | `findSync` + new async `openRequestFor` reading the database | **security** |
| `chat-transport.ts` | new `secret_rejected` turn kind; `buildModelRequest` renders the code | behaviour |
| `schema.ts` | new `askimate_conversation_events` table | additive |
| `secret-routes.ts` | new `DELETE /askimate/secret/:requestId` | additive |
| ordinary chat route | new fail-closed guard using `openRequestFor` | **security** |
| `src/ChatView.tsx`, `public/index.html` | inline rendering; provisional surface only | **provisional UI** |
| `packages/secrets` | **no change** | — |

---

## 12. Adversarial test matrix

Every row is a deliberate regression: break the mechanism, prove the suite goes red. A row that
cannot be made to fail is not testing anything.

| # | Regression introduced | Must fail |
|---|---|---|
| 1 | Composer send fires a request while a card is open | prevention test |
| 2 | The buffer is auto-sent when the card closes | **no-auto-send test** |
| 3 | Composer clears optimistically before acknowledgement | draft-restoration test |
| 4 | Draft written to `localStorage` while a request is open | containment test |
| 5 | `openRequestFor` reads the cache instead of the database | **restart fail-open test** |
| 6 | Quarantine guard removed from the chat route | fail-closed test |
| 7 | A refused message is written to `askimate_messages` | persistence test |
| 8 | A refused message reaches `history` | model-funnel test |
| 9 | Secure input converted to a controlled component | **React state test** |
| 10 | Composer converted to a native submitting form | URL-leak test |
| 11 | Secure input moved inside the composer's form | DOM-separation test |
| 12 | `secret_rejected` swallowed instead of appended | conversation-stall test |
| 13 | A rejection message assembled from input rather than a code | closed-union test |
| 14 | `askimate_conversation_events` given a text column | schema test |
| 15 | Client ignores `expiresAt` and stays blocked forever | self-healing test |
| 16 | `DELETE` fails to destroy the entry | cancellation test |
| 17 | Two conversations' requests cross-checked incorrectly | binding test *(partly exists)* |
| 18 | Telemetry switched from allowlist to denylist | telemetry test |

---

## 13. Structurally guaranteed vs. only mitigated

**This section is the honest one. Everything above is easier to read than this table is to write.**

### Structurally guaranteed — cannot be violated without a visible code change

1. The password cannot become message content. `ChatTurn`'s non-message variants **have no
   `content` field**; `persistableContent` and `buildModelRequest` can only read one.
2. The password cannot reach the model. One funnel, and it reads `content`.
3. No plaintext, hash or length can be persisted. **No column exists.**
4. A secret is single-use. `entry.take()` nulls before returning; the second call returns null.
5. There is no `getSecret(handle)`. Asserted by a compile-time test.
6. No `RenderDecision` falls back to a chat message. **The value does not exist in the union.**
7. Enter in the password field cannot submit the chat form. Separate `<form>` elements.
8. Composer text cannot reach the URL. No native form submission exists.
9. A refused message cannot be persisted or modelled. It is refused before either.

### Mitigated only — reduced in likelihood, not eliminated

1. **A student deliberately sending a password as a message.** Autofocus, inert send, visible
   draft. Not preventable — password detection is explicitly not the defence.
2. **Bytes in `req.body` on the abnormal path.** Quarantine refuses; it cannot un-receive.
   Mitigated by middleware-order discipline and `scrubParseErrorBody`.
3. **Session replay / error SDK keystroke capture.** Rules defined; **verification blocked** on
   access to the production client.
4. **A student copying from the secure field into the composer.** Not technically preventable.
5. **A password typed into the composer sitting in browser memory** for the life of the page.
   Contained, not eliminated.

### Blocked on access — cannot be resolved from here

- Verification of the production client's error reporter and session-replay configuration.
- Integration of any of this into the real AskiMate chat UI. **The production application is on
  Replit and inaccessible.** Everything above can be built and tested against the research harness;
  none of it can be claimed as production-integrated.

---

## 14. What is being proposed for approval

**Ready for approval now:** §1 three-layer architecture · §3–§6 flows and boundaries · §8 the
demoted role of quarantine · §10 the five finding resolutions · §11 component changes · §12 test
matrix.

**Explicitly NOT proposed for approval, and not to be finalised without coordination:** all visual
design, copy, layout, card styling, hint wording, and interaction detail. Any UI built to exercise
the architecture is a **provisional test harness** and will be labelled as such in the code.

**One residual risk to acknowledge rather than solve:** §13, mitigated item 1. A student can type
their password into the composer and deliberately send it. Every structural defence stops short of
that, and no honest architecture claims otherwise.
