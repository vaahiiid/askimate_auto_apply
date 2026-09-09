# Provisioning request — one bucket, to verify the S3 checksum binding

**For:** Vahid Mohammadi, who creates everything below. **Nothing in this document has been created.**
**Why:** [ADR-0092](./decisions/0092-the-document-never-enters-a-process-we-run.md) makes the
document vault a bucket with pre-signed upload, on one condition set in Vahid's words: *"Verify the
S3 checksum enforcement against a real bucket BEFORE reshaping the port around it."* The verification
is built (`pnpm run verify-s3-checksum`). It needs somewhere to run against.
**Rule:** *"Do not provision anything. When you are ready for a real bucket, tell me exactly what
needs to exist, what it costs, and what it can reach, and I will create it. AWS spend stays my act."*

## What the verification does, so the request is sized to it

Three objects of a few hundred bytes each, under `verify/<runId>/`, written, read back with HEAD, and
deleted before the script exits — on every path, including failure. The bytes are a fixed sentence
with a nonce. **Not a document, not personal data.** Total traffic per run: five requests, under
2 KB. It then writes a JSON record to `verification-runs/` (git-ignored) that says VERIFIED, REFUTED
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
| Default encryption | SSE-S3 is enough for the binding test. **SSE-KMS under a CMK only if you also want E5 run** — see §4 | |
| Lifecycle | **expire `verify/` after 1 day** | So a run killed mid-way leaves nothing that costs anything |
| CORS | **none needed now.** The script uploads from Node, not a browser. The real vault will need a CORS rule for the page's origin — a later request | |

This is a **verification bucket**. It can become the vault later or be deleted; the script does not
care which, and nothing in the repository will reference its name.

### The credential

A credential whose entire reach is the prefix `verify/` in that one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VerifyPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<BUCKET>/verify/*"
    }
  ]
}
```

`sts:GetCallerIdentity` needs no grant. Nothing else is used — no `ListBucket`, no bucket-level
actions, no other bucket, no other service.

**Form:** the Phase-0 plan says *"no long-lived IAM users"* (item 3) and *"GitHub Actions → AWS via
OIDC, not stored access keys"* (item 11). For a one-off run from this environment, the honest ask is
a **temporary credential** — an `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
set from an assumed role with the policy above, expiring within hours. It is set as environment
variables on this environment and **never written to the repository, a file in it, or a log.**

### The environment variables the script reads

| variable | required | value |
|---|---|---|
| `AAS_S3_VERIFY_BUCKET` | yes | the bucket name you chose |
| `AAS_S3_VERIFY_REGION` | no | defaults to `eu-west-2` |
| `AAS_S3_VERIFY_KMS_KEY_ID` | no | a CMK ARN, **only** if E5 is wanted (§4) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | yes | the temporary credential |

## 2 · What it costs

Stated from the Phase-0 bootstrap plan, which is the only pricing this repository holds. **This
sandbox cannot reach the AWS pricing pages; confirm at creation.**

- **S3**: the plan budgets the whole Phase-2 set — S3, KMS, RDS, Secrets Manager, CloudWatch, VPC —
  at *≈ $25/month*, with RDS the bulk of it. A bucket holding three objects for a few seconds, with
  five requests per run, rounds to **zero**. S3 is charged per GB-month stored and per request; a run
  stores under 2 KB and makes five requests.
- **KMS** (only if E5): a customer-managed key is a flat monthly charge plus a per-request charge; one
  run is two requests. The plan's *"KMS — customer-managed key"* line is the same key the vault will
  need, so creating it now is not a new cost, it is an early one.
- **Credit**: $0 has been spent against the AWS credit to date (`README.md`, *Infrastructure
  provisioned: None*). This is the first thing that would draw on it, and its draw is negligible.

**Billing alerts** — the plan's item 4 (*$100, $250, $500, $750, non-negotiable*) — should exist
before the first resource does, not after.

## 3 · What it can reach

**Nothing.** A bucket has no outbound reach. The credential can put, get and delete objects under one
prefix of one bucket, and identify itself. It cannot list the bucket, read any other prefix, touch
any other service, or create anything.

The script reaches `s3.eu-west-2.amazonaws.com` and `sts.eu-west-2.amazonaws.com` and no other host.

## 4 · The optional second question — SSE-KMS through a pre-signed PUT

The binding is the load-bearing fact and needs only §1. There is a second fact the vault will rest
on: **can the same pre-signed PUT carry `x-amz-server-side-encryption: aws:kms` under a CMK the
uploader has no grant to?** ADR-0010 requires the vault to be encrypted at rest with a
customer-managed key, and under ADR-0092 the encryption is S3's, so this matters — but it is a
separate verdict and the script reports it separately (`sseKms`).

To run it: create the CMK in `eu-west-2` with rotation on (plan item 7), give the **signing**
credential `kms:GenerateDataKey` on that key (the browser that uploads later will have no AWS
credential at all — that is the point of the test), set `AAS_S3_VERIFY_KMS_KEY_ID`, and the script
adds experiment E5. Skip it, and the record says `NOT CHECKED` for that half, honestly.

## 5 · What happens after

1. `AAS_S3_VERIFY_BUCKET=<name> pnpm run verify-s3-checksum` from this environment.
2. The record lands in `verification-runs/s3-checksum/<runId>.json` and the verdict is reported to
   you in the run's own words — VERIFIED, REFUTED or NOT CHECKED, with the HTTP statuses and S3
   error codes for each experiment.
3. **VERIFIED** → the port is reshaped around pre-signed upload (ADR-0092 §"What the port becomes").
   **REFUTED** → *"tell me before building further"* — you are told, with the evidence, and the port
   is not touched. **NOT CHECKED** → the reason is in the record and the run is repeated once it is
   fixed; nothing is inferred from a run that did not complete.
