# Phase 0 · Deliverable 1 — Existing System Inventory

**Date:** 2026-08-26
**Status:** Complete for what is reachable · **Partially blocked** (see §0)
**Inspected:** `vaahiiid/Universitio` @ `main` (shallow clone, last push 2026-07-28)

---

## 0. What I could and could not inspect — read this first

Three repositories are visible on the GitHub account:

| Repository | Size | Branches | Contents |
|---|---|---|---|
| `vaahiiid/askimate_auto_apply` | 0 KB | none | Empty. This is the new AAS repo. |
| `vaahiiid/ai-admissions-platform` | 0 KB | none | **Empty placeholder.** Created 2026-07-28, never pushed to. |
| `vaahiiid/Universitio` | 57 MB | `main` | The real monorepo. Inspected in full. |

**The live AskiMate product at askimate.com is not in any of them.**

`archive/askimate/ARCHIVE-REPORT.md` records that on **2026-06-18** AskiMate was separated
out of the Universitio monorepo into a standalone product at its own domain. Everything
AskiMate-specific was moved into `archive/askimate/` and the live Universitio app now only
*redirects* to askimate.com.

So the code I inspected is:

- ✅ **Confirmed** — the shared platform AskiMate was built on, and still shares a database with.
- ✅ **Confirmed** — the AskiMate codebase *as it stood on 2026-06-18*, in the archive.
- ❌ **Not seen** — whatever askimate.com has become in the ~10 weeks since the split.

Everything below is labelled **Confirmed** (I read it) or **Assumed** (inferred, needs your
confirmation). I have not presented any assumption as fact.

**What this blocks:** the *precise* endpoint shapes and auth handshake for the integration
contract. **What it does not block:** the architecture, the repo structure, the AWS plan, or
Phase 1 — the domain core is deliberately self-contained and needs nothing from AskiMate.
Deliverable 2 is therefore designed to be *robust to not knowing* askimate.com's internals.

---

## 1. Directory structure — **Confirmed**

A **pnpm workspace monorepo**, 1,071 tracked files.

```
Universitio/
├── services/
│   ├── api-server/        Express 5 API — the entire backend
│   ├── universitio/       React 19 + Vite 7 SPA — the entire frontend
│   └── mockup-sandbox/    Dev-only design sandbox (out of production scope)
├── lib/
│   ├── db/                Drizzle ORM schema + pg pool — the only DB access layer
│   ├── api-spec/          OpenAPI 3.1 spec + orval codegen config
│   ├── api-zod/           Generated Zod validators (from openapi.yaml)
│   ├── api-client-react/  Generated react-query client (from openapi.yaml)
│   └── assessment-scoring/
├── artifacts/             Replit deployment manifests (.replit-artifact/artifact.toml)
├── archive/askimate/      ← the entire pre-split AskiMate product (63 files)
├── scripts/               Build, deploy, smoke-test shell scripts
├── .agents/memory/        Engineering decision records (8 markdown notes)
└── threat_model.md        A genuinely good, current threat model
```

`.agents/memory/` is effectively an existing decision-record practice. **The new system
should continue this habit** — it is one of the better things in this repo.

---

## 2. Runtime and framework versions — **Confirmed**

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | `~5.9.2` |
| Package manager | pnpm (enforced — a `preinstall` hook rejects npm/yarn) | workspace protocol |
| Backend | Node + Express | Express `^5` |
| Frontend | React + Vite | React `19.1.0`, Vite `^7.3.2` |
| ORM | Drizzle | `^0.45.2` |
| Database driver | `pg` | `^8.20.0` |
| Validation | Zod | `^3.25.76` |
| UI | Radix UI + Tailwind 4 + shadcn/ui | — |
| Routing (SPA) | `wouter` | `^3.3.5` |
| Server state | TanStack Query | `^5.90.21` |

**Node version is not pinned anywhere** — no `engines` field, no `.nvmrc`. The runtime version
is whatever Replit provides. Minor, but worth fixing in the new repo.

`tsconfig.base.json` is **strict-ish but not strict**: `strictNullChecks`, `noImplicitAny`,
`alwaysStrict`, `useUnknownInCatchVariables` are on; but `strict: true` itself is *not* set, and
`strictFunctionTypes: false`. For AAS I will recommend full `strict: true` — the branded-type
enforcement in §3.1 of the brief depends on it.

