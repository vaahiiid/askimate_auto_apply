# The independent production architecture

**Date:** 2026-08-28 · **Repository version:** 0.11.0 · **Status:** proposal, awaiting decisions
**Scope:** design only. No implementation, no Phase E, no changes to any other application.

**Premise, per Vahid, 2026-08-28:** *"This is an independent product. Assume the existing production
source does not exist… If the current architecture or data model cannot safely support the secure
conversation architecture we are building, we will change it."*

This document therefore designs the system the product needs, not a bridge to anything that exists.
The legacy audit (`phase-e-integration-audit.md`) is retained as evidence about a system we are no
longer building against; where it is cited below it is cited as **a hazard we now design out**, not
as a constraint.

---

## 1. The forces

Five requirements, all of them Vahid's, and they pull against each other:

1. **The student never leaves the conversation.** Not for a password, not for anything.
2. **A secret must never reach** the model, the transcript, the database, logs, telemetry, analytics,
   error reports, or browser storage.
3. **The automation must be able to spend the secret** at a university portal.
4. **The conversation must survive** a refresh, a restart, a dropped connection, and a refused
   request, without losing what the student wrote.
5. **The model drives the conversation**, so it must know *that* a password step happened and *how it
   ended*, without knowing anything about the value.

Phase A–D satisfied all five **inside one page**, using code discipline: an uncontrolled input, a ref
read at submit, a build rule, a fibre-tree test. That work is sound and it stays.

It has one limit, and it is the limit that decides this architecture:

> **No discipline inside a page defends against a script that shares the page.**
>
> Any script on an origin may read `document.querySelector('input[type=password]').value`, attach a
> global `input` listener, or observe the DOM. Whether the React input is controlled is irrelevant to
> a script that reads the element directly. Same-origin policy does not distinguish *our* code from
> *a tag someone added in a console*.

The legacy audit measured exactly that hazard in the wild — a tag manager on the pages that host the
chat and the password fields, with a `connect-src` that permits exfiltration as an analytics
parameter. We are not inheriting that system, but we would recreate the hazard the moment we put a
password box on a page that loads third-party scripts. So the architecture removes the possibility
rather than the tag.

---

## 2. Three planes

| Plane | Name | Origin | Owns | Third-party scripts |
|---|---|---|---|---|
| **A** | Conversation Service | `app.askimate.com` | Users, conversations, the event log, message bodies, LLM calls, product analytics | Permitted, under policy (§9) |
| **B** | Secure Interaction Service | `secure.askimate.com` | Secret requests, the vault, handle minting and spending | **None. Ever.** |
| **C** | Automation Runner | internal only | Browser automation against portals | None |

Plane B is a **separate deployable on a separate origin**, not a route inside Plane A. That single
decision is what converts "the password never enters application state" from a promise the code makes
into a guarantee **the browser enforces**.

### How the student stays in the conversation anyway

The secure control is rendered **inline in the transcript**, at the directive's ordinal position, as a
cross-origin `<iframe>` served by Plane B:

```
app.askimate.com                       secure.askimate.com
┌───────────────────────────────┐
│ transcript                    │
│  ▸ assistant message          │
│  ▸ ┌───────────────────────┐  │      ┌──────────────────────────┐
│    │ <iframe src=…/control │──┼─────▶│ GET /control/:requestId  │
│    │  /:requestId>         │  │      │  · its own document      │
│    │                       │  │      │  · script-src 'self'     │
│    │  [password] [confirm] │  │      │  · no analytics, no GTM  │
│    │  [ Set password ]     │  │      │  · POST to its OWN origin│
│    └───────────────────────┘  │      └──────────────────────────┘
│  ▸ composer (send blocked)    │                 │
└───────────────────────────────┘                 │
              ▲                                   │
              └──── postMessage ──────────────────┘
                    {kind, requestId, lifecycle|reason, handle?}
                    — a closed union. Never a value.
```

The student sees one continuous conversation. The browser sees two origins that cannot read each
other's DOM, storage, or memory.

### What this buys, precisely

