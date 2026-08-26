# Decision point — 2026-08-26

What is done, what is blocked, what needs your approval, and the exact minimum for the first
controlled real application run.

---

## 1 · What I completed

| | |
|---|---|
| **Retention mechanism** | Versioned, auditable, with basis provenance. Unresolved requirements are first-class and blocking. `pnpm run retention-status`, and it runs in CI. ([ADR-0023](./decisions/0023-retention-periods-are-determined-not-invented.md)) |
| **Retention analysis** | Twelve open questions, each with the source that answers it and an owner. **No period invented.** ([analysis](./retention-analysis.md)) |
| **Requirements Service** | On AskiMate's own `kb_pending_entries → review → kb_entries` workflow, plus the official-source channel. No separate system. |
| **Discovery: flow capture** | Login, account creation, CAPTCHA, MFA/OTP, email verification, submission, payment and conditional fields — detected **with the evidence that produced each**. |

**669 tests.** Typecheck, lint, boundaries and CI green.

### The three things worth your attention

**Retention now fails safe in a way that is visible.** `0 of 10 document types could be stored
today. 12 questions recorded as unresolved.` That is the designed state. The mechanism refuses
`"TODO"`, `"TBC"`, `"n/a"` and nine other placeholders as a basis — because the realistic failure is
not an empty field, it is a placeholder added to make an upload work that then looks like a real
basis in every listing.

**A signal is an observation, not a conclusion.** Discovery records *"there is a script tag from
google.com/recaptcha"*, not *"this portal uses CAPTCHA"*. The second is a very good inference from
the first, and inferences belong to the specialist reviewing the blueprint.

**The strict comparison caught me.** Writing the Requirements Service tests, my extractor read *"no
band below 6"* from a page saying *"no band below 6.0"*. `channelsAgree` refused to decide those were
the same requirement and reported a conflict. I fixed the extractor and kept a test asserting the
near-match still conflicts — deciding those mean the same thing is a human's job.

---

## 2 · What remains blocked

| | Blocker | Whose | Notes |
|---|---|---|---|
| 1 | **Real portal discovery** | Yours to run | Environment blocks all three hosts. [Runbook](./runbook-discovery-handoff.md) · ~5 min |
| 2 | **Specialist reviews** — blueprint, then mapping set | Yours | Cannot start until 1 |
| 3 | **Bedrock credentials** | Yours | Then `pnpm run verify-bedrock` and the model choice is mechanical |
| 4 | **An account** | Yours | [QA HE request](./qa-higher-education-sandbox-request.md), drafted |
| 5 | **Retention determinations** | Yours to decide | See §4 — this is the one I most need a name against |

Nothing on this list is waiting on me.

---

## 3 · Authoritative sources — used, and needed

### Used

**None for retention periods, and I want to be precise about that.**

This environment blocks `ico.org.uk`, `legislation.gov.uk` and `gov.uk`. I checked all three; they
return no response. So I read no source and proposed no period.

What I *did* rely on is my understanding of a well-established framework — that UK GDPR Article
5(1)(e) requires data be kept no longer than necessary for the purpose, that Article 5(2) requires
the controller to demonstrate it, and that **no specific period is prescribed** for any of these
document types. That is stated in the analysis so whoever reads the sources knows what they are
looking for. **It is not advice, and the sources are what count.**

### Needed

| For | Source |
|---|---|
| The framework, and most periods | ICO *Guide to UK GDPR → Principles → Storage limitation* |
| Whether limitation periods anchor several entries | Limitation Act 1980 s.5 — **and confirmation that we rely on defending a claim as a purpose** |
| Transcript, degree, English certificate | The university's / QA HE's own published records-retention requirement |
| The three minors entries | ICO guidance on children's personal data; Age Appropriate Design Code |
| Consent records specifically | UK GDPR Article 7(1) — demonstrating consent |
| Whether an appropriate policy document is required | DPA 2018 Schedule 1 |
| Financial evidence, when a route needs it | GOV.UK Student visa financial evidence guidance |

