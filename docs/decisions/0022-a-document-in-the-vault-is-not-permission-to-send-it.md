# ADR-0022 — A document in the vault is not permission to send it

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Depends on:** [ADR-0010](./0010-policy-driven-document-retention.md),
[ADR-0011](./0011-minor-detection-and-the-minor-workflow.md)

## The decision

> *"Do NOT encode 'student consent' as automatically being the legal basis for all processing…
> The system must not upload a document to a university merely because the document exists in the
> vault. The application context, destination, purpose and authorisation must be known before a
> document is transmitted."*

## The failure this closes

The obvious implementation of "attach the passport" is:

```ts
const bytes = await vault.retrieve(documentId);
await session.attach(locator, documentId, bytes);
```

Every one of the four things above is missing from those two lines — silently, and in a way a code
review would not necessarily catch, **because the code looks like it is doing exactly what was
asked**. The document was in the vault. The blueprint said a passport goes here. It went.

So the upload path does not take a document ID. It takes a `DisclosureAuthorisation`, which cannot
be constructed without all four:

| | |
|---|---|
| **What** | the document, by ID **and content hash** — the student authorised *this* passport, not whatever is under that ID later |
| **Where** | the institution and the portal host — "send my transcript to Ulster" is not permission to send it to a different portal in the blueprint |
| **Why** | the application it belongs to, and what the university asked it for |
| **Authority** | a lawful basis determination **and**, where that says so, the student's specific authorisation |

## Lawful basis is recorded, never assumed — and consent is not the default

The shortcut ruled out is `consented: boolean` on a document. It is wrong in **both** directions,
which is why it is worth spelling out:

**Consent is often the wrong basis.** Under UK GDPR consent must be freely given, and a student who
cannot get their application submitted without agreeing has not freely given anything. Contract
(Art. 6(1)(b)) frequently fits the application itself better.

**Consent is often not enough.** A document may carry special-category data; a minor brings their
own conditions; and "the student agreed to us holding it" is a different question from "the student
agreed to us sending it to this university".

So the model is a **determination**: a named person, a date, an Article 6 basis, an Article 9
condition where relevant, whether specific student authorisation is also needed, the reasoning, and
a review date. There is no default and no fallback — `LawfulBasisRegister` can miss, and an activity
with no determination throws. Same shape as the retention schedule, same reason: **absence of a
decision is not permission.**

One check is worth calling out. A determination naming **consent** as its basis while recording that
no student authorisation is needed is refused as self-contradictory. Consent that was never asked
for is not consent, and a record claiming it is worse than no record at all — it looks like
compliance.

## Specific means specific

Where the basis requires authorisation, the text the student saw must **name both the document and
the destination**. "Do you agree to AskiMate helping with your application?" is not authorisation to
send a passport to Ulster.

The request text is rendered deterministically from the disclosure itself, and a test asserts that
the rendered text satisfies the specificity check. The wording and the check cannot drift apart.

## Minors: empty is not none

An empty condition set means **nobody has determined the conditions yet** — which is not the same as
there being none, and the difference decides who gets asked next. `undefined` means the applicant is
not a minor; `[]` blocks (ADR-0011).

## Checked at the moment of transmission, not at intent

`mayTransmit` runs against what is *actually about to be sent*:

- a different document under the same authorisation → refused; an authorisation is not transferable
- **the content hash changed** → refused; the student agreed to one file and this is another
- a different host → refused (subdomains of the authorised host are allowed)
- the student withdrew → refused, immediately

Withdrawal is marked, never deleted. "They authorised it, then withdrew" is exactly the history a
subject access request needs.

## The record

Every transmission produces a `TransmissionRecord` — document ID, content hash, destination,
institution, case, timestamp. IDs and hashes, **never contents** (brief §8), and produced *by* the
act of leaving rather than reconstructed afterwards. "Why did this leave our systems?" has an answer
that does not require inference.

## What is deliberately still open

Vahid: *"The legal basis and any additional consent/authorisation requirements should be determined
and documented before production."*

This ADR builds the **shape** a determination must take and makes processing without one impossible.
It does **not** decide what the determinations are — that is a job for someone with the relevant
competence, and inventing an answer here would be exactly the "universal legal rule" ruled out.

Before production, someone must determine and register, at minimum: storing identity documents,
storing academic documents, disclosing documents to an institution, and whatever a minor's route
adds. The system will refuse to act until they have.

`packages/disclosure` is forbidden from importing the model port at all. Whether a document may be
sent to a university is a legal and factual question with a recorded answer, and a model must have
no way to participate in it.
