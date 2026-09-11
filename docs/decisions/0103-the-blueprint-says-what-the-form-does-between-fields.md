# ADR-0103 — The blueprint says what the form does between fields

**Status:** **Accepted** — engineering decisions made under Vahid's instruction of 2026-09-11,
*"Take the four schema gaps"*; gap 4 built in P93, gaps 1–3 to follow, each on its own phase
**Continues:** [ADR-0017](./0017-blueprints-are-reviewed-artefacts.md) ·
[ADR-0069](./0069-a-document-attachment-is-one-consequential-act.md) ·
[ADR-0102](./0102-use-the-refusal-the-form-offers.md)

## Context

The first real form (Sheffield PGT, read 2026-09-10 and 2026-09-11) showed four things the
blueprint schema could not say, each recorded in the capture README as a gap for step 4 and
raised for Vahid rather than designed around:

1. **Options that arrive after another field is set.** The education page's grading system and
   grade are empty selects until the institution is chosen and a lookup answers; the subject list
   until a search is run. A fill that sets the later field before the earlier one sets a field
   with no options.
2. **A typeahead as a fill mechanism.** The institution and country are Tom Select controls: a
   text box that searches and a list to pick from, with the real `<select>` hidden.
3. **A repeatable entry as a page shape.** Education and employment are one page per entry, and
   the applicant adds as many as they have.
4. **A companion field whose value follows another act.** Every document slot has a status radio
   — *upload now / later / not providing* — that must hold *now* when a file goes in; sixteen
   slots tick it from the file input's own script, the seventeenth does not.

Vahid, 2026-09-11: *"Take the four schema gaps. Part 2 waits, deliberately. It is the page where
submission actually happens and it deserves the schema to be settled before it is read — reading
it now and then changing the shape underneath it is work done twice."*

These are engineering decisions, recorded here as the standing approval allows, and they change
the shape of a reviewed artefact — so each is stated plainly enough that he can overturn it.

## Principle

The blueprint is a *reading* of the form (ADR-0017). Each gap is something the form *does* between
its fields that a reading has to carry, or the fill will do the wrong thing on a page that looked
complete. Each addition is data a reviewer can see and check against the portal; none lets the
runner decide anything at fill time that the reviewed artefact did not say. Where a value cannot
be known before the fill — a grading system's options after the lookup — the mapping still names
what the reviewer expects and the runner refuses if the form does not offer it, exactly as
`option` rendering has always refused a value the list does not hold.

## Gap 4 — a document slot's companion — DECIDED and BUILT (P93)

`RequiredDocument.companion?: { fieldRef; whenAttached }` — the control the portal expects set
beside the slot when a file is placed in it, and the value it must hold.

- The plan carries it with the upload (`UploadInstruction.companion`), from the blueprint, when a
  document is mapped to the slot; with no document mapped the companion is left as the form has
  it, and is never a blocker. It is never mapped: `checkUsable` refuses a companion that is not
  on the blueprint, does not offer the value, or is mapped as well (`document_companion_invalid`).
- The runner sets it **after** the attach — a portal's own script may set it from the file input's
  change event, and a runner that set it first would be undone — and reads it back; a companion
  the portal did not take fails the page with what the portal shows, because a save without it
  may not register the upload.
- The preview names it beside the attachment, in the option's own words, and it is inside the
  content hash.
- The validator does not count a required companion as missing: it is the attach's second act.
- Radio groups, generally: the fill session now sets a group by the *value* of the option, and
  reads back the value of the *checked* member — before this a group found by name could only be
  ticked, not chosen, which P88's grouped radios would have hit on the first fill.
- Measured on the fixture portal, whose documents page now demands the status and does not tick it
  itself — the seventeenth slot's shape: without the second act the save is refused with the
  portal's own message; with it the journey completes.

The curated Sheffield draft carries a companion on the seven slots whose *upload now* value the
capture holds; ten wait on a re-read for their option values, and the README says so.

**Found rather than designed, while setting those seven.** The language page and the education
page both call their file input `certificate` and its status radio `certificateStatus`, and the
draft parsed. Every consumer keys by fieldRef alone — a mapping set's `fieldRef`, the plan's
instructions, the preview's lines, and now the companion check, which met the education page's
radio when it looked for the language page's and refused. Scoping that one lookup to the page
would have hidden the ambiguity from the one check that noticed it. So the rule is stated where
the artefact enters: `parseBlueprint` refuses a fieldRef that appears twice, at the second
occurrence's path, naming the first. The tool's own draft repeats names freely (every page has a
`saveBtn`); a curated draft may not, and the two language-page fields are renamed
`languageCertificate` and `languageCertificateStatus`, locators unchanged.

