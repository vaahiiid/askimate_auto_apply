# Decision sheet — holding the student's portal password

**For:** Vahid · **Raised:** 2026-09-22, by him · **Status:** open, undecided, unbuilt
**Because:** the product intent is that the student does everything through our chat. Today they
type their university password into the secure box **once per attempt** — he typed six across ten —
because the vault is deliberately unable to remember it.

His framing: *"'We never keep it' was our decision, not an external rule."* True. It is
**ADR-0020 §1**, his words, 2026-08-26:

> *"AskiMate should never become the long-term credential holder for a student's university
> account."*

So this sheet is about revisiting one of his own decisions, not about working round somebody else's.

---

## What exists today, from the code

| | Where | What it guarantees |
|---|---|---|
| **No plaintext at rest** | `packages/secrets/src/vault.ts`, ADR-0034 | AES-256-GCM, data key from KMS, ciphertext in Redis with `save ""`, `appendonly no`, TTL with a **hard 5-minute ceiling** checked twice, in two files, deliberately not sharing a constant |
| **No read API** | same | `use(callback)` hands plaintext to a callback and returns the callback's result. No getter. *"A vault with a `get` is a vault whose value ends up in a variable, and a variable ends up in a log line"* |
| **Two independent compromises** | same | The cache holds ciphertext **and a wrapped key**. Reading the cache yields nothing without KMS; holding KMS yields nothing without the cache |
| **Single use, bound** | `packages/secrets/src/handle.ts` | The handle is bound to a case **and** a host; `secret_consumed`, `secret_expired`, `secret_cancelled` are terminal, with nothing leading out |
| **Not operator-retrievable** | ADR-0020 §2a, the field-allowlist logger, `check-boundaries` | *"Never log it… make it retrievable by an AskiMate operator"* is refused structurally, not by policy |
| **The typing surface** | the cross-origin secure box, ADR-0032/0033 | Plaintext never enters the conversation plane |

## What does not exist

- Any durable store for a credential. By design.
- Any way to use one secret twice. By design (`secret_consumed` is terminal).
- Any way for a student to revoke something we hold, because we hold nothing.
- Any DPIA entry for storing an authentication credential.

---

## The shape proposed, if the answer is yes

Not "turn off the TTL". The guarantees above are worth keeping almost all of.

1. **Durable ciphertext, not cached ciphertext.** A `case_credentials` row in Postgres, one per
   case. The envelope is unchanged: AES-256-GCM, data key from KMS, ciphertext and wrapped key
   stored, plaintext never assigned to anything outliving one stack frame. The two-compromise
   property survives as **database plus KMS**.
2. **A per-case data key, destroyed at conclusion.** Crypto-shredding. When the case concludes — or
   the moment the student says so — the key is destroyed and the ciphertext becomes unreadable by
   anyone, including us. This is what makes *"we destroyed it"* a provable act rather than a
   `DELETE` somebody has to trust, and it is the piece that makes a durable hold honest.
3. **Keep the callback-only rule, and extend the structural guard.** `check-boundaries` gains a rule
   that the credential store may not grow a getter; the field-allowlist logger's deny set gains its
   columns.
4. **Replace single-use with counted use.** `secret_consumed` cannot stay terminal. What replaces it:
   **used only by this case, only on the bound host, and every use recorded and readable by the
   student** — so the student can see, in the same place they see everything else, that it was used
   four times and when.
5. **Revocation is one path, not two.** The student's *"forget my password"* and the case's
   conclusion are the same act on the same key.

**What this trades.** It keeps no-read-API, two-independent-compromises and operator-unreachable
exactly. It trades **"nothing at rest"** for **"nothing readable after the case ends"**, and
**"single use"** for **"counted use, bound to one case and one host"**.

---

## The question this sheet exists to ask, and it is not the DPIA

His instruction, and the reason this section is here rather than in an appendix:

> *"say what we do when the portal's own terms forbid sharing a password. That clause is
> near-universal and you named it yourself. If it is there, holding the credential is not a DPIA
> question, it is a question about whether the student can honestly agree to it."*

