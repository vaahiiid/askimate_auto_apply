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
| [0005](./0005-contract-first-openapi.md) | Contract-first OpenAPI at the AskiMate↔AAS boundary | Proposed |

**All five are Proposed. None is agreed.** They become Accepted only on Vahid's explicit approval.
