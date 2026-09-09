# Provisioning request — one bucket, to verify the S3 checksum binding

**For:** Vahid Mohammadi, who creates everything below. **Nothing in this document has been created by
the agent.** As of 2026-09-09 he is creating it (§ Approved, below).
**Why:** [ADR-0092](./decisions/0092-the-document-never-enters-a-process-we-run.md) makes the
document vault a bucket with pre-signed upload, on a condition set in Vahid's words: *"Verify the
S3 checksum enforcement against a real bucket BEFORE reshaping the port around it."* The verification
is built (`pnpm run verify-s3-checksum`). It needs somewhere to run against.
**Rule:** *"Do not provision anything. When you are ready for a real bucket, tell me exactly what
needs to exist, what it costs, and what it can reach, and I will create it. AWS spend stays my act."*

**Approved and amended by Vahid, 2026-09-09**, in his words: *"Provisioning request read and
approved. I am creating it. One change: do section 4 as well, not optionally. The KMS half is not a
nice-to-have — ADR-0010 requires the vault to be encrypted with a customer-managed key, and under D
the encryption is S3's, so if a pre-signed PUT cannot carry SSE-KMS under a CMK the uploader has no
grant to, then D has a hole in it. I would rather find that now than after the port is reshaped."*
And: *"Billing alerts first, before any resource. All four thresholds."* This document was rewritten
to match. Where it said "optional" of §4, it no longer does.

**Recorded 2026-09-09, in Vahid's words, so the record is accurate:** *"a temporary credential was
briefly exposed and has been revoked with a DateLessThan token-issue-time deny policy on the role.
Nothing was created with it and the bucket is empty."* That credential was never set in this
environment and never reached the script; that run did not happen.

**Ran 2026-09-09, twice, from a session with the variables set** — see §6. Both verdicts VERIFIED on
the second run. The resources exist and were created by Vahid; the credential was the one-hour
assumed-role credential the script reads from `AAS_S3_VERIFY_*`.

## 0 · Before any resource: billing alerts

*"Billing alerts first, before any resource. All four thresholds."* — the Phase-0 bootstrap plan's
item 4: **$100, $250, $500, $750**. They exist before the bucket, the key, or the credential does.

## What the verification does, so the request is sized to it

Three objects of a few hundred bytes each, under `verify/<runId>/`, written, read back with HEAD, and
deleted before the script exits — on every path, including failure. The bytes are a fixed sentence
with a nonce. **Not a document, not personal data.** Total traffic per run: one STS call, four PUTs
(one of which S3 is expected to refuse), two HEADs and three DELETEs — ten requests, under 2 KB of
body. It then writes a JSON record to `verification-runs/` (git-ignored) that says VERIFIED, REFUTED
or NOT CHECKED, and the reasoning. That record is what "verified before reshaping the port" will
point at.

**This environment can reach S3.** Checked before writing this: a `CONNECT` to
`s3.eu-west-2.amazonaws.com:443` opens and S3 answers (an unauthenticated `307`), where
`www.sheffield.ac.uk:443` was refused by the egress gateway. So the run can be made from here once
credentials exist.

## 1 · What needs to exist

### The bucket

| | value | why |
|---|---|---|
| Region | **`eu-west-2`** | ADR-0012. Not negotiable |
| Name | **yours to choose** — this document does not invent one | The script reads it from `AAS_S3_VERIFY_BUCKET` |
| Block public access | **all four settings on** | Phase-0 bootstrap plan §7 item 8 |
| Bucket policy | **TLS-only** (`aws:SecureTransport` = false → Deny) | Same item |
| Versioning | your call — the vault's will be **on** (same item); a verification bucket gains nothing from it | |
| Default encryption | **SSE-KMS under the CMK in §4** | ADR-0010; and §4 is required, not optional — see the amendment above |
| Lifecycle | **expire `verify/` after 1 day** | So a run killed mid-way leaves nothing that costs anything |
| CORS | **none needed now.** The script uploads from Node, not a browser. The real vault will need a CORS rule for the page's origin — a later request | |

This is a **verification bucket**. It can become the vault later or be deleted; the script does not
care which, and nothing in the repository will reference its name.

### The key

A customer-managed KMS key in `eu-west-2`, rotation on (plan item 7). This is the key the real vault
needs under ADR-0010 — *"that key is the one the real vault needs anyway, so this is early spend,
not new spend"* (Vahid). Its ARN goes in `AAS_S3_VERIFY_KMS_KEY_ID`.

### The credential