He is right, and it changes the order of the analysis. **If Sheffield's terms say the student must
not disclose their password to anyone, then:**

- The student cannot consent their way out of it. Consent governs what *we* may do with their data;
  it does not release them from an agreement they made with the university. Our lawful basis being
  sound would not make their disclosure permitted.
- **The disclosure has already happened**, at the moment they type it into our box — which is true
  today, on the current design, and has been true for all ten attempts. Holding it does not create
  that problem; it extends its duration and makes it durable. That distinction is worth being precise
  about rather than comfortable about: we are not proposing a new category of act, we are proposing
  to keep doing an existing one for longer.
- The honest positions, if the clause is there, are:
  - **(i) Do not hold it, and accept the per-attempt cost** — today's answer, with the cost now
    measured at six passwords across ten attempts.
  - **(ii) Hold it, and tell the student plainly that their university's terms say not to share it,
    so that agreeing is informed rather than uninformed.** Defensible only if the sentence is in the
    consent, in those words, and not in a policy page.
  - **(iii) Change route.** On an **agent portal** there is no student credential at all — see
    [`the-agent-portal-possibility.md`](./the-agent-portal-possibility.md). If that route exists,
    this whole sheet may be moot.
  - **(iv) Ask the university.** An approved-agent relationship or a written permission makes the
    clause not apply to us. That is a business act, not an engineering one.

**What must be read before deciding:** the clause itself. Sheffield's terms of use and the account
registration page's tick-box text. It is in his 0a/0b errand already.

**My position, stated because he asked for a shape and not a survey:** if the clause is there, (ii)
alone is not enough for a real student, because we would be asking them to break an agreement with
the institution they are applying to, in order to save them typing. (i) is honest and cheap. (iii)
is better than both if the route exists. I would not build the hold until that read comes back.

---

## What else changes, if yes

**ADRs changed (not added):**

| ADR | What changes |
|---|---|
| **0020 §1** | *"never become the long-term credential holder"* — the decision being revisited. The crux |
| **0020 §2a** | For accounts we create, the password is **generated**, never chosen. *"Chosen once by the student in our chat"* reverses that, and it needs its own answer: who chooses the password for an account we create? |
| **0034** | The five-minute ceiling no longer governs this secret. The ceiling stays for the request-scoped path |
| **0101 A2** | The five-minute in-memory browser session stays and stops forcing a re-ask. His *"tell me with the measurement"* condition becomes moot rather than breached |
| **0101 B** | `portal_sign_in` through the secure box narrows from *"we don't have it"* to *"the one we hold was refused"*. **His phishing-normalisation argument is served by this**, not damaged: asking becomes rare, which is what made routine asking dangerous |

**Added:** one ADR for the held-credential shape.
**Unchanged:** the secure box itself, the disclosure gates, the transmission gate, the authorisation
content hash, the mandatory-review categories.

**Inside this item, not beside it:** **blocker 31** — the runner signs in with the profile's
`contact.email` rather than the account's own e-mail. Harmless while a person hands over; load-bearing
the moment a held credential is used unattended.

**The DPIA**, once the terms question is settled: a new processing operation (storage of an
authentication credential), retention tied to case conclusion rather than a clock, a risk class that
reaches the student's university account rather than our record, a different breach-notification
calculus, and a necessity argument the four B2 determinations (ADR-0087) never contemplated.

---

## Cost

Sheet: written. Build, if yes: **2–3 phases, 10–14 hours** — migration and store, per-case key,
crypto-shred, revoke path, counted use, consent wording, boundary and logger guards, blocker 31,
DPIA update.

## What I need from you

1. **The terms clause** — does Sheffield's say the password must not be shared? That decides the
   order of everything above.
2. **Which of (i)–(iv)**, given what the clause says.
3. If yes: **who chooses the password for an account we create** — the student, or generated as
   ADR-0020 §2a has it today.
4. Whether **counted use, readable by the student** is the right replacement for single use, or
   whether you want a use limit as well.
