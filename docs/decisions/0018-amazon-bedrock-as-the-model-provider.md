# ADR-0018 — Amazon Bedrock is the model provider, and no model is named yet

**Status:** **Accepted** — Vahid's decision, 2026-08-26. **Amended 2026-09-28 (P243, row 101):** two
AWS services answer to "Bedrock"; the client calls one and the verify script listed the other. See
the last section.
**Depends on:** [ADR-0004](./0004-branded-types-for-confirmed-values.md),
[ADR-0012](./0012-aws-region-eu-west-2.md), [ADR-0016](./0016-extraction-must-quote-the-document.md)

## The decision

> *"Use Amazon Bedrock as the initial model provider. We have approximately $1,000 of AWS credit
> available, so use the AWS credit where practical rather than spending cash on direct Anthropic API
> calls. Keep the existing LLM port/provider abstraction exactly as designed so that the provider can
> be changed later without reworking the Interview, Extraction or Navigation layers."*

And, separately and importantly:

> *"Before selecting the final Bedrock model, verify which suitable models are actually available…
> Do not assume a model is available. Verify the available options when the relevant AWS access
> exists."*

## What changed, and what deliberately did not

**One new file calls a model:** `packages/llm/src/bedrock.ts`. It implements `ModelClient` and
nothing else.

**Nothing else changed.** The interview, extraction, mapping, preparation and orchestration packages
do not know Bedrock exists. That was the whole reason for building against a port before the
provider decision existed, and it is now the thing that makes the decision reversible: switching to
the Anthropic API direct, or to Vertex, is one file.

The dependency-boundary check enforces it — every package except `packages/llm` is forbidden from
importing `@anthropic-ai/bedrock-sdk`, `@anthropic-ai/sdk`, or any other model SDK.

## No model is named, and the code refuses to invent one

`bedrockConfigFrom` has **no default model**. An unconfigured workload throws at start-up with the
list of what is missing and a pointer to `pnpm run verify-bedrock`.

That is not pedantry. Bedrock model availability is not a fact about Claude — it is a fact about
**one AWS account, in one region, at one moment**. It varies by region, by whether the account has
requested access to a model family, and by whether a model is reachable directly or only through an
inference profile. An ID written from memory is a guess that fails at run time, on a real student's
case, rather than at start-up on a developer's laptop.

`pnpm run verify-bedrock` reads the answer out of the account: caller identity, the Anthropic models
that account can see, and the inference profiles. Three read-only `List`/`Get` calls. It requests no
model access, invokes nothing, and picks nothing.

## Four workloads, configured separately

They have genuinely different requirements and may end up on different models. Setting all four to
the same ID is a reasonable starting position — having to write it four times makes it a choice
rather than a default.

| Workload | Env var | What it needs |
|---|---|---|
| `interview` | `AAS_BEDROCK_MODEL_INTERVIEW` | Long context; careful phrasing; latency visible to the student |
| `interpretation` | `AAS_BEDROCK_MODEL_INTERPRETATION` | Strict tool use; short and high-volume, so **cost matters most here** |
| `document_extraction` | `AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION` | Strict tool use; long context; **copies spans exactly** |
| `navigation` | `AAS_BEDROCK_MODEL_NAVIGATION` | Page reasoning; the only workload whose output never goes near a form field |

The document-extraction row has a hard constraint the others do not: ADR-0016 discards any reading
whose quoted span is not in the document, so **a model that paraphrases its own quotations will fail
every extraction.** That is the first thing to test on a candidate model, and it is cheap to test.

## Strict tool use, not prose parsing

Interpretation and extraction ask for a structured answer through a strict-schema tool with a forced
`tool_choice`. Parsing a value out of prose means writing a parser for the model's phrasing, and
that parser becomes a second, undocumented place where a date of birth can be misread.

The structured answer is still not trusted. Three checks stand between it and the profile:

1. `value` goes through the field's **deterministic parser**. A value that will not parse is
   `not_understood` — at any confidence. `02/04/1999` is a perfectly confident reading of an
   ambiguous date, and it is refused.