## Gap 1 — options that arrive after another field — DECIDED and BUILT (P94)

`BlueprintField.optionsAfter?: { fieldRef }` — this field's options are loaded by the portal after
`fieldRef` is set. Fill order follows the blueprint's field order, and `checkUsable` refuses a
blueprint whose dependent field precedes the field it depends on. The runner, before selecting,
waits a bounded time for the option it was told to select to appear, and fails with the options
the form offered if it does not. The mapping names the option by the label or value the reviewer
saw once the earlier field was set; the runner never chooses among what arrives. What the
reviewer can see of a dependent list is a limit of the capture, not of the schema: a capture taken
with the earlier field set shows the list, and the curation records that state.

As built:

- `checkUsable` refuses (`options_after_invalid`) a dependent field whose earlier field is not on
  the same page before it, or is itself; a dependent that is not a select, multiselect or radio —
  there is nothing to wait for; and a mapped dependent whose earlier field is mapped by nothing —
  its option could never arrive, so the fill would fail on every run, and the refusal is here
  rather than there.
- The plan carries `optionsAfter` on the instruction, through the transport and the wire, and the
  runner calls `awaitOption(locator, value)` before the fill — a new act on the session, for one
  named option, bounded at five seconds — and the page fails as drift with what the list offered
  when the bound passes. Nothing is typed into that field.
- Discovery does not infer the dependency; the reviewer records it. The demonstration's stubbed
  review does exactly that for the fixture form's passport-country list, which the page now fills
  after the nationality and after a round trip, as the fixture portal's does; a fill that did not
  wait meets an empty list and is refused.
- The curated Sheffield draft records the education chain the handlers name: `institutionCode`
  after `institutionCountry`, `gradingSystemId` after `institutionCode`, `grade` after
  `gradingSystemId`, `subject` after `subjectSearch`. Their option lists are what the capture held
  with nothing set — one blank entry each — so no mapping can name an option until a capture is
  taken with the earlier fields set, and `checkUsable` will refuse one that does, as `option`
  rendering always has.

## Gap 2 — a typeahead — DECIDED and BUILT (P95)

`FieldInputType` gains `typeahead`, with `BlueprintField.typeahead?: { optionLocator }` — the
locator of the entries the control offers as the student types. The runner types the mapped text,
waits for an entry whose text equals it exactly, and chooses that entry; no entry, or more than
one, fails with what was offered. Choosing a typeahead entry is a fill, not an advance, and the
click guard is told so.

As built:

- `checkUsable` refuses (`typeahead_invalid`) a typeahead field that does not say where its
  entries are, and entries declared on a field that is not a typeahead. The plan carries the
  entry locator on the instruction, through the transport and the wire.
- The session gains two acts, `fillTypeahead` for a confirmed value and `fillTypeaheadConstant`
  for a reviewed constant — kept apart for the reason `fill` and `fillConstant` are — and the
  runner routes a typeahead instruction to them. The act types the text, waits a bounded five
  seconds for exactly one entry whose text equals it, and clicks that entry. No entry or more
  than one fails with what was offered and chooses nothing; "Ira" offering *Iran* and *Iraq*
  chooses neither. The entry's click does not consult the advance allow-list, because the entry
  is the answer and not a control — but an entry that reads as a submission control is refused
  by the same rule that guards every click.
- Discovery does not produce the type: a typeahead reads as a text input. The reviewer sets it.
- The fixture portal's study page asks the course through a search answered by the server for
  what was typed, two courses sharing a prefix, and refuses a save naming no course the search
  offers; the gated fixture maps it as a reviewed constant. The demonstration form carries a
  typeahead the page answers by script, for the confirmed path.
- The curated Sheffield draft marks `institutionCountry-ts-control` and `institution-ts-control`
  as typeaheads. Their entry locator is Tom Select's default markup, not the capture's — the
  captured pages are not in the repository — and the README says so; the next read confirms it.

## Gap 3 — a repeatable entry — DECIDED, to build (P96)

`BlueprintPage.repeats?: { fieldKey; addAnother? }` — the page is filled once per item of a
list-valued profile field (`education.prior_qualifications` is one), and mappings on that page
use `part` paths relative to the item. The plan carries the page's instructions once per item
with the item's index, the page walk revisits the page through its own *new entry* URL or
*add another* control between items, and the preview lists each entry. This is the largest of the
four and touches the page walk; it is last for that reason.

## What this does not decide

Whether Part 2 — course choice and the submission boundary — has shapes beyond these four. It is
unread by decision, and read only once the schema above is settled.
