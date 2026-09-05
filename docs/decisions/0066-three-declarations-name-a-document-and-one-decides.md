# ADR-0066 — Three declarations name a document, and one of them decides

**Status:** **Accepted** — 2026-09-05
**Corrects:** [ADR-0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md) §6, which said the
blueprint page's declaration "reaches the preview and stops the run". It does not — see §2
**Depends on:** [ADR-0009](./0009-requirements-provenance-and-verification.md) (a requirement carries
provenance and clears an evidence bar), [ADR-0017](./0017-mapping-is-reviewed-data.md) (a mapping is
reviewed data, pinned to a blueprint version), [ADR-0021](./0021-application-requirements-are-not-visa-requirements.md)
(`scope` is mandatory so a rule cannot default into blocking), [ADR-0057](./0057-approval-binds-to-content-not-to-claims.md)
(what the content hash covers)
**Defers, explicitly:** whether AAS ever obtains a document at all — §6

## §1 · What was ambiguous

P29 found two fields called `requiredDocuments` and could not say which one meant what. Investigating
it produced a third, and a correction to P29's own account of the first two.

| | Declared on | Type |
|---|---|---|
| **A** | `BlueprintPage.requiredDocuments` | `RequiredDocument[]` — `documentRef`, `label`, `acceptedFormats`, `maxSizeBytes?`, `required`, `requiredWhen?` |
| **B** | `MappingSource {kind: "document"}` | `{ documentRef: string }`, on one mapping in a reviewed mapping set |
| **C** | `CatalogueEntry.requiredDocuments` | `string[]` |

**They are not three names for one thing, and reconciling them would be a mistake.** A is an
observation of a portal. B is a decision about a portal. C is a statement to a student.

## §2 · Which one decides, measured

Two mutations against the shipped fixture, each applied to disk and read back, each run through the
real driver:

| Mutation | Result |
|---|---|
| **A removed**, B kept — the page declares no document, the mapping still does | the run still stops for a specialist, naming `passport`. **10/10 of ADR-0065's tests pass unchanged.** |
| **A kept**, B removed — the page declares a required passport, the mapping maps that field to a handoff instead | the run reaches **`authorise`**. No stop, no intervention, no attachment. |

So **A is neither necessary nor sufficient. It decides nothing.** ADR-0065 §6 said otherwise, and was
wrong: what reaches `plan.uploads` is `mapping.source.documentRef` (`plan.ts:205`), never
`page.requiredDocuments`. The fixture author happened to give both the same string, which is why the
two looked linked.

Confirmed by search as well as by mutation: `allRequiredDocuments` has exactly one caller in the
repository, `scripts/inspect-discovery.ts`, and `git log -S` shows it has never had another.
`packages/orchestrator`, `packages/preparation`, `packages/execution` and `packages/mapping` outside
its fixtures contain **no occurrence of the word at all**. That is now a `check-boundaries` rule.

## §3 · The authority map

| | **A** page declaration | **B** mapping source | **C** entry list |
|---|---|---|---|
| **Owner** | the blueprint | the mapping set | the catalogue entry |
| **Created by** | `pageFrom` in discovery, from every `<input type="file">`; `documentRef` is the field's own `fieldRef` | a specialist author | a specialist author |
| **Reviewed** | yes — blueprint review, and covered by the entry hash (ADR-0057) | yes — **two people**, and pinned to a blueprint version (ADR-0017) | yes — inside `ReviewedCatalogueEntry`, covered by the hash (ADR-0057) |
| **Consumed by** | `scripts/inspect-discovery.ts`. Nothing else, ever | `planFill` → `plan.uploads` → `buildPreview` → `executePlan` → ADR-0022's gate | the target listing, `renderOffer`, and `InterviewState` |
| **Decides** | nothing | the fill plan, the preview refusal, ADR-0065's stop, whether a document may be transmitted | nothing |
| **Informational or consequential** | informational | **consequential** | informational **in effect**; it was designed to be consequential and never wired |
| **Authoritative for execution** | no | **yes** | no |
| **If absent** | nothing changes | no upload is planned; if the portal field is then unmapped, `planFill` raises `no_mapping` → a specialist | the offer reads *"Documents needed: none recorded"* |
| **If A and B disagree** | nothing detects it. Both directions measured in §2 | | |
| **If B and C disagree** | nothing detects it. §4 is that case | | |

The blueprint's real authority over documents is exercised through its **fields**, not through A: a
`<input type="file">` that no mapping covers is a `no_mapping` blocker and reaches a specialist. A is
a summary of those fields that nothing consults.

## §4 · The contradiction, and the one thing in it that is a defect

The measured case, through the real production path — a reviewed entry declaring `["passport"]` whose
blueprint attaches no document and whose mapping plans no upload:

```
Apply to Gated University (Main)
  Course: MSc Controlled Studies
  Intake: September 2026 (2026-09)
  Applied through: gated.portal.test (direct portal)
  Documents needed: passport
```