2. `verbatim` goes through the **grounding check** for documents. A span the document does not
   contain discards the whole reading (ADR-0016).
3. `confidence` can send a reading to a human. It can never promote one.

The schema makes the model's answer legible. Those three are what make it safe.

## Bedrock's feature differences that actually affect us

| | |
|---|---|
| Structured outputs / strict tool use | **Available.** The design above depends on it. |
| Prompt caching | Available, but **automatic caching is not** — so the document text carries an explicit `cache_control` breakpoint. Several fields are read from one transcript; without it, each read pays for the whole document. |
| Models API (`client.models.list()`) | **Not available.** ~~Model discovery goes through Bedrock's own `ListFoundationModels` / `ListInferenceProfiles`, which is what the verify script uses.~~ **Corrected in P243:** those two calls list the InvokeModel service, which is not the service the client calls; the Messages-API endpoint has no list call, and its model table is the documentation page (see the amendment below). |
| Web search, web fetch, code execution | Not available — and not used. |

## Cost

The Phase 0 cost model identified model inference, not browser compute, as the dominant per-run cost
and recommended measuring rather than estimating it. `BedrockModelClient.usage` now reports the
**provider's own** token counts, including cache reads. `MeteredModelClient`'s figures are estimates
and are superseded wherever a real client is in use.

`interpretation` is the highest-volume call in the system — one per student reply — so it is the
row where a cheaper model earns the most, and the row to look at first if the credit is burning down
faster than expected.

## What is still open

**The actual model IDs.** They are chosen against §4 of the verify script's output, by a human, once
credentials exist. When that happens, record the choice and the reasoning **in this ADR** rather than
only in an environment variable — otherwise the reasoning is lost the first time someone asks why.

## Verified in this environment: nothing

The credentials present in the Claude Code environment are the agent proxy's placeholders
(`prox…`), and both STS and Bedrock reject them. So availability has **not** been verified here, and
this ADR names no model. That is the correct outcome, not a gap.

## Amended 2026-09-28 (P243, row 101): two services answer to "Bedrock"

Vahid's first `--live` run, 2026-09-28, with `AAS_BEDROCK_REGION=eu-west-2` and the four model
variables set to `eu.anthropic.claude-sonnet-4-6` — an id `pnpm run verify-bedrock` had listed as
ACTIVE in the same shell:

> `LIVE — Amazon Bedrock, eu-west-2 / document_extraction eu.anthropic.claude-sonnet-4-6`
> `404 {"type":"error","request_id":"req_…","error":{"type":"not_found_error","message":"The model 'eu.anthropic.claude-sonnet-4-6' does not exist"}}`

The same with the bare `anthropic.claude-sonnet-4-6`. His reading: *"--live is not reaching
Bedrock. It reaches api.anthropic.com… My first guess is that something — ANTHROPIC_API_KEY in my
shell, or a default in the SDK — routes the client away from Bedrock, and the banner prints the
configuration rather than the destination. If that is it, the banner is the defect."*

**What the client is, read from the code and the SDK.** `packages/llm/src/bedrock.ts` builds
`AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk`. Its base URL is
`https://bedrock-mantle.{region}.api.aws/anthropic`, signed with SigV4 for the service
`bedrock-mantle`. That is **"Claude in Amazon Bedrock"**: the Messages-API endpoint of Amazon
Bedrock, which takes the same request shape as the Claude API and answers in the Claude API's own
error shape, `request_id: req_…` included. So a `req_` id and an Anthropic-shaped error do not
show that api.anthropic.com was reached. The request went to Bedrock.

**What can move it.** Measured in this environment by constructing the client and printing its
base URL: `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` change nothing. One variable did —
`ANTHROPIC_BEDROCK_MANTLE_BASE_URL`, which the SDK reads when the code gives no base URL. He has
not set it, so it is not his cause; but it was a hole, because a shell variable would have moved
every student document the client carries to another host without a word. Closed in P243: the
client gives the base URL itself, from the region, and a test sets the variable to
api.anthropic.com and reads the pinned URL back. `AWS_BEARER_TOKEN_BEDROCK` changes how a request
is signed, not where it goes.

