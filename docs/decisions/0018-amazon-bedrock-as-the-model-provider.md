# ADR-0018 — Amazon Bedrock is the model provider, and no model is named yet

**Status:** **Accepted** — Vahid's decision, 2026-08-26
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
| Models API (`client.models.list()`) | **Not available.** Model discovery goes through Bedrock's own `ListFoundationModels` / `ListInferenceProfiles`, which is what the verify script uses. |
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