A credential whose entire reach is the prefix `verify/` in that one bucket, plus the one KMS action
that writing an SSE-KMS object needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VerifyPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<BUCKET>/verify/*"
    },
    {
      "Sid": "SignUploadsUnderTheVaultKey",
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey"],
      "Resource": "<CMK ARN>"
    }
  ]
}
```

`sts:GetCallerIdentity` needs no grant. Nothing else is used — no `ListBucket`, no bucket-level
actions, no other bucket, no other key, no `kms:Decrypt` (the script HEADs objects; it never reads
one back), no other service.

**Why the signing credential holds the KMS grant and the uploader does not.** E5 asks whether a
pre-signed PUT can carry SSE-KMS *under a CMK the uploader has no grant to*. The signer (the
conversation service, later; this credential, now) is the party with the grant; the uploader (a
browser, later; a bare `fetch`, now) has no AWS credential at all. That is the shape of D, and it is
the shape the experiment reproduces.

**Form:** the Phase-0 plan says *"no long-lived IAM users"* (item 3) and *"GitHub Actions → AWS via
OIDC, not stored access keys"* (item 11). For a one-off run from this environment, the honest ask is
a **temporary credential** — access key id, secret and session token from an assumed role with the
policy above, expiring within hours. It is set as environment variables on the cloud environment
and **never written to the repository, a file in it, or a log.**

### The environment variables the script reads

| variable | required | value |
|---|---|---|
| `AAS_S3_VERIFY_BUCKET` | yes | the bucket name you chose |
| `AAS_S3_VERIFY_REGION` | no | defaults to `eu-west-2` |
| `AAS_S3_VERIFY_KMS_KEY_ID` | **yes** | the CMK's ARN (§4). The script refuses to start without it |
| `AAS_S3_VERIFY_ACCESS_KEY_ID` | **yes** | the temporary credential's access key id |
| `AAS_S3_VERIFY_SECRET_ACCESS_KEY` | **yes** | its secret |
| `AAS_S3_VERIFY_SESSION_TOKEN` | **yes** | its session token. Required on purpose: an assumed-role credential has one; an IAM user's key does not |

**Why not `AWS_ACCESS_KEY_ID` and friends.** This sandbox injects placeholder `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` values of its own into every session (they begin `prox…`; STS answers
`InvalidClientTokenId` — `docs/what-a-controlled-live-run-needs.md` §17), and which value wins when
the environment sets the same names is not documented. The script therefore never consults the
SDK's default credential chain: it reads the three `AAS_S3_VERIFY_*` names, which nothing else sets,
and hands them to its clients explicitly. Without all three it refuses before any request, and a
test proves it does not fall back to `AWS_*` even when those are populated.

### Where the variables go, so they never enter the repository, a file in it, or a log

Established from the platform's own documentation (`code.claude.com/docs/en/cloud-environments`,
*Set environment variables*) and checked against this container:

1. At [claude.ai/code](https://claude.ai/code), open the **cloud environment** this repository's
   sessions run in, for editing (*Update cloud environment*). The **Environment variables** field
   takes `.env` format, one `KEY=value` per line. That field is the only place the values are typed.
2. *"Each session copies the environment's values once, at startup, into ordinary environment
   variables that any command Claude runs can read. Because running sessions don't re-read the
   configuration, editing or adding variables affects sessions you start afterward; sessions already
   running keep the values they started with."* So **a session that is already open will not see
   them** — the run must be made from a session started after they are set.
3. Inside the session they exist only as process environment variables. Nothing writes them to disk:
   the script reads them into memory, and the run's JSON record (`verification-runs/`, git-ignored)
   holds the bucket name, the region, the key ARN and the observations — never the credential, never
   a pre-signed URL. The script prints no URL and no credential; what it prints is the STS caller
   identity (account and role ARN), the bucket, the HTTP statuses and S3 error codes.
4. The session transcript records commands and their output. That is the log to think about. It
   never contains the values because no command prints them, and the agent does not run `env`,
   `printenv`, or anything that would echo a variable's value — the command it runs is
   `pnpm run verify-s3-checksum` and nothing else touching those names.
5. The platform's **API credentials** feature is not used. It attaches a bearer header to requests
   for listed hosts at the proxy; a pre-signed S3 URL is a SigV4 signature computed *inside* the
   process from the secret, so the credential has to be in the process, and the experiment would not
   be the experiment otherwise.
6. When the run is done, delete the three credential lines from the environment (the credential
   expires within the hour regardless) and revoke the credential if you wish. The bucket name and key
   ARN can stay.

*"Anyone who uses the environment can read the values"* (same page). In a personal organisation that
is one person.

## 2 · What it costs

Stated from the Phase-0 bootstrap plan, which is the only pricing this repository holds. **This
sandbox cannot reach the AWS pricing pages; confirm at creation.**

- **S3**: the plan budgets the whole Phase-2 set — S3, KMS, RDS, Secrets Manager, CloudWatch, VPC —
  at *≈ $25/month*, with RDS the bulk of it. A bucket holding three objects for a few seconds, with
  five requests per run, rounds to **zero**. S3 is charged per GB-month stored and per request; a run
  stores under 2 KB and makes nine S3 requests.
- **KMS**: a customer-managed key is a flat monthly charge plus a per-request charge; one run is a
  handful of `GenerateDataKey` calls (one per object written under SSE-KMS). The plan's *"KMS —
  customer-managed key"* line is the same key the vault will need, so creating it now is not a new
  cost, it is an early one — Vahid's words: *"early spend, not new spend."*
- **Credit**: $0 has been spent against the AWS credit to date (`README.md`, *Infrastructure
  provisioned: None*). This is the first thing that would draw on it, and its draw is negligible.

**Billing alerts** — §0. Before the first resource, not after.

## 3 · What it can reach

**Nothing.** A bucket has no outbound reach. The credential can put, get and delete objects under one
prefix of one bucket, ask one KMS key for a data key, and identify itself. It cannot list the
bucket, read any other prefix, decrypt anything, touch any other key or service, or create anything.

The script reaches `s3.eu-west-2.amazonaws.com` and `sts.eu-west-2.amazonaws.com` and no other host.

## 4 · The second question, required — SSE-KMS through a pre-signed PUT

There are two facts the vault rests on, and this run checks both. The first is the binding (§1). The
second: **can the same pre-signed PUT carry `x-amz-server-side-encryption: aws:kms` under a CMK the
uploader has no grant to?** ADR-0010 requires the vault to be encrypted at rest with a
customer-managed key, and under ADR-0092 the encryption is S3's. Vahid: *"if a pre-signed PUT
cannot carry SSE-KMS under a CMK the uploader has no grant to, then D has a hole in it. I would
rather find that now than after the port is reshaped."*

So: the CMK (§1), `kms:GenerateDataKey` on the **signing** credential and on nothing else, and
`AAS_S3_VERIFY_KMS_KEY_ID` set. The script runs experiment E5 as part of every run and **refuses to
start without the key** — a run without this half is not the run that was approved, and a binding
verdict on its own would invite reading half an experiment as the whole.

The two verdicts stay separate — `binding` and `sseKms` — and are reported separately. If the KMS
half is REFUTED, the run says, in its own text, that this is **a different problem** from the
checksum binding: not folded into the binding's verdict, not softened by it. That is Vahid's
instruction: *"If the SSE-KMS half is REFUTED, that is a different problem and I want it named as
such rather than folded in."*

## 5 · What happens after

0. **Nothing runs until Vahid says the variables are set.** *"I will tell you when the environment
   variables are set. Do not run anything until then, and do not create anything yourself."*
   Because a running session does not see new variables (§1, *Where the variables go*), the order
   is: set the three non-secret variables first and start a session to confirm they arrive (names
   only are echoed, never values); then fetch the one-hour credential, add its three variables, and
   start the session that runs it. The repository is that session's memory — ADR-0092 and this
   document say what to run and what to report — so no conversation history is needed.
1. `pnpm run verify-s3-checksum` from that session, with the bucket, the key and the credential
   set in the environment (§1's table).
2. The record lands in `verification-runs/s3-checksum/<runId>.json` and **both verdicts are reported
   separately, in the run's own words** — VERIFIED, REFUTED or NOT CHECKED for the binding and for
   SSE-KMS, with the HTTP statuses and S3 error codes for each experiment. The exit code is zero only
   when both are VERIFIED.
3. **Binding VERIFIED and SSE-KMS VERIFIED** → the port is reshaped around pre-signed upload
   (ADR-0092 §"What the port becomes").
   **Binding REFUTED** → *"stop and tell me before touching the port, as agreed."* You are told, with
   the evidence, and the port is not touched.
   **SSE-KMS REFUTED** → named as a different problem, not folded in. The port is not touched either:
   D's encryption at rest would have a hole, and that is yours to decide on, not something to route
   around.
   **Either NOT CHECKED** → the reason is in the record and the run is repeated once it is fixed;
   nothing is inferred from a run that did not complete.

## 6 · What happened

Two runs on 2026-09-09, both against `askimate-aas-vault-4471` in `eu-west-2` as
`AskiMate-S3-Verify-Role`; records in `verification-runs/s3-checksum/` (gitignored — they stay with
Vahid), outcomes in ADR-0092 §4.

| Run | Checksum carried as | Binding | SSE-KMS | Exit |
|---|---|---|---|---|
| `…13-31-02-151Z-e31c17` | query parameter (the SDK's default hoisting) | REFUTED — S3 never read it; no checksum stored | VERIFIED | 1 |
| `…13-38-58-676Z-ddbb99` | signed header the uploader must send | VERIFIED — E2 400 `BadDigest`; omitted and altered headers 403 `SignatureDoesNotMatch` | VERIFIED — `aws:kms` under the CMK, checksum stored, substitution 400 `BadDigest` | 0 |

The first verdict was a verdict on the SDK's default, not on S3, and Vahid said so before the
second run: *"Treating that as final would have abandoned D over a client-side hoisting default."*
The script now signs the checksum header and refuses to say VERIFIED unless omitting and altering
it are both refused. Each object the runs wrote was deleted; the bucket was left as it was found.
The port is untouched; §5.3's first outcome is reached, and the reshaping starts on his word.
