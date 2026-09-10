# Provisioning request — the document vault's role, CORS, and lifecycle

**For:** Vahid Mohammadi, who creates everything below. **Nothing in this document has been created by
the agent.** *"AWS spend stays my act."* (ADR-0092 §4)
**Why:** P61 ([ADR-0094](./decisions/0094-document-metadata-is-durable-and-the-transport-starts.md))
makes the Conversation Service able to start with the document transport: intakes and records in
its database, bytes in the bucket under the customer-managed key, minted from the process. What it
needs from AWS is small and all of it is listed here. Until it exists the service starts without the
transport and the document routes answer `service_unavailable` — a refusal, not a bypass.

## What already exists (created by you, 2026-09-09)

| | |
|---|---|
| Bucket | `askimate-aas-vault-4471`, `eu-west-2`, block-public-access on, TLS-only, SSE-KMS default |
| Key | the CMK whose ARN the verification ran under, rotation on |
| Role | `AskiMate-S3-Verify-Role` — scoped to `verify/*`, temporary credentials only, and now revoked |

The verification bucket *"can become the vault later"* (its request said so), and the service is
written so that it can: nothing in the repository names the bucket. Whether it does is your call;
this document assumes it does and says what changes if not.

## 1 · What needs to exist

### The service's role

The Conversation Service signs upload and retrieval URLs with **its own** credential — the task
role, in the deployment that has one; there is no student credential and no long-lived key. A
pre-signed URL is only as capable as its signer, so the role needs exactly what the URLs do and
what the confirm and the purge do:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DocumentsPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::askimate-aas-vault-4471/documents/*"
    },
    {
      "Sid": "SignUnderTheVaultKey",
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "<CMK ARN>"
    }
  ]
}
```

- `PutObject` — the browser's PUT is signed by this role; S3 checks the role's permission, not the
  browser's (the browser has none). Objects go under `documents/<studentId>/<intakeId>` and nowhere
  else; `objectKeyFor` is the one place that shape lives.
- `GetObject` — `HeadObject` for the confirm reads the stored checksum and the encryption; and the
  runner's retrieval URL, when it has a caller, is a signed GET.
- `DeleteObject` — `purgeContents` (ADR-0010), when the retention sweep has a caller.
- `kms:GenerateDataKey` — writing under SSE-KMS; `kms:Decrypt` — reading back. `Encrypt` is not
  needed: S3 generates the data key.
- **No `ListBucket`.** The service never lists; it knows every key it wrote.

**Do not** give this role the verification prefix, and do not give the verification role this one.

### Bucket CORS, for the page's origin

The browser PUTs straight to the bucket from the page the Conversation Service serves (ADR-0060), so
the bucket must answer that origin's preflight. One rule, one origin, the headers the run proved the
URL is refused without, and nothing else:

```json
[
  {
    "AllowedOrigins": ["https://<the conversation service's public origin>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-server-side-encryption",
      "x-amz-server-side-encryption-aws-kms-key-id"
    ],
    "ExposeHeaders": ["etag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 300
  }
]
```

No `GET` from the browser (the runner fetches, not the page), no wildcard origin, no `*` in the
headers. In a deployment with a second origin (a staging page), a second rule with that origin —
not a widened first one.

### Lifecycle

- Nothing under `documents/` expires by lifecycle: retention is decided by the schedule and executed
  by `purgeContents`, not by S3 (ADR-0010, ADR-0023). A lifecycle rule here would be a second
  retention policy nobody approved.
- `verify/` can keep its one-day expiry.
- **Abort incomplete multipart uploads after 1 day** — the service does not use multipart, but a
  browser that does would leave parts that cost money and that no purge reaches.

### The environment the service reads

| variable | value |
|---|---|
| `AAS_DOCUMENTS_BUCKET` | `askimate-aas-vault-4471` |
| `AAS_DOCUMENTS_KMS_KEY_ARN` | the CMK's **ARN** — not an alias, not the bare id: HEAD reports the ARN and the confirm compares against it |
| `AAS_DOCUMENTS_REGION` | optional; `eu-west-2` is the default and the only value accepted (ADR-0012) |
| `AAS_RETENTION_SCHEDULE_DIR` | the directory holding the approved schedule versions — `config/retention` in this repository |

All of the first three-and-the-fourth together, or none. A partial set is refused at startup with
every missing name listed. Credentials are **not** among them: the S3 client takes the process's
role. Nothing reads `AWS_*` in this repository's own code.

## 2 · What it costs

Stated from the Phase-0 bootstrap plan, the only pricing this repository holds; confirm at creation.

- **S3 storage** — a document is a few megabytes; the plan's ≈$25/month Phase-2 line covers S3 with
  RDS as the bulk. Storage grows with students and shrinks with purges.
- **S3 requests** — three per document (PUT, HEAD, and eventually GET or DELETE).
- **KMS** — one `GenerateDataKey` per upload, one `Decrypt` per read. The key already exists.
- **Nothing new is created** if the verification bucket becomes the vault: a policy, a CORS rule and
  a lifecycle rule are configuration, not resources.

## 3 · What it can reach

**Nothing.** A bucket has no outbound reach. The role can put, get and delete under one prefix of
one bucket and use one key. It cannot list, cannot reach `verify/`, cannot touch another bucket or
service. The browser reaches the bucket with a URL that expires within fifteen minutes and is
refused without the headers the signature covers.

## 4 · If the verification bucket is NOT to be the vault

Create a second bucket in `eu-west-2` with the same settings the verification request listed —
block public access, TLS-only, versioning **on** for the vault, SSE-KMS under the same CMK — and
point `AAS_DOCUMENTS_BUCKET` at it. Everything above applies to it unchanged.

## 5 · What happens after

1. You set the four variables on the service's deployment and start it. The log line says
   `documents=s3`. If the schedule directory is missing, empty, or does not validate, the process
   refuses to start and says which.
2. The first real declaration mints a URL. **That is the first request this service makes to AWS**,
   and it happens on your deployment, not from this environment — nothing here runs against AWS
   without your word (ADR-0092 §4).
3. The page's upload control exists (P62, [ADR-0095](./decisions/0095-the-page-makes-the-put-and-the-cors-rule-is-exercised.md)),
   and the CORS rule in §1 is the one its browser test enforces: the test parses the JSON block
   above and admits nothing else, so the page's PUT is proved against the rule as written here. What
   is still not built: the retention sweep that calls `purgeContents`; the runner's fetch of a retrieval URL, which
   waits until `attach_document` is reachable — B5 is decided (A, hold and reuse, ADR-0078, 2026-09-07) and does not condition it; what is left is engineering: the attachment intent identity ADR-0069 names and a `WorkKind` that can carry it (state-of-the-system blocker 9).
