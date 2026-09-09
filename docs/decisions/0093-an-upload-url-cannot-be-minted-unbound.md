# ADR-0093 — An upload URL cannot be minted unbound

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-09
**Continues:** [ADR-0092](./0092-the-document-never-enters-a-process-we-run.md), whose condition 1 was
met that day and whose port this reshapes. **Completes** the transport
[ADR-0090](./0090-the-gates-run-before-a-byte-is-accepted.md) began: the gates still run before a
byte exists, and now the byte never comes here.

## The decision, in Vahid's words

> Both halves VERIFIED. Condition 1 of ADR-0092 is met. Reshape the port.
>
> The constraint you found is the important output of this, more than the verdict: the property
> holds only when the checksum is a signed header the browser sends, and the SDK's default hoists it
> into the query string where S3 never reads it. Make that structural in the minting code, not a
> note in the ADR — a default that silently disables the binding is exactly the shape this
> repository has spent phases removing. If it can be made impossible to mint an upload URL without
> that header signed, do that.

It can be, and it is.

## Context — what the run found

ADR-0092 §4 records two runs against the bucket Vahid created. The first said **binding REFUTED**:
the SDK's default presign had hoisted `x-amz-checksum-sha256` into the URL's query string, the only
signed header was `host`, S3 stored no checksum, and a URL bound to a hash behaved exactly like one
bound to nothing. Vahid: *"The run refuted the property under the SDK's default presign, not the
property itself."* The second run, with the header marked unhoistable, said **VERIFIED on both
halves**: a same-length substitution refused (`BadDigest`), the header omitted refused
(`SignatureDoesNotMatch`), the header altered to match the substituted body refused (the same), the
control accepted, the stored checksum read back equal to the declared one, and all of it holding
under SSE-KMS with the customer-managed key.

So the property is real, and it is conditional. The condition is one option on one SDK call, and
the SDK's default is the wrong side of it. That is the finding this record is about.

## Decision

**A `BoundUploadUrl` is a branded type with one producer, and the producer refuses to produce one
whose signature does not cover the checksum header.** The route that answers a declaration can only
put a `BoundUploadUrl` on the wire. An unbound URL has no path to a browser: not because a handler
remembers to check, but because the type does not admit one.

`mintBoundUpload` (`packages/documents/src/bound-upload.ts`) does three things to the presigner it
is handed, and trusts it for none of them:

1. **It decides what is signed.** The checksum header value is computed from the intake's declared
   hash — base64 of the digest bytes, which is what S3 compares — and the customer-managed key and
   the expiry are decided here. The adapter is told; it does not choose.
2. **It names what must not be hoisted.** `x-amz-checksum-sha256` and the two SSE-KMS headers, as a
   set the presigner receives. An adapter cannot forget to say so, because it is not the one saying
   it.
3. **It reads the URL back.** Before returning, it parses what the presigner produced and throws
   `UnboundUploadError` if the checksum header appears in the query string, if `X-Amz-SignedHeaders`
   does not cover every required header, if the URL is not `https:`, has no usable expiry, or would
   outlive the intake it was minted for.

The S3 adapter (`apps/conversation-service/src/s3-document-vault.ts`) passes `unhoistableHeaders`
to the SDK because the mint told it to. **If a future SDK version changed what that option means,
step 3 throws, the declaration answers `service_unavailable`, and no URL leaves the process.** The
default that silently disabled the binding cannot silently disable it again: it fails loudly, at the
declaration, before a browser is involved.

### Proven against the library, offline

Presigning makes no network call, so the SDK version this repository pins can be asked without a
bucket. `s3-document-vault.test.ts` does two things with the real presigner and fake static
credentials: it mints the way the adapter does and shows `assertBoundUploadUrl` accepting the result
with all three headers signed and nothing hoisted; and it mints **the SDK's default**, exactly as the
first run did, shows the checksum in the query string, and shows the same function **refusing** it.
That test is the regression the finding deserves. A dependency bump that changed the hoisting
behaviour fails it in CI.

### The browser is told what to send

The run's E6 and E7 established that the URL is refused without the headers, and with them altered.
So `PreparedUpload` states them — `x-amz-checksum-sha256`, `x-amz-server-side-encryption`,
`x-amz-server-side-encryption-aws-kms-key-id`, with their exact values — and the declaration's
response carries them. ADR-0075's rule: a client is told, not left to guess and be refused.