| Threat | Same-origin page | Cross-origin frame |
|---|---|---|
| A tag manager tag reads the input value | **Possible** | **Impossible** — different origin |
| XSS on the chat page reads the password | **Possible** | **Impossible** |
| A session-replay tool records keystrokes | **Possible** | **Impossible** |
| An error reporter serialises the DOM | **Possible** | Captures an opaque frame |
| A browser extension reads it | Possible | Possible (out of scope for any web design) |
| The secure origin is itself XSS'd | — | **Catastrophic** — see T3 in §7 |

The last row is the honest cost: isolation concentrates the risk. Plane B becomes a small, boring,
heavily-constrained document precisely because everything now depends on it.

### What it costs

- **Iframe height** must be negotiated by `postMessage`. Real work, and it is fiddly.
- **Focus and keyboard** cross a frame boundary; autofocus and Escape need explicit handling.
- **Styling** cannot cascade in. Plane B needs its own copy of the design tokens, versioned with A.
- **Accessibility**: the frame needs a title and an accessible name; screen-reader flow across frames
  needs testing rather than assumption.
- **Two deployables** rather than one, with a shared release discipline.
- **Safari/iOS**: cross-origin frames and storage partitioning have historically been quirky. Needs a
  real device matrix, not an assumption.

**Alternative considered — same origin, route-scoped CSP.** Serve the control on Plane A but send a
stricter CSP on that route: drop the analytics hosts from `script-src` and `connect-src`, add a
nonce, forbid inline. Cheaper, no frame mechanics, and genuinely better than nothing. It fails on one
point: a single-page application does not re-fetch its document per route, so a route-scoped CSP does
not apply to a control rendered inside an already-loaded SPA. It would require a full-page navigation
to the secure route — which breaks requirement 1 more thoroughly than an iframe does.

**Recommendation: the cross-origin frame.** It is the only option that makes the guarantee structural,
and it is the only one that keeps the student in the conversation.

---

## 3. The conversation model

One append-only event log per conversation is the source of truth. A message is one kind of event.

```sql
CREATE TABLE conversation_events (
  id               bigserial PRIMARY KEY,
  conversation_id  bigint      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ordinal          integer     NOT NULL,           -- dense, per conversation, assigned by the server
  kind             text        NOT NULL CHECK (kind IN (
                     'message',
                     'secret_requested', 'secret_received', 'secret_consumed',
                     'secret_expired',   'secret_cancelled', 'secret_rejected')),
  actor            text        NOT NULL CHECK (actor IN ('student','assistant','mentor','system')),

  -- ONLY a message may carry free text, and it carries it BY REFERENCE.
  body_id          bigint      NULL REFERENCES message_bodies(id) ON DELETE SET NULL,

  -- Secure-turn columns. Closed sets, enforced by the database.
  request_id       text        NULL,
  reason_code      text        NULL CHECK (reason_code IS NULL OR reason_code IN (…closed set…)),
  handle           text        NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, ordinal),

  -- ── The load-bearing constraint ───────────────────────────────────────
  -- A message has a body; nothing else may have one. This is what makes
  -- "a secure event cannot hold what a student typed" a fact about the
  -- schema rather than a convention the code is trusted to keep.
  CONSTRAINT only_messages_have_bodies
    CHECK ((kind = 'message') = (body_id IS NOT NULL)),

  CONSTRAINT secure_events_name_a_request
    CHECK ((kind = 'message') = (request_id IS NULL)),

  CONSTRAINT only_received_has_a_handle
    CHECK (handle IS NULL OR kind = 'secret_received'),

  CONSTRAINT only_rejection_has_a_reason
    CHECK (reason_code IS NULL OR kind = 'secret_rejected')
);

CREATE TABLE message_bodies (
  id           bigserial PRIMARY KEY,
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  redacted_at  timestamptz NULL          -- see §3.3
);
```

### 3.1 Why the body is a separate table

Three reasons, each independently sufficient:

1. **The constraint above becomes expressible.** With `content` on the event row you can only ask a
   human to keep it null; with a foreign key you can ask the database.
