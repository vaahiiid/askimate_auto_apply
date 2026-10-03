# ADR-0153 — A mapping row states an identity, not a resemblance

**Status:** Accepted · decided by Vahid, 2026-10-03, in his own words · applied by review; enforced mechanically nowhere yet

## Context

His own Master's met the signed Sheffield maps. His profile said *"Azad University"*; Sheffield's
institution list, searched for *Azad*, returned thirty-six entries, among them `UNI6950 Azad
University` and `UNI30764 Islamic Azad University` — his. The obvious fix was a row: *"Azad
University" → UNI30764*. It was pointed out (P281) that a mapping row is not a correction to one
student's answer: the entry is signed once and read for every student, and that row would send
every student who says *Azad University* — exactly the label of a different entry — to a different
institution than the one they named.

## Decision

In his words: *"A mapping row is a rule about every student, and I was treating it as a correction
to my own answer. 'Azad University → UNI30764' would quietly send every student who says 'Azad
University' to a different institution than the one they named. That is the closest-match rule we
refuse, written into the catalogue by hand. Record that as a rule in its own right: a mapping row
states an identity, not a resemblance. If a student's word and a portal's label differ, the fix is
the student's answer, not a row that equates them."*

So:

1. **A row says the student's value and the form's entry are the same thing** — for every student
   who could give that value. A row that says they are alike, or that one student meant the other,
   is refused at review.
2. **Where the student's word and the portal's label differ, the student's answer is what
   changes** — corrected by the student, in the interview, in their own words. His own case:
   *"I correct my answer to 'Islamic Azad University'. My degree is from Islamic Azad University
   and 'Azad' was my shorthand, not the institution's name."* The row is then exact.
3. **The same holds for an award title and a subject.** His Master's: *"MSc is on the list and my
   certificate says Master's in International Business, which is an MSc. I choose MSc. No new row
   needed."* — his answer becomes the form's label, and the existing row maps it.

## Consequences

- **ADR-0142** defines the award title as the title printed on the certificate. An answer
  corrected to the form's category (*MSc* for *Master's in International Business*) holds the
  category, not the printed title. Recorded there as a known consequence, not settled here.
- **Not enforced by a check.** Identity across vocabularies is a judgement — *Iranian* → `IR` is an
  identity, and its key is not the entry's label — so no general check can tell identity from
  resemblance. One narrow check is possible and not built: for a typeahead, where ADR-0109 already
  records the text each value reads as, a row whose key is not the recorded text of the value it
  names could be refused; it would have refused *"Azad University" → UNI30764*.
- **The interview cannot yet offer a portal's list** (blocker 25, option B), so "the fix is the
  student's answer" is today a correction the student makes by retyping — which is how he makes it.