**One genuinely excellent practice worth copying:** `pnpm-workspace.yaml` sets
`minimumReleaseAge: 1440` — no npm package may be installed until it has been public for 24
hours. That is a real supply-chain defence and it should carry over to the new repo verbatim.

---

## 3. Database engine and schema — **Confirmed**

**PostgreSQL**, accessed only through `lib/db`. Connection resolves `DATABASE_URL`, falling
back to `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`. SSL mode is parsed from the
connection string.

18 schema modules. The ones that matter to AAS:

### AskiMate tables (still live in the database; code archived)

| Table | Notes relevant to AAS |
|---|---|
| `askimate_users` | Student identity. See breakdown below. |
| `askimate_conversations` | Includes the human-escalation fields: `needsExpertReview`, `expertReviewQuestion`, `expertReviewedAt`, `kbIngestedAt`, `aiFinalReplyAt`, `mentorTakenOver`. |
| `askimate_messages` | `sender` ∈ `user` \| `ai` \| `mentor` \| `system`; `metadata` jsonb holds `{reviewLevel, needsHumanReview, sources, aiAttempt}`. |
| `askimate_weekly_usage` | Free-tier quota (ISO week bucket). |
| `kb_entries` / `kb_pending_entries` | Knowledge base + human approval queue. `embedding` stored as `jsonb`. |
| `hero_analytics`, `hero_rate_limit` | Marketing widget telemetry. `hero_rate_limit` is orphaned — no code reads it. |

### `askimate_users` — the fields AAS would care about

```
id, email (unique), passwordHash, firstName, lastName, mobile,
dateOfBirth  TEXT  ← nullable, free-text, unvalidated
marketingConsent, termsAccepted, privacyAccepted,
plan, planKey, trialEndsAt, trialStartedAt, stripeSessionId,
googleId, emailVerified, emailVerificationToken, ...
lastActiveAt, firstChatAt, adminNotes, ...
```

**Three findings that directly affect the brief's product rules:**

1. **`dateOfBirth` is `TEXT`, nullable, with no format validation.** Product rule 6 — minors
   detected from date of birth — cannot be built on this field as it stands. AAS must treat DOB
   as confirm-required and parse it deterministically, rejecting anything ambiguous. It must
   never assume a student is an adult because DOB failed to parse.