2. **Erasure without holes.** A GDPR erasure request, or the retention policy (ADR-0010, ADR-0023),
   deletes or redacts the body row. The event survives, so ordinals stay dense, replay stays correct,
   and the conversation still reads as a conversation with "[removed]" in place of a sentence.
3. **The scan that proves the property gets smaller.** "No secret is in the database" becomes "no
   secret is in `message_bodies.content`", one column instead of a growing list.

### 3.2 Why an event log rather than a message table plus a side table

The current repository has `askimate_messages` and `askimate_conversation_events` as two tables whose
ordinals are aligned **by convention**. Nothing enforces that a message at ordinal 4 and an event at
ordinal 4 are not both claiming position 4. One log, one `UNIQUE (conversation_id, ordinal)`, and the
ambiguity cannot arise.

It also makes the transcript, the model context, and the replay-after-refresh path **the same
projection of the same list**, which is what `projectTranscript` already assumes and what the
two-table split quietly undermines.

### 3.3 Lifecycle

```
                        ┌──────────────────────────────────────────┐
                        │                                          ▼
  (orchestrator)  ─▶ secret_requested ─▶ secret_received ─▶ secret_consumed
                        │      │                │
                        │      │                └────────────▶ secret_expired
                        │      └── secret_rejected ──┐  (rejection does NOT close;
                        │            (reason_code)   │   the request stays open)
                        │      ◀─────────────────────┘
                        ├──────────────────────▶ secret_cancelled   (student abandoned)
                        └──────────────────────▶ secret_expired     (TTL passed)
```

Two deliberate properties, both carried forward from Phase C/D because they were right:

- **A rejection closes nothing.** A mistyped confirmation leaves the request open and the box on
  screen. Closing on a rejection released the composer while the server still held the request — the
  divergence that Phase D removed.
- **Only a lifecycle transition closes a request.** The client cannot decide on its own that a step
  is over.

One deliberate change: **`secret_cancelled` becomes its own lifecycle**, rather than being folded into
`secret_expired` as it is today. The two are the same to the guard and different to everyone else —
the model should say "no problem, shall I try another way?" to one and "that timed out, let me ask
again" to the other, and product analytics should be able to tell an abandonment from a timeout.
**This changes an approved decision and is listed in §8 for your call.**

---

## 4. What may enter each layer

The single funnel principle: for each layer there is **exactly one function** through which data may
reach it, and that function takes the event union — so adding an event kind forces a decision at
every boundary instead of defaulting to "pass it through".

| Layer | Permitted | Forbidden | Enforced by |
|---|---|---|---|
| **LLM context** | `message` bodies where actor ∈ {student, assistant}; one fixed sentence per directive; the lifecycle word; the opaque handle; the reason code | Everything else. No prompt title/explanation, no portal host from an untrusted source, no free text from any non-message event | `buildModelRequest` — the only builder; the DB `CHECK` makes free text on a secure event impossible to begin with |
| **Transcript** | The full event list, projected 1:1 — nothing dropped, nothing reordered | Any item invented client-side; any display sentence carried *on* an event (wording is chosen at render, from a fixed table keyed by code) | `projectTranscript`; `reason_code` is a closed set |
| **Database** | Event rows; message bodies; secret-request metadata (ids, host, purpose, lifecycle, expiry) | **Plaintext secrets, at rest, anywhere, ever.** No encrypted-at-rest secret column either — see §5.4 | The vault holds plaintext in process memory only; there is no column to write it to |
| **Logs** | Request id, conversation id, user id, lifecycle word, reason code, route, status, duration | Request bodies, response bodies, error objects, headers, query strings, anything from Plane B's request path | A structured logger with a **field allowlist** serialiser; `scrubParseErrorBody` before any handler touches an error; a boundary rule forbidding `console.*` in Plane B |
| **Analytics** | Event names and lifecycle words from a closed set, emitted **by Plane A only**, about *that a step happened* | Anything originating on Plane B; any input value; any message body | Plane B loads no analytics and its CSP has no analytics host in `connect-src` |
| **Browser storage** | UI preferences; a composer draft **only while no secure request is open** | Any secret; any prompt content; the auth token (see §8, decision 4); any draft during a secure turn | `composerPolicy.draftPersistence`; Plane B writes no storage at all |

