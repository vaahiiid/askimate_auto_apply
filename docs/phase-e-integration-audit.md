# Phase E integration audit — what is needed to connect AAS to the real AskiMate client

**Date:** 2026-08-28 · **Repository version:** 0.11.0 · **Scope:** read-only. No production code was
modified, nothing was implemented, and no repository other than this one was written to.

## Evidence labelling

| Label | Meaning |
|---|---|
| **Measured** | A command was run and this is its output |
| **Read (live)** | Read from `vaahiiid/Universitio` `origin/main` — code that ships today |
| **Read (archive)** | Read from `archive/askimate/` — AskiMate **as of 2026-06-18**, before separation. The direct ancestor of askimate.com, **not** authoritative for what runs there now |
| **Unverifiable** | Cannot be established with the access available |

---

## 0. Access, re-verified today

The previous audit (`production-repository-audit.md`, 2026-08-27) is **confirmed still accurate**, with
two corrections and one material addition.

| # | Check | Result |
|---|---|---|
| 1 | `list_repos` | 3 repos, `has_more: false` — `askimate_auto_apply`, `Universitio`, `ai-admissions-platform` |
| 2 | `ai-admissions-platform` working tree | **Measured**: `fatal: your current branch 'main' does not have any commits yet`. Genuinely empty |
| 3 | `curl -I https://askimate.com`, `www.askimate.com`, `replit.com` | **Measured**: `000` — proxy answered `403` to `CONNECT` for all three (policy denial). The live site cannot be inspected, and neither can Replit |
| 4 | Environment | **Measured**: no Replit token, no AskiMate `DATABASE_URL`, no deployment credential |
| 5 | Local `universitio` clone | **Measured**: was **5 weeks stale** (`58a2c62`, 2026-07-16). `origin/main` is `376926d`, 2026-08-21. The previous audit read the stale tree |
| 6 | AskiMate changes in those 5 weeks | **Measured**: exactly two files, both build output — `lib/db/dist/schema/askimate-conversations.d.ts` and its `.map`. No AskiMate source changed |

**The addition:** the previous audit did not record that Universitio still carries **live, mounted
AskiMate code** — see §7 below. That changes what Phase E has to reckon with.

**Correction to a standing assumption:** the GitHub mirror has **no usable commit history**. Every
Replit publish lands as one squashed commit literally titled *"Published your App"*; the archive and
the live guest-chat route below arrived in the same commit, so nothing can be dated relative to
anything else. **Read (live)**, and it matters: GitHub is a mirror, Replit is the source of truth.

---

## 1. Where the real AskiMate conversation UI lives

**Read (archive).** `archive/askimate/frontend/pages/askimate-dashboard.tsx` — **1,901 lines**, a
single React page with a tab bar (`activeTab: "chat" | …`). It was
`services/universitio/src/pages/askimate-dashboard.tsx` inside the Universitio Vite SPA before
separation.

Supporting files:

| File | Role |
|---|---|
| `frontend/pages/askimate-dashboard.tsx` | The signed-in conversation UI |
| `frontend/pages/askimate-guest-chat.tsx` | Guest chat (349 lines) |
| `frontend/pages/askimate-landing.tsx` | Public landing + hero chat entry |
| `frontend/contexts/AskiMateAuthContext.tsx` | JWT auth; token in `localStorage["askimate_token"]` |
| `frontend/utils/askimate-realtime.ts` | Delta polling + a Web Audio notification beep |
| `frontend/components/ProtectedRoute.tsx` | Route guard |

**Whether askimate.com still runs this code is Unverifiable.** It is the direct ancestor and the best
available evidence; it is 10 weeks old and the product has been developed independently since.

---

## 2. How messages are currently sent and received

**Read (archive)**, cross-checked against the live schema.

**Send** — `askimate-dashboard.tsx:655–760`:

```
POST {BASE_URL}api/askimate/chat
  Authorization: Bearer <localStorage["askimate_token"]>
  { message: content, conversationId? }
```

