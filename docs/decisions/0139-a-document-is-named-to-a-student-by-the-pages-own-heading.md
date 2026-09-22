# ADR-0139 — A document is named to a student by the page's own heading, never by the portal's field name

**Status:** Accepted · 2026-09-22 · **found by Vahid reading Run A's own preview**, the same day P187 produced it · completes [ADR-0059](./0059-the-student-can-read-what-they-are-authorising.md) on the one line it was broken on · continues [ADR-0107](./0107-a-handed-slots-companion-says-later.md) (what the portal is told beside a handed slot) · the same rule as [ADR-0136](./0136-an-option-map-is-checked-against-the-list-that-was-captured.md), applied to a label rather than to a value
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-22, before signing. **Built in P188**, the same day. Signed together with ADR-0138 — see *Consequences*.

## Context — the sentence that says what we are telling the university

P187 cut the preview for a completed qualification from six documents to four, which is what the
page shows. Vahid read the result before signing it:

> *"One thing before I sign, and it is in the sentence the student reads before saying yes:*
>
>   *We are telling University of Sheffield that your officialCertTranslation, your
>   officialTranTranslation, your certificateTranslation and your transcriptTranslation are coming
>   later.*
>
> *Those are field names, not documents a student knows. And they mislead:
> `officialCertTranslStatus` is the FINAL ACADEMIC CERTIFICATE — its own options read 'I will upload
> my final certificate now/later' — not a translation. The student reads 'translation' four times
> and two of the four are the degree certificate and the final transcript themselves."*

Both halves are true and the second is the serious one. The four slots' `fieldRef`s were authored
in P85 from the portal's `name` attributes, and two of them are simply misleading names that
Sheffield's own developers chose: `officialCertTranslation` is the row the page heads **Final
Academic Certificate**, and `officialTranTranslation` is **Final Academic Transcript**. A student
reading the preview was told four translations were coming later. Two of them were the degree
certificate and the final transcript.

## Why this is not the seven field names he let stand

On 16 September, offered a reading of seven questions that carry field names in the preview, he
declined:

> *"The values sent are right, which is what my signature is about, and a readable label is for the
> developer who comes next rather than for Run A."*

That decision stands and this one does not overturn it. He drew the line himself:

> *"I let seven field names stand in the preview on the 16th because they were beside values that
> were right, and they mattered to a developer, not a student. This is different: it is the sentence
> that says what we are telling the university, it is the part the student authorises, and it names
> the wrong document. ADR-0059 — the student can read what they authorise — is broken on exactly the
> line that matters."*

So the rule is narrow and its boundary is the reason for it: a field name beside a correct value in
a list of boxes is a developer's convenience; a field name **inside the sentence that states what
the university is being told** is the student authorising something they cannot read, and when the
name is wrong it is the student authorising something that is not true.

## Decision

A `RequiredDocument` may carry **`title`** — the page's own heading for the document — and the
preview says that, in both places a document is named to a student:

- `You attach yourself: Final Academic Certificate`
- `We are telling University of Sheffield that your Final Academic Certificate … is coming later.`

**Where there is no captured title, the preview SAYS so**: *"a document this form does not name"*.
It does not fall back to `fieldRef`, because a silent fallback is the failure being fixed and would
keep it wherever a title is missing. Vahid: *"If a slot has no captured title, say so rather than
falling back to its field name in a sentence a student reads."*

A box the student **fills** is unchanged: it still reads as its question, because a question is what
it is. Only a document is named by a title, because only a document has one.

### Which capture the title is read from, and how the build holds it there

He offered two sources and asked which was used. **Neither, exactly** — and the reason matters:

| Source he named | Why it is not what the entry carries |
|---|---|
| **His read of the page on the 22nd**, and the slot headings he read on the 11th | A person's report, not data in this repository. It corroborates, and it cannot be checked by a build. ADR-0136's failure was precisely a person's reading written down as a fact with nothing to check it against |
| **The radios' own option labels**, captured 2026-09-22 | Captured, but they name an **act**, not a document: *"I will upload my final certificate later"*. They would give *"your final certificate"* where the page's heading says *Final Academic Certificate*, and for the two translation slots they lose *Final Academic* entirely |

What the repository holds is the **companion radio's captured label**, `labelSource: "row_text"` —
discovery's read of the row, first captured **2026-09-10**:

```
certificateStatus              "Proof of Registration This is any document showing you are a student at the
                                institution for example a document confirming your registration or a
                                certificate of study."
transcriptStatus               "Most Recent Transcript This is a breakdown of the marks/scores you received
                                most recently, for example at the end of your previous year of study."
officialCertTranslStatus       "Final Academic Certificate This is the certificate you received after passing
                                your qualification. This document should include a signature or stamp from the
                                institution. Please note that if you are of"
officialTranTranslStatus       "Final Academic Transcript This is a breakdown of the marks/scores you received
                                after passing your qualification.This document should include a signature or
                                stamp from the institution.Please note that "
certificateTranslationStatus   "Final Academic Certificate Translation This is an official translation of the
                                certificate you received after passing your qualification. This document should
                                include a signature or stamp from the tran"
transcriptTranslationStatus    "Final Academic Transcript Translation This is an official translation of the
                                transcript you received after passing your qualification. This document should
                                include a signature or stamp from the transl"
```