### 4.1 The negative space

Worth stating explicitly, because these are the things that look harmless:

- **No display sentence on an event.** A `message` field on a rejection event is a field somebody
  eventually assembles from input. The code chooses the sentence from the code.
- **No `metadata jsonb` on an event.** An untyped bag defeats every constraint above. Typed columns
  with CHECKs, or a new event kind.
- **No echo of a rejected request body.** Not in a response, not in a hint, not in a log line.
- **No source maps served from Plane B.** They are a readable copy of the one file that matters.
- **No `err.body`.** Body-parser attaches the raw request body to a JSON syntax error. Scrub first,
  always, before anything reads the error.

---

## 5. The secure boundary

### 5.1 The rule

> **A plaintext secret exists in exactly two places, and both are transient: the DOM element the
> student typed it into, and one stack frame inside Plane B. It is never assigned to anything that
> outlives that frame.**

### 5.2 Where it goes, step by step

| # | Step | Plane | What crosses |
|---|---|---|---|
| 1 | Orchestrator decides a password is needed | A | `{caseRef, purpose, targetHost}` — no secret exists yet |
| 2 | `POST /internal/secret-requests` | A → B | Metadata only. Returns `{requestId, prompt}` |
| 3 | Append `secret_requested` event | A | `kind`, `request_id`. No body — the CHECK forbids one |
| 4 | Render the frame at its ordinal | A | A URL containing a request id |
| 5 | Student types | **B's document only** | Nothing crosses. A's origin cannot read it |
| 6 | `POST /v1/secret/:requestId` to B's own origin | B → B | **The one request that carries a password** |
| 7 | Vault stores it, mints a handle | B | Plaintext → process memory, keyed by handle |
| 8 | `postMessage` to A | B → A | `{kind:'secret_status', requestId, lifecycle, handle}` |
| 9 | Append `secret_received` event | A | Lifecycle word + opaque handle |
| 10 | Runner asks B to spend it | C → B | `{handle, caseRef, purpose, targetHost}` |
| 11 | B injects into the browser context, destroys the entry | B/C | Plaintext never returns to the caller |

Step 11 is the shape that already exists in `packages/secrets`: `use()` takes a **callback**, hands
the plaintext to it, and returns the callback's *result*. There is no accessor, no getter, no queue.
That design is kept.

### 5.3 The postMessage contract

The only channel between the planes, and it is deliberately narrow:

```ts
// B → A. A closed union with no free-text member.
type SecureFrameMessage =
  | { kind: "ready";           requestId: string; height: number }
  | { kind: "resize";          requestId: string; height: number }
  | { kind: "secret_status";   requestId: string; lifecycle: SecretLifecycle; handle?: string }
  | { kind: "secret_rejected"; requestId: string; reason: SecretRejectionReason }
  | { kind: "cancelled";       requestId: string };
```

Validated on receipt, every time, all four:

1. `event.origin === SECURE_ORIGIN` — exact string, no prefix match, no regex.
2. `event.source === frameRef.current?.contentWindow` — the right frame, not any frame.
3. `message.requestId` matches the request this frame was rendered for.
4. `kind` and every enum member are parsed against the closed set before use.

A → B carries **nothing**: the request id is in the URL and the auth is a cookie scoped to B. There is
no inbound channel that could be used to inject.

### 5.4 Why the secret is not encrypted at rest instead

Encryption at rest would let a secret be written to a durable store, which sounds stronger and is
weaker: it creates backups, replicas, WAL segments, snapshots and a key-management problem, all
holding something whose entire required lifetime is under five minutes. The stronger property is
**that there is nothing to find**. The cost is that a Plane B restart loses in-flight secrets, which
is a real availability trade — see §8, decision 5.

---

## 6. The production API and persistence model

