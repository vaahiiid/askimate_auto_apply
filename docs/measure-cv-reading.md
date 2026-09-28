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
pnpm run verify-bedrock                      # read-only: the account, and what each Bedrock service takes
export AAS_BEDROCK_REGION=…                  # and the four AAS_BEDROCK_MODEL_* variables — see "Two services" below
pnpm run measure-cv -- --live --out ~/cv-measure/report.json ~/cv-measure/my-cv.pdf ~/cv-measure/other.docx
```

Without `--live` the same command runs the deterministic stand-in, which reads only a line
labelled *Position:* — useful as the contrast, and it costs nothing. `--live` with the
variables unset is an error, never a silent fallback.

With `--live`, the first line says that **nothing has been called yet** and where the client is
built to go. The destination is printed **after** the run, from the client's own record of every
request that left it — on a failed run too, where it is the evidence: `called: 1 request(s) went
to https://bedrock-mantle.eu-west-2.api.aws/anthropic/v1/messages …`, or `called: No request left
the client …` when the run failed before one. (P243, row 101.)

## Two services answer to "Bedrock", and the ids are not interchangeable

The client calls the **Messages-API endpoint** of Amazon Bedrock ("Claude in Amazon Bedrock",
`https://bedrock-mantle.<region>.api.aws/anthropic`). Its ids are of the form
`anthropic.<model>` — `anthropic.claude-sonnet-5`, `anthropic.claude-haiku-4-5` — with **no**
`eu.`/`global.` prefix and **no** version suffix, and it has no list call: its model table is the
[documentation page](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#supported-models),
and a call is the only proof. Sonnet 4.6 is not on that table (read 2026-09-28).

`verify-bedrock` sections 2 and 3 list the **other** service — InvokeModel (`bedrock-runtime`),
whose ids carry profile prefixes and versions (`eu.anthropic.claude-sonnet-4-6`). An id from those
sections handed to the client is answered with *"does not exist"*; that was the first `--live`
run. Section 4 of the script says what the client calls, and flags a configured id whose shape is
the other service's, before anything is spent. Which service, and which model, is Vahid's choice,
recorded in ADR-0018.

## What comes out, and what never does

For each document: pages, lines, characters. For each of the two lists (jobs, qualifications),
since P242 the CUT comes first, because that is what stage three depends on:

- the section as a **line range** (`lines 15–23`), or NOT FOUND, in which case the cut ran over
  the whole document;
- the cut: how many entries, how many read whole, how many non-blank section lines no entry
  claims, how many entry lines lie outside the section, how many overlapping pairs and how many
  ranges outside the document were refused;
- the cover letter as a line range, found by its opening ("Dear …") and its closing ("Yours
  sincerely" and the like), or none;
- per entry: its **line range** and line count — check these against your own document by line
  number — its **date-range count** (two reads *TWO ENTRIES CUT AS ONE?*: the merge detector), and
  **LETTER TEXT INSIDE THE ENTRY** with the count of lines where the cut put the letter into a job
  — the failure named rather than discovered;
- then, inside each entry, stage two's reading: the parts read, missing, ungrounded (with the
  span's length), not reached, and why the entry was dropped.

Then the provider's own usage figures.

Without `--live`, the cut is the stand-in's — crude but real: the scope is cut into blocks at
blank lines and at labelled lines, and a block that carries a date range ("Sep 2019 – Aug 2021",
"2021 – Present") is an entry. It reads no part of a prose entry, because it reads labelled lines
only; so a free run shows whether the CUT works on a real document and shows the reading as
missing, which is the honest picture of what the stand-in can do.

**Never a value, never a span, never a line of any document.** The JSON at `--out` carries the
same structure. A test holds the report to it: nothing of the fixture CV appears in it. So what
he pastes back into the conversation is safe to paste.

## Credentials: which account, what kind, where, and the lead time

The record names one account and one region: **the AskiMate AWS account**, with about $1,000 of
credit (ADR-0018), in **eu-west-2** (ADR-0012). Nothing in the repository holds a credential,
and nothing should: the Bedrock client and `verify-bedrock` use the AWS SDK's default credential
chain, which reads, in order, the environment, then the shared credentials file, then an SSO or
assumed-role session.

What to get, from whoever administers that account:

1. **A credential that can call Bedrock.** The plain option is an IAM user with an access key
   (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if it is temporary); the
   better option is IAM Identity Center (SSO) with `aws sso login` and a named profile. Either
   goes **outside the repository**: exported in the shell for the run, or in `~/.aws/credentials`
   under a profile named in `AWS_PROFILE`. Never in a file the repository can see, never in the
   chat.
2. **Permissions on that credential.** For `verify-bedrock`: `sts:GetCallerIdentity`,
   `bedrock:ListFoundationModels`, `bedrock:ListInferenceProfiles`. For the measurement, on the
   service the client calls, the documentation names `bedrock-mantle:CreateInference` on the model
   ARNs (its IAM-role path); whether `AmazonBedrockFullAccess` covers `bedrock-mantle:*` is not
   established here — the first call says. (`bedrock:InvokeModel` is the other service's action;
   it is what P242 wrote here, and it was written as if there were one service.)
3. **Model access, in the console — a lead time, not a command.** Anthropic models on Bedrock
   have to be enabled for the account and region under *Bedrock → Model access*; for Anthropic
   the first request asks for use-case details, and access is usually granted within minutes but
   can take longer. On the InvokeModel service some models are reachable only through a
   cross-region **inference profile** (`eu.`, `global.`); the Messages-API endpoint the client
   calls takes no such prefix. `verify-bedrock` prints what the account can see on the one and
   what the other takes, and picks nothing.
4. **Then, in the shell** (never committed): `AWS_REGION=eu-west-2`, `AAS_BEDROCK_REGION=eu-west-2`,
   and the four `AAS_BEDROCK_MODEL_*` variables set to ids of the service the client calls, one
   workload at a time; the measurement uses `AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION`.

The part that is a lead time is 3, and only if the account has never enabled Anthropic models.
Everything else is minutes once someone with the console is in front of it.

## What the answer decides

- Sections found, entries found, most parts read: the cut is good enough and stage three is
  the estimated one — the reader process and the proposals into the interview.
- Sections found, few or no entries: measured on 2026-09-27 (row 100) — the cut by first label
  was the fixture-shaped assumption, and stage three became the model-segmenting one.
- The cut's ranges match the jobs you know, one date range each, no letter text inside an
  entry, most parts read: the reader process is built on it.
- Ranges merging or splitting, or letter text inside a job: the prompt or the detectors change,
  and the run is repeated before anything is built.
- Sections not found: the headings list is short of real headings, or the text layer is not
  line-shaped; the report says which lines count.
- Grounding rejections: the model paraphrases its quotations, which every reading in this
  system refuses — the ADR-0016 risk, measured rather than assumed.