One correction worth flagging: **Home Office sponsor record-keeping duties are the university's, not
ours.** Inheriting their period because it is written down somewhere would be adopting an obligation
that is not ours — and keeping data longer than necessary for *our* purpose is the breach, not the
safe option.

---

## 4 · Decisions that genuinely need you

Only three. Everything else follows.

### 4.1 · Name the person who will determine the retention periods

The single biggest unblocker. Twelve questions, one owner, and the system then does the rest.

Most efficient order once named:

1. **Is "defending a legal claim" a purpose we rely on?** One legal question that moves most of the
   table — it decides whether limitation periods anchor several entries, and the periods get much
   longer or much shorter accordingly.
2. **Ask QA HE what they require us to retain** — one extra paragraph in the sandbox email you are
   already sending.
3. **Take advice on the three children's-data entries.** Genuinely conflicting principles:
   minimisation says hold a child's data for less time, Article 7(1) says hold the consent record
   for longer. I do not know which wins and will not pretend to.

### 4.2 · Confirm the DPA 2018 Schedule 1 question is in scope

If any of these documents are handled as **special category** — a reference mentioning a disability,
a medical reason for a deferred entry — an appropriate policy document may be required *before* the
processing. This sits with the ADR-0022 lawful-basis determinations. I have flagged it rather than
answered it.

### 4.3 · One ordering, if you disagree with it

The authentication approaches are now ranked, and you named the first and the last: passwordless
first, a generated ephemeral credential last. I placed two in between — *the student types their own
password* and *the portal emails them its own* — both above the generated one, because under both we
hold nothing at all.

I am recording that as derived from your principle rather than dictated by you. If the ordering is
wrong, [ADR-0020 §2](./decisions/0020-the-account-belongs-to-the-student.md) is the paragraph to
argue with. Nothing else about authentication needs your approval; the rest is settled and built.

---

## 5 · The exact minimum for the first controlled real run

Stopping before submission. Nothing here is optional.

### Must exist before the run

| # | | Status |
|---|---|---|
| 1 | Real discovery output for Ulster Birmingham | ⛔ you run it |
| 2 | Blueprint reviewed by a specialist → `reviewed` | ⛔ needs 1 |
| 3 | Mapping set authored **and reviewed by a second person** | ⛔ needs 2 |
| 4 | Bedrock credentials + four model IDs set | ⛔ yours |
| 5 | Retention schedule v1 with a policy for **every document the run will touch** | ⛔ §4.1 |
| 6 | Lawful-basis determination registered for `disclose_document_to_institution` | ⛔ needs a named determiner |
| 7 | A sandbox account, or a consenting applicant with written informed consent | ⛔ yours |
| 8 | A named specialist watching, able to stop the run | ⛔ yours |
| 9 | The applicant present or reachable, for MFA/OTP and to approve the content | ⛔ yours |
| 10 | **Your explicit approval at that point** | ⛔ |

### Must be true during the run

- The applicant's **own** email is the account's address, and stays the official contact
- Any temporary credential expires and is destroyed at handover
- Nothing bypasses MFA, CAPTCHA, email verification or account-ownership controls
- Every document upload carries a `DisclosureAuthorisation` naming the document, its content hash,
  the destination and the purpose
- The run **stops** at `ready_to_submit`

### Must happen after

- The account is handed back: they set their own password via the portal's own reset flow, and
  confirm they can sign in. **The case cannot conclude until this is done.**

### One step I would insist on, before any of it

**Replay the captured real portal and run the whole chain against it offline.** It costs nothing, is
repeatable, and is where every mismatch between the fixture and the real portal will surface — on a
laptop rather than in a real admissions system. Everything is already in place for it; it becomes a
data exercise the moment discovery output arrives.

---

## 6 · What I did not assume

Said plainly, because your instruction was to not assume in order to keep moving:

- **No retention period.** Not one, not even a plausible-looking default.
- **No Bedrock model.** The config has no default and throws with the list of what is missing.
- **No portal behaviour.** The Ulster blueprint remains unverified hearsay, and
  `checkExecutable` refuses it.
- **No lawful basis.** The register can miss, and a missing determination throws.
- **No claim that the authentication model fits the real portal.** It is recorded as a model, with
  four things discovery might find that would change it.
