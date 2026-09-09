# ADR-0092 — The document never enters a process we run

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-09, **on two conditions** (§4), neither
yet met. The port is not reshaped until the first is.
**Continues:** [ADR-0090](./0090-the-gates-run-before-a-byte-is-accepted.md), whose transport this
keeps and whose store this replaces.
**Restores:** the Phase-0 design for the vault —
[`docs/phase-0/02-integration-contract-proposal.md`](../phase-0/02-integration-contract-proposal.md) §4.3

## The decision, in Vahid's words

> D. In my own words: the conversation service runs the gates, then mints a pre-signed upload rather
> than accepting bytes, and the document never enters any process we run.

That sentence is the whole design. Everything below is how it was reached, what it rules out, what
it rests on, and what has and has not been built.

## How it was reached

ADR-0090 shipped the transport against an in-memory store that refuses to run in production, and
deferred the durable encrypted store. Building it raised a question with four answers.

**The boundary check refused the first attempt, and that refusal was a control working.** The
obvious durable store encrypts bytes in-process, which needs a key provider, and the key providers
live in `packages/secrets`. `check-boundaries.ts` forbids `apps/conversation-service` from depending
on that package — *"the conversation plane holds four lifecycle words and an opaque handle. A vault,
a store or a resolver here would put a password in the one plane ADR-0037 keeps free of them"* — and
it failed the build. Vahid, on being told: *"Record the boundary check's refusal as what it was — a
real control that stopped a wrong design early, not an obstacle that was routed around."* So
recorded. It is the same shape as ADR-0072's finding in reverse: a control that exists, is
reachable, and fired on the first wrong design to meet it.

Four options were then put to Vahid. Three were not taken, and the reasons are his.

### A — extract `packages/keys` · **considered, not taken**

Move `DataKeyProvider` and its two implementations into a package both planes may depend on, keep
the forbidden edge intact, encrypt in the conversation service. Sound, and my recommendation at the
time. Not taken because **under D, SSE-KMS does the encryption and the extraction would be
thrown-away work** — Vahid's words. It also left the conversation service holding documents, just by
a safer route, and that was the thing he was trying to avoid.

### B — a separate documents deployable · **considered, not taken**

Vahid leaned toward this and asked to be told if he was wrong. He was, on a premise, and the
argument that decided it was not cost. In his words:

> B does not deliver its own promise: with the session bound to one origin, either we build a new
> auth mechanism or the conversation service proxies every document — which is the exact thing I was
> trying to prevent. A sixth process that still touches every file is worse than no sixth process,
> because it looks solved.

The origin fact is ADR-0033's: `__Host-aas-session` is bound to exactly one origin, so a document
service on its own origin has no session. The premise correction was that the Phase-0 record has
separate *storage* with direct upload, not a separate *service* — *"I read 'the document store is its
own component' as 'its own service', and the Phase-0 record says separate storage with direct upload.
That is a different thing and it gets me what I wanted more cleanly."*

### C — amend the boundary rule · **out**

> That boundary is the only thing keeping the service that talks to students away from students'
> passwords. Loosening it because a new need arrived is how a boundary disappears — not by being
> overruled, but by being adjusted each time it is inconvenient. Same reasoning as ADR-0080.

## What D is

```
POST /v1/conversations/{id}/documents         the declaration · THE GATES RUN HERE (ADR-0090, kept)
  → { uploadUrl, expiresAt, … }                 a pre-signed S3 PUT bound to the declared SHA-256

browser ──PUT──▶ S3                             the bytes. No AAS process is on this path.

after mayTransmit (ADR-0022):
  conversation service mints a short-lived pre-signed GET
  runner ──GET──▶ S3                            the runner holds a URL, not a key (ADR-0042 kept)
```

- **ADR-0090's property is kept and strengthened.** The gates still run before any byte exists, and
  now there is no process in which a refused byte could have been "not kept": it was never received.
- **The hash binding moves into S3.** The declaration's SHA-256 is signed into the pre-signed PUT;
  S3, not us, refuses a body that does not match. **This is the fact the whole design rests on and it
  is not yet verified — §4.**
- **Encryption at rest is S3's**, SSE-KMS under the customer-managed key ADR-0010 requires. No key
  material in any AAS process. `packages/secrets` is untouched and the forbidden edge stands.
- **The conversation service holds metadata only** — `DocumentRecord`, which `packages/documents`
  has always defined as *"a document's metadata. Never its contents."* The phrase was written in
  Phase 2 and D is the first design that makes it literally true of the process too.
- **The runner** keeps its refusal of both database URLs and every vault library; it fetches from a
  URL it was handed, after the transmission gate.
- **The original design, restored.** Phase-0 §4.3: *"students upload directly to AAS via short-lived
  pre-signed S3 URLs. Passports and bank statements never touch Replit's disk, never appear in
  AskiMate's logs, and stay inside the KMS-encrypted vault."*

