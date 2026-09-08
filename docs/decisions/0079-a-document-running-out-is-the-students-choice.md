# ADR-0079 — A document running out is the student's choice, once, in writing

**Status:** **Accepted** — approved by Vahid Mohammadi, 2026-09-07
**Completes:** [ADR-0078](./0078-documents-are-held-and-reused.md) §5 — the rule was decided there
and the numbers deliberately left absent until proposed and confirmed

## Context

B5 is *hold and reuse*. A document kept twelve months after its last use is a document that can go
out of date **between one application and the next**, and the student is the only person who can do
anything about it. ADR-0078 recorded the rule and explicitly recorded that no threshold was
configured, because the numbers were to be proposed with reasoning and confirmed first. They were
proposed on 2026-09-07 and approved the same day, with one removal.

## Decision

### The thresholds

One principle, applied throughout: **the threshold is the time a student needs to obtain a
replacement**, not a fixed fraction of the document's life.

| document | threshold | why |
|---|---|---|
| `passport` | **6 months** | UK renewal is routinely ~3 weeks and can run to 10; six months also covers the validity many visa routes require at entry |
| ~~`national_id`~~ | ~~**3 months**~~ | ~~Usually renewable in-country in weeks, and the student is often already there.~~ **The document type was removed in [ADR-0089](./0089-national-id-leaves-the-supported-document-types.md).** The threshold and its reasoning are correct and are recorded there, so re-adding the type starts from them |
| `english_test_certificate` | **4 months** · *provisional* | Results take ~2 weeks, but a re-sit needs booking, preparation and often travel |
| `birth_certificate`, `degree_certificate`, `academic_transcript`, `reference_letter`, `personal_statement` | **none** | They do not expire. Staleness in a reference or a statement is a quality judgement, not an expiry, and it belongs to the student |
| `bank_statement` | **none, deliberately** | See below |
| `visa_document` | **none, deliberately** | ADR-0021 — the visa route is out of scope for the application this system makes |
| `sponsorship_letter`, `parental_consent`, `guardianship_document`, `other` | **undetermined** | Nobody has decided. Recorded as such rather than defaulted to silence |

**`bank_statement` gets nothing, and that is the decision rather than an omission.** Vahid: *"Row 12
is out of scope and blocking, and giving it a threshold makes it look half-ready. Leave it with
nothing."* It was in the proposal at 14 days and was removed. A bank statement has a recency window
rather than an expiry in any case.

### The three properties, each structural

1. **The wording recorded is the wording shown.** `recordChoice` takes the `ExpiryWarning`, not a
   string, and `ExpiryWarning` is branded so only `decideExpiryWarning` can produce one. There is no
   parameter through which a caller could record a sentence other than the one the student read. A
   record saying *"the student was warned"* without saying what they read is evidence of nothing —
   the same argument ADR-0059 makes about the preview a student authorises.

2. **It fires once.** The only input about previous warnings is *when the first one happened*; there
   is no "warn anyway". Vahid: *"a countdown that nags is one people learn to dismiss."*

3. **Every document type is classified.** `EXPIRY_THRESHOLDS` is total over `DocumentType`, so a new
   type does not compile until somebody decides — the mechanism ADR-0077 uses for the profile
   registry, for the same reason. `undetermined` is a fourth state and blocks the warning rather than
   reading as *"no warning needed"*, which is ADR-0023's rule in another place.

### The English test number is provisional, and says so in the code

Row 8 of decision sheet B1 carries obligation `read_the_test_provider_terms`. Those terms may
constrain validity or verification in a way that moves this number, so the threshold names the
obligation, `provisionalThresholds()` lists it, and every warning produced from it is marked
`provisional` — which is carried into the recorded choice.

Vahid: *"keep that link explicit so the number cannot be treated as settled."* Discharging the
obligation is what settles it.

### `already_expired` is not a warning

A document whose expiry has passed is a **validity failure** — `assessValidity` refuses it — and
telling the student *"this is about to expire"* would be both wrong and too late. It is its own
answer with its own name.

## What this deliberately does NOT do

- **It does not store anything.** No vault holds a document, so nothing yet has an expiry date to
  watch or a choice to persist. This is the decision and the wording; the storing of the record
  belongs to the transport phase.
- **It does not decide the four undetermined types.** Guessing a threshold for a sponsorship letter
  to make the table look complete is the failure this repository keeps naming.
- **It does not put the thresholds in the retention schedule.** They are not retention periods: a
  retention period is a legal determination with a basis and a version history, and belongs in
  versioned configuration for those reasons. A warning threshold is a product rule over a closed
  union in code, and its most valuable property — that a new document type cannot be added without
  one — can only be enforced by the type system. Recorded so the choice can be overridden rather
  than being an accident of where it was easiest to put.

## Consequences

- A student is told once, in specific words, that something is running out, and both options are
  presented as real — proceeding is legitimate, and the record of that choice is what makes it
  theirs.
- **`packages/documents` is in no deployable's dependency closure** (only `packages/extraction`
  depends on it, and nothing depends on that), so this constrains code that does not currently run.
  It is compile-time and pure, so it holds whenever the package is built and will already hold when
  the transport phase wires it in — but it is not guarding a live path today, and the same was true
  and said of ADR-0077.
- The declared-but-unreachable surface is **unchanged at six**. Nothing here is a runtime capability
  waiting on a caller.
