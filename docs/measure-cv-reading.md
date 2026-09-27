# Measuring the CV reading on real documents (P240)

Vahid, 2026-09-27: *"Run the existing stage-two pipeline against them, through the real model,
and tell me what comes out: how many entries were found, how many parts per entry, what was
dropped and why, and where the grounding rejected something. Not to fix anything. To find out
whether the thing stage three depends on works at all on real documents."*

The model call is his spend and his act, so he runs it. This page is what to give and how.

## What to give

- **His own CV**, as a **PDF with a text layer** (exported from a word processor, not a scan) or
  as a **.docx**. A scanned PDF reads as an empty page: the pipeline does no OCR, and the report
  will say so.
- **Other people's CVs only with their agreement or with names and contact details removed.**
  The script sends each entry's lines to Bedrock, once per part, so their words leave his
  machine. The measurement needs the *shape* of a messy CV — headings, dates, how jobs are laid
  out — not the person; a CV with the name and the contact lines blanked measures the same.
  Nothing in the repository's decisions covers processing a person's CV for a measurement: the
  signed determination (B2-5) covers a student who asked for an application. His own is his.

## Where

Outside the repository, so nothing can be committed by accident — for example `~/cv-measure/`.
Nothing the script does writes a document's text anywhere.

## What to run

```sh
cd askimate_auto_apply
pnpm run verify-bedrock                      # read-only: which models this account can use
export AAS_BEDROCK_REGION=…                  # and the four AAS_BEDROCK_MODEL_* variables verify-bedrock names
pnpm run measure-cv -- --live --out ~/cv-measure/report.json ~/cv-measure/my-cv.pdf ~/cv-measure/other.docx
```

Without `--live` the same command runs the deterministic stand-in, which reads only a line
labelled *Position:* — useful as the contrast, and it costs nothing. `--live` with the
variables unset is an error, never a silent fallback.

## What comes out, and what never does

For each document: pages, lines, characters; for each of the two lists (jobs, qualifications):
whether a section was found under any of the headings, how many entries the cut produced, how
many read whole; for each entry: the parts read, the parts missing, the parts whose quoted span
was not in the document (with the span's length), the parts not reached, and why the entry was
dropped. Then the provider's own usage figures.

**Never a value, never a span, never a line of any document.** The JSON at `--out` carries the
same structure. A test holds the report to it: nothing of the fixture CV appears in it. So what
he pastes back into the conversation is safe to paste.

## What the answer decides

- Sections found, entries found, most parts read: the cut is good enough and stage three is
  the estimated one — the reader process and the proposals into the interview.
- Sections found, few or no entries: the cut by first label is the fixture-shaped assumption
  a real CV does not meet, and stage three begins with the model segmenting, which is a
  different stage three from the one estimated.
- Sections not found: the headings list is short of real headings, or the text layer is not
  line-shaped; the report says which lines count.
- Grounding rejections: the model paraphrases its quotations, which every reading in this
  system refuses — the ADR-0016 risk, measured rather than assumed.