## §4 · The two conditions

**1 · The checksum binding is verified against a real bucket before the port is reshaped.**

> Verify the S3 checksum enforcement against a real bucket BEFORE reshaping the port around it. You
> flagged it as unverified from the sandbox and that flag is the reason I am setting this condition
> rather than assuming it. If a pre-signed URL cannot bind the body to the declared hash, tell me
> before building further — the whole gates-before-bytes property rests on it, and I would rather
> know while the port is still the shape it is.

`pnpm run verify-s3-checksum` is that verification, built in this phase. Five experiments, and a
judgement that **cannot say VERIFIED by accident**: the refusal of a same-length substitution (E2)
counts only if the bound URL accepted the right bytes (E1) *and an unbound URL accepted the same
substitution* (E3), so that the refusal is attributable to the binding and to nothing else. A
refusal with no control is a result that cannot fail, which ADR-0072 says is not evidence. REFUTED
needs only one observation — S3 accepted a body that does not hash to the declared value — and the
verdict then says *"Do not reshape the port around it."* Without a bucket it says NOT CHECKED, exits
non-zero and writes no record. The judgement is tested offline in all its branches.

**Amended 2026-09-09 — the second half is required.** As first written, the fifth experiment (E5:
can the same pre-signed PUT carry SSE-KMS under a CMK the uploader has no grant to?) was optional.
Vahid, on reading the provisioning request:

> One change: do section 4 as well, not optionally. The KMS half is not a nice-to-have — ADR-0010
> requires the vault to be encrypted with a customer-managed key, and under D the encryption is S3's,
> so if a pre-signed PUT cannot carry SSE-KMS under a CMK the uploader has no grant to, then D has a
> hole in it. I would rather find that now than after the port is reshaped. And as you noted, that
> key is the one the real vault needs anyway, so this is early spend, not new spend.

So condition 1 has two halves, both checked in the same run: the **binding** and **SSE-KMS**. The
script refuses to start without the key, reports the two verdicts separately, and exits zero only
when both are VERIFIED. They remain two verdicts because they are two facts, and because of the
second thing he asked:

> If the checksum binding is REFUTED, stop and tell me before touching the port, as agreed. If the
> SSE-KMS half is REFUTED, that is a different problem and I want it named as such rather than
> folded in.

A KMS refusal therefore says, in the run's own text, that it is a different problem from the binding
— D's encryption at rest would have a hole — and the port is not touched on either refusal.

**2 · Nothing is provisioned by the agent.**

> Do not provision anything. When you are ready for a real bucket, tell me exactly what needs to
> exist, what it costs, and what it can reach, and I will create it. AWS spend stays my act.

[`docs/provisioning-request-s3-verification.md`](../provisioning-request-s3-verification.md) is that
statement: billing alerts at all four thresholds first, then one bucket in `eu-west-2`, the
customer-managed key ADR-0010 requires, and a credential whose whole reach is `s3:PutObject` /
`GetObject` / `DeleteObject` on the prefix `verify/*` plus `kms:GenerateDataKey` on that one key;
cost that rounds to zero and is drawn from a credit with $0 spent; reach of nothing. It names no
bucket, because inventing one would be the kind of record this repository removes.

Approved 2026-09-09: *"Provisioning request read and approved. I am creating it."* — with the
amendment above, and: *"Billing alerts first, before any resource. All four thresholds."* And the
sequencing: *"I will tell you when the environment variables are set. Do not run anything until
then, and do not create anything yourself."* Nothing has run and nothing has been created.

## What the port becomes — described, not built

`DocumentVault.store(upload, contents, now)` assumes bytes in the process. Under D it becomes three
operations — *prepare* an upload (mint the bound URL for an intake that passed the gates),
*confirm* it (HEAD the object; S3's stored checksum must equal the declared one), and *prepare* a
retrieval (mint a short-lived GET after `mayTransmit`). `PUT …/content` leaves the contract and the
declaration answers with `uploadUrl`. `acceptBytes` — the in-process hash check — is retired,
because S3 performs it. ADR-0090's sixteen route tests are rewritten around the new shape. The
in-memory intake port stays for tests and keeps its production refusal.

**None of that exists yet**, and it will not until condition 1 is met with VERIFIED on both halves.

## What was built in this phase, and what was not

Built: the verification (`scripts/verify-s3-checksum.ts`), its offline guard
(`verify-s3-checksum.test.ts`, which also holds the no-bucket path to NOT CHECKED / exit 1 / no
record), the provisioning request, and this record. The S3 SDK and pre-signer are root
dev-dependencies for the script; **no package depends on them.**

Not built: any change to `packages/documents`, to the transport routes, to `packages/secrets`, to
the boundary rules, or to any AWS resource.

**Declared-but-unreachable surface: six, unchanged.**