2. **`email` is verified** (`emailVerified` boolean, token + expiry flow, and Google OAuth
   accounts are marked verified on arrival). This is a *legitimate seed* for product rule 7
   (the student's own personal email is the official application contact) — but verifying an
   address for login is not the same consent as designating it the official contact on a
   university application. AAS should still confirm it explicitly.

3. **There is no student profile beyond this.** No qualifications, no grades, no work history,
   no test scores, no passport details, no financial information. **AskiMate has no profile
   for AAS to inherit.** The canonical profile must be built from zero.

### Migrations — **a real risk to flag**

`scripts/post-merge.sh` runs:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force    # drizzle-kit push --force
```

`drizzle-kit push --force` **diffs the schema against the live database and applies changes
directly**. It is not a versioned, ordered, reviewable migration. There is exactly one
migration file on disk (`drizzle/0000_tiny_toro.sql`) and the schema has clearly moved well
past it. On a database holding student PII, `--force` can drop a column without a review step.

This works today because the team is small and the data is low-stakes. **It must not carry over
to AAS**, which will hold passport and bank-statement metadata and needs an auditable schema
history. Recommendation recorded in [ADR-0003](../decisions/0003-versioned-migrations-not-push-force.md).

---

## 4. Authentication and sessions — **Confirmed**

There are **two entirely separate auth systems**. They share no code.

### 4a. Admin auth — live, in `services/api-server/src/middleware/auth.ts`

```ts
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const ADMIN_EMAIL      = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD;   // plaintext comparison
```

- **A single admin account**, credentials supplied as environment variables.
- `verifyCredentials()` is a plain string equality check — no hashing, no per-user records.
- On success: HS256 JWT `{email, role:"admin"}`, **24h expiry**, sent as `Bearer`.
- The server **refuses to boot** if any of the three variables are missing. Good.
- Rate limited: 10 login attempts/hour on `/api/admin/auth/login`.

**Assessment:** adequate for one operator; will not support the brief's Review Console, which
needs *named human specialists* with per-reviewer attribution. Every approval in the
authorisation ledger must be attributable to an identified person. AAS needs real reviewer
identities from day one — this is not a system to extend.

### 4b. Student auth — archived, was in `archive/askimate/backend/routes/askimate-auth.ts`

- `bcrypt` hash, cost factor **12**. Good.
- HS256 JWT signed with `JWT_SECRET`, **7-day expiry**.
- **Token stored in browser `localStorage`** under `askimate_token`.
- Google OAuth: the JWT is handed off via a **2-minute, single-use, HttpOnly cookie**
  (`askimate_pending_token`), then exchanged for a body-returned token by
  `/askimate/consume-pending-token`. This deliberately keeps the token out of the redirect URL,
  browser history, and analytics — a thoughtful design.
- Logout clears both `askimate_token` and `askimate_guest_session_id`, with the comment
  *"Critical: prevent leakage to next user."*
- Guests are identified by an `x-guest-session-id` header (a `randomUUID`).

**The `localStorage` choice is the weak point.** A token in `localStorage` is readable by any
XSS on the origin, and the CSP in `app.ts` necessarily allows `'unsafe-inline'` for scripts
(GTM + Vite require it). For a chat product that is a contained risk. **For AAS it is not
acceptable** — an AAS session can authorise a university application submission. AAS must use
HttpOnly, `Secure`, `SameSite` cookies with short-lived access tokens.

**Assumed (needs confirmation):** that askimate.com still uses this scheme post-split.

---

## 5. How a chat request flows, frontend → model → back — **Confirmed (as of the split)**

```
React SPA
  │  POST /api/askimate/ai   { message, history }
  │  Authorization: Bearer <7d JWT from localStorage>
  ▼
app.ts   express.json({ limit: "16kb" })   ← tight body cap on this route specifically
  ▼
routes/askimate-ai.ts
  ├─ getUser(req)                    decode JWT → userId
  ├─ isBurstLimited(userId)          in-memory burst guard
  ├─ weekly quota check              askimate_weekly_usage, free tier only
  ▼
ai/chatService.ts :: generateAiAnswer(message, history)
  ├─ classifyIntent()                small_talk | study_abroad | non_supported
  ├─ retrieval:
  │     semantic  → text-embedding-3-small, cosine vs vector_store.json
  │     keyword   → BM25-style fallback (keywordRetrieval.ts)
  │     + getActiveDbKbEntries() from kb_entries
  ├─ CONFIDENCE GATE
  │     KB_HIT_SEMANTIC = 0.55        below → escalate_human
  │     KB_HIT_BM25     = 0.35        below → escalate_human
  ├─ if hit: gpt-4o-mini rewrites the KB context under KB_STRICT_SYSTEM_PROMPT
  └─ returns { answer, sources, reviewLevel, mode, escalated, topScore }
  ▼
persist user + ai messages to askimate_messages (metadata jsonb)
increment askimate_weekly_usage
  ▼
res.json(...)
```

### The part that matters most for AAS

The existing system **already enforces the brief's §3.1 principle** — the AI is never the
source of a study-abroad fact. Read this comment from `chatService.ts` verbatim:

> `openai_semantic` and `bm25_fallback` were removed because they implied that OpenAI itself
> produced the study-abroad answer. Study-abroad answers are NEVER LLM-generated without a KB
> anchor.

And from the system prompt:

> Use ONLY the facts contained in the "Verified knowledge" section. Do NOT add information from
> your own training data. […] If the provided context does not actually answer the user's
> question, reply EXACTLY: *"Thanks for your question. I want to make sure you get accurate
> guidance…"*

**This is the same principle the brief demands, and it is already the house style.** That is a
strong signal. The difference: AskiMate enforces it *by prompt*. The brief requires AAS to
enforce it *by construction*. That is an upgrade in rigour, not a change in philosophy — and it
should be framed that way to the team.

### Two-layer escalation already exists in embryo

`reviewLevel ∈ safe_auto | cautious_auto | escalate_human` is layer one (confidence-based).
Layer two exists as a **keyword** list, not a hard rule:

```ts
const HIGH_RISK_KEYWORDS = [/\bvisa\b/, /bank\s+statement/, /proof\s+of\s+funds/,
                            /\bdepend(a|e)nt(s)?\b/, /\bcas\b/, /\batas\b/, ...];
const ALWAYS_HIGH_RISK_IDS = new Set(["bank_statement_requirements", "uk_student_visa", ...]);
```

But in AskiMate a high-risk match only appends a *"speak to a mentor"* disclaimer — it does not
force human review. **The brief's rule 5 is stricter:** financial evidence and anything
involving a minor must be escalated for mandatory human review *every time*, regardless of
confidence. In AAS this must be a hard, non-bypassable gate in the state machine, not a
keyword-triggered sentence. Noted as a deliberate tightening, not a contradiction.

### Retrieval storage — a scaling note

Embeddings live in **`vector_store.json` on local disk** and in a `jsonb` column on
`kb_entries`. There is no `pgvector`. Fine at current KB size; it will not scale, and it means
similarity search happens in Node rather than in Postgres. Not AAS's problem directly, but
relevant if AAS ever needs semantic retrieval over requirements — **use `pgvector` from the
start** rather than inheriting this pattern.

---

## 6. Document handling — **Confirmed, and this is the biggest gap**

There are three separate file paths, and **none of them is a student document vault.**

| Path | Storage | Encryption | Retention | Used for |
|---|---|---|---|---|
| `routes/leads.ts` → `cvUpload` | **Local disk** `uploads/cvs/` | ❌ none | ❌ none | Career/partner CVs |
| `routes/blog.ts` → `blogImageUpload` | Replit App Storage (GCS) | at-rest by provider | — | Blog images |
| `routes/admin.ts` → `upload` | memory, 50 MB | — | — | Blog ZIP import |

The CV path:

```ts
const CV_UPLOAD_DIR = path.resolve(process.cwd(), "uploads/cvs");
const cvUpload = multer({
  storage: multer.diskStorage({ destination: CV_UPLOAD_DIR, filename: `${Date.now()}-${rand}${ext}` }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: allow [".pdf", ".doc", ".docx"],
});
```

**Findings:**

1. **Files are written to the container's local filesystem.** On Replit that is ephemeral — a
   redeploy or restart loses them. This is very likely already causing silent data loss.
2. **No encryption at rest beyond whatever the platform provides.** No KMS, no customer-managed key.
3. **No expiry, validity, or recency metadata of any kind.** No column, no field, nothing.
4. **No extraction, no confirmation step, no verification state.**
5. **No link between a document and a student account.** CVs attach to lead submissions, not to `askimate_users`.

### What this means — and it is good news

The brief's rule 4 (deterministic validity — the UK 31-day financial-evidence recency window)
has **nothing to migrate from and nothing to be compatible with.** There is no legacy document
model to preserve, no half-built validity logic to reconcile, no stale metadata to clean up.

**AAS owns the document vault outright, greenfield, from Phase 2.** That removes what would
otherwise have been the single most awkward integration problem. I would treat this as a
significant de-risking of the project, not as a gap to be filled.

It does, however, mean the Phase 2 estimate must include the *whole* vault — extraction,
confirmation, validity engine, encryption, lifecycle — with no reuse.

---

## 7. Job queue and background workers — **Confirmed**

**There is no queue and no worker process.** Everything runs in-process on the single API
server, started from `index.ts` after `app.listen()`:

| Job | Mechanism | Cadence |
|---|---|---|
| `startOpportunitiesIngester()` | `setTimeout` + `setInterval` | first run 45s, then every 8h |
| `schedulePostDeploySmokeTest()` | `setTimeout` | one-shot after deploy |
| `startNewsletterScheduler()` | `setInterval`, polls the clock | every 10 min; fires Wed 09:00 UK |
| `startGuestArchiver()` | `setTimeout` + `setInterval` | first run 1 min, then every 24h |

The archived `jobs/expiryReminders.ts` was the same pattern with four sub-jobs.

**Consequences, stated plainly:**

- **Restart loses in-flight work.** There is no durable queue, no retry, no dead-letter path.
- **Idempotency is ad-hoc**, done per-job with boolean flag columns (`reminderSent5d`,
  `activationEmail1Sent`, …) or a table lookup. It works, and the intent is right — but it is
  reinvented each time, with no shared primitive.
- **No horizontal scale.** Two API instances would run every scheduler twice. The newsletter
  scheduler defends against this with a DB check; others do not.

**For AAS this pattern is disqualifying.** The brief requires case state to survive process
restarts, deployments and multi-week waits, and requires every submission attempt to carry an
idempotency key such that duplicate submission is *structurally impossible*. That needs a
durable queue (SQS + DLQ), a separate worker process, and a first-class idempotency primitive
in the domain core — which is exactly what Phase 1 specifies. **This confirms the brief's
architecture rather than challenging it.**

---

## 8. Tests and CI — **Confirmed. This is the weakest area of the existing system.**

### CI: none

There is **no `.github/` directory.** No GitHub Actions, no workflows, no checks on push, no
branch protection driven by CI. Nothing runs automatically on a commit or a pull request.

### Tests: effectively none

- `services/api-server/vitest.config.ts` exists and includes `src/**/*.test.ts`.
- **Zero files match that pattern.** `pnpm test` in api-server runs and finds nothing.
- The **only** test file in the entire repository is
  `archive/askimate/backend/routes/__tests__/askimate-hero-rate-limit.test.ts` — archived, and
  outside the vitest include path.
- No frontend tests. No integration tests. No fixtures.

### What stands in for testing

A **post-deploy smoke test** — `scripts/smoke-test.sh` (7.6 KB of bash) curls the *deployed*
site, checks health endpoints and key pages, and emails/Slacks on failure via Resend. It runs
after Replit switches live traffic, scheduled by `jobs/postDeploySmokeTest.ts`.

This is *detection*, not *prevention*: it tells you production broke, after production broke.

### The honest assessment

Manual verification plus a production smoke test is a defensible trade-off for a marketing site
and a chat assistant. **It is not a defensible trade-off for a system that submits university
applications on a student's behalf.**

The brief's §10 is therefore not an incremental improvement on existing practice — it is a new
discipline the project does not yet have. That is worth naming explicitly at the outset, because
it is a real cost that must be planned for and not discovered mid-Phase-3. The new repo should
ship with CI **from its first commit**, before there is any code to protect, so it is never a
retrofit.

---

## 9. Deployment — **Confirmed, and it corrects an assumption in the brief**

### The brief says AskiMate runs on Google Cloud Platform. That is only partly right.

**Compute and hosting are Replit.** The evidence is unambiguous and pervasive:

- `artifacts/*/.replit-artifact/artifact.toml` — Replit's deployment manifest format.
- `app.ts`: `app.set("trust proxy", 1)` — *"required behind Replit's proxy"*.
- Dev host allowlist: `.replit.dev`, `.repl.co`, `.replit.app`, `.replit.com`.
- `jobs/postDeploySmokeTest.ts` — runs *"after Replit has switched live traffic to the new deployment."*
- `.gitignore` excludes `.replit`, `.replitignore`, `replit.md`.
- Frontend devDeps include three `@replit/vite-plugin-*` packages.

**The GCP part is object storage only**, and it is *Replit's* GCS, reached through a local
sidecar — not a GCP project Vahid controls:

```ts
// services/api-server/src/lib/blogObjectStorage.ts
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const storage = new Storage({ credentials: {
  audience: "replit", token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`, type: "external_account", ...
}});
```

`Storage` is `@google-cloud/storage`, which is why it reads as GCP — but the credentials are
Replit's federated identity, and the bucket is provisioned by Replit App Storage.

**Assumed:** Postgres is also Replit-provisioned (the `PGHOST`/`PGUSER`/… fallback pattern is
Replit's convention). Not directly confirmable from the repo.

**Why this matters for AAS:** the brief's statement that "the existing product runs on GCP and
is not being moved" is directionally right — AAS goes on AWS, AskiMate stays where it is — but
the *nature* of the boundary is different from what the brief assumes. There is no GCP project
to peer with, no VPC to connect, no IAM to federate. AskiMate lives on a PaaS with limited
network control. **This makes the integration necessarily a plain, authenticated,
public-internet HTTPS contract** — which, conveniently, is also the cleanest design. It rules
out private networking options that would otherwise be worth considering.

### The deployment topology

| Artifact | Kind | Port | Serves | Production command |
|---|---|---|---|---|
| `artifacts/universitio` | `web` | 3000 | `/` | static build → `services/universitio/dist/public` |
| `artifacts/api-server` | `api` | 8080 | `/api`, `/sitemap.xml` | `bash scripts/start-and-smoke-test.sh` |
| `artifacts/mockup-sandbox` | — | — | dev only | — |

Health probe: `GET /api/healthz`. Build: `scripts/build-deploy.sh` (frontend, then esbuild
bundle of the API). In production the API also serves the SPA and applies a tiered
`Cache-Control` policy.

### Security posture — genuinely good, and worth saying so

`app.ts` is careful work: a tuned CSP with per-integration allowances and documented reasons for
each `'unsafe-inline'`; HSTS with a 2-year max-age, `includeSubDomains`, preload, production-only;
`frameguard: deny` plus `frame-ancestors 'none'`; a `Permissions-Policy` scoping `payment` to
Stripe's origin; an origin-validating CORS callback; canonical-host 301 redirects; a raw-body
carve-out for Stripe webhook signature verification; and SSE explicitly exempted from
compression *before* the compression middleware installs its hooks.

`threat_model.md` is current, specific, and names real assets and trust boundaries.

**This is a team that thinks about security properly.** The gaps in §6 and §8 are gaps of
*coverage and process*, not of care or capability. AAS should hold this bar and raise it where
the stakes are higher — not treat the existing work as something to be replaced.

---

## 10. The API contract layer — an unused asset worth reviving

`lib/api-spec/` contains an OpenAPI 3.1 spec and an `orval` config that generates **both** a
typed react-query client (`lib/api-client-react`) and Zod validators (`lib/api-zod`) from it.

The pipeline works. But `openapi.yaml` is **36 lines long and describes exactly one endpoint**:
`GET /healthz`, returning `{status: string}`.

Meanwhile the real API has ~60+ routes across `admin`, `leads`, `blog`, `auth`, `public`,
`newsletter`, `opportunities` — **none of which are in the spec.** The frontend calls them
through hand-written fetch code instead.

**Read charitably:** someone set up contract-first tooling correctly and the team never adopted
it — most likely because retrofitting a spec over 60 existing routes is a large, unrewarding
job with no immediate payoff.

**The opportunity:** a *new* repo has no retrofit cost. If AAS is contract-first from its first
endpoint, the discipline is free. And the integration contract in Deliverable 2 is precisely the
kind of boundary that benefits most from a machine-checked schema — it is the seam between two
systems, two clouds, and (eventually) two teams. Recommended in [ADR-0005](../decisions/0005-contract-first-openapi.md).

---

## 11. Summary — what this means for AAS

| Area | Existing system | Implication for AAS |
|---|---|---|
| Language/stack | TypeScript, Node, Postgres, Drizzle, Zod, pnpm | ✅ Brief's choice matches. Familiar to the team. Keep it. |
| AI-never-invents-facts | Already the house rule, enforced by prompt | ✅ Same philosophy. AAS enforces it by types instead. |
| Two-layer escalation | Layer 1 exists; layer 2 is advisory keywords | ⚠️ AAS must make layer 2 a hard, non-bypassable gate. |
| Student profile | Name, email, mobile, DOB (`TEXT`) only | ⚠️ Nothing to inherit. Build canonical profile from zero. |
| Document vault | **Does not exist.** CVs → ephemeral local disk | ✅ Greenfield. Removes the hardest migration problem. |
| Validity/expiry engine | Does not exist | ✅ Greenfield, no legacy semantics to honour. |
| Durable state / queue | **Does not exist.** In-process `setInterval` | ⚠️ AAS needs SQS + worker + real idempotency. As briefed. |
| Idempotency | Ad-hoc boolean flag columns per job | ⚠️ Needs a first-class domain primitive. Phase 1. |
| Migrations | `drizzle-kit push --force` | ⚠️ Must not carry over. Versioned migrations only. |
| Tests | **Zero.** Post-deploy smoke test only | ⚠️ New discipline. CI from commit #1. |
| CI | **None.** No `.github/` | ⚠️ Same. |
| Auth (admin) | One shared credential pair, env vars | ⚠️ Review Console needs named, attributable reviewers. |
| Auth (student) | bcrypt-12 + 7d JWT in `localStorage` | ⚠️ AAS needs HttpOnly cookies. Stakes are higher. |
| Hosting | **Replit** (not GCP). GCS via Replit sidecar | ℹ️ Corrects the brief. Forces a clean public HTTPS contract. |
| Security headers / threat model | Careful, current, well-reasoned | ✅ Hold this bar. Copy `minimumReleaseAge`. |
| API contract tooling | Built, working, used for 1 endpoint | ✅ Adopt properly in the new repo — free at greenfield. |
| Browser automation | **None anywhere.** No Playwright, no Puppeteer | ℹ️ Entirely new capability. Phase 3 has no precedent to lean on. |
| Decision records | `.agents/memory/` — 8 notes, good practice | ✅ Continue as `docs/decisions/` ADRs. |

---

*Deliverable 1 of 5. Continue to [02 — Integration Contract Proposal](./02-integration-contract-proposal.md).*