That is the offer the student **accepts** (ADR-0058, Gate 2). The run then reaches `request_secret`,
still `running`, and asks them for a portal password. Nothing ever asks for the passport, nothing
blocks on it, and nothing records that it was not obtained.

**The engineering defect is not that the passport is unenforced — it is that a promise is made and
its non-fulfilment is invisible.** Which of those two halves to fix is §6's decision. What P30 fixes
is that the situation was undocumented, unasserted, and one refactor away from being "tidied up" in
the dangerous direction.

`requiredDocuments` is deliberately absent from `offerCanonical`, but the entry's `contentHash` is in
there, so the offer *is* bound to it transitively (ADR-0057). Changing C changes the hash and
therefore every outstanding offer — which is correct, and worth knowing before anyone edits one.

## §5 · Why the interview's capability is kept rather than deleted

`packages/interview` still owns document collection. `nextAction` asks fields first and documents
second, deliberately — *"an upload request lands better once the agent knows who it is talking to"* —
and returns `request_document` only once **no** field is outstanding.

The orchestrator enters the interview only `if (plan.blockers.length > 0)`, i.e. only **while** a
field is outstanding. **The two conditions are mutually exclusive by construction.** That single
line, written the same day as the interview package, is what severed the capability; ADR-0064 §4
measured the consequence without finding the cause.

So `request_document` is not dead code that arrived by accident. It is a capability the interview
still has and the orchestrator never delegates to, and `recordDocument` — the function that would
mark one collected — has no caller, so `collectedDocuments` can never become non-empty. It is
asserted in a test rather than deleted, because deleting it would destroy the evidence of what was
intended and would have to be rebuilt if §6 is answered in the affirmative.

## §6 · What is engineering, what is product

**Engineering, settled here.** A decides nothing; B decides; C is advisory. That is not a preference —
it is what the code does, measured in both directions, and now guarded.

**Product, and genuinely undecided.** No ADR before ADR-0064 mentions either field. The archaeology
says why: `InterviewState.requiredDocuments` and the orchestrator's interview gate were written on
the same day (2026-08-26) and were incompatible from that moment; `CatalogueEntry.requiredDocuments`
was added in P1 (2026-08-31) to feed an interview state nothing would reach; P20 (2026-09-03) folded
it into the reviewed, hashed artefact, giving it two-person approval authority it was never designed
for; P21 put it in front of students. Each step was locally reasonable. None of them decided what the
field means.

The open questions, precisely:

1. **Does AAS ever obtain a document, or only ever identify one?** If only identify, C is a
   student-facing checklist and the offer line should say who provides it. If obtain, C is the front
   of a path that is blocked on ADR-0022 and ADR-0023 (ADR-0065 §7a) and needs the Requirements
   Service (ADR-0009, ADR-0019) behind it.
2. **What must a reviewed entry declare when the mapping plans no upload?** Refusing to load such an
   entry presumes answer 1. It is not a check that can be written first.
3. **Should C be validated against the domain's closed `DocumentType`?** The evidence that it was
   meant to be is strong — `"passport"` is a member, the interview does `replace(/_/g, " ")` on it,
   and both the retention schedule and the disclosure gate key on `DocumentType`. But narrowing the
   type changes the parser's contract and, through it, every artefact's hash.

## §7 · The timing fact that makes this urgent, and cheap

**No approval exists yet.** There is no `approvals.json` anywhere in the repository, the shipped
fixture catalogue declares `requiredDocuments: []`, and `AAS_CATALOGUE=fixtures` is refused in
production. So the contradiction in §4 is not live in any deployment — it becomes reachable the
moment a specialist authors the first real entry, which they will naturally do by filling in a field
called `requiredDocuments` and seeing it appear in the student's offer.

And because `toCanonical` walks the parsed object, **field names are inside the hash**. Renaming
either field — the obvious remedy for two things sharing a name — costs nothing today and invalidates
every approval once any exists. That is a reason to answer §6 before the first artefact is approved,
not after.

## §8 · What P30 changed

No behaviour. The system already does the right thing; nobody had written down that it does, or why
it must keep doing it.

- **A `check-boundaries` rule.** `packages/orchestrator`, `packages/mapping` (outside fixtures),
  `packages/preparation` and `packages/execution` may not mention `requiredDocuments` at all. The
  tempting change is to join the declarations up because they share a name; that is how a list with
  no evidence behind it would come to block a real application — the failure ADR-0021 names, arriving
  by omission.
- **Five tests** pinning §2, §4 and §5, including both mutation directions as permanent regressions.
- **Doc comments** on all three declarations naming the concept, its authority, and this ADR. The
  driver's said *"Document kinds the interview must collect"*, which was never true of any code path.

## Consequences

- Which declaration decides is answered, measured, guarded and reversible only by a new ADR.
- ADR-0065 §6's account of the causal chain is corrected.
- The contradiction is kept as evidence rather than patched, per the instruction that produced this
  phase, and the product decision it depends on is stated rather than guessed.
- Nothing was renamed, derived, deleted or given new authority.