### 6.1 Plane A — Conversation Service (`app.askimate.com`)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/conversations` | Create |
| `GET` | `/v1/conversations` | List for the authenticated student |
| `GET` | `/v1/conversations/:id/events?after=<ordinal>` | The transcript. One shape for both first load and catch-up |
| `GET` | `/v1/conversations/:id/stream` | **SSE.** The event log is the source; the stream is a tail of it |
| `POST` | `/v1/conversations/:id/messages` | **Fail-closed:** authenticate → check for an open secret request → *only then* read the body. `409 {status:"refused", reason:"secret_request_open", requestId, expiresAt}` |

The ordering in the last row is not a style preference. Reading the body first means there is a code
path in which a mistyped password is pulled into a variable and then discarded; putting the guard
ahead of the read means the value never enters scope at all.

### 6.2 Plane B — Secure Interaction Service (`secure.askimate.com`)

Student-facing:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/control/:requestId` | The document. `frame-ancestors https://app.askimate.com` only |
| `POST` | `/v1/secret/:requestId` | The one request carrying plaintext. 4 kB body cap |
| `DELETE` | `/v1/secret/:requestId` | Cancellation → `secret_cancelled` |
| `GET` | `/v1/secret/:requestId` | Lifecycle only. Never anything derived from the value |

Internal (service-to-service, mTLS or a signed service token, never reachable from the internet):

| Method | Path | Notes |
|---|---|---|
| `POST` | `/internal/secret-requests` | Open a request. Returns `{requestId, prompt}` |
| `POST` | `/internal/secret-uses` | Spend a handle. Body: `{handle, caseRef, purpose, targetHost, consumer}`. Returns the *result* of the use, never the value |

### 6.3 Plane B's response headers, in full

```
Content-Security-Policy: default-src 'none';
                         script-src 'self';
                         style-src 'self';
                         img-src 'self' data:;
                         connect-src 'self';
                         form-action 'self';
                         base-uri 'none';
                         frame-ancestors https://app.askimate.com
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), autoplay=(), clipboard-read=()
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

Note what is absent: no `'unsafe-inline'`, no CDN, no font host, no analytics host. If a style needs
a font it is self-hosted. **`connect-src 'self'` alone forecloses exfiltration**, because there is
nowhere to send anything.

### 6.4 Persistence

| Table | Plane | Holds |
|---|---|---|
| `users`, `conversations` | A | Identity and conversation metadata |
| `conversation_events` | A | The log (§3) |
| `message_bodies` | A | The only free text in the system |
| `secret_requests` | B | `request_id`, `user_id`, `conversation_id`, `case_ref`, `purpose`, `target_host`, `lifecycle`, `handle`, `expires_at`. **No secret column** |
| *(the vault)* | B | Process memory. Not a table |

Planes A and B hold **separate databases with separate credentials**. Plane A cannot read
`secret_requests` and does not need to: it learns lifecycle through `postMessage` and through its own
event log. This means a full compromise of Plane A's database yields no secret metadata beyond what
is already in its event log — ids and lifecycle words.

---

## 7. Threat model

Assets: the student's chosen password; the student's conversation; the student's identity; the
portal account.

| # | Threat | Vector | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Third-party script reads the password | A tag manager or vendor script on the chat page | **Cross-origin isolation.** Plane B loads no third-party code and Plane A cannot read Plane B's DOM | None from Plane A. See T3 |
| T2 | XSS on Plane A reads the password | Injected script on the chat origin | Same as T1 — the input is not on that origin | XSS on A still steals the session; see T14 |
| T3 | **XSS on Plane B** | Any injection on the secure origin | `script-src 'self'`, no inline, no user-controlled HTML, no templating of untrusted input, a deliberately tiny surface, subresource integrity, review discipline | **The concentrated risk.** Accepted consciously; mitigated by keeping B small and boring |
| T4 | Prompt injection makes the model request a secret for an attacker's host | Poisoned KB entry or student input | `targetHost` and `purpose` come from the **case and blueprint**, never from model output. The model can request *a* password; it cannot choose *whose* | Model can still ask at the wrong moment; annoying, not dangerous |
| T5 | Model exfiltrates via the handle | Handle appears in model context | Handle is random (not derived), single-use, and bound to student + case + purpose + target, checked again at spend | A handle in a transcript is useless outside a live vault |
| T6 | Secret reaches a log | `console.error(err)` with `err.body`; a request logger | Scrub before any read; field-allowlist serialiser; no body logging; boundary rule forbidding `console.*` on Plane B | A misconfigured platform log at the load balancer — must be checked, not assumed |
| T7 | Secret reaches analytics | A replay or heatmap tag | No analytics on B; `connect-src 'self'` leaves nowhere to send | None on B |
| T8 | Secret reaches a backup, replica, or snapshot | Plaintext at rest | **There is no column.** Vault is process memory | A heap dump of Plane B; mitigate by not enabling core dumps |
| T9 | Operator or insider reads the vault | An admin endpoint, a debugger | The vault has **no read API**. `use()` takes a callback and returns the callback's result. Every use is audited | A privileged shell on B's host. Reduce blast radius by keeping B minimal |
| T10 | Runner captures it in a screenshot, trace or video | Playwright artefacts | ADR-0025; `confirmNoDiagnosticCapture` gate before any use; artefacts disabled for the credential step | A portal that echoes the password in its own DOM — out of our control, worth detecting |
| T11 | Cross-student replay | Submitting to someone else's request | Ownership checked at submit *and* at spend; same 404 for "not yours" and "does not exist" | None known |
| T12 | Clickjacking the secure frame | A hostile page frames B | `frame-ancestors https://app.askimate.com`; B refuses to render unframed or wrongly framed | None known |
| T13 | Phishing frame — a hostile page *imitating* B | Social engineering | Out of scope for CSP. Mitigate with student education and a consistent, recognisable secure-step presentation | Real, and unsolved by any web mechanism |
| T14 | Session token stolen by a tag or XSS on A | `localStorage` is readable by any script on the origin | **Move the token to an `httpOnly`, `Secure`, `SameSite=Lax` cookie** (§8, decision 4) | A tag can still *act* as the user in-page; it cannot exfiltrate the credential |
| T15 | A refused message is lost | Optimistic clearing | Clear only on acknowledgement; the draft is never touched on any failure path | Student may retype after a full page loss |
| T16 | Client and server disagree about whether a request is open | Divergent close rules | One authority (`openSecureRequest`) for the client, one (`openRequestFor`) for the server, with a browser test that presses Send against the real guard | This is exactly the class of bug Phase D found twice; keep the seam tested |
| T17 | A secret survives a process restart and is spent later | Durable secret storage | There is none — see T8 | Availability cost, §8 decision 5 |

