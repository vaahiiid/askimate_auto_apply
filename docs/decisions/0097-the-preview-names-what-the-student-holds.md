# ADR-0097 — The preview names what the student holds

**Status:** **Accepted** — 2026-09-10
**Continues:** [ADR-0095](./0095-the-page-makes-the-put-and-the-cors-rule-is-exercised.md) and
[ADR-0096](./0096-expired-document-intakes-are-swept-by-the-worker.md). Slice **a** of the attachment
path measured in the state document (§2, 2026-09-10). Completes the first layer of
[ADR-0069](./0069-an-authorisation-is-spendable-only-in-the-application-it-names.md)'s identity table
on a production path.

## Context

The transport ends at a held document. The first cut in the path from there to a portal was measured
on 2026-09-10: `RunDriver` handed the orchestrator `documents: new Map()`, so a reviewed mapping with a
`document` source stopped every run at `document_missing` before the student was asked anything —
whether or not they held the document.

ADR-0069 froze an attachment's authorisation identity as `(fieldRef, documentRef, contentHash)` and
put all three inside the preview's content hash. ADR-0087's determination 3 registered the preview,
the authorisation text and that hash as *"required, not optional"* for a disclosure. Both were true
of a preview that could never contain a document.

## Decision

### The driver reads the vault's metadata, and only that

`RunDriverOptions.heldDocuments` is the one question the driver asks the vault: what does this
student hold? It is the `DocumentRecordStore` (ADR-0094) — `PostgresDocumentRecordStore` in both
composition roots, so the Conversation Service and the Worker build the same driver and name the same
documents (ADR-0041). The driver names no vault method that yields or takes bytes, and the
measurement test that used to assert the empty map now asserts that.

### One document per type: the current one

`previewDocumentsOf` keys the preview's map by document **type**, because that is what a reviewed
mapping's `documentRef` names (ADR-0069: *"what a reviewer decided AskiMate calls the document"*).
Where a student holds several of one type, the latest usable one is chosen; a superseded or purged
record is never chosen, because a superseded passport is the one the student replaced and attaching
it would be sending what they withdrew.

### Named as the type, not as a file

`PreviewDocument.filename` becomes `describedAs`, and the preview line reads *"Upload your passport:
passport"*. The vault records no filename — the page never sends one, and a name the student typed is
free text this system has no use for. What the student is told is the thing they were told they were
sending.

### What this does and does not authorise

A run whose student holds the document now reaches `authorise` with the attachment named, and the
`AuthorisationCaptured` event binds to a hash that covers it. It does **not** send anything:
`toStoredPlan` still refuses a plan with uploads, no `DisclosureRequestRecord` is constructed, and
`mayTransmit` is untouched. Slices b to e (state document §2) remain, in that order.

## What was built

- `previewDocumentsOf`, `HeldDocuments`, `RunDriverOptions.heldDocuments`; `buildRunDriver` wires the
  record store; the test harness does the same
- `PreviewDocument.describedAs` (was `filename`), in `packages/preparation` and its two fixtures
- Tests: a run whose student holds a passport reaches `authorise` with it named (against Postgres);
  the current-not-superseded choice, purged never chosen (pure); the measurement test rewritten

## What was not built

Slice b — the preview's presented text carrying, per attachment, the four things ADR-0022 requires —
waits for Vahid's word on whether one `authorise` over a preview naming every attachment is the
*"specific"* authorisation determination 3 means. Slices c to e follow it.

**Declared-but-unreachable surface: six, unchanged.**