### The confirmation does not take the browser's word

`POST …/documents/{intakeId}/confirm` replaces `PUT …/content`. It spends the intake atomically (the
same take-and-remove as before), then asks the bucket what it holds. `receiveUpload` — the only
producer of the branded `ReceivedUpload` a record is written from, the device `AcceptedBytes` was
when the bytes came through this process — refuses nothing there (`upload_not_received`, a new
published code), a different checksum or length (`content_hash_mismatch`), and an object S3 did not
encrypt under the configured key (`UnencryptedObjectError`, answered as `service_unavailable`
because it is the bucket's fault and not the student's). Only what matches, exactly, is recorded.

## What the port is now

```
POST /v1/conversations/{id}/documents            the declaration · THE GATES RUN HERE (ADR-0090, kept)
  → 201 { intakeId, expiresAt, upload: { url, method: PUT, headers, expiresAt },
          maxBytes, acceptedContentTypes, contentHash, retentionPolicyReference }

browser ──PUT url, headers, bytes──▶ bucket       S3 enforces the checksum the signature bound.
                                                  No AAS process is on this path.

POST /v1/conversations/{id}/documents/{intakeId}/confirm
  → 201 { documentId, documentType, state, contentHash, retentionPolicyReference }
     the bucket is asked (HEAD); the record is written only from a ReceivedUpload

later, after mayTransmit (ADR-0022):
  vault.prepareRetrieval(documentId) → a short-lived GET the runner fetches. No caller yet.
```

`DocumentVault` has no method that takes or returns bytes. `store(upload, contents, now)` and
`retrieve(documentId)` are gone; `prepareUpload`, `confirmUpload` and `prepareRetrieval` replace
them. `acceptBytes` and `AcceptedBytes` are retired with the route that used them. The in-memory
implementation now sits over an **in-memory bucket that refuses what the run saw S3 refuse** — the
substitution, the omitted header, the altered header, the expired URL, the forged signature — so a
test that passes against it and would fail against S3 has to be one the run did not cover.

## What was built

- `packages/documents`: `bound-upload.ts` (the mint, the read-back, the receipt check, the brands);
  the reshaped `DocumentVault`; the in-memory bucket; `upload_not_received` on `IntakeRefusedError`.
  `acceptBytes` removed. 18 new tests, and the vault's 27 rewritten around prepare → put → confirm.
- `apps/conversation-service`: `s3-document-vault.ts` over `@aws-sdk/client-s3` and the presigner
  (now dependencies of this app, and of no package); the declaration mints; `PUT …/content` gone,
  `POST …/confirm` in its place; `express.raw` no longer imported — **no route on this service reads a
  non-JSON body.** 20 route tests rewritten; 9 adapter tests, two of them against the real SDK.
- `packages/contracts`: the confirm path published, the content path withdrawn, `PreparedUpload`
  in the declaration's response, `upload_not_received` in the one closed set of problem codes.

## What was not built, and is next

- **Durable metadata.** `DocumentRecord`s and the object key each one lives under are held in a Map
  in both implementations. The bytes are where D puts them; the record of them is not yet in the
  conversation plane's database. `assertDocumentStoreIsDurable` keeps refusing a production start,
  as it has since ADR-0090, and production wiring of the S3 vault waits for that phase.
- **CORS on the bucket**, for the page's origin — a provisioning request when the client surface
  exists.
- **The retrieval's caller.** `prepareRetrieval` exists on the port; nothing calls it until
  `attach_document` leaves its hold (B5) and the runner fetches. It was described in ADR-0092 as
  part of the port and is built as such, and it is not counted as a declared-but-unreachable
  capability because it is a port method with no promise of its own — the promises, `purgeContents`
  and `authoriseDisclosure`, are in the register with their reasons updated to what is now true.
- **Content-type is not bound.** The upload URL signs the checksum and the SSE headers, which is
  what the run verified. It does not sign `Content-Type`; the record's content type is the declared
  one, and nothing downstream trusts what the bucket says it is.

**Declared-but-unreachable surface: six, unchanged.** `purgeContents` gained an implementation, not
a caller.