---

## 8. Decisions that must be made before implementation

Each has a recommendation. None should be treated as settled without your word.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **Isolation model** | (a) Cross-origin iframe on `secure.askimate.com`; (b) same origin with a stricter route CSP | **(a).** It is the only option that makes the guarantee structural. §2 states the costs honestly |
| 2 | **Conversation model** | (a) One event log + `message_bodies`; (b) keep messages and events as two tables | **(a).** The `CHECK` in §3 is not expressible under (b) |
| 3 | **`secret_cancelled` as a distinct lifecycle** | (a) Add it; (b) keep folding cancellation into `secret_expired` | **(a).** Changes an approved Phase C/D decision, which is why it is here |
| 4 | **Session token storage** | (a) `httpOnly` cookie; (b) `localStorage` | **(a).** Under (b) any script on Plane A — including a tag — can read the credential |
| 5 | **Vault durability** | (a) Process memory only, secrets lost on restart; (b) durable encrypted store | **(a),** with a health-check-gated deploy so restarts do not land mid-flow. (b) creates backups of the thing we promised not to keep |
| 6 | **Transcript transport** | (a) SSE from the event log; (b) polling | **(a),** with polling as the documented fallback. Polling is simpler and it is what a 2-second interval costs at scale |
| 7 | **Analytics on Plane A** | (a) A tag manager under the controls in §9; (b) first-party, server-side events only | **(b) for the secure flow at minimum.** Plane A's marketing pages are a separate question and yours to weigh |
| 8 | **Repository structure** | (a) Split `apps/chat-integration` into `apps/chat-service` and `apps/secure-service`; (b) keep one app | **(a).** See §10 |
| 9 | **Guest conversations** | (a) Allowed, but a secure turn requires an authenticated, email-verified student; (b) authentication required throughout | **(a).** Guests are a product decision; the secure gate is not |
| 10 | **Identity** | (a) Build an auth service; (b) adopt a managed identity provider | Genuinely yours. The repository currently **verifies** JWTs and issues none, so something must fill this either way |

