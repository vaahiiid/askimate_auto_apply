# ADR-0070 — The portal's file field is called `fieldRef`, because that is what it holds

**Status:** **Accepted** — Vahid's decision, 2026-09-06
**Amends:** [ADR-0066](./0066-three-declarations-name-a-document-and-one-decides.md),
[ADR-0069](./0069-an-authorisation-is-spendable-only-in-the-application-it-names.md) §"What `documentRef` means"

## The decision

> Vahid, 2026-09-06: *"Approved: rename documentRef to fieldRef. Do it now, while it is free.
> Rename the portal-layer field (BlueprintPage.requiredDocuments[].documentRef) to fieldRef so the
> two meanings stop sharing a name. Keep the domain-layer MappingSource documentRef as it is."*

`RequiredDocument.documentRef` → `RequiredDocument.fieldRef`. `MappingSource { kind: "document" }
.documentRef` is unchanged.

## Why the old name was wrong rather than merely unfortunate

One name spanned two layers:

| | Layer | What it holds |
|---|---|---|
| `BlueprintPage.requiredDocuments[]` | **portal** | `field.fieldRef` — the `name` attribute of the `<input type="file">`, written by `pageFrom` |
| `MappingSource { kind: "document" }` | **domain** | what a reviewer decided AskiMate calls the document; the key `DocumentSource` and the preview's document map are looked up by |

ADR-0069 recorded that the repository contained **both readings of the same field**: discovery wrote
the portal's field name, and the hand-written fixture in `packages/mapping/src/fixtures/portal.ts`
wrote `"passport"` where the file input on that page is `"passport_upload"`. No reader could tell
from the name which was intended, and both were plausible.

That is the specific failure a rename fixes and a comment does not. A comment says what the field
means; the name said something else, and the fixture had already followed the name.

## The fixture's value was wrong, and the rename made it say so

Under `documentRef`, `"passport"` was ambiguous. Under `fieldRef` it is false — no field on that page
is called `passport`. The value is now `"passport_upload"`, which is what discovery would have
written and what the mapping's `fieldRef` already pointed at.

One assertion changed with it: the P30 measurement in `run-driver.test.ts` that reads the page's
declaration now expects `["passport_upload"]`. The measurement is unchanged — the page declaration
is still inert in both directions, which is ADR-0066's finding and is what that test exists to prove.

## Why now

Free today, and only today:

- **No catalogue approval exists.** `toCanonical` walks the parsed object, so **field names are
  inside the content hash** (ADR-0057). Renaming a blueprint key after the first approval
  invalidates every approval, and each one is a two-person review that would have to be redone.
- **The parser is one line.** `packages/catalogue/src/parse.ts` reads the key by name, so the
  on-disk blueprint format changes with it; no blueprint in the repository is approved, and the only
  recorded discovery output lives under the git-ignored `discovery-runs/`.
- **The readers are two.** `scripts/inspect-discovery.ts` prints it for a specialist authoring a
  mapping set; `allRequiredDocuments` in `packages/blueprint` has no other caller, which `git log -S`
  confirmed in P30.

## What did not change

`MappingSource.documentRef` keeps its name. It is the domain key, it is what the reviewed mapping
decides, and it is the one identifier of the two that has authority (ADR-0066). Renaming *it* would
invalidate mapping sets rather than blueprints and would rename the thing that is correctly named.

Nothing about behaviour changed. The page declaration was inert before this ADR and is inert after
it: `check-boundaries` still forbids `requiredDocuments` in `packages/orchestrator`,
`packages/mapping` (outside fixtures), `packages/preparation` and `packages/execution`, and the
measurement in both directions still passes unchanged.
