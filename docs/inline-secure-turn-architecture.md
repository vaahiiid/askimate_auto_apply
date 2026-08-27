# The inline secure turn: a password collected inside the conversation

**Status:** proposal. Nothing here is implemented.
**Date:** 2026-08-27
**Supersedes the UX half of:** `docs/secret-channel-report.md`, `docs/password-flow-audit.md`
**Does not change:** the security model in `packages/secrets`, ADR-0025, ADR-0026

---

## 0. The constraint that changed

Vahid, 2026-08-27:

> *"The student must not be forced to leave the chat at any point in their journey… The entire
> student experience should remain inside the AskiMate chat experience. However, this does not
> mean sensitive data should become an ordinary chat message."*

The previous work treated "not an ordinary chat message" as the whole problem and let the UX fall
where it landed. It landed badly. This document is about fixing that without touching the part
that is right.

## 1. The central finding

**The security architecture already separates the two things that matter. The prototype's user
interface then re-joined them in the wrong place.**

`ChatTurn` in `apps/chat-integration/src/chat-transport.ts` is a union:

```ts
type ChatTurn =
  | { kind: "message";       sender; content: string }
  | { kind: "directive";     directive: "request_secret"; prompt: SecretPrompt }
  | { kind: "secret_status"; lifecycle: SecretLifecycle; handle?: string }
```

A directive is **already a first-class turn in the conversation**. It sits in the same ordered
list as messages. It has no `content` field, so there is no place on it for typed text to sit and
no branch of `buildModelRequest` that could copy one.

That is exactly the architecture Vahid is asking for. The conversational layer and the secure
interaction layer are already distinct *types in one sequence*.

The prototype then throws that away at render time:

```js
// public/secure-control.js
function renderTranscript() {
  for (const turn of turns) {
    if (turn.kind !== "message") continue;   // ← the directive vanishes
    …
  }
}
```

```html
<!-- public/chat.html -->
<div id="transcript"></div>
<form id="composer">…</form>
<section id="secure-control" hidden>…</section>   <!-- ← below the composer, outside the conversation -->
```

So the student sees the conversation stop, the composer grey out, and an unrelated box appear
underneath. Nothing about that is required by the security model. It is a rendering choice, and it
is the wrong one.

**The recommendation is therefore not a new secure channel. It is to render the directive turn
where it already logically belongs — inline, in sequence, in the transcript — and to resolve the
one genuine tension that follows.**

## 2. Two axes people conflate

| | Conversational layer | Secure interaction layer |
|---|---|---|
| **Where the pixels are** | in the transcript | **also in the transcript** |
| **Which pipeline the bytes travel** | `POST /api/askimate/ai`, `askimate_messages`, model prompt | `POST /api/askimate/secret/:id` → `SecretStore` → memory → destroyed |