---

## 9. Google Tag Manager — the four questions

Stated first, because the audit's finding has been misread once already: **GTM's presence is a
measured fact about the legacy system, and its container contents are unknown.** Nothing below claims
a replay tool is installed. Nothing below recommends removing GTM blindly.

### 9.1 Why it is a concern for a secure input flow

Not because tag managers are bad. Because of what a tag manager *is*:

1. **It is a script loader whose payload is chosen at runtime, outside the repository.** Its purpose
   is to run code that no diff contains. Code review, CI, and every build-time control we have —
   including this repository's own boundary rules — are structurally unable to see it.
2. **Any script on an origin can read any input on that origin.** `document.querySelector(
   'input[type=password]').value`, a delegated `input` listener, a `MutationObserver`. The
   uncontrolled-input discipline that Phase B–D established defends against React *state* capture; it
   does not defend against an element read, because nothing in a page can.
3. **Session-replay and heatmap tools do exactly this by design.** Their masking features are
   opt-in configuration, which is to say: a setting someone must not get wrong, on a product whose
   requirement is that the value cannot leak.
4. **A container publish is not a deploy.** No pull request, no review, no rollback discipline,
   and no signal in the repository that anything changed.
5. **On the legacy CSP it also had an exfiltration path**: `connect-src` allowed
   `google-analytics.com`, so a value could leave as an event parameter without violating policy. And
   because the session token was in `localStorage`, a tag could read that too.

The conclusion is not "GTM is unsafe". It is: **a page that loads a tag manager cannot make a
guarantee about what happens to an input on that page.** For a marketing page that is fine. For a
password box it is the whole requirement.

### 9.2 What must be audited in the container

Read-only, in the GTM console; none of it is visible from a repository.

**Inventory**
- Every tag: name, type, trigger, firing/blocking conditions, paused status.
- Every **Custom HTML** and **Custom JavaScript** tag — read the code, line by line.
- Every tag from the **Community Template Gallery**, and its permissions manifest.
- Whether **server-side tagging** is in use, and what the server container forwards.

**Data access**
- Variables of type **DOM Element**, **JavaScript Variable**, **Auto-Event Variable**, **Element
  Visibility**, **Custom JavaScript** — these are how a tag reaches page content.
- **Form Submission** and **Element Visibility** triggers, and anything reading `gtm.element`.
- GA4 **Enhanced Measurement**: whether *Form interactions* is on.
- Any variable or tag referencing `localStorage`, `sessionStorage`, `document.cookie`, or an input
  selector.

**Governance**
- The user list and each account's permission level; who can **publish**.
- Whether 2FA is enforced on every account with publish rights.
- The **version history**: who published what, when, and the diff of each version.
- Whether the container on the production domain is this container or another one.
- Whether any workspace has unpublished changes.

**Scope**
- Which pages the container loads on, and whether that includes any page with a credential field.

### 9.3 Controls to implement

Ordered strongest first.

1. **Serve the secure control from an origin with no tag manager.** This is the control that makes
   the rest optional. Everything below is defence for Plane A.
2. **`connect-src` on the secure origin is `'self'`.** Even a hypothetical injected script has
   nowhere to send anything.
3. **Treat a container publish as a security change.** Restrict publish rights to named people,
   enforce 2FA, require a second reviewer, and record the version diff where code changes are
   recorded.
4. **Ban Custom HTML/JavaScript tags by policy** on any container that loads on an authenticated
   page. Prefer server-side tagging, where the browser never executes vendor code.
5. **Remove `'unsafe-inline'` from Plane A's `script-src`** over time, using a per-response nonce.
   This is a real project, not a config change, because GTM's bootstrap is inline — and that tension
   is itself informative.
