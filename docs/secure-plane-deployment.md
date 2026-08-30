# Secure Plane — what this repository implements, and what must be provisioned

> Vahid, 2026-08-28: *"Do not fake KMS availability in a way that makes production
> security claims untrue. If cloud infrastructure cannot actually be provisioned
> in this repository, clearly separate: 1. production implementation
> 2. local/test implementation 3. required deployment configuration."*

This document is that separation. Everything in §1 runs and is tested here.
Everything in §3 is a claim this repository **cannot** make on its own.

## 1. Implemented and verified in this repository

| Piece | Where | Verified by |
| --- | --- | --- |
| Envelope encryption, AES-256-GCM, a fresh data key per secret, keys zeroed | `packages/secrets/src/vault.ts` | `vault.test.ts` — the cache is scanned byte-for-byte for the plaintext |
| No read API: `use()` takes a callback and returns the callback's result | same | `vault.test.ts` — the entry is gone *while the task runs* |
| Single-use, and one answer for unknown / spent / expired | same | `vault.test.ts` |
| A five-minute ceiling applied at encryption time | same | `vault.test.ts` |
| The one endpoint that accepts a secret | `apps/secure-service/src/routes.ts` | `secure-routes.test.ts` (20) |
| Cross-origin control document, CSP, `frame-ancestors` | `control-document.ts` | `secure-routes.test.ts`, `check-boundaries.ts` |
| One-time bootstrap, atomic single-use claim | `requests.ts` | `secure-routes.test.ts` — including two simultaneous exchanges |
| Field-allowlist logger that cannot take an object | `logger.ts` | `secure-routes.test.ts` — on failure paths only |
| Transactional outbox, receipt and publication committing together | `lifecycle-outbox.ts` | `secure-routes.test.ts`, `lifecycle.test.ts` |
| A real browser typing a real credential across two origins | — | `two-origin.test.ts` (7) |

## 2. Local and test implementations — correct, and NOT production

| Port | Local implementation | Why it is not production |
| --- | --- | --- |
| `DataKeyProvider` | `LocalDataKeyProvider` | Wraps data keys with a master key **held in this process**. One host compromise yields every ciphertext in the cache. Under KMS it does not: unwrapping is an API call this process cannot make without a credential that can be revoked and is audited. |
| `EnvelopeCache` | `InMemoryEnvelopeCache` | In-process. Two service instances do not share it, which is precisely the failure ADR-0034 exists to fix — the instance that receives the submission and the one that spends the handle are different processes. |

**These cannot be used in production by accident.**
`assertVaultIsProductionGrade(provider, process.env.NODE_ENV)` throws at boot
when `NODE_ENV=production` and the provider is local. A comment saying "not for
production" is advice; a process that will not start is a control.

## 3. Must be provisioned before a real credential is handled

Nothing in this repository can verify any of these. They are the deployment's.

### 3.1 AWS KMS (eu-west-2, ADR-0012)

- A customer master key with a key policy permitting **only** the secure
  service's task role, and only `GenerateDataKey` and `Decrypt`.
- `AAS_SECURE_KMS_KEY_ID` and `AAS_SECURE_KMS_REGION` set on the service.
- CloudTrail on the key. The encryption context carries the request id and
  nothing that identifies a student outside our own database — it is visible in
  CloudTrail, so it must stay non-confidential.
- **`KmsDataKeyProvider` is written and typed but has never been run against a
  live key from this repository.** An operator's first-run check is a single
  `GenerateDataKey` call; a mocked test passing here would be evidence only that
  the mock matched the mock.

### 3.2 Valkey / Redis for the ciphertext cache

```
appendonly no
save ""                  # no RDB, no AOF — nothing on disk, ever
maxmemory-policy noeviction
requirepass / ACL per service
tls-port only
```

`noeviction` is load-bearing: silent eviction under memory pressure would look
to a student like a spontaneous cancellation, and a security control that fails
quietly is not one. An `EnvelopeCache` adapter over a Redis client is **not
implemented here** — the port is, and it is the whole surface the vault uses.

### 3.3 The two origins, and TLS

- `app.askimate.com` — the conversation plane, serving the client and the API.
- `secure.askimate.com` — the secure plane. A **different registrable-site
  label is not required**, but a different origin is.
- HTTPS on both. `__Host-` cookies require `Secure`, and the secure session is
  additionally `SameSite=None; Partitioned`, which browsers only accept over
  HTTPS. On `http://localhost` Chromium treats the origin as trustworthy, which
  is why the browser tests work; nothing else does.
- `frame-ancestors https://app.askimate.com` on the control document, matching
  the deployed conversation origin exactly.

### 3.4 Service-to-service authentication

Both internal APIs are behind `serviceMutualTls` in the contract. This
repository uses an `x-service-cert` header as the stand-in and the code is
written so that **only that check changes** under mTLS: the request bodies, the
idempotency behaviour and the retry classification are identical.

- Private subnet, no public route to `/internal/*`.
- A per-service client certificate. The conversation service and the automation
  runner have different ones and different permitted operations.

### 3.5 Process hardening

- **Core dumps disabled** on the secure service. A heap dump is the remaining
  plaintext exposure, and it is the only one left.
- No request logger, no APM agent, no error reporter. `check-boundaries.ts`
  fails the build if one is added by name, but a sidecar that scrapes stdout is
  outside what a build can see.
- Health-check-gated rolling deploys, so an instance drains its in-flight secure
  turns before it is retired.

### 3.6 Identity (ADR-0038)

Both planes' sessions are minted from a managed OIDC provider's callback. The
`/dev/session` route in the conversation app is a **test seam**, mounted only
when a caller passes `issueSessionFor`, and it must not exist in a deployed
configuration.