**How far "unchanged since" goes, measured rather than asserted.** Of the three later reads of that
page, two carry these labels character for character — `sheffield-pgt-2026-09-14-education-dependent`
and `sheffield-pgt-2026-09-14-third-read`. The third, `sheffield-pgt-2026-09-14-five-pages-relabelled`,
carries the **field references** in their place for all six: that read could not reach the row text
positionally (P126), so it has no label to agree or disagree with. Two reads agree, one is silent,
and none contradicts.

Every one fuses the heading to the help paragraph and truncates it mid-sentence. **Splitting them by
a pattern would be an assumption written down as a fact.** All six happen to continue *"This is …"*,
and a rule built on that is ADR-0136's `Sep`/`Sept` failure in a new costume: it works on the six in
front of us and fails silently on the seventh.

So the split is a **person's judgement**, recorded, and the build checks that the person did not
invent words:

```ts
interface SlotTitle {
  readonly text: string;      // the page's words for the document, and nothing else
  readonly readFrom: string;  // the captured text it was read out of, quoted whole
}
```

Two checks, both mechanical, both in the parser:

1. **`text` must be a whole-word prefix of `readFrom`.** *Degree certificate* is refused against
   *Certificate status*; so is *Certif*.
2. **Where the slot has a companion on the same page, `readFrom` must BE that field's captured
   label**, character for character. A reviewer cannot quote a reading that is not in the file.

The reviewer's judgement is where the heading ends. The words are the capture's, and the hash holds
both, so the quotation is signed beside the title it justifies.

## Built in P188

- **`packages/blueprint`** — `SlotTitle`, and `RequiredDocument.title`.
- **`packages/catalogue`** — parsed, and therefore hashed; the two checks above; a blank `text` or
  `readFrom` refused.
- **`packages/mapping`** — `HandoffRequirement.documentTitle`, set from the slot's title on both the
  repeating and the non-repeating path.
- **`packages/preparation`** — `PreviewHandoff.documentTitle`; the two sentences say it; with none,
  they say the form does not name the document.
- **Sheffield's entry and the curated draft** — all six titles, each quoting its companion's
  captured label. Blueprint 0.2.27 → **0.2.28**, mapping set 0.3.33 → **0.3.34**.
- **Red first.** Without the preview change the new test's *Final Academic Certificate* never
  appears — the label is printed instead; without the parser change the title round-trips to
  `undefined` and the hash does not move.

## Consequences

**What the student now reads**, for the synthetic profile's completed qualification:

```
- You attach yourself: officialCertTranslation
- You attach yourself: officialTranTranslation
- You attach yourself: certificateTranslation
- You attach yourself: transcriptTranslation
- We are telling University of Sheffield that your officialCertTranslation, your officialTranTranslation,
-   your certificateTranslation and your transcriptTranslation are coming later.
+ You attach yourself: Final Academic Certificate
+ You attach yourself: Final Academic Transcript
+ You attach yourself: Final Academic Certificate Translation
+ You attach yourself: Final Academic Transcript Translation
+ We are telling University of Sheffield that your Final Academic Certificate, your Final Academic Transcript,
+   your Final Academic Certificate Translation and your Final Academic Transcript Translation are coming later.
```

**One signature covers both this and ADR-0138.** He said so before either was built: *"I sign once
for both — B and the wording. There is no point signing cdb43561 and re-signing in an hour."* The
entry's hash is therefore `sha256:e2a10113c9e0f3536c1081cb3f51a7ea682ed6fceec9694d391a708a85f2b080`,
and `sha256:cdb43561…` — P187's — was never signed and never will be. An agent never writes an
approval hash.

**Signed 2026-09-22, commit `eb4e83e`** — the fifth signature on this entry, his own account only,
from his own hash computation: *"Signed eb4e83e, sha256:e2a10113…, from my own hash computation."*
The directory loads again, and the test that asserted the refusal was taken down in the same breath
(P189).

**The two pre-completion slots are named too**, though Run A's own preview does not show them: a
qualification still running is told *Proof of Registration* and *Most Recent Transcript*, which is
what the page heads them and is not what the entry's authored `label` says either (*Degree
certificate*, *Transcript*).

**`RequiredDocument.label` is now only for a reviewer**, and two of Sheffield's six are wrong in it.
They are left as authored rather than corrected, because correcting an authored label would be the
same act that produced the wrong one: a name chosen by whoever was typing. The title, checked
against a capture, is what a person reads.