6. **Move the session token to an `httpOnly` cookie** so no in-page script can read it (decision 4).
7. **An automated check, in CI.** We already have Playwright driving a real browser: load the secure
   control and assert that the set of script origins is exactly `{secure.askimate.com}` and the set of
   network destinations is exactly `{secure.askimate.com}`. A tag added later fails the build. This
   is the one control that does not rely on anybody remembering.

### 9.4 Should secure controls run under stricter third-party isolation?

**Yes**, and the reasoning is short:

The security requirement is *"a password must never become visible to anything but the vault"*. A
requirement of the form "never" cannot be met by a control whose correctness depends on a
configuration in a third-party console that no build can inspect. Either the guarantee is structural
or it is a promise about a settings page.

Origin isolation is the only mechanism that makes it structural: after it, the question "what tags are
in the container?" stops being a question about the password. It remains a good question about the
session token and about the student's messages — which is why §9.2 and §9.3 still matter — but it is
no longer load-bearing for the secret.

---

## 10. Is this repository sufficient as the foundation?

**Mostly yes as a library; no as a product skeleton.** Assessed honestly:

### Keep unchanged — this is the valuable part

| Module | Why it survives |
|---|---|
| `packages/secrets` | Handle minting, binding, single-use, callback-only consumption, lifecycle transitions. Correct and adversarially tested |
| `chat-transport.ts` | The single model funnel and the closed reason set derived from a runtime array |
| `transcript.ts` | 1:1 projection; a rejection closes nothing |
| `render-decision.ts` | Fail-closed rendering; `composerPolicy` with `typing: "live"` unrepresentable otherwise |
| `SecureControl.tsx` | Uncontrolled, ref-read, no secret-bearing prop. Moves to Plane B, unchanged |
| `useSecureTurn.ts` | Delegates every decision. Its transport changes; its logic does not |
| `scripts/check-boundaries.ts` | The build rules. Extend, do not replace |

### Structural changes required

| # | Gap | Evidence | Change |
|---|---|---|---|
| S1 | **The app is shaped as an integration into a foreign application** — the name, the transcribed schema, the "research build" banner | `apps/chat-integration/src/index.ts` | Split into `apps/chat-service` (A) and `apps/secure-service` (B) |
| S2 | **The schema is transcribed legacy** — `askimate_users.password_hash`, `is_guest`, `guest_session_id`, `needs_expert_review`, `is_user_message` are another product's concerns | `apps/chat-integration/src/schema.ts` | Own schema, per §3 |
| S3 | **No migration tooling for the chat schema.** ADR-0003 requires versioned migrations; this app ships a single `SCHEMA_DDL` string | **Measured**: `packages/case-store/migrations` exists; the chat app has none | Real migrations before any data exists |
| S4 | **No API contract.** ADR-0005 is contract-first OpenAPI | **Measured**: no OpenAPI document anywhere in the repository | Author the contract for §6 before implementing it |
| S5 | **No identity.** The app verifies JWTs and issues none | **Measured**: no `jwt.sign` outside tests | Decision 10 |
| S6 | **`InMemorySecretStore` is the only store.** Fine for a research build; a production choice that must be made deliberately | `packages/secrets/src/store.ts` | Decision 5 |
| S7 | **The client assumes same-origin `fetch`** | `SecureControl.tsx`'s `postSecret` | Under decision 1, B's control posts to its own origin and reports by `postMessage`. Logic unchanged |
| S8 | **F4 is still open** — `replayEvents` has no producer or consumer | Phase D report | Resolved by §6.1's events endpoint, which makes replay a normal read |

### What this means for sequencing

The valuable work is the decision modules and they are done. The missing work is a **product
skeleton**: a schema, migrations, a contract, an identity story, and a second deployable. That is
ordinary engineering, and it is a larger body of work than Phase D was.

---

## 11. What is deliberately not designed here

- **The orchestrator's decision to ask for a password.** It exists as a port; the policy is a product
  question.
- **Mentor and expert-review flows.** They are events in the log; their workflow is out of scope.
- **Billing, plans, and limits.**
- **The visual design.** Every layout, wording and interaction decision remains yours. This document
  specifies data shapes, boundaries and headers, not appearance.