**Receive** — there is **no WebSocket and no SSE** on the student path. `useEffect` starts
`setInterval(poll, 2000)`:

```
GET {BASE_URL}api/askimate/chat/:conversationId?after=<lastSeenId>
```

The server generates the AI reply **synchronously inside the POST**
(`archive/.../routes/askimate-chat.ts:373` → `generateAiAnswer`, then
`db.insert(askimateMessages)`), so both rows exist before the POST returns; the 2-second poll is what
surfaces the reply. A 30-second `setTimeout` clears the typing indicator if the poll never delivers.

### Three properties of the current composer that Phase E has to face

1. **It is a controlled React input.** `value={messageInput}` / `onChange={setMessageInput}`, in **two
   places** (lines 1289 and 1350). Every keystroke is React component state.
2. **It is cleared optimistically.** On the follow-up-message path `setMessageInput("")` runs
   *before* the `fetch` (line 716). A server refusal destroys the message.
3. **It is disabled while sending** (`disabled={sending}`).

All three are precisely the behaviours the AAS design rejects. This is not criticism of the existing
code — a chat box has no reason to be built any other way — but it means Phase E is a **composer
replacement**, not a component drop-in.

### The message model — **Read (live)**

`lib/db/src/schema/askimate-conversations.ts` is **live in Universitio today**:

```ts
askimateMessages = {
  id, conversationId,
  isUserMessage: boolean,
  sender: text  // "user" | "ai" | "mentor" | "system"
  content: text // NOT NULL — free text
  isRead: boolean,
  metadata: jsonb,   // on "ai" messages: { reviewLevel, needsHumanReview, sources, aiAttempt }
  createdAt,
}
```

`content` is `NOT NULL` free text, and `metadata` is an untyped `jsonb`. **There is no non-message
turn type.** That single fact drives most of §3 and §8.

---

## 3. Where a `request_secret` directive would enter the production client

**Read (archive).** The render loop is `askimate-dashboard.tsx:1175–1220`, switching on `msg.sender`:

- `"system"` → its own branch (line 1175), already rendered differently from a chat bubble
- `"user"` / `"ai"` / `"mentor"` → bubbles
- `msg.metadata?.needsHumanReview` → an extra affordance under an `"ai"` message (line 1220)

So there are three candidate insertion points, and **two of them are wrong**:

| Candidate | Verdict |
|---|---|
| A new `sender` value, e.g. `"directive"` | ❌ `content` is `NOT NULL`, so the row still carries free text, and the row **is** a message — it reaches `askimate_messages`, the dashboard's history, and any prompt built from it. This is the exact path AAS exists to avoid |
| `metadata` on an `"ai"` message | ❌ Same objection, plus the prompt-bearing `content` is still required |
| **A second ordered stream beside the message list** | ✅ The AAS model: `ChatTurn` is a union in which only `kind: "message"` has `content`, and `persistableContent()` returns `null` for everything else |

**Conclusion:** a `request_secret` directive cannot be expressed in the production message model as it
stands. Phase E requires a schema and transport addition on the AskiMate side — the
`askimate_secret_requests` and `askimate_conversation_events` tables this repository already defines
(`apps/chat-integration/src/schema.ts`), or their equivalent.

---

## 4. How conversation state is loaded and restored on refresh

**Read (archive).** `askimate-dashboard.tsx:458–560`.

On mount, and on every conversation switch:

1. State is **reset** — `setMessages([])`, `setMessageInput("")`, `knownMessageIds.clear()`,
   `lastSeenId = 0`. **The composer draft is destroyed on a conversation switch.**
2. `GET api/askimate/conversations` — the list
3. `initialLoad()` → `GET api/askimate/chat/:id` — the full history
4. `markRead()` → `POST api/askimate/chat/:id/mark-read`
5. `setInterval(poll, 2000)`

