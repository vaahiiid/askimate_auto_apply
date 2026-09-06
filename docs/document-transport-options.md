# The document transport boundary — two options, costed

**P33, 2026-09-06.** A read-only investigation. **Nothing was built**: no route, no upload surface, no
object storage, no document table, and no change to the Secure Plane.

Its purpose is to turn ADR-0067's **B4** (*no transport by which a student can supply bytes*) and
**B5** (*hold or pass through*) from open questions into one decision with two costed answers.

---

## 1 · The document lifecycle as it exists

```
   ???                     executePlan                    session.attach
  (missing)  ─────────►   plan.uploads  ─────────────►   setInputFiles(buffer)
                              │                              │
                              ├─ documents(documentRef)      └─ no temp file, no trace
                              │     = DocumentSource
                              └─ mayTransmit(...)  ← ADR-0022, at the moment of upload
```

Traced, not inferred:

| Step | What actually happens |
|---|---|
| Acquisition | **Does not exist.** No route, no parser, no client control. |
| `DocumentSource` | `(documentRef) => Promise<AuthorisedDocument \| null>`. Returns bytes **and** the `DisclosureAuthorisation` together, so a caller cannot supply one without the other. |
| Resolution | Called **inside** the upload loop, **per upload, per execution**. |
| Gate | `mayTransmit` immediately before `attach`: document id, content hash, destination host, withdrawals. |
| Attachment | `setInputFiles` with an **in-memory buffer**, not a path. |
| Ordering | `executePlan` fills every instruction **first**, then every upload. |
| Failure | Stops at the first failure and returns a report. `executePlan` itself does not retry and has no idempotency. |
| Cleanup | `purgeContents` — vault-side only. Nothing purges a transient buffer explicitly; it is garbage. |

**Today the runner passes `() => Promise.resolve(null)`**, and `toStoredPlan` refuses any plan with
uploads, so the loop is unreachable in production and reachable only in `scripts/end-to-end.ts`.

## 2 · The transport gap is two gaps, not one

**(a) Student → AAS.** No route on any of the Conversation Service's nineteen; no `multipart`
anywhere in either OpenAPI document; the only body parser is `express.json({ limit: "64kb" })`.

**(b) AAS → the process holding the browser.** `toStoredPlan` refuses `has_uploads`, and the
published schema says why — *"a plan with its uploads silently removed would report itself complete
having attached nothing."* The **Automation Runner has no database, no vault and no cache**: it claims
work over an internal API and is forbidden a case store by `check-boundaries`.

So even with the bytes in hand, AAS has no way to get them to the browser. Any transport design must
answer both halves, and (b) is the one nobody has named before.

**There is an exact precedent for (b), and it is not "send it to the runner".** For a password, the
answer was ADR-0042: the runner never holds it; a **Fill Agent** in the Secure Plane takes the
envelope from the shared cache, decrypts locally, and types it into the runner's browser over CDP.
Whether a document deserves the same shape, or whether a document is different in kind from a
credential, is part of the decision below.

## 3 · The authenticated surfaces that exist

| Surface | Auth | Limit | Could it carry a document? |
|---|---|---|---|
| Conversation Service | `__Host-` HttpOnly cookie, `SameSite=Lax`, Secure, Path=/; **same origin, no CORS** | `express.json` **64 KB** | Only with a new parser and a new route. The identity binding is already right. |
| Secure Interaction Service | cookie + frame token, cross-origin iframe, `script-src 'self'` | `express.json` **8 KB** | See §4. |
| Internal APIs (claim / report / agent) | service tokens + mTLS-style certs | — | Runner-facing, not student-facing. |

The Conversation Service is the **only** student-facing surface that already binds a request to a
student and a conversation. That is a strong argument for where (a) lands, and it is orthogonal to
the hold-vs-pass-through choice.

## 4 · The Secure Plane exclusion — verified

P31 excluded it on TTL, persistence and keys. Verified, and the picture is stronger than stated:

- **≤ 5-minute TTL** is ADR-0034's hard ceiling, and the expiry sweep enforces it.
- **All persistence disabled** in the shared cache; a restart that loses an in-flight value **fails
  closed and visibly** — the request moves to `secret_expired` and the student is asked again.
