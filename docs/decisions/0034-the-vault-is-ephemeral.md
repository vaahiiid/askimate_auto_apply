# ADR-0034 — The vault is ephemeral, encrypted, and shared by ciphertext only

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Supersedes:** the recommendation in `production-architecture.md` §8 decision 5 that the vault be
process memory only. That answer was right about durability and wrong about availability; this one
keeps the first property and fixes the second.

## The problem with "process memory only"

`InMemorySecretStore` holds plaintext in one process's heap. It has the property we want — nothing at
rest, nothing to back up, nothing to subpoena — and one that makes it unusable in production:

**it does not survive horizontal scaling.** With more than one instance behind a load balancer, the
instance that receives `POST /v1/secret/:requestId` and the instance that later receives
`POST /internal/secret-uses` are different processes. The handle resolves to nothing and every real
run fails. Sticky routing by request id would "solve" it by making correctness depend on a load
balancer's hashing, which is not a security control.

A single instance is not a production answer either: it means no rolling deploys, no autoscaling, and
an outage on every restart.

## The decision

**The secret is envelope-encrypted at the application layer and the ciphertext is held in a shared
cache with all persistence disabled and a TTL equal to the request's.**

```
plaintext ──▶ AES-256-GCM with a data key from AWS KMS (eu-west-2, ADR-0012)
           ──▶ ciphertext + encrypted data key ──▶ Valkey/Redis
                                                    · appendonly no
                                                    · save ""          (no RDB, no AOF)
                                                    · TLS in transit, ACL per service
                                                    · maxmemory-policy noeviction
                                                    · TTL = request TTL, hard ceiling 5 minutes
```

The plaintext exists in exactly two places, both transient: the DOM element the student typed it into,
and one stack frame in the secure service. It is encrypted before it is assigned to anything that
outlives that frame.

## Why this is stronger, not weaker, than memory-only

| Property | Memory-only | This |
|---|---|---|
| Plaintext at rest | None | None |
| In a backup, replica, WAL or snapshot | No | **No** — persistence is off, and the payload is ciphertext regardless |
| Survives horizontal scaling | **No** | Yes |
| Survives a rolling deploy | **No** | Yes |
| Compromise of the cache alone yields | n/a | Ciphertext. Useless without KMS |
| Compromise of one host yields | That host's heap | That host's heap |

Two independent compromises are now required: the cache **and** KMS. Memory-only required one.

## What is deliberately not done

- **No durable secret store.** Not Secrets Manager, not a database column, not "encrypted at rest in
  Postgres". Those create backups, replicas, WAL segments and snapshots of something whose entire
  required lifetime is under five minutes. The strongest property remains *that there is nothing to
  find*.
- **No read API on the vault.** `use()` takes a callback, hands it the plaintext, and returns the
  **callback's result**. There is no getter, no accessor and no queue. This is the existing design in
  `packages/secrets` and it is kept exactly.
- **No key caching across requests.** A data key is requested per secret and zeroed after use.

## Operational requirements this creates

- **Core dumps disabled** on the secure service; a heap dump is the remaining plaintext exposure.
- **Cache eviction must be `noeviction`.** Silent eviction under memory pressure would look like a
  spontaneous cancellation, and a security control that fails quietly is not one.
- **A restart that loses in-flight secrets fails closed and visibly**: the request moves to
  `secret_expired`, the student is told in the conversation, and the model asks again.
- **Health-check-gated deploys** so a rolling restart drains in-flight secure turns first.