**What survives a refresh:** the JWT in `localStorage["askimate_token"]`, and whatever is in
`askimate_messages`. **What does not:** everything else. There is no draft persistence, so AAS's
"suspend draft persistence during a secure turn" containment rule has nothing to suspend — it becomes
a no-op rather than a conflict.

**Relevant to replay:** rebuilding a secure step after refresh needs a source of truth that is not
`askimate_messages`. That is exactly what `replayEvents` + `askimate_conversation_events` do in this
repository, and neither has a caller yet (the F4 gap, still open).

---

## 5. Where the AAS React integration could connect without duplicating logic

The AAS client is deliberately layered, and the seam is clean:

| AAS module | Role | Phase E disposition |
|---|---|---|
| `SecureControl.tsx` | Uncontrolled password field; the only file that may render one | **Drop in unchanged** |
| `useSecureTurn.ts` | Turn list + the three lifecycle calls; delegates every decision | **Drop in unchanged** |
| `transcript.ts`, `render-decision.ts`, `chat-transport.ts` | The four authorities | **Drop in unchanged** |
| `ChatView.tsx`, `browser-entry.tsx`, `public/index.html` | Provisional surface | **Discard.** Replaced by the real dashboard |

The realistic shape:

1. `askimate-dashboard.tsx` calls `useSecureTurn(...)`, keeping its own `messages` state for ordinary
   chat and letting the hook own the secure-turn overlay.
2. Its render loop gains one branch for a secure item, rendering `<SecureControl>` at the right
   ordinal.
3. The composer's `onSubmit` consults `composerPolicy(...)` before sending.
4. **The composer becomes uncontrolled**, and its clear moves to after the server's acknowledgement.

Item 4 is the only invasive change, and it is the one that carries the security value: a controlled
composer puts a mistyped password into React state, where an error boundary or a state-serialising
reporter can read it.

**Nothing needs to be re-implemented.** All four decision modules are consumed as functions. The risk
is not duplication, it is the composer rewrite touching a 1,901-line page that has scroll-lock,
unread-count, polling and paywall logic interleaved with it.

---

## 6. Telemetry, error reporting, session replay, analytics — the keystroke-capture question

**This is the most consequential finding in the audit.**

### What is measurably present

**Read (live)** — `services/universitio/index.html`:

```html
<script>…gtm.js?id=GTM-K8JH6BWB…</script>          <!-- Google Tag Manager -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QVQPPZ9SGE"></script>  <!-- GA4 -->
```

**Read (archive)** — the AskiMate chat page itself pushes to the GTM `dataLayer`, including **inside
the send handler**:

| File:line | Event |
|---|---|
| `askimate-dashboard.tsx:662` | `user_activated` — fired on the first send |
| `askimate-dashboard.tsx:684`, `:754` | `paywall_reached` |
| `askimate-dashboard.tsx:211` | `checkout_abandoned` |
| `askimate-dashboard.tsx:250`, `:1519` | `subscription_completed`, `subscription_started` |
| `askimate-signup.tsx:135` | `signup_completed` |
| `AskiMateNavbar.tsx:161`, `:225` | `cta_clicked` |

### What is measurably absent

**Measured** — a repository-wide scan for `sentry`, `logrocket`, `hotjar`, `fullstory`, `posthog`,
`mixpanel`, `amplitude`, `clarity.ms`, `smartlook`, `mouseflow`, `datadog`, `bugsnag`, `rollbar`,
`newrelic`, `session-replay`: **zero hits in source.**

### Why "absent from source" is not the answer

**GTM is a runtime script loader.** A session-replay or heatmap tag added in the GTM web UI executes
on the page with no code change, no diff, no review, and no deploy. The container ID is
`GTM-K8JH6BWB`; **its tag list is Unverifiable from here** — it lives in Google's console, not in the
repository.

The CSP is the mitigation, and it is a real one. **Read (live)**,
`services/api-server/src/app.ts:35–120`:

- `scriptSrc` includes `'unsafe-inline'` **and** `googletagmanager.com` → a GTM custom-HTML tag runs.
- `connectSrc` is `'self'`, `google-analytics.com`, `analytics.google.com`, `googletagmanager.com`,
  `challenges.cloudflare.com`, `api.dicebear.com`, `api.stripe.com`, `hooks.stripe.com`.

So a replay tag that POSTs to `hotjar.com` **would be blocked**. A tag that reads an input's value and
ships it as a **GA4 event parameter would not** — `google-analytics.com` is an allowed `connect-src`.

**The exposure is concrete and current:** GTM already runs on pages that contain
`<input type="password">` — `askimate-login.tsx:189`, `askimate-signup.tsx:199`,
`reset-password.tsx:104` and `:117`. Whatever policy protects those passwords today is the policy that
would protect a secure-control password tomorrow, and that policy is **not visible in the code**.

### What this means for Phase E

The AAS threat model assumes the page does not exfiltrate keystrokes. On this stack that assumption is
**held by a Google Tag Manager container configuration, not by code**. Three things follow, and they
are engineering requirements rather than opinions:

1. **The GTM container's tag list must be enumerated** before a password box ships. It is the one input
   to the threat model that cannot be read from a repository.
2. **`connectSrc` should not include the analytics hosts on the page that renders the secure control**,
   or the control should be served from a page GTM does not load. A route-scoped CSP is the smaller
   change.
3. **A GTM change is a security change** on this stack and needs the same review as a code change.

Two further **Read (live)** observations on the error path:

- `services/api-server/src/routes/askimate-chat.ts:113` — `console.error("[ASKIMATE-CHAT] Chat error:", err)`
  logs the **error object**. On a body-parser JSON syntax error, `err.body` carries the raw request
  body. This is the finding `apps/chat-integration/src/app.ts` scrubs (`scrubParseErrorBody`), present
  in live Universitio code today.
- **Measured**: no `app.use((err, req, res, next))` error handler was found in the api-server, so
  Express's default handler runs — matching the transcription in `docs/chat-integration-report.md`.

---

## 7. Live AskiMate code still running inside Universitio

**Read (live).** The `ARCHIVE-REPORT.md` states *"Zero build-time or runtime imports from
`archive/askimate/`"* and lists `routes/askimate-chat.ts` among the routes removed. Both statements are
true of the **archived** file. A **different, non-archived** file of the same name is live:

```
services/api-server/src/routes/index.ts:11  import askimateChatRouter from "./askimate-chat";
services/api-server/src/routes/index.ts:32  router.use(askimateChatRouter);
```

`services/api-server/src/routes/askimate-chat.ts` (119 lines) serves **`POST /api/askimate/chat`** — a
guest hero-widget endpoint with a 2-question limit that writes `message.trim()` to
`askimate_messages.content`. It is mounted **before** `newsletterRouter` specifically so it stays
publicly reachable, and `threat_model.md:32` lists it as a public surface.

Also still live and now orphaned:

| Location | State |
|---|---|
| `services/api-server/src/app.ts:402` | `express.raw` body parser for `/api/askimate/stripe-webhook` — **route archived** |
| `services/api-server/src/app.ts:405` | `express.json({limit:"16kb"})` for `/api/askimate/ai` — **route archived**; nothing serves it |
| `AskiMateChatDemo.tsx`, `HeroLiveChat.tsx` (repo root) | **Measured**: nothing imports them |
| `lib/db/dist/schema/askimate-*.d.ts` | Stale build output |
| `hero_rate_limit` table | The archive report itself calls it orphaned |

**Measured**: `/api/askimate/ai` has no caller anywhere — only its archived definition and that body
limit. The `{ message, history }` shape this repository's `chat-transport.ts` was designed against is
**confirmed** (`archive/.../askimate-ai.ts:78`), and the route is currently unreachable.

