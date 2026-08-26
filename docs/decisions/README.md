# Decision Record

Per master brief §12.8: *"Maintain a decision record. Confirmed architectural, technical and
product decisions must not be quietly reversed later."*

This continues a practice that already exists in the Universitio repository as
`.agents/memory/` — formalised here as numbered ADRs.

## Status vocabulary

Brief §12.9 requires a clear distinction between implemented, planned, assumed and confirmed.
ADR status uses exactly that vocabulary:

| Status | Meaning |
|---|---|
| **Proposed** | Written up and recommended. **Not agreed by Vahid.** Must not be treated as settled. |
| **Accepted** | Vahid approved it. Binding — reversing it requires a new ADR that supersedes this one. |
| **Superseded** | Replaced. The replacing ADR is named. The record is never deleted. |
| **Rejected** | Considered and declined. Kept so the reasoning is not re-litigated. |

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-integration-via-https-api-and-signed-webhooks.md) | Integration via HTTPS API + signed webhooks | Proposed |
| [0002](./0002-aas-owns-the-confirmed-profile.md) | AAS is the system of record for the confirmed profile | Proposed |
| [0003](./0003-versioned-migrations-not-push-force.md) | Versioned migrations, not `drizzle-kit push --force` | Proposed |
| [0004](./0004-branded-types-for-confirmed-values.md) | Branded types make model output unable to reach a form field | Proposed |
| [0005](./0005-contract-first-openapi.md) | Contract-first OpenAPI at the AskiMate↔AAS boundary | Accepted |
| [0006](./0006-reapplication-requires-explicit-student-instruction.md) | Re-application requires an explicit student instruction | Accepted |
| [0007](./0007-agent-led-conversational-intake.md) | Agent-led conversational intake — the student never fills in a form | Accepted |
| [0008](./0008-recovery-first-escalation-and-the-learning-loop.md) | Recovery-first escalation, and the learning loop | Accepted |
| [0009](./0009-requirements-provenance-and-verification.md) | Requirements provenance and multi-source verification | Accepted |
| [0010](./0010-policy-driven-document-retention.md) | Policy-driven document retention, with no default | Accepted |
| [0011](./0011-minor-detection-and-the-minor-workflow.md) | Identity check, minor detection, and the minor workflow | Accepted |
| [0012](./0012-aws-region-eu-west-2.md) | AWS region — eu-west-2 (London) | Accepted |
| [0013](./0013-minor-is-not-a-blocker.md) | Minor is not a blocker; minor conditions are stage-scoped | Accepted |
| [0014](./0014-discovery-cannot-submit.md) | Discovery is structurally incapable of submitting | Accepted |
| [0015](./0015-interview-is-a-capability-of-askimate-chat.md) | The interview is a capability of AskiMate Chat, not a new interface | Accepted |
| [0016](./0016-extraction-must-quote-the-document.md) | An extracted value must quote the document, or it is discarded | Accepted |
| [0017](./0017-mapping-is-reviewed-data.md) | Field mapping is reviewed data, and format rules are data too | Accepted |
| [0018](./0018-amazon-bedrock-as-the-model-provider.md) | Amazon Bedrock is the model provider, and no model is named yet | Accepted |
| [0019](./0019-requirements-curation-ownership.md) | A human specialist curates requirements, through the AskiMate knowledge workflow | Accepted |

All nineteen are **Accepted**. ADR-0013 supersedes the gate design in ADR-0011. Reversing any of them requires a new ADR that supersedes it.
