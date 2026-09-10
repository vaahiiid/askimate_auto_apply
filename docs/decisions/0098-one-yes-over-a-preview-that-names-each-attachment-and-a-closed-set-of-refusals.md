# ADR-0098 — One yes over a preview that names each attachment, and the gates refuse in a closed set

**Status:** **Accepted** — Vahid's decisions, 2026-09-10
**Continues:** [ADR-0097](./0097-the-preview-names-what-the-student-holds.md) (slice b of the
attachment path); closes blocker 18 of the state document. **Applies** [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md)
and [ADR-0087](./0087-the-four-lawful-basis-determinations.md)'s determination 3; **extends** the closed error contract of 2026-08-28 and
[ADR-0075](./0075-a-refusal-reaches-the-person-it-is-for.md)'s rule that a refusal must be actionable.

## The two decisions, in his words

### Authorisation: one yes over a preview that names every attachment

> One authorisation, over a preview that names each attachment separately.
>
> Two reasons. First, the mechanism already makes that yes specific: it binds to a hash covering
> which field, which document and which bytes, and any change voids it. So one yes is a yes to an
> exact, frozen content, not a vague one. Second, the product exists to reduce what a student has to
> do. Five separate yeses for five documents teaches a student to click through without reading,
> which is the once-only reasoning from ADR-0079 applied to consent.
>
> The condition: the preview must name each attachment plainly — which document, going where, for
> what. "Your documents will be sent" is not a preview. If a student cannot tell from it exactly
> what leaves, the single yes is not the instrument ADR-0087 meant.

### Blocker 18: keep the no-detail rule, write the words instead

> The contract's Problem stays without detail. Close the gap the way P41 closed its own: a closed
> set of refusal codes, each with wording written for the student and covered by the
> wording-coverage guard.
>
> Free text composed at the point of failure is where a thing nobody meant to publish gets
> published — the same reasoning as the SpecialistNotice's no-encountered/no-expected rule. A closed
> set is reviewable; a detail string is not.
>
> If a gate's refusal cannot be expressed as a code with written wording, that is worth telling me
> about, because it probably means the refusal is telling the student something we have not decided
> how to say.

## What was built for the first decision

### The preview says, per attachment, which document, going where, for what

`renderPreview` writes, under *Documents that will be sent:*, three lines for each attachment:

```
  Upload your passport: your passport
    going to: Example University (apply.example.test)
    for: this application — MSc Example Studies, 2026-09
```

The document (the type the reviewed mapping named, ADR-0097), the destination (institution and
portal host), and the purpose (the form's own label for the box, and the application by course and
intake). Deterministic, from the preview itself — no model writes a line of it (ADR-0059).

### The destination is inside the hash

`SubmissionPreview.portalHost` is the host of the first URL the blueprint's discovery run observed,
and it is in the canonical content the hash is taken over. ADR-0022's *"where"* is part of what the
student says yes to: the same fields and the same passport, re-pointed at another host, is a
different thing to authorise and voids the earlier yes. A blueprint that observed no URL cannot be
previewed (`destination_unknown`); it could not be executed either (`isExecutable`).

> **Amended in P74 (2026-09-10).** The observed host, *unless the entry names a deployment*. A
> reviewed blueprint is run against a university's UAT environment before production through
> `CatalogueEntry.portalOrigin` (ADR-0057), and the bytes go to **that** host — the Run Driver
> resolves every step's host through it, and the runner's transmission gate is asked about it
> (`mayTransmit({ toHost: work.portalHost })`, ADR-0069). A preview naming the observed host over
> a run made to another was an authorisation the runner could never spend: the plane's gate
> passed it (same host on both sides of the plane's own check) and the runner's refused it,
> `wrong_destination`, correctly. Found when the journey's fixture portal first took a file.
> So `buildPreview` takes the deployment (`PreviewDeployment`), `RunInputs.portalHost` carries
> it, and the three places the driver builds a preview — the run's inputs, the hash check at the
> yes, the hand-over — resolve it through one reading (`deploymentOf`). The consequence is the
> one this section already states: a run re-pointed at a deployment after the yes is a different
> thing to authorise, and stops at the authorisation again. The observed URL is still required;
> a deployment says *where* a reviewed blueprint runs, not that an unreviewable one may.

### What this makes true

The `AuthorisationCaptured` event, over this preview's hash, is the specific student authorisation
determination 3 requires: the text named the document, the destination and the purpose, the hash
binds to them, and any change voids it. Slice c builds the `DisclosureRequestRecord` from that event
and the preview text — `presentedText` is the preview, `method` is `chat_affirmation` — and nothing
here sends anything yet.

## What was built for the second decision

### Three codes, and no `detail` anywhere

The storage gate's five refusals become three published codes, each with words on the page:

| Code | Gate refusal | The student reads |
|---|---|---|
| `document_not_retainable` | `RetentionPolicyMissingError`, `RetentionRequirementUnresolvedError` (ADR-0010, ADR-0023) | *"I cannot keep that kind of document yet: how long it may be held has not been decided. Nothing was kept."* |
| `document_basis_undetermined` | `NoLawfulBasisError`, `DocumentTypeNotCoveredError` (ADR-0022, ADR-0087) | *"I cannot keep that kind of document yet: the basis for holding it has not been decided. Nothing was kept."* |
| `document_type_refused` | `DeterminationDecidedAgainstError` (ADR-0088) | *"That kind of document is not one I keep. Nothing was kept."* |

All 403: the declaration is well formed and the student is who they say; a policy gate refuses, and
nothing in the request can be changed to pass it. A gate that throws anything else is a defect in the
mapping and answers 500, never a quiet `forbidden`.

Every `detail:` left the wire in the Conversation Service: the four document-route ones, the
`validation_failed` on `/purpose`, and two older hand-rolled documents (the ambiguous-target 409 and
`content_changed`) that had carried a refusal's sentence since P21. The gates' sentences still exist
— for a log reader, and for the route tests, which read them off the thrown error — and the contract's
parser goes on dropping any `detail` a server sends.

### The guard

`scripts/no-free-text-on-the-wire.test.ts` reads every route file of every process that answers a
problem document and refuses a `detail:` member. Textual, because the `problem()` helpers take an
untyped `extra` and a type cannot see a hand-rolled `res.json({...})`. `refusal-wording.test.ts`
holds the three new codes to the two lists as before.

### What could not be expressed as a code — nothing, this time

Vahid asked to be told if a gate's refusal could not be expressed as a code with written wording.
All five could. The two pairs that share a code (retention missing and unresolved; basis absent and
type not covered) are the same instruction to the student — not yet — and the distinction is the
data-protection owner's to read, in the gate's own sentence, not the student's.

## What was not built

- Slice c: plan transport carrying uploads as references, and the service answering a retrieval URL
  under the runner's lease after `authoriseDisclosure` and `mayTransmit` with the case.
- Slices d and e as the state document §2 lists them.

**Declared-but-unreachable surface: six, unchanged.**
