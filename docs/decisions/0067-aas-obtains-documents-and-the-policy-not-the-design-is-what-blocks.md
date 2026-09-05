# ADR-0067 — AAS obtains documents; what blocks it is policy, not design

**Status:** **Accepted** — 2026-09-05
**Corrects:** [ADR-0066](./0066-three-declarations-name-a-document-and-one-decides.md) §6.1, which recorded
*"does AAS ever obtain a document, or only ever identify one?"* as an open product question. It is not
open. It was decided in Phase 0 and Phase 1 and the decision is load-bearing throughout — see §3
**Depends on:** [ADR-0010](./0010-policy-driven-document-retention.md),
[ADR-0016](./0016-extraction-must-quote-the-document.md),
[ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md),
[ADR-0023](./0023-retention-periods-are-determined-not-invented.md)
**Amends:** ADR-0022's claim that *"the system will refuse to act until"* storing activities are
registered. Measured: true for sending, **false for storing** — see §7
**Builds nothing.** No upload path, no storage, no table, no engine, no schema change

## §1 · The question

P30 ended by asking which of two product directions AAS is designed for:

> **Option A** — AAS only ever *identifies* that a document is required.
> **Option B** — AAS *obtains* a document from the student, and may hold and transmit it.

P30 framed this as undecided. That was wrong, and the error is worth naming: P30 read the three
fields called `requiredDocuments` and concluded from their inertness that the product boundary was
open. It never read the document subsystem sitting beside them.

## §2 · The answer

**Option B. AAS is designed to obtain, hold, extract from and transmit documents.** It is not a
preference and it is not new: it is what the accepted ADRs decide and what the code already
implements.

## §3 · The evidence, in the order it settles the question

**The decisions say so, in Vahid's own words.**

- [ADR-0010](./0010-policy-driven-document-retention.md) answers *Phase 0 Open Question 5 — how long
  do we keep a passport scan*, and instructs: *"Design the document vault so that retention periods
  are configurable and policy-driven."* An identification-only product has no vault and never asks
  that question.
- [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md): *"The system must not
  upload a document to a university merely because the document exists in the vault."* Presupposes
  both a vault holding documents and an upload path — and the ADR's entire subject is constraining
  that upload, not preventing it.
- [ADR-0016](./0016-extraction-must-quote-the-document.md) is about AAS reading a document it holds:
  *"a model asked to read a blurry photograph, having seen a great many passports."*

**The code implements it.**

- `packages/documents` implements the whole lifecycle — `uploaded → extracted → confirmed →
  verified → superseded → purged`, with `store`, `retrieve`, `listForStudent`, `startRetentionClock`
  and `purgeContents`.
- `packages/execution` **already transmits**: `executePlan` loops `plan.uploads`, resolves each
  through a `DocumentSource`, and puts it through ADR-0022's `mayTransmit` gate at the moment of
  upload. That gate is wired into the runner today; it simply never has a document to check.
- `scripts/end-to-end.ts` **already performs a document upload end to end** against a replayed
  portal, with a real `DisclosureAuthorisation` built from a stubbed `LawfulBasisDetermination`.

**The product record expects it.**

- `docs/what-a-controlled-live-run-needs.md`: *"the first real document upload will fail loudly."*
- `docs/decision-point-2026-08-26.md`, the pre-production checklist: *"Retention schedule v1 with a
  policy for **every document the run will touch**"*, and *"Every document upload carries a
  `DisclosureAuthorisation`…"*

Option A is therefore not a choice the architecture leaves open. It would be a **narrowing** of a
decided design, and would strand `packages/documents`, `packages/extraction` and the upload half of
`packages/execution` as code nothing can reach.

## §4 · What is actually built, and what is only wired

Measured by dependency, not by intent:

| | Built | Reachable from a deployable |
|---|---|---|
| Transmission gate (`mayTransmit`, ADR-0022) | yes | **yes** — `packages/execution`, used by the runner |
| Disclosure authorisation + specificity check | yes | yes, through execution |
| `TransmissionRecord` audit | yes | yes |
| The run's stop when a document is missing (ADR-0065) | yes | yes |
| Document vault (`packages/documents`) | yes | **no** — nothing but `packages/extraction` depends on it |
| Extraction (`packages/extraction`) | yes | **no** — nothing depends on it at all |
| Retention schedule | yes | via the vault, so **no** |
| A way for a student to supply bytes | **no** | — |

So the gate that refuses ships in production, and the thing it would refuse cannot exist yet. That is
the correct order and it is ADR-0019's stated principle: the constraint ships before the thing it
constrains.

