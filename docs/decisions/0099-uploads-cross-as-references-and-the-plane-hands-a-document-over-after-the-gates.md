# ADR-0099 — Uploads cross as references, and the plane hands a document over only after the gates

**Status:** **Accepted** — 2026-09-10
**Continues:** [ADR-0098](./0098-one-yes-over-a-preview-that-names-each-attachment-and-a-closed-set-of-refusals.md)
(slice c of the attachment path measured in the state document §2). **Applies**
[ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md),
[ADR-0069](./0069-an-authorisation-is-spendable-only-in-the-application-it-names.md) and
[ADR-0087](./0087-the-four-lawful-basis-determinations.md)'s determination 3; **amends** [ADR-0046](./0046-a-fill-plan-crosses-as-value-and-provenance.md)'s rule that a plan with uploads
is not transportable.

## Context

Three of the five cuts measured on 2026-09-10 sat between a held document and a runner's browser:
a plan with uploads was refused transport; no `DisclosureRequestRecord` was ever constructed; the
runner had no `DocumentSource`. Slices a and b (ADR-0097, ADR-0098) put the document into the
preview and made the student's single yes specific to it. This slice closes the three.

ADR-0046 refused a plan with uploads because *"transporting a plan with uploads in it would need the
documents too, and the runner is forbidden `@askimate/aas-documents`"*. Both halves of that reason
still hold. What changes is what an upload IS on the wire.

## Decision

### An upload crosses as a reference, never as a document

`StoredUpload` and `TransportedUpload` carry exactly four things: which box (`fieldRef`, its label),
which document the reviewed mapping named for it (`documentRef`), and where the box is
(`locators`). No bytes, no document id, no hash. The contract's parser refuses a fifth field. The
plane filters a page's uploads by the same rule as its fields, and a page whose only box is a file
input is a page to fill.

### The plane hands a document over only after the gates, in this order

`POST /internal/v1/work/{runId}/documents/{documentRef}`, behind the service certificate, the lease
in the body. `RunDriver.documentForWork` checks, and each check is a refusal rather than a fallback:

1. the caller holds the lease on this run (ADR-0045);
2. the run is at `execute`, and its plan names this upload;
3. the case carries a captured, un-voided authorisation, and the preview the orchestrator would
   render **now** hashes to it — what was said yes to is what is about to leave (ADR-0057, ADR-0059);
4. a `DisclosureRequestRecord` is built from what the student actually saw — the preview text, the
   document it named, the destination it named, the case, the form's own label as
   `requestedFor` — with determination 3 from the register, and `authoriseDisclosure` runs
   (ADR-0022, ADR-0087, ADR-0098). A case a minor-safeguarding trigger holds passes an **empty**
   `minorConditions`, which the gate refuses as undetermined (ADR-0011);
5. `mayTransmit` runs **with the case** (ADR-0069);
6. only then is a sixty-second retrieval URL minted (ADR-0092), and the record the gates ran over is
   answered beside it.

Nothing on this route reads a byte. The refusals are a closed set of nine in the driver and map to
four published codes on the wire; the route tests read the driver's reason, the runner reads the
code and reports the work as needing a person.

### The runner runs the gate again before it attaches

`documentSourceFor` asks the plane under the lease, refuses a record about another case before
fetching, fetches the URL once, hashes the bytes and refuses a mismatch, looks the determination up
in **its own** register by id and refuses one it does not hold, rebuilds the record and mints the
`DisclosureAuthorisation` brand through `authoriseDisclosure` — never a cast — and hands
`executePlan` an `AuthorisedDocument`. `executePlan` then runs `mayTransmit` with the case at the
moment of attaching, as it always has. The gate twice, on two machines, same inputs.

`fillApplication` requires a `DocumentSource`; a fill that silently had none would report every
upload as "no document supplied", the outcome ADR-0046 refused transport to avoid.

### `authoriseDisclosure` leaves the declared-but-unreachable register

Its production caller is `documentForWork`. The entry moves to `reachable`; the state document's
table moves with it (ADR-0073's two lists).

## What was found, and is Vahid's

**The runner's entry point performs `create_account` only.** Building the hand-over measured that
`apps/browser-runner/src/main.ts` answers `needs_the_student` to every other work kind, and that
`fillApplication` — the thing that would fill and save a page — is called by `scripts/journey.test.ts`
and by nothing a deployable runs. Execute work has no production performer and never had: the
browser session an account was created in does not survive to the next work item, and the password
that would sign in again was single-use and is gone (ADR-0042). Nothing yet decides how a runner is
signed in when execute work arrives. `fillApplication` enters the register as declared-but-unreachable
with that reason; the count stays six. It is blocker 19 in the state document, and the decision —
how a signed-in session lives across work items — is his.

**Execute work for a portal with no login is never handed out.** `accountDetail` answers null when no
account exists and no account step names one, because `ClaimedWork` carries an account's email and
approach (ADR-0045). The open fixture has neither. The hand-over test takes its lease through the
store the claim path uses, and this is recorded under blocker 19 rather than widened here.

## What was built

- `packages/mapping/src/plan-transport.ts` — `StoredUpload`; `toStoredPlan` carries uploads and no
  longer refuses `has_uploads`; `rehydratePlan` rebuilds them
- `packages/contracts` — `TransportedUpload`, `TransportedPlan.uploads`, `WorkDocument`,
  `WireDisclosure`, `WorkDocumentRequest`, `parseWorkDocument`; both in `conversation.v1.yaml`
- `RunDriver.documentForWork`, `RunDriverOptions.disclosure`, `WorkDocumentRefusal`; the route;
  `DriverWiring.disclosure`; `main.ts` builds the transport before the driver and threads its
  register and vault; `workPayloadFor` carries this page's uploads
- `apps/browser-runner/src/document-source.ts`; `WorkIntake.document`;
  `FillApplicationDeps.documents`; the runner depends on `@askimate/aas-disclosure`
- Tests: the runner's source (seven cases), the contract parser, the route (four, every refusal
  mapped), the plane-side hand-over against Postgres (the yes, the lease, a stranger refused, a
  wrong upload refused, the record the gates ran over), the transport round trip with uploads

## What was not built

- Slice d — the runner's entry point performing execute work with this source (blocker 19).
- Slice e — the `attach_document` intent per upload (ADR-0069's third layer) and the
  `TransmissionRecord` written from the runner's report.
- A `WithdrawalRecord` producer: a student's change of mind voids the fill authorisation, which
  step 3 refuses on; `mayTransmit`'s own withdrawal check is passed an empty list, and says so.

**Declared-but-unreachable surface: six** — `authoriseDisclosure` out, `fillApplication` in.