- **A data key per secret, zeroed after use.**
- **`express.json({ limit: "8kb" })`** — tighter than the conversation plane's 64 KB.
- The control's only input is a password field, under `script-src 'self'`.
- `check-boundaries` forbids **every request logger, APM agent and error reporter** in that app, with
  a measured reason: *body-parser attaches the raw request body to a JSON parse error as `err.body`
  (measured: `JSON.stringify(err)` emits the password in full)*.

**Verdict: (D) — evidence that document transport should be a separate boundary**, with (B) true as
well. Nothing about the exclusion is a law of nature; every property is a deliberate constraint
chosen because the payload is a password. Widening any of them to fit a document would weaken the one
service whose entire justification is those constraints — and *"ask the student again"* is a correct
answer for a password and a hostile one for a 4 MB scan.

The measured `err.body` hazard is **not** Secure-Plane-specific and transfers directly: whatever
parser accepts a document must not attach the body to an error object.

## 5 · `attach_document` — declared, and produced by nothing

`ConsequentialAction` has five members and `attach_document` is `VERIFIABLE: true` (*"the application
page lists its attachments"*). But:

- `WorkKind` is `create_account | execute`;
- `ACTION_FOR_WORK` maps those to `create_portal_account | advance_portal_page`;
- **nothing anywhere produces an `attach_document` intent.**

It is in the same class as `ProcessingActivity.documentTypes` before P32 and
`BlueprintPage.requiredDocuments` before P30: declared, and unreached.

What *would* happen today is worse than nothing being there. `executePlan` performs a page's
instructions and its uploads under **one** intent, keyed `advance_portal_page` + the page's content
target. And:

> **`pageValuesOf` reads `plan.instructions` only.** Uploads are not in the target.

So the page's content target is **blind to which document is attached**. Replacing a passport does not
change the key. ADR-0051 §6/§7 built the content-aware target precisely so *"a correction the student
makes late"* produces a different intent; a document replacement is the same class of event and is
currently invisible to it — while `attach_document`'s own comment says *"Duplicates are visible to
admissions."*

**Whichever option is chosen, attachment needs its own intent identity.** That is a transport-level
requirement, not a policy one, and it is the clearest single finding of this phase.

## 6 · Retry, precisely

`assessIntent`: `not_started` → do it; `already_done` → ADR-0047 re-offers only `failed_cleanly`;
**in flight + verifiable → `verify_first`** (pause, raise an intervention, a person looks at the
portal); in flight + not verifiable → escalate.

A crash mid-execute therefore leaves `advance_portal_page` in flight for that page. On resume the
whole page re-runs — every field **and every upload** — because the upload is inside it.

| | Where the bytes come from on retry |
|---|---|
| **Hold** | `vault.retrieve(documentId)`. The `DocumentSource` closes over the vault; retry is transparent and needs no student. |
| **Pass-through** | Nothing can produce them. The transient buffer is gone with the process. The student must supply the document **again**, or something must hold it — which is the thing pass-through was chosen to avoid. |

This is the sharpest asymmetry in the whole comparison, and it is structural rather than a
preference: **`executePlan` re-resolves `DocumentSource` on every execution.** Changing that — caching
the resolved bytes across attempts — would itself be holding them, and would also change retry
semantics that ADR-0054 and ADR-0047 settled.

## 7 · The identity model, against what a transport needs

| Binding | Exists today | Where |
|---|---|---|
| student | ✅ | `DocumentUpload.studentId`; the session cookie |
| document type | ✅ | `DocumentUpload.documentType` (closed `DocumentType`) |
| content hash | ✅ | `DocumentUpload.contentHash`, and `mayTransmit` re-checks it |
| case | ⚠️ | on `DisclosureSubject.caseId` only — **not** on the upload |
| conversation | ❌ | nowhere |
| target / blueprint | ❌ | nowhere on the document; only `DisclosureDestination.portalHost` at send time |
| upload instance | ⚠️ | `documentId` is minted **by the vault at store time**, so a pass-through document has no identity until one is invented |
| purpose | ✅ | `RetentionPurpose`, and since P32 it keys the storage activity too |

**Two are missing and one is conditional.** A transport must bind at least case and target, because
`mayTransmit` already refuses a wrong host and ADR-0022 requires the destination in the
authorisation — but nothing binds the *acquisition* to the case it was acquired for. Under
pass-through the `documentId` gap becomes load-bearing: `mayTransmit`, the `TransmissionRecord` and
`ExecutionOutcome.attached` all key on a `documentId` that only the vault currently mints.

## 8 · Threat model, split by where the answer lives

**Transport-level (engineering — resolvable without any policy decision):**

| Threat | Mitigation available today |
|---|---|
| wrong student | session cookie already binds the request; the vault already keys on `studentId` |
| wrong case / wrong target | **missing** — §7; needs binding at acquisition |
| replay / duplicate upload | **missing** — §5; needs `attach_document` intent identity |
| substitution / tampering | `mayTransmit` re-checks the content hash at the moment of upload |
| wrong host | `mayTransmit` refuses a destination that is not the session's |
| oversized file | no parser exists; a limit is chosen with the parser |
| MIME / type confusion | `DocumentUpload.contentType` is recorded and **never validated**; `attach` sends `application/octet-stream` regardless |
| filename injection / path traversal | `attach` uses `name: documentId`, a minted id — **already safe**, and worth keeping |
| accidental persistence via error objects | the measured `err.body` hazard (§4); a document parser must be held to the same rule |
| logs / tracing | already forbidden by `check-boundaries` in the sensitive apps; the fill context is never traced (ADR-0025) |
| browser caching | `attach` writes into the *runner's* browser, not the student's |
| Redis | the envelope cache is the secret plane's; a document must not enter it |
| database | no `bytea` or blob column exists anywhere; keep it that way |

**Policy-level (needs a determination, not a design):** malicious-file scanning (what is scanned, by
whom, and what happens on a hit); specialist access to a held document; how long a rejected or
superseded document survives.

## 9 · Policy dependencies, separated

- **A — already determined by existing ADRs.** The transmission gate and its four bindings
  (ADR-0022); the storage gates (ADR-0010, ADR-0023, ADR-0068); the runner holding nothing sensitive
  (ADR-0042, ADR-0045); no tracing (ADR-0025); `attach_document` being verifiable (ADR-0054).
- **B — lawful basis.** `disclose_document_to_institution` (unmade), and — since P32 —
  `store_document:<purpose>` for whichever purposes a held document falls under.
- **C — retention.** All twelve unresolved requirements, **if** documents are held. Under
  pass-through, only if transient bytes count as storage (§10).
- **D — disclosure.** The student-authorisation text must name the document and the destination;
  the machinery exists, the determination does not.
- **E — product.** Hold vs pass-through; whether a document may be reused across applications;
  whether a specialist may open one; malicious-file policy.
- **F — real portal evidence.** Which documents the portal actually asks for, their accepted formats
  and size caps. **103 discovery runs have observed zero file inputs** because the application is
  behind a login. Format and size limits cannot be chosen from the fixture.

## 10 · The classification question, still open

ADR-0010 gates `vault.store`; ADR-0023 says an unresolved requirement *"blocks storage exactly as a
missing policy does"*. **Neither classifies bytes held in a process for the duration of an upload.**
This document does not classify them either — ADR-0023 forbids guessing at exactly this kind of
question, and the answer changes which of §9's twelve retention questions bite.

What can be said without deciding it: pass-through does **not** avoid ADR-0022. The transmission gate
and the disclosure determination apply to *sending*, whatever the bytes came from.

---

## Option A — Hold

**Architecture.** Acquisition route on the Conversation Service → `assertStorable` → `DocumentVault`
(S3 + KMS) → at execution, a `DocumentSource` closing over the vault → `mayTransmit` → `attach`.

**Data flow.** Bytes at rest, encrypted with a customer-managed key; ids and hashes everywhere else.

**Security boundary.** The vault is the only holder. The runner still holds nothing; either the bytes
reach it over the internal API, or a Secure-Plane-shaped process attaches them over CDP (§2).

**Policy dependencies.** B **and** C in full — twelve retention determinations plus a
`store_document:<purpose>` basis — and D.

**Retry.** Transparent. `vault.retrieve` on every attempt. Nothing is asked of the student twice.

**Student UX.** Supply once. A failed run resumes without them. Reuse across applications becomes
possible (a separate product decision).

**Implementation scope.** Acquisition route + parser + client control; an S3 + KMS `DocumentVault`
satisfying the existing contract; a `documents` table or equivalent metadata store **plus a
migration**; wiring the vault into a deployable for the first time; `attach_document` intent
identity; the plan-transport decision for (b).

**Test scope.** Vault contract against real storage; the acquisition route; retry across a crash;
purge and erasure; the existing gate suite unchanged.

**Operational complexity.** A new datastore with a customer-managed key, lifecycle rules, an erasure
path, and a retention job that must actually run.

**Main risks.** The largest policy surface (C is twelve external questions). A real datastore holding
passports is the highest-consequence thing this system would own.

## Option B — Pass-through

**Architecture.** Acquisition route → bytes held only for the life of one execution → `mayTransmit`
→ `attach` → discarded.

**Data flow.** Bytes exist in exactly one process, for one attempt.

**Security boundary.** Nothing at rest. But the bytes must cross from the acquiring process to the
one holding the browser, and the runner has no store — so either they travel over the internal API
in a request that must never be logged, or a Secure-Plane-shaped process holds them briefly.

**Policy dependencies.** B (disclosure basis) and D. **C only if** transient bytes count as storage
(§10) — which is the unresolved question, not a saving that can be assumed.

**Retry.** **The weak point.** `executePlan` re-resolves `DocumentSource` on every execution; after a
crash nothing can produce the bytes again. Either the student re-supplies — during a run they may not
be watching, and `verify_first` means a *person* must look at the portal first — or something holds
them, which is Option A wearing a different name.

**Student UX.** Possibly supply more than once, at the least predictable moment. No reuse across
applications.

**Implementation scope.** Smaller at rest — no datastore, no migration, no lifecycle job — but larger
in the run: a custody path across a plane boundary, an expiry, a re-request flow, a `documentId`
minted somewhere other than the vault (§7), and the same `attach_document` intent identity.

**Test scope.** The custody window; expiry; the re-request path; proof that no log, error object or
cache holds bytes; the same gate suite.

**Operational complexity.** Lower steady-state, higher in-run. Nothing to purge; more to get right
about failure.

**Main risks.** The retry story conflicts with settled machinery rather than extending it. And the
saving that motivates it (avoiding ADR-0023) **is not established** — it depends on §10, which is
exactly the question ADR-0023 says not to answer by assumption.

---

## What the existing architecture favours

It does not decide, and this document does not decide for it. But the evidence is not symmetric:

- **Retry favours A, structurally.** `executePlan` re-resolving `DocumentSource` is not incidental —
  it is what makes `mayTransmit` a check on *what is actually about to be sent*. B has no answer that
  does not either ask the student again mid-failure or reintroduce holding.
- **The vault is already built for A.** The full lifecycle, the validity engine, `purgeContents` and
  now both storage gates exist and are unreachable. B leaves them unreachable and adds a second,
  parallel custody path.
- **B's saving is unproven.** It rests on §10.

**The honest summary: A is the shape the architecture was built for, B is the shape that might avoid
twelve open questions, and whether it actually avoids them is itself one of the open questions.**

## Must transport semantics be frozen before the first catalogue approval?

**Partly — and less than might be expected.** The freeze list is about what is inside the content
hash (`toCanonical` walks the parsed object, so field *names* are content). Transport semantics are
not in a catalogue artefact.

Two things do belong on the list:

1. **The meaning of a mapping's `documentRef`** — already on it, and now urgent for a different
   reason: `DocumentSource` is keyed on it, so it is the transport's lookup key as well as the
   planner's.
2. **Accepted formats and size caps**, if they are ever expressed in a reviewed artefact. `RequiredDocument`
   already carries `acceptedFormats` and `maxSizeBytes`, and both are inside the hash.

Everything else about transport — the route, the custody model, the intent identity — is outside the
approved artefact and can be decided after the first approval without invalidating it.

## The decision, stated concretely

> **Does a document, once supplied by the student, persist in AAS until the application is complete
> (Option A), or does it exist only for the duration of one execution attempt (Option B)?**
>
> Answering A commits to the twelve retention determinations and a `store_document:<purpose>` lawful
> basis. Answering B commits to a custody model across a plane boundary and to a retry story that the
> current `DocumentSource` contract does not support — and does not avoid the retention questions
> unless someone competent determines that transient bytes are not storage.

Whoever answers it also needs to answer, or explicitly defer: who determines the two lawful bases and
by when; and what happens to a document a scanner rejects.

## What P34 could do without that answer

Two things are transport-level, needed under **either** option, and blocked on nothing:

1. **`attach_document` intent identity** — §5. Attachment currently rides a page intent whose target
   cannot see it, while the domain already declares the action, marks it verifiable, and warns that
   duplicates are visible to admissions.
2. **Binding a document to its case and target at acquisition** — §7. Two of the eight bindings do
   not exist, and `mayTransmit` already assumes the destination is known.

Both make either option safer and neither presumes which is chosen.
