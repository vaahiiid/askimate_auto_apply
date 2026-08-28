# ADR-0037 — Service topology, network boundaries and deployment

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0012](./0012-aws-region-eu-west-2.md) (region),
[ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md) (origins)

## The decision

**Three deployables, three trust levels, one region (eu-west-2).**

| Service | Origin | Network | Holds |
|---|---|---|---|
| **conversation** | `app.askimate.com` | Public, behind ALB + WAF | Users, conversations, the event log, message bodies, LLM calls |
| **secure** | `secure.askimate.com` | Public for the control and submit; **internal API on a private subnet with no public route** | Secret requests, the vault, handle minting and spending |
| **runner** | none | Private only. No inbound from the internet | Browser automation against portals |

### Data stores

- **Two Postgres databases** (RDS, eu-west-2), one per stateful service, with **separate credentials**
  and no cross-database access. The conversation service cannot read `secret_requests`, and does not
  need to: it learns lifecycle through `postMessage` and its own log. A full compromise of the
  conversation database therefore yields no secret metadata beyond ids and lifecycle words.
- **One ephemeral cache** for the vault (ADR-0034), reachable only by the secure service.
- TLS required on every connection; IAM database authentication rather than long-lived passwords.

### Service-to-service

The runner reaches the secure service's internal API over **mTLS** on a private subnet, with a
per-service client certificate. There is no public route to `/internal/*` — not an authenticated one,
not a firewalled one. It is not routable.

### Compute

ECS Fargate behind an ALB. Chosen over EKS because the operational surface of Kubernetes is not
justified by three services, and over Lambda because the secure service holds a warm in-process cache
and SSE holds long-lived connections — both of which fight a function-per-request model.

### Configuration and secrets

No credential in an environment variable committed anywhere. AWS Secrets Manager for credentials, SSM
Parameter Store for configuration, injected at task start. A separate KMS customer-managed key per
environment, with the vault's data-key grants scoped to the secure service's task role alone.

### Observability

- **Structured JSON logs with a field allowlist.** The serialiser emits named fields; it cannot be
  handed an object. Request bodies, response bodies, error objects, headers and query strings are not
  loggable — not "should not be logged", not representable.
- **`scrubParseErrorBody` runs before anything reads an error**, because body-parser attaches the raw
  request body to a JSON syntax error.
- **OpenTelemetry traces with a redaction processor** and no body capture, per
  [ADR-0025](./0025-sensitive-data-never-reaches-a-trace.md).
- **No `console.*` in the secure service**, enforced by the existing boundary check.
- Platform logs at the ALB are checked for body capture rather than assumed clean.

### Backups and disaster recovery

Both databases: automated backups, point-in-time recovery, encrypted with a CMK. The vault: **never**.
There is nothing in it that may survive, and its loss is a five-minute availability event handled by
asking the student again.

## Environments

Three — development, staging, production — with **separate AWS accounts**, separate KMS keys, separate
domains and no shared data. Staging never receives production data; a synthetic student fixture is
generated instead. A secret is a secret in staging too.
