# ADR-0083 — An ADR and the lists of it must agree

**Status:** **Accepted** — 2026-09-08
**Continues:** [ADR-0082](./0082-the-record-of-what-cannot-be-reached-is-checked-too.md) — which held one
hand-written document to a checked register, and left the records of the decisions themselves unchecked

## Context

ADR-0082 asked whether the prose describing a check still matched the check. This asks the same
question of the records describing the **decisions**, and the answer was worse: not one hand-written
copy but **three**, none of them compared with the others, disagreeing since the day they were
written.

- The **ADR file** itself, whose `**Status:**` line is the decision.
- The **index**, `docs/decisions/README.md`.
- **`state-of-the-system.md` §3**, *"Every ADR, and whether it is still in force"* — a full second
  copy of the same table, in the document the README calls the standing account.

## What was found

**Four of eighty-two disagreed, and the history says exactly how.** All three times on 2026-08-26:

| time | commit | |
|---|---|---|
| 08:05 | `4ee6b1c` | Phase 0. Five ADR files, all *"Proposed · awaiting Vahid's approval"*. Index created saying the same. Consistent. |
| 08:47 | `a27cb60` | Phase 1. Commit message: *"Phase 0 approved by Vahid on 2026-08-26. ADRs 0001-0005 moved to Accepted."* Flips all **five files**. Does not touch the index. |
| 09:02 | `8786fff` | Edits the index — and moves **only 0005**'s row to Accepted. 0001 to 0004 are left behind. |

A partial edit, fifteen minutes after the approval, four rows missed. **Seventy-eight commits and six
weeks carried it forward**, and the index has said `Proposed` for those four in *every commit since
the index existed*.

**The direction is what makes this one different.** Every previous finding of this shape — eight
consecutive phases — was a record claiming **more** than the system did: a capability with no caller,
a refusal with no reader, a route with no client. This one claimed **less**. The cost was not a false
guarantee; it was that `state-of-the-system.md` grew a standing blocker,

> **12** · Accept or revise ADRs 0001–0004 · owner: **You**

**asking Vahid to decide something he had already decided**, and a recommendation in §9 to accept two
of them. A record that understates does not fail loudly. It generates work for a person, and the
person cannot tell it is wrong without reading the git history.

**A third defect, found while fixing the second.** §3's table was missing ADR-0081 and ADR-0082
entirely — because P47 and P48 each added a row to the index and not to the second table. That is not
an old mistake inherited from Phase 0; it is one made **in the two phases immediately preceding this
one**, by the same hand that then went looking for exactly this shape. Two records are a thing that
can drift. Three is a thing that will.

## Decision

**§1 — The ADR file is the decision; the lists are listings of it.** Where they disagree, the file is
right and the listing is wrong. This is not a preference: the file is what a person edits when
deciding, and the listings are maintained afterwards, which is precisely how the 09:02 edit went
wrong.

**§2 — All three records are checked against each other.** `scripts/adr-status-agrees.test.ts`
asserts that every ADR file's status matches its index row and its §3 row; that every ADR is listed
in both; that no list names an ADR that does not exist; and that every file has a status the project
recognises.

**§3 — The index's stated Accepted count must match its own rows.** It said *"Seventy-eight are
Accepted"*, which was right for the stale index and wrong for the decisions. A count quoted in prose
drifts on its own.

**§4 — A disagreement that a person must resolve is declared, not picked.** `CONTESTED` is empty and
exists so that a future disagreement whose resolution is a founder's call can be recorded with what
each side says, the evidence, and who decides — the register pattern ADR-0073 uses for a capability
with no caller. A declared entry whose two sides later agree fails as stale.

**ADRs 0001–0004 are deliberately not in it.** Their approval is recorded in three independent
places: the four files, `a27cb60`'s commit message, and sibling ADR-0005 — approved in the same
sentence, whose index row *was* updated. Only the listings disagreed, and they were wrong. Declaring
that contested would have been its own false record, and would have left the blocker standing.

## What this deliberately does NOT do

- **It does not re-approve anything.** No status is being decided here. Four rows are being corrected
  to match a decision made on 2026-08-26 and recorded in the ADR files ever since. If that approval
  did not happen, this correction is wrong and the ADR files have been wrong for six weeks — and that
  is a question for Vahid, raised explicitly rather than settled quietly.
- **It does not merge the three records.** §3 carries *"whether it is still in force"* — which ADR
  amends which, what P72 corrected — and the index carries the narrative. Collapsing them would lose
  both. They may differ in everything except the status.
- **It does not touch 0001 and 0002's substance.** They are accepted decisions describing an
  integration that has not been built, which is a different thing from an unaccepted decision, and it
  stays recorded as blocker 10.

## Consequences

- **Blocker 12 is closed as never having existed.** The list asked for a decision that had been made
  before the list was written.
- Four deliberate regressions, each verified from disk: reverting any one index row fails by name;
  reverting a §3 row fails by name; deleting an ADR's §3 row fails the listing check; leaving the
  stated count at seventy-eight fails.
- **The declared-but-unreachable surface is unchanged at seven.** Nothing here is a capability.