## §5 · Storing and sending are separate, and the code already separates them

`disclosure.ts` refuses a determination for the wrong activity with the sentence *"A basis for holding
a document is not a basis for sending it."* Exactly one processing activity is declared:
`disclose_document_to_institution`. There is **no declared activity for holding**.

ADR-0010's gate is on `vault.store`. ADR-0022's gate is on transmission. They are independent, which
means a third shape exists that no document has yet named:

> **Pass-through** — the bytes reach the portal without AAS ever storing them.

Architecturally it is available: `DocumentSource` returns `{ contents, contentHash, authorisation }`
and nothing requires those bytes to have come from a vault. It would engage ADR-0022's single
determination and none of ADR-0023's twelve.

**This ADR does not adopt it.** Whether bytes held in a process's memory for the duration of an
upload constitute storage under UK GDPR is exactly the kind of question ADR-0023 forbids guessing at.
It is recorded because it materially changes the MVP's cost, and because deciding it is cheaper than
discovering it.

## §6 · What blocks Option B — all of it policy, none of it design

| | Blocker | Owner | Why it cannot be answered here |
|---|---|---|---|
| **B1** | Twelve unresolved retention requirements | `data_protection_owner` | Each names an external authoritative source: ICO storage-limitation guidance, the university's or QA Higher Education's own records-retention requirement, DPA 2018 Sch. 1, the Age Appropriate Design Code. ADR-0023 forbids inventing a period. |
| **B2** | No lawful-basis determination for `disclose_document_to_institution` | a named determiner | ADR-0022: a determination is *"a named person, a date, an Article 6 basis… the reasoning, and a review date"*. Naming a person is not an engineering act. |
| **B3** | No lawful-basis **activity** for holding, and no storage-time gate that consults one | a named determiner, then engineering | §7 |
| **B4** | No transport: nothing by which a student can supply bytes | product + engineering | §8 |
| **B5** | Store-and-forward, or pass-through? | product + legal | §5 |

`pnpm run retention-status` prints B1 and who owns each question, and runs in CI. Nothing prints B2
or B3.

## §7 · A guarantee ADR-0022 states and the vault does not provide

ADR-0022 says:

> Before production, someone must determine and register, at minimum: **storing** identity documents,
> **storing** academic documents, disclosing documents to an institution… **The system will refuse to
> act until they have.**

Measured. `InMemoryDocumentVault` is constructed with a `RetentionSchedule` and nothing else, and
`store()` has exactly one gate — `assertStorable`, which checks retention. With a retention policy
configured and **no lawful-basis determination anywhere in the process**, a document stores:

```
STORED with NO lawful-basis determination anywhere: doc_000001 uploaded
retention policy consulted: PROBE-001
```

So the sentence is true of disclosure and false of storage. It is not currently exploitable — no
retention policy exists, so the retention gate refuses everything, and no deployable holds a vault at
all. But it is a real gap between a stated guarantee and the implementation, of the same kind
ADR-0056 found and closed.

**It is deliberately not closed here.** Adding the gate means deciding where the lawful-basis
machinery sits relative to `packages/documents`, and that is a coupling decision inside a document
architecture this phase exists to leave unsettled. It is recorded instead as a MUST-HAVE in §9 and as
the first item of the next phase's scope. What is corrected now is the *claim*: ADR-0022 overstates
what the vault enforces.

## §8 · The transport, which nothing has designed

There is no route, no schema and no client surface by which a student could supply a document.
Confirmed: nineteen routes on the Conversation Service, none document-bearing; no `multipart` anywhere
in either OpenAPI document; and the published fill-plan schema states plainly that a plan with uploads
is *refused* for transport rather than trimmed, *"because a plan with its uploads silently removed
would report itself complete having attached nothing."*

**The Secure Plane is not the answer, and should not be made into one.** It is shaped for a secret:
a hard five-minute TTL, all persistence disabled, a per-request data key zeroed after use
(ADR-0034), and a control whose only input is a password field. Widening it to carry documents would
give the one service that touches passwords a second, larger, longer-lived payload — the opposite of
why it exists.

## §9 · The minimum capability, split

For **one real document to reach one real portal, lawfully**:

**MUST HAVE**

1. B1 resolved — a retention schedule covering every type the run touches — **or** B5 decided as
   pass-through, in which case B1 does not bite.