None of this is a Phase E blocker. It is raised because a live public chat endpoint that the archive
report implies is gone will otherwise be missed by anyone reasoning from that report.

---

## 8. Can Phase E be done in this repository alone?

**No.** Four of the five required changes are on the AskiMate side.

| Work | Where it must happen |
|---|---|
| `SecureControl`, `useSecureTurn`, the four decision modules | **This repository** — consumed as a package |
| The `askimate_secret_requests` / `askimate_conversation_events` tables and their migration | **AskiMate** — its database |
| Mounting `createSecretRoutes` and the fail-closed guard on the message route | **AskiMate** — its Express app |
| A **producer**: something that opens a secret request and emits a `request_secret` directive | **AskiMate** — its orchestrator/AI layer |
| The composer rewrite in `askimate-dashboard.tsx` | **AskiMate** — its client |

The remaining AAS-side gap (**F4**, open since 0.10.0) is the directive delivery route and the
conversation-event read/write routes. Those can be **built and tested here** against the existing
harness, but they cannot be *connected* without the AskiMate app.

---

## 9. What is required to complete Phase E — the exact list

### A. Access (blocking)

| # | Needed | Why | Status |
|---|---|---|---|
| A1 | **The production AskiMate source**, on a GitHub repo on this account or granted to this session | Everything in §1–§5 is 10 weeks old and Unverifiable against production | ⛔ Absent |
| A2 | **Read access to the Replit project** hosting askimate.com | Replit is the source of truth; GitHub is a squashed mirror. Env vars, secrets and deployment config exist only there | ⛔ Absent (`replit.com` is 403 at the proxy) |
| A3 | **The GTM container `GTM-K8JH6BWB` tag list** (or askimate.com's own container, if different) | §6. The one threat-model input that cannot be read from any repository | ⛔ Absent |
| A4 | **askimate.com reachable**, or a saved HTML/HAR of the chat page | To confirm which analytics actually load, and the live CSP headers | ⛔ Absent (403 at the proxy) |

### B. Artefacts (needed even with A1)

| # | Artefact | Why |
|---|---|---|
| B1 | The chat page and its send/receive path | Confirm §2 against production |
| B2 | The Express app entry: middleware order, body parsers, error handler, CSP | AAS's guard must mount ahead of the body read; the CSP decides the exfiltration question |
| B3 | The message/conversation schema + migration tooling | §3: two new tables |
| B4 | The auth middleware and JWT issuer | `createSecretRoutes` verifies with `jwtSecret`; ownership checks are fail-closed |
| B5 | The AI/orchestrator layer that would decide to ask for a password | The producer in §8. Nothing in the archive does this |
| B6 | The list of environment variables | **Read (archive)**, `RESTORE.md:139` names only `OPENAI_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`. Not a complete production list |

### C. Decisions (yours, not blocking the audit)

1. **Does the secure control ship on a GTM-loaded page?** If yes, §6 must be resolved first. If no,
   a route-scoped CSP or a separate origin is the smaller change.
2. **How is AAS consumed** — a published package, a git submodule, or vendored into the AskiMate repo?
   This decides whether "no duplicated logic" survives contact.
3. **Does the composer rewrite happen in one change or behind a flag?** It touches a 1,901-line page.

---

## 10. What can proceed here, now, without any new access

Honestly stated so the blocked items are not used to justify idleness:

- **F4**: the conversation-event read/write routes and a directive delivery route, built and tested
  against the existing browser harness. Real work, and it closes the last AAS-side gap.
- **A `SecretPrompt` producer** behind the existing orchestrator port, so the directive has a source.
- **A migration script** for the two tables, written against `SCHEMA_DDL`, ready to run wherever
  AskiMate's database is.

None of that is Phase E. It is the part of Phase E that does not need AskiMate — and it should not be
started on the assumption that it will fit, because §3 says the directive cannot enter the production
message model without a schema change that only AskiMate can make.
