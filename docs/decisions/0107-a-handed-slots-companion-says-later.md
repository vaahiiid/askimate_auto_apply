# ADR-0107 — A handed slot's companion says "later": a statement about when, never a claim about the document

**Status:** Accepted · 2026-09-12 · decides blocker 23 · amends 0105 (its companion half), continues 0104 and 0106
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-12. Built in P106.

## Context

ADR-0104 made a repeating page's document slots the student's own act. ADR-0105 handed each
slot's companion radio to the student with the slot. On 2026-09-12 Vahid found on the real
portal that Sheffield's education page records nothing when an evidence radio is unanswered, and
says nothing about it; his repeat of the same entry with every radio answered saved. So the
shape as built produced, on this page, exactly the state that does not save. He asked for the
question to be put up on its own
([the sheet](../decision-sheet-blocker-23-a-companion-the-page-will-not-save-without.md)), with
what each option costs, and answered it.

## Decision

**A.** The runner sets a handed slot's companion to the defer-style option the reviewer names on
the blueprint. His reasoning, which is the reason and not the cost comparison:

> *"'I will upload this later' is not a claim about the document, it is a statement about when.
> We are not saying the student has a certificate, or does not, or will not send one. We are
> saying nothing is being sent in this act. That is true, and it is the only one of the three
> options that is true."*

**The distinction that makes A safe is the one it must never cross**, in his words:

> *"'I will upload later' is ours to say. 'I will not be providing this document' is a claim
> about the student's intent and is not ours to say, ever, on any portal. Enforce that: the
> reviewer-named value for a handed slot must be the defer-style option, and a mapping naming
> the refusal-style one is refused. If a portal offers only 'now' or 'not providing' with
> nothing in between, that is not option A and the page waits for the student."*

**B** is out: *"the education page is the heart of the application and handing all of it back
defeats what the fill is for."* **C** is out: *"a run that ends in 'not recorded' on every
qualification is not a safeguard, it is a system that does not work, reported honestly."*

### Two conditions, his

1. *"The preview must show it before the yes, in the student's words not ours: for each
   qualification, that we are telling Sheffield the certificate and transcript are coming later,
   that the student attaches them themselves, and that the application is not complete until
   they do. If a student authorises this and is surprised later, the preview failed."*
2. *"The deferred state must not be quietly forgotten. A student who authorised 'later' has an
   application with something outstanding."* Raised as its own item — blocker 24 — and not
   folded into this build, as he asked.

## What is built

- **The blueprint names both values.** A slot's companion carries `whenDeferred` (the
  defer-style option, ours to say) and, where the form has one, `whenNotProviding` (the
  refusal-style option, named so it can be refused). The parser refuses the two being one
  option, and either being the attach option.
- **A companion is mapped by nothing.** ADR-0105's admission of a companion handed with its slot
  is withdrawn. The usable-set check refuses any mapping on a companion; when the mapping's value
  is the not-providing option, the refusal says so in his words. A companion follows its slot:
  set with the attach (ADR-0103 gap 4), or to the defer value when the slot is the student's own
  act.
- **A handed slot with no defer value named** is admitted only on a page the plan fills nothing
  on — the page waits for the student — and refused otherwise, naming the fields that would be
  filled. On a repeating page that means the slot handed and the other fields mapped by nothing;
  a handoff on a non-slot field there is refused as before (ADR-0104).
- **The plan** carries, for each handed slot with a defer value, a reviewed-constant instruction
  on the companion — once per entry on a repeating page — marked as the slot's deferral, and the
  slot's handoff names what the portal is told, in the option's own words when the form has them.
  The runner fills it as any constant, and ADR-0106's read-back sees it.
- **The preview**, under each entry, after *You attach yourself:* — *We are telling <institution>
  that your Certificate is coming later. You attach it yourself. The application is not complete
  until you do.* — and the same for the general list. The defer value is inside the content hash:
  a different thing said beside the slot is a different thing to say yes to.
- **The handover** names, beside each document the student attaches themselves, that the
  institution has been told it is coming later and the application is not complete until they
  attach it.
- **The fixture portal** drops a qualification saved with the radio unanswered, silently, as
  Sheffield does; the journey saves two qualifications with *later* on each and reads them
  back. The Sheffield set (0.3.9) no longer hands the six status radios; the draft cannot name
  their defer values until the radios' `value` attributes are read from a copy of the fieldset —
  the capture holds one value three times over.

## Consequences

- On Sheffield's education page a qualification saves again, and the student reads before the
  yes what the portal is told about their certificates and what they owe.
- What the system does with the outstanding state after the handover is blocker 24, open. Today
  the student is told once, at the handover, and nothing records or follows it.
- Nothing here touches the transmission gate, the authorisation content hash's role, or the
  mandatory-review categories; the hash gains a line, it does not lose one.

## What was deliberately not done

- No heuristic on option wording to tell *later* from *not providing*: both are named by the
  reviewer from the page, and the check is on the named values, not on labels.
- No deferral for a slot mapped by nothing: an unmapped slot's companion is left as the form has
  it, and on a page that requires an answer ADR-0106 reads that as *uncertain*. The reviewer
  maps or hands every slot on such a page.