These axes are independent. Moving the pixels into the transcript does not move the bytes into the
message pipeline. Conflating them is what produced both the old bad UX ("it must be a separate
panel because it is separate") and the risk Vahid names ("do not turn the password into a normal
message merely because the UI appears inside the chat").

The structural property that keeps the bytes apart is not location. It is this:

> **The secure input element is not reachable from the message-send path, and the message input is
> not reachable from the secret-send path.**

In the DOM that is enforced by two separate `<form>` elements with no shared submit handler and no
shared `name` attributes. A `<form>` nested inside a transcript container is still a separate
form. **The guarantee survives the move unchanged.** This is the load-bearing observation of the
whole design.

## 3. Recommended architecture: the Inline Secure Turn

A `request_secret` directive renders as a **turn-shaped card in the transcript**, in sequence,
styled as an assistant turn, containing its own `<form>` with a password input.

```
┌─ transcript ────────────────────────────────────────────┐
│  ai      Great — I can create your Ulster account now.  │
│                                                          │
│  ┌── secure turn ──────────────────────────────────┐    │
│  │ 🔒 Create a password for your university         │    │
│  │    application                                    │    │
│  │    This goes straight to portal.ulster.ac.uk.     │    │
│  │    I never see it.                                │    │
│  │    [ Password            ]                        │    │
│  │    [ Confirm password    ]                        │    │
│  │    ( Set password )                               │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
│  ai      Done — your account is being created.          │
└──────────────────────────────────────────────────────────┘
[ Ask AskiMate…                                  ] ( Send )
```

The student experiences one continuous conversation. Scrollback shows the request in place. The
composer never disappears.

### 3.1 What replaces the disabled composer

`chatInputEnabled` currently returns `false` while a box is open, and
`fail-closed.test.ts:321` pins that behaviour. That is the modal freeze Vahid is rejecting, and it
must go — but it is also the strongest single defence against the most likely leak in the design,
so it cannot simply be deleted.

**Three defences replace it, in order of how much they carry:**

**(a) Autofocus the secure field.** The natural typing target becomes the correct one. Cheap,
invisible, and it removes most of the realistic accident — a student who has just been shown a
password box and starts typing lands in the right place.

**(b) The composer stays live, visually recessed, with honest placeholder text.** Something like
*"You can keep chatting — your password goes in the box above."* The chat is not frozen; the
student is told where the password goes. This is what satisfies the product requirement.

**(c) Server-side quarantine — the one that actually holds.** While a secret request is open on a
conversation, an ordinary message from that user on that conversation is:

- **not persisted** to `askimate_messages`,
- **not sent to the model**, not in `message`, not in `history`,
- answered with a fixed system turn: *"I did not read that while the password box was open — the
  box above is the only place a password should go. Please say it again if it wasn't your
  password."*

This is deterministic, not a heuristic. It does not try to detect a password — it cannot, and
`looksLikeAPassword` is explicitly documented as a backstop rather than a defence. It is a **state
rule**: while this conversation has a live secret request, the ordinary transport is closed for
writes.

**The cost is real and should be stated plainly: a student who types a genuine question during
that window loses it and must retype it.** The window is short (TTL ≤ 15 minutes, ceiling; 5
minutes as issued by the orchestrator; in practice seconds). Losing one chat message is the
correct trade against permanently persisting a password into a table with no redaction path and no
delete mechanism.

**What quarantine does not do:** the message still crossed the wire and was parsed into
`req.body`. Quarantine prevents *persistence and model exposure*, not *transit*. If a request
logger is ever added ahead of the route, it will see that body. That is the same live risk already
documented in `app.ts`, and the same mitigation applies.

## 4. The exact data flow

```
 1. Orchestrator                 nextStep() → RunStep { kind: "request_secret", request }
                                 ── deterministic. The MODEL DOES NOT DECIDE THIS. ──
                                          │
 2. Chat server                  store.request(request, now) → SecretPrompt
                                 bindings.open({ requestId, userId, conversationId,
                                                 caseRef, purpose, targetHost, expiresAt })
                                          │  ← DB row. No plaintext column exists.
 3. → client                     ChatTurn { kind: "directive", prompt }
                                          │  ← NOT a message. No content field.
 4. Client                       decideRendering(prompt, capabilities, now)
                                   ├─ "refuse" → fixed text, no input shown, FAIL CLOSED
                                   └─ "secure_control" → render INLINE TURN, autofocus
                                          │
 5. Student types                value lives ONLY in the DOM input node
                                          │
 6. Submit                       POST /api/askimate/secret/:requestId
                                   Bearer JWT · { password, confirmation, conversationId }
                                          │  ← the ONE request in the client carrying plaintext
 7. Secure endpoint              verify JWT → check binding.userId → check conversationId
                                 → compare confirmation ON THE SERVER
                                 → store.submit(requestId, password, now) → SecretHandle
                                          │  ← plaintext dies with this call frame
 8. → client                     { status: "secret_received", handle }
                                 inputs cleared; card collapses to a settled state
                                          │
 9. Client                       ChatTurn { kind: "secret_status", lifecycle, handle }
                                          │
10. Model sees                   "[A secure password box was shown to the student.]"
                                 "[secret_received · sh_a1b2…]"
                                          │
11. Runner                       fillSecret({ store, claim, consumer: untracedPageConsumer })
                                 → store.use(claim, consumer, task, now)
                                 → entry.take()  ── single-use; gone before task runs ──
                                 → typed into the portal field on an untraced context
                                          │
12. Lifecycle                    secret_consumed. Nothing derived from it exists anywhere.
```

**The model's involvement is at steps 3, 9 and 10 only — and at each of those it handles metadata
it authored or a lifecycle word.** It is not in the path at steps 5–8 in any form.

## 5. What the model can and cannot see

**Can see:**
- The `explanation` it wrote itself, and the `title` derived from `purpose`.
- The fixed sentence `[A secure password box was shown to the student.]` — a literal, not a
  template, so there is no field for anyone to interpolate later.
- `[secret_received · sh_…]` — a lifecycle word and an opaque handle that resolves to nothing
  outside the store's private `Map`.
- The target host, purpose, and TTL — all decided before the student typed anything.

**Cannot see:**
- The password. There is no `getSecret(handle)` and the package's `index.ts` documents why there
  must never be one.
- Its length, hash, strength score, masked preview, or any other derivation. `SecretPrompt` has no
  field that could carry one, by construction — every field is fixed before input exists.
- Whether the confirmation matched, beyond a rejection reason code.
- Anything the student typed into a quarantined message.

**One gap to close (see §8, item 5):** on rejection, the prototype sets a `window` variable and
pushes **no turn at all**, so the model never learns the attempt failed and the conversation
stalls. `secret_rejected` must reach the model as a status turn carrying the reason *code* — never
a message assembled from input.

## 6. What the server can and cannot store

**`askimate_secret_requests` (exists):** `requestId`, `userId`, `conversationId`, `caseRef`,
`purpose`, `targetHost`, `lifecycle`, `handle`, `expiresAt`, `updatedAt`.

There is no plaintext column, no encrypted column, no hash and no length. The row survives a
restart; the secret does not — a refreshed page is told it was asked, and the store is the
authority on whether the handle still resolves. A student in that position is asked again, which
is the honest outcome.

**`askimate_messages`:** receives only `kind: "message"` turns, gated by `persistableContent`,
which returns `null` for everything else.

**Must be added:** a content-free transcript placeholder so a refresh mid-flow does not leave a
hole in the conversation. This must be a **directive record, not a message row** — a message row
would put rendered text on the replay path. See §8, item 6.

## 7. Reuse: what exists, what changes, what is new

### Reusable unchanged — implemented and tested

| Component | Why it survives the change |
|---|---|
| `packages/secrets` (all of it) | The security model is location-independent. Zero changes. |
| `secret-routes.ts` | The endpoint does not care where the pixels are. |
| `bindings.ts` + `schema.ts` | Session binding is unaffected by layout. |
| `render-decision.ts` | Its union has no `chat_message` outcome. That is exactly right and stays. |
| `buildModelRequest` / `persistableContent` | The model funnel is unchanged. |
| `app.ts` middleware audit + `scrubParseErrorBody` | Transport-level, unaffected. |
| `secret-fill.ts`, `sensitive.ts` | Consumption side, unaffected. |
| Orchestrator `RunStep { kind: "request_secret" }` | Already emits the request deterministically. |

**This is most of the work, and it is already done.** The security model needs no revision.

### Changes to existing behaviour

| Change | Why |
|---|---|
| `chatInputEnabled` → removed, replaced by a guarded-composer model | It encodes the modal freeze being rejected |
| `fail-closed.test.ts:321` "disables the ordinary chat input" | Must be **replaced**, not deleted — the new test asserts quarantine instead |
| `renderTranscript` skipping non-message turns | The bug that removed the directive from the conversation |

### Must be built

1. **Inline turn rendering** — directives and statuses rendered in transcript order.
2. **A real React component** for AskiMate's client, replacing the vanilla-JS page.
3. **Guarded composer** — live, recessed, honest placeholder.
4. **Server-side message quarantine** while a request is open.
5. **`secret_rejected` as a status turn** so the conversation continues.
6. **A persisted content-free directive record** so refresh preserves continuity.
7. **Store instantiation and wiring** — the orchestrator → chat → runner path is not connected to
   anything today.

## 8. Failure modes and mitigations

| # | Failure | Mitigation | State |
|---|---|---|---|
| 1 | Student types the password into the composer | autofocus + recessed composer + **server-side quarantine** | to build |
| 2 | Enter in the password field submits the chat form | two separate `<form>` elements | exists |
| 3 | Password manager autofills the wrong field | `autocomplete="new-password"` / `"off"` | exists |
| 4 | An inline card re-populated from a persisted turn | the value is never in the turn list; the record carries no content | to build |
| 5 | Refresh mid-typing | box reopens empty via `GET`; nothing recovered | exists |
| 6 | **React controlled input puts the password in component state** | **uncontrolled input + ref, read at submit** | **new risk** |
| 7 | Client error reporter captures input values | verify masking; do not assume the SDK default | blocked on access |
| 8 | Session replay (Hotjar/FullStory/Clarity) records keystrokes | must be checked against what AskiMate actually runs | blocked on access |
| 9 | Student copies from the secure field into the composer | not technically preventable; quarantine bounds the damage | partial |
| 10 | A client that does not understand the directive renders it as text | `channel` discriminant + refuse | exists |
| 11 | Model echoes a password it somehow saw | `looksLikeAPassword` backstop in `buildSecretPrompt` | exists |
| 12 | **Quarantine fails open after a server restart** | **`find()` must read the database, not the cache** | **new risk** |

### Two findings that are not in any previous document

**Finding A — the React state trap (row 6).** In the vanilla prototype the password exists only as
a DOM node's `.value`. A React *controlled* input puts it in component state, where it becomes
visible to React DevTools, reachable by an error boundary, and serialisable by any error reporter
that captures component state. **Moving to a real component therefore introduces a leak the
prototype does not have.** The control must use an uncontrolled input read through a ref at submit
time. This is a direct consequence of the architecture change and must be a stated rule, not a
convention.

**Finding B — the binding cache does not read through (row 12).** `DatabaseSecretBindingStore.find`
is:

```ts
public find(requestId: SecretRequestId): SecretBinding | null {
  return this.#open.get(requestId) ?? null;   // no database read
}
```

The class comment claims "a read-through cache of open requests"; there is no read-through. After a
process restart, an open request is invisible to the server. For the *endpoint* this fails closed
(a submission 404s), which is why no existing test catches it. **For the quarantine rule it would
fail open**: no known open request means the message path stays open at exactly the moment the
student is most likely to type a password into it. The quarantine check must consult the database.

## 9. Where the constraint has an edge Vahid should know about

`RunStep { kind: "student_handoff" }` exists for email verification, MFA, OTP, CAPTCHA and
payment. Those inherently require the student to look somewhere else — an inbox, an authenticator
app — and the standing rule is that none of them may be bypassed.

The constraint is still satisfiable in the sense that matters: **AskiMate never hands the student
off to another AskiMate surface.** The conversation stays open, shows a live inline waiting state,
and resumes in place when they return. What it cannot do is stop a university's own MFA from
existing. Flagged so it is a known edge rather than a surprise.

## 10. Implementation plan

Ordered so each phase is independently verifiable, and so the riskiest assumption is tested
earliest.

**Phase A — inline rendering and the turn contract** *(no security change)*
Render directive and status turns in transcript order. Replace `renderTranscript`'s skip. Prove
by test that a directive turn renders a control and contributes nothing to `buildModelRequest`.

**Phase B — the guarded composer and quarantine** *(the real security work)*
Remove `chatInputEnabled`; add the server-side quarantine rule; make `find` read through to the
database. Replace `fail-closed.test.ts:321`. Adversarial tests: a message sent while a request is
open reaches neither `askimate_messages` nor the model, **including after a simulated restart**.

**Phase C — rejection and continuity**
`secret_rejected` as a status turn with a reason code. The content-free persisted directive
record. Test that a refresh mid-flow shows the request in place and recovers nothing typed.

**Phase D — the React control**
Uncontrolled input, ref-read at submit. A test that fails if the input is made controlled. Verify
no password reaches component state, an error boundary, or a serialised error.

**Phase E — wiring** *(partly blocked)*
Instantiate the store; connect orchestrator → chat → runner. **The production AskiMate client is
on Replit and inaccessible, so Phases A–D can be built and tested against the research harness but
cannot be integrated into the production chat UI from here.** That limit is a fact about access,
not about the design.

## 11. Product decisions this design does not make

Everything above is resolvable by engineering except one thing, and it is genuinely a product
call rather than a technical one:

**Quarantine costs the student a message.** A genuine question typed during an open password
request is dropped and must be retyped. The alternative — allowing it through — means a mistyped
password is persisted permanently with no redaction path. Engineering says quarantine; whether
that momentary friction is acceptable in AskiMate's voice is a product judgement.

It is not blocking. The recommendation stands as written, and if the answer is "no", the fallback
is (a) + (b) alone with the risk accepted and documented.
