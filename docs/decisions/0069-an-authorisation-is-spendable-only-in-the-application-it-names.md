# ADR-0069 — An authorisation is spendable only in the application it names

**Status:** **Accepted** — 2026-09-06
**Depends on:** [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md),
[ADR-0058](./0058-a-case-opens-from-an-offer-the-student-accepted.md),
[ADR-0067](./0067-aas-obtains-documents-and-the-policy-not-the-design-is-what-blocks.md),
[ADR-0068](./0068-the-storage-boundary-refuses-what-adr-0022-says-it-refuses.md)

## The decision

`mayTransmit` takes the case the upload is part of, and refuses an authorisation whose
`DisclosureSubject.caseId` is a different one. `ExecutionContext` carries that case, so
`executePlan` supplies it at every upload, and the Automation Runner supplies it from the work it
was leased.

An attachment's authorisation is therefore bound to **one application**, in the same way ADR-0022
already binds it to one document, one file and one destination.

## What was measured

`DisclosureSubject.caseId` has existed since Phase 1, documented as *"The case this belongs to"*.
`recordTransmission` copies it into the `TransmissionRecord`. `renderDisclosureRequest` prints it to
the student as *"Which application:"*.

**Nothing compared it to anything.** `mayTransmit` checked withdrawal, `documentId`, `contentHash`
and host, and `ExecutionContext` was `{ portalHost, withdrawals, now }` — the executor had no case
to compare against even if the check had been written.

So an authorisation captured for one application was spendable in another, provided the document id,
the content hash and the host matched. ADR-0022 says an authorisation *"is not transferable"* about
documents; it was transferable between applications.

### The host does not cover this

The tempting reading is that the destination check already prevents it. It does not, and the reason
is structural rather than incidental: **two reviewed targets can share one portal host.** A second
course at the same university, a January intake beside a September one, and a route offered through
the same portal are all separate targets with separate blueprints and the same
`DisclosureDestination.portalHost`. `ambiguousGroups` and `isAmbiguous` exist in
`packages/catalogue` precisely because routes collide on institution, course and intake — the
catalogue already knows that a target is not identified by where it points.

So "the right university" is not "the right application", and only the case says which application.

### What the failure would have looked like

The same student, the same passport, the same university, a second application. The student was
asked about the first and said yes. Under the previous check that yes was spendable on the second,
and the `TransmissionRecord` would have recorded the FIRST case's id — so the audit trail would have
said the document went out under an authorisation for an application it was not part of, and
"why did this leave our systems?" would have had a confidently wrong answer.

## Why the case, and not a longer list

The alternative was to check the student and the target as well. It was rejected because those are
not independent facts: `cases.student_id` is written from the conversation's own row, never from a
request body, and `cases.blueprint_id` is written from an offer verified against the conversation's
own log (ADR-0058). One case names exactly one student and exactly one target, in a table with
foreign keys enforcing it.

Checking three things that a database constraint already ties together would be three chances to
disagree with each other, and ADR-0041's reason applies: a second representation of one fact is a
second thing to keep true. The case is the canonical identifier for "which application", and it is
the one that is checked.

This is also why no new identifier was introduced. `ClaimedWork.caseId` already crosses to the
runner; `DisclosureSubject.caseId` already records the binding; the change joins two identifiers
that already existed and were never compared.

## Where this does not reach

**Acquisition is still unbound.** This binds the *spending* of an authorisation to a case. It does
not bind the *acquisition* of a document to one, because there is no acquisition — ADR-0067 §B4
records that no transport exists by which a student can supply bytes, and ADR-0067 §B5 (hold or pass
through) is still a product and legal decision nobody has made. When a transport is built, whatever
constructs the `DocumentSource` must bind the document to the case at the moment it is obtained;
this check will then be the second of two, not the only one.

**Attachment has no intent identity.** `ConsequentialAction` declares `attach_document` and marks it
verifiable, and nothing produces it: `WorkKind` is `create_account | execute`, and uploads ride the
page's `advance_portal_page` intent, whose target is computed from `plan.instructions` only. A
document replacement therefore does not change the page's intent key. That is recorded in
`docs/document-transport-options.md` §5 and remains open; it is transport-level and blocked on
nothing, but building it now would be an intent for an action nothing can currently raise.

## What `documentRef` means — recorded, not renamed

Two fields carry the name and they are in different layers:

| | Layer | Value |
|---|---|---|
| `BlueprintPage.requiredDocuments[].documentRef` | **portal** | `field.fieldRef` — the name attribute of the `<input type="file">`, set by `pageFrom` in discovery |
| `MappingSource { kind: "document" }.documentRef` | **domain** | what a reviewer decided AskiMate calls the document; the key `DocumentSource` and the preview's document map are looked up by |

The repository contains both readings **of the same field**: discovery writes the portal's field
name into it, and the hand-written fixture in `packages/mapping/src/fixtures/portal.ts` writes
`"passport"` while the file input's `fieldRef` is `"passport_upload"`. That disagreement is harmless
only because ADR-0066 made the blueprint page's list causally inert and `check-boundaries` keeps
`requiredDocuments` out of the whole planning path.

Nothing is renamed here. A rename of a blueprint field changes what discovery writes and what a
reviewer reads, and ADR-0066 §6 already records the open product question about the student-facing
list; folding a rename into this ADR would decide it sideways. What this ADR adds is a test at the
place the value is produced — `pageFrom` sets `documentRef` to the field's `fieldRef`, asserted
against the field itself and against its label — so the layer is pinned by something that fails
rather than by a paragraph.

The smallest architectural decision still required, stated so it can be taken later:
**rename `BlueprintPage.requiredDocuments[].documentRef` to `fieldRef`**, which is what it holds. It
is cheap today (no approval exists, and `allRequiredDocuments` has one caller,
`scripts/inspect-discovery.ts`) and it costs every catalogue approval once one exists, because
`toCanonical` walks the parsed object and field names are inside the content hash.

## Attachment identity, frozen

An attachment intent is `(fieldRef, documentRef, contentHash)` — which box, which document the
reviewed mapping named for it, and which bytes. All three are inside the preview's content hash,
which is what a student's authorisation is taken against (ADR-0057, ADR-0059), and each now has a
test that fails when it is removed.

`documentId` is deliberately **not** in it. The vault mints it at store time, so re-storing the same
scan mints another, and a student agreed to send a document rather than a row. It is checked at the
other layer instead: `mayTransmit` compares the `documentId` about to be sent against the one the
authorisation names, because at that point the question is "is this the artefact that was
authorised?" rather than "is this the same application?".

The three layers, stated once:

| Layer | Identity | Enforced by |
|---|---|---|
| authorisation | `(fieldRef, documentRef, contentHash)` | the preview content hash |
| transmission | `(caseId, documentId, contentHash, host)` | `mayTransmit` — the case added here |
| ledger | *missing* | uploads ride `advance_portal_page`; see above |

## Consequence

`mayTransmit` gains a required argument and a fifth refusal, `wrong_case`; `ExecutionContext` gains
a required `caseId`. Both are public contracts of `packages/disclosure` and `packages/execution`,
changed for the reason ADR-0068 changed `store`'s: the previous shape could not express a guarantee
ADR-0022 states. Required rather than optional, because an optional case is a case somebody forgets,
and the callers that must supply it — the runner, the demo — already hold it.

The check ships before the thing it constrains, which is the order ADR-0019 asks for and the order
P31 observed the document gate already had: nothing can supply a document yet, and the refusal that
will meet the first one that can is in production now.