2. B2 — the disclosure determination.
3. B3 — a holding activity and its gate, **if anything is held**.
4. B4 — a transport, and a decision about where the bytes live between arriving and being sent.
5. Student authorisation naming the document *and* the destination. **Built** —
   `authoriseDisclosure`, `renderDisclosureRequest`, and the specificity check that ties the rendered
   text to the check.
6. The transmission gate at the moment of upload. **Built and wired.**
7. The `TransmissionRecord`. **Built.**
8. A decided design for carrying uploads to the runner. The current `has_uploads` refusal is
   load-bearing and correct today; it is also the one existing refusal that must change.
9. The run stopping when a document is required and absent. **Built** (ADR-0065).

**CAN BE DEFERRED**

- Extraction from the document (ADR-0016). Attaching a passport does not require reading it; that
  machinery serves *profile* values.
- Reuse across applications, the validity window, supersession, `verified` state and specialist
  access to held bytes.
- Erasure tooling beyond `purgeContents`.

**NOT REQUIRED for the first run**

- Financial evidence — ADR-0021 puts it out of scope for a UK university application.
- Minor-safeguarding documents, unless the applicant is a minor (ADR-0011, ADR-0013).
- Object storage and KMS, if B5 is decided as pass-through.

## §10 · What must be frozen before the first catalogue approval

Verified, not assumed: there is no `approvals.json` anywhere in the repository — the only ones are in
`/tmp` test directories — and `toCanonical` walks the parsed object, so **field names are inside the
content hash**. Two artefacts differing only in a field's *name* hash differently:

```
{ requiredDocuments: [...] }  sha256:435b98b5…
{ studentDocuments:  [...] }  sha256:32c383ba…
```

So the following must be settled before the first artefact is approved, because after that each
change invalidates every approval:

1. The **name and shape** of `CatalogueEntry.requiredDocuments`.
2. The **name and shape** of `BlueprintPage.requiredDocuments`.
3. What a mapping's `documentRef` **is**. Today it is ambiguous: discovery emits the portal's own
   `fieldRef`, the shipped fixture uses a domain-ish word, and `DocumentSource` keys on whatever the
   mapping says. The mapping set is inside the entry, so this is inside the hash too.

None of these is a change this ADR makes. They are the list a decision has to cover.

## §11 · `CatalogueEntry.requiredDocuments` is not redesigned here

Asked and answered on the evidence, not on taste. For the **identification** role ADR-0066 measured
it to have, `readonly string[]` is sufficient: it names types, it is shown to a student, nothing plans
from it.

For any **consequential** role it is insufficient, and the shape it would need already exists —
`Requirement`, with `criticality`, a mandatory `scope`, curated and official evidence, and
`revalidateBy` (ADR-0009, ADR-0021). It would also need the required/optional and `requiredWhen`
distinctions the blueprint side already carries and the entry side does not.

That is an upgrade path, not a redesign, and taking it is the same decision as B5 and §10. Nothing
changes until it is taken.

## §12 · AskiMate

Unchanged, and it needs no negotiation: ADR-0002 records that **AskiMate holds no documents of any
kind** — *"no qualifications, grades, test scores, passport data, financial information, or documents
of any kind."* It therefore cannot hand AAS a document reference; there is nothing to hand.

The boundary that follows: AskiMate may identify and explain a requirement in conversation, because
that is what ADR-0015 already makes it — the surface. Obtaining, holding, verifying and transmitting
are entirely AAS's side of the line. Nothing about documents gives a reason to widen the seed-hint
channel of ADR-0002, and this ADR does not.

## §13 · The decision that remains

Not *"identify or obtain"* — that is answered. What remains is a single product/legal decision with
four parts, and it is concrete:

> **Before the first real document, and before the first catalogue approval:**
>
> 1. **Does AAS hold documents, or pass them through?** (B5) Decides whether B1's twelve retention
>    questions bite at all, and whether object storage is in the MVP.
> 2. **Who determines the lawful basis, and by when?** (B2, B3) A named person with a date. Holding
>    and sending need separate determinations; only sending has an activity name today.
> 3. **How does a student supply a document?** (B4) Not the Secure Plane — §8.
> 4. **What are the frozen names?** (§10) Three, and they are cheap today and expensive after the
>    first approval.

Only (1), (2) and (4) require someone other than an engineer. (3) is designable once (1) is answered.

## Consequences

- The product direction is recorded as answered, with the evidence, so it is not re-litigated.
- ADR-0066 §6.1 is corrected; ADR-0022's storage guarantee is corrected.
- A third shape — pass-through — is on the table, named, and not adopted.
- Nothing was built. The blockers are enumerated with owners, and three of the four need a person.
