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
to https://bedrock-runtime.eu-west-2.amazonaws.com/model/eu.anthropic.claude-sonnet-4-6/invoke …`,
or `called: No request left the client …` when the run failed before one. (P243, row 101.)

## One service, one list

Two Amazon Bedrock services serve Claude, and the first `--live` run handed one service's id to
the other (row 101). Since P244, on Vahid's word — *"verify-bedrock and the client must read the
same list"* — the client calls the **InvokeModel service** (`bedrock-runtime.<region>.amazonaws.com`),
which is exactly the service `verify-bedrock` lists: section 2 is its models, section 3 its
inference profiles, and section 4 looks each configured `AAS_BEDROCK_MODEL_*` up in those two
lists by identity and says *listed* or *NOT LISTED*. An id printed in section 2 or 3 is an id the
client can call, in the region the base URL names; a profile beginning `eu.` names the EU in its
id, which is why it is the one used (ADR-0012, amended). The first measurement runs with
`eu.anthropic.claude-sonnet-4-6`, his choice, recorded in ADR-0018.

## What comes out, and what never does

For each document: pages, lines, characters. For each of the two lists (jobs, qualifications),
since P242 the CUT comes first, because that is what stage three depends on:

- the section as a **line range** (`lines 15–23`) and what ended it — the next heading, the
  cover letter's opening, or the end of the document — or NOT FOUND, in which case the cut ran
  over the whole document. Since P245 a letter that follows a section with no heading between
  ends the section at its opening, and only when the letter is found by both its opening and its
  closing and opens inside that section; a CV with no letter, or a letter the finder does not
  know, keeps its last section to the end of the document and says so;
- the cut: how many entries, how many read whole, how many non-blank section lines no entry
  claims, how many entry lines lie outside the section, how many overlapping pairs and how many
  ranges outside the document were refused;
- the cover letter as a line range, found by its opening ("Dear …") and its closing ("Yours
  sincerely" and the like), or none;
- per entry: its **line range** and line count — check these against your own document by line
  number — its **date-range count** (two reads *TWO ENTRIES CUT AS ONE?*: the merge detector), and
  **LETTER TEXT INSIDE THE ENTRY** with the count of lines where the cut put the letter into a job
  — the failure named rather than discovered;
- then, inside each entry, the reading: the parts **read**, **missing from the document**, **read
  but not that value** (real text the plan's parser refused — "BSc" for a level), **the student's
  to state** (never asked of the document, ADR-0149), and **would ask** — what the interview asks
  for this entry, in the plan's order. An entry is COMPLETE when every document part read,
  INCOMPLETE when the interview has something to ask, DROPPED for an invented span or two date
  ranges cut as one. On a real CV the qualifications read *would ask: countryCode* and nothing
  else: that is the end state (P246).

Then the provider's own usage figures.

The same reading runs in production through `apps/cv-reader` (ADR-0092 as amended, P246): the
process claims a confirmed CV from the plane, fetches it once, reads it exactly as this script
does, and reports what the document gave; the plane seeds the interview from the report, and the
interview asks only *would ask*. This script is the measurement; the reader is the deployment.

**What the first live run showed (P247).** On a real CV the jobs come out almost complete and the
qualifications do not: a CV lists a degree as one line, so each qualification *would ask* the
country, the start, the end, the grade and the grade scale. The CV path fills the employment
section; plan for education from that, not from "the CV fills it in" (row 104).

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
   `bedrock:ListFoundationModels`, `bedrock:ListInferenceProfiles`. For the measurement:
   `bedrock:InvokeModel` (and `bedrock:InvokeModelWithResponseStream`) on the model or the
   inference profile it will use. `AmazonBedrockFullAccess` covers all of it for a measurement;
   a narrower policy is right for anything that stays. (P243 had this pointing at the other
   service's action; P244 put the client on this one.)
3. **Model access, in the console — a lead time, not a command.** Anthropic models on Bedrock
   have to be enabled for the account and region under *Bedrock → Model access*; for Anthropic
   the first request asks for use-case details, and access is usually granted within minutes but
   can take longer. Some models are reachable only through a cross-region **inference profile**
   (an id beginning `eu.` or `global.`), which is what `AAS_BEDROCK_MODEL_*` must then name — and
   `eu.` is the one that keeps the request in the EU. `verify-bedrock` prints exactly what the
   account can see, checks what is set against it, and picks nothing.
4. **Then, in the shell** (never committed): `AWS_REGION=eu-west-2`, `AAS_BEDROCK_REGION=eu-west-2`,
   and the four `AAS_BEDROCK_MODEL_*` variables set to ids `verify-bedrock` listed, one workload
   at a time; the measurement uses `AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION`. For the first run:
   `eu.anthropic.claude-sonnet-4-6` in all four.

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