**The running services have no such exposure today**, because none builds this client:
`apps/conversation-service/src/wiring.ts` wires `DeterministicModelClient`, and the worker has no
model client. The only constructor of `BedrockModelClient` is `scripts/model-for-demo.ts`. When a
service does build it, the pin holds there too.

**The defect that caused his 404.** Two services answer to the word "Bedrock":

| | InvokeModel / Converse (`bedrock-runtime`) | Messages-API endpoint (`bedrock-mantle`) |
|---|---|---|
| What lists its models | `ListFoundationModels`, `ListInferenceProfiles` — what `verify-bedrock` calls | Nothing: its Models API is not served. The documentation page is the list |
| Its ids | `anthropic.claude-sonnet-4-5-20250929-v1:0`; through a profile, `eu.anthropic.claude-sonnet-4-6`, `global.…` | `anthropic.claude-sonnet-5`, `anthropic.claude-haiku-4-5`, `anthropic.claude-opus-4-7`, … — no prefix, no version |
| Sonnet 4.6 | Listed, through `eu.`/`global.`/`us.`/`jp.` profiles | **Not on its table** (read 2026-09-28) |
| The client | Not what the code calls | What the code calls |

`verify-bedrock` verified the InvokeModel service and the client called the Messages-API endpoint,
so an id verified as ACTIVE on the one was handed to the other, and *"does not exist"* was that
endpoint telling the truth about its own list. The verifier and the client had never been about
the same service, and the record — this ADR's feature table included — was written as if there
were one. **The banner made it worse**: it printed the configuration, before the call, as if it
were the destination.

**What P243 changed.** The banner names no destination before the call: it says nothing has been
called, and where the client is built to go. After the run, on the failure path as well, a line
says what actually left the client — every request's URL, from the client's own record, with the
service named. `BedrockModelClient.destination` carries that record. An id whose *shape* belongs to
the InvokeModel service (a profile prefix, a version suffix, an ARN) is named before the run, as a
shape and not as availability: `anthropic.claude-sonnet-4-6` has the documented shape and the
endpoint still answered 404, so the shape check says only which service documents ids of that
form. `verify-bedrock` now says which service each of its sections is about, and prints what the
client calls and where that service's list lives. And the demo scripts' colour codes, which had no
escape byte and printed as `[33m` text, are escapes now.

**What is still open, and his to decide.** The measurement needs a model the Messages-API endpoint
serves in eu-west-2, or the client moved to the other service. The two ways:

1. **Stay on the Messages-API endpoint** and set the four variables to an id from its table — the
   documented ones as of 2026-09-28 are `anthropic.claude-sonnet-5`, `anthropic.claude-haiku-4-5`,
   `anthropic.claude-opus-4-7`, `anthropic.claude-opus-4-8`, `anthropic.claude-opus-5`,
   `anthropic.claude-opus-5-5`, `anthropic.claude-fable-5`, `anthropic.claude-fable-5-1`. Not
   verifiable by a list call; proven by the first call. Open on this path: eu-west-2 is listed for
   that endpoint as "Global, EU", not "in-region only", and the documentation does not say how a
   bare id is routed from a London base URL — whether the request stays in the EU is not
   established here, and ADR-0012 chose London.
2. **Move the client to the InvokeModel service** (`AnthropicBedrock` from the same package,
   `https://bedrock-runtime.{region}.amazonaws.com`), where `verify-bedrock`'s lists are the truth
   and `eu.anthropic.claude-sonnet-4-6` is the EU profile of a model this account has enabled. One
   file changes, and strict tool use and explicit cache breakpoints are available there too.

Neither is taken here. The choice of model was his in this ADR from the start, and the choice of
service is the same choice.
