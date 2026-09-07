# Decision sheet — B5: hold, or pass through?

**For:** Vahid · **Prepared:** 2026-09-06 · ~~**Answerable in one sitting**~~
**✅ DECIDED — A, hold. Vahid Mohammadi, 2026-09-07. See [ADR-0078](./decisions/0078-documents-are-held-and-reused.md).**
Full analysis: [`document-transport-options.md`](./document-transport-options.md).

> **The decision, in his words:**
>
> *"Documents are stored in the vault and reused. We never ask a student for the same document
> twice. The reason is the product's core mechanic, not convenience: fill-once, apply-to-many is
> what the business plan sells as the switching cost, and a per-attempt pass-through would destroy
> it."*
>
> Decided on a stronger ground than this sheet argued. The sheet recommended A because B's saving
> was unproven and its retry story certainly worse; the decision is that pass-through is not a
> cheaper way to do the same thing, **it is a different product**.
>
> The counter-argument this sheet asked to be weighed — that A makes Universitio an organisation
> holding a bucket of passports — was weighed and accepted, with the shortest periods the B1
> answers allow: **twelve months after last use**, not six years.

---

## The question

> When a student supplies a document, does it **persist in AAS until the application is complete**
> (Option A — hold), or does it **exist only for the duration of one execution attempt**
> (Option B — pass-through)?

Everything else about document transport waits on this. It is not an engineering preference: it
decides how many external policy questions we must answer before the first document can move, and it
decides what happens to a student when a run fails halfway.

---

## The two options, side by side

| | **A — Hold** | **B — Pass-through** |
|---|---|---|
| Bytes at rest | Yes: S3 + customer-managed KMS key | No, anywhere |
| Student supplies | **Once** | Once **per attempt** |
| Retry after a crash | `vault.retrieve` — invisible to the student | **Nothing can produce the bytes.** Ask again, or hold them (= A) |
| Policy needed first | B2 disclosure basis + **all twelve** retention determinations (B1) + storage basis | B2 disclosure basis + **B1 only if** transient bytes count as storage — **unresolved** |
| Build | Acquisition route, S3+KMS vault, metadata table + migration, lifecycle/purge job | Acquisition route, cross-plane custody path, expiry, re-request flow, a `documentId` minted outside the vault |
| Already built for it | The whole of `packages/documents` — lifecycle, validity engine, `purgeContents`, both storage gates | Nothing. `documentId` is minted **by the vault**, and `mayTransmit`, `TransmissionRecord` and `ExecutionOutcome.attached` all key on it |
| Steady-state ops | A datastore holding passports: key rotation, lifecycle rules, an erasure path, a retention job that must actually run | Nothing to purge |
| In-run complexity | Low | High — custody across a plane boundary, and the failure paths are the hard ones |
| Reuse across applications | Becomes possible (separate product decision) | Impossible |

---

## What each forecloses

**Choosing A forecloses** the claim that we hold no student documents. Once there is a bucket with
passports in it, that is the highest-consequence asset the system owns, and every retention, erasure
and breach question becomes live and permanent. It does not foreclose deleting early — a short
retention period under A is available; a long one under B is not.

**Choosing B forecloses** transparent retry, and it forecloses it *structurally*. `executePlan`
re-resolves `DocumentSource` on every execution — that is not incidental, it is what makes
`mayTransmit` a check on what is *actually about to be sent* rather than on what was intended. Under
B, a run that crashes mid-page comes back through `assessIntent` as `verify_first`: a **person** must
look at the portal before it resumes, and only then does the student get asked for their passport
again, at the least predictable moment. B also forecloses document reuse across applications for
ever, and leaves `packages/documents` permanently unreachable while adding a second, parallel custody
mechanism beside it.

**The saving that motivates B is not established.** B's case is that it avoids ADR-0023's twelve
retention questions. That is only true if bytes held in a process for the duration of an upload are
not "storage" under UK GDPR — and neither ADR-0010 nor ADR-0023 classifies them. ADR-0023
specifically forbids guessing at this kind of question. So B may cost the same policy work as A and
still have the worse retry story.

---

## What it means for B4 (the transport itself)

B4 is "no route by which a student can supply bytes". It is **two** gaps, and the answer to B5
changes only one of them.

- **Student → AAS.** Identical under both: a route on the Conversation Service, a multipart parser,
  a size cap, and a client control. The `err.body` hazard (body-parser attaching the raw request body
  to a parse error) applies to whatever parser we choose, under either option.
- **AAS → the process holding the browser.** This is where they diverge. The Automation Runner has
  no database, no vault and no cache, and `toStoredPlan` refuses any plan with uploads. Under **A**,
  bytes can come from the vault at execution time. Under **B**, they must survive a plane crossing in
  a request that must never be logged — or a Secure-Plane-shaped process must hold them and attach
  them over CDP, which is the ADR-0042 pattern used for passwords.

Under **either** answer, `attach_document` needs its own intent identity: it is declared and marked
verifiable and produced by nothing, and uploads currently ride a page intent whose target cannot see
which document is attached.

---

## Recommendation

**Option A — hold — with the shortest retention period the answers to B1 permit.**

Three reasons, in order of weight:

1. **B's saving is unproven and its cost is certain.** The retention questions may bite under B
   anyway (§10 of the options document); the broken retry story bites under B always.
2. **The failure mode lands on the student at the worst moment.** A crashed run under B means a
   person reviews the portal state and *then* the student is asked to re-upload a passport, possibly
   hours later, possibly on a phone, for a run they thought was finished. Under A they never know it
   happened.
3. **The architecture is already built for A and refuses correctly today.** The vault, the lifecycle,
   the validity engine and both storage gates exist and are reachable from nothing. A makes existing,
   reviewed machinery live. B leaves it dead and builds a second custody model beside it.

**The counter-argument I would want you to weigh**, because it is real: A means Universitio holds a
bucket of passports and birth certificates, and that is a materially different risk posture from
holding none — for insurance, for a breach, and for what we can say to a university or a parent. If
the answer is "we do not want to be an organisation that stores identity documents", that is a
legitimate reason to choose B and accept the worse retry, and it is a founder's call rather than an
engineer's.

**What would change my recommendation:** a competent determination that transient in-memory bytes
are *not* storage under UK GDPR. That single answer removes B's main uncertainty and makes the
choice much closer.

---

## What I need from you

~~One line: **A or B.**~~ **Answered: A, on 2026-09-07.** The twelve retention determinations were
answered the same day (see B1), so that blocker did not survive to become the next one either.

**What remains before a document can move**, none of it a founder decision except the first:

- **B2** — the ADR-0022 lawful-basis determination. `assertStorable` requires a registered basis
  *as well as* a retention policy, so the vault stays shut on this alone.
- **The transport phase** — student → AAS (route, multipart parser, size cap, client control) and
  AAS → the process holding the browser. Identical to what this sheet described, with the second
  half now settled as "from the vault at execution time".
- **The deletion cascade**, recorded in the schedule and not yet implemented.
- **The expiry thresholds**, to be proposed and confirmed before implementation.
- **`attach_document`'s own intent identity**, which ADR-0069 names and this sheet flagged as needed
  under either answer.
