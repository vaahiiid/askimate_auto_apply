# ADR-0037 — Service topology, network boundaries and deployment

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0012](./0012-aws-region-eu-west-2.md) (region),
[ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md) (origins)

## The decision

**Four deployables, three trust levels, one region (eu-west-2).**

| Service | Origin | Network | Holds |
|---|---|---|---|
| **conversation** | `app.askimate.com` | Public, behind ALB + WAF | Users, conversations, the event log, message bodies, LLM calls |
| **secure** | `secure.askimate.com` | Public for the control and submit; **internal API on a private subnet with no public route** | Secret requests, the vault, handle minting and spending |
| **fill agent** | none | Private only. Reachable from the runner alone, over mTLS | The ONE browser operation that types a credential ([ADR-0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md)) |
| **runner** | none | Private only. No inbound from the internet, plus a CDP endpoint reachable by the fill agent alone | Browser automation against portals |

### Data stores

- **Two Postgres databases** (RDS, eu-west-2), one per stateful service, with **separate credentials**
  and no cross-database access. The conversation service cannot read `secret_requests`, and does not
  need to: it learns lifecycle through `postMessage` and its own log. A full compromise of the
  conversation database therefore yields no secret metadata beyond ids and lifecycle words.
- **One ephemeral cache** for the vault (ADR-0034), reachable by the secure service and the fill
  agent and by nothing else. Both hold a KMS grant on the same customer-managed key: the service
  only ever calls `put`, the agent only ever calls `use`, and no value passes between them
  (ADR-0042). The fill agent has **no database**, in either plane.
- TLS required on every connection; IAM database authentication rather than long-lived passwords.

### Service-to-service

The runner reaches the **fill agent's** internal API over **mTLS** on a private subnet, with a
per-service client certificate. The **fill agent** reaches the secure service's internal API the same
way, with a different one. There is no public route to `/internal/*` on either service — not an
authenticated one, not a firewalled one. It is not routable.

The runner has **no certificate permitting `/internal/v1/secret-uses`**: the authority to settle a
use belongs to the process that performs one (ADR-0042). It asks the agent, and the agent asks the
secure service.

### The fill agent is its own task, not a sidecar

Containers in one ECS task share the task IAM role through the credentials endpoint at
`169.254.170.2`. A fill agent running beside the runner would therefore hand the runner's container
the agent's KMS grant and its route to the vault's cache — the exact widening ADR-0042 exists to
prevent. So the agent is a separate task with its own role, and `pidMode` is set to `task` on
nothing, so no container can `ptrace` another.

The runner's Chromium exposes a CDP endpoint on the private subnet. CDP is unauthenticated, so the
security group permits **only the fill agent's** security group to reach it, and Chromium binds to
the task ENI rather than to `0.0.0.0` on a routable network. The agent's own egress is restricted to
that endpoint and to the secure service.

### Compute

ECS Fargate behind an ALB. Chosen over EKS because the operational surface of Kubernetes is not
justified by three services, and over Lambda because the secure service holds a warm in-process cache
and SSE holds long-lived connections — both of which fight a function-per-request model.

### Configuration and secrets

No credential in an environment variable committed anywhere. AWS Secrets Manager for credentials, SSM
Parameter Store for configuration, injected at task start. A separate KMS customer-managed key per
environment, with the vault's data-key grants scoped to the secure service's and the fill agent's
task roles alone. The runner's task role has no KMS grant at all.

### Observability

- **Structured JSON logs with a field allowlist.** The serialiser emits named fields; it cannot be
  handed an object. Request bodies, response bodies, error objects, headers and query strings are not
  loggable — not "should not be logged", not representable.
- **`scrubParseErrorBody` runs before anything reads an error**, because body-parser attaches the raw
  request body to a JSON syntax error.
- **OpenTelemetry traces with a redaction processor** and no body capture, per
  [ADR-0025](./0025-sensitive-data-never-reaches-a-trace.md).
- **No `console.*` in the secure service or the fill agent**, enforced by the existing boundary check.
- Platform logs at the ALB are checked for body capture rather than assumed clean.

### Backups and disaster recovery

Both databases: automated backups, point-in-time recovery, encrypted with a CMK. The vault: **never**.
There is nothing in it that may survive, and its loss is a five-minute availability event handled by
asking the student again.

## Environments

Three — development, staging, production — with **separate AWS accounts**, separate KMS keys, separate
domains and no shared data. Staging never receives production data; a synthetic student fixture is
generated instead. A secret is a secret in staging too.
