# ADR-0131 — A consent notice on a portal is answered only with the student's own choice: asked in the notice's words, recorded per portal, visible and changeable, never decided for them

**Status:** Accepted · 2026-09-18 · decides blocker 47 with [ADR-0130](./0130-the-point-is-read-at-every-press-not-only-a-failed-one.md) · continues [ADR-0108](./0108-what-the-student-owes-the-portal-is-a-record-on-the-case.md) and [ADR-0110](./0110-a-run-may-start-on-an-account-the-student-already-holds.md) · keeps [ADR-0124](./0124-the-runner-says-what-it-did-in-words-it-is-allowed-to-say.md), [ADR-0127](./0127-the-submit-is-two-waits-with-two-names.md) and [ADR-0129](./0129-the-runner-reads-the-point-at-the-moment-the-press-fails.md) whole
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P165**, the same day, against the fixture; the Sheffield entry waits on a read of its notice.

## Context — a full-viewport backdrop, measured, over the sign-in button

Attempt 1 of Run A's third conversation printed, at the instant its press failed:

```
pending: another element intercepts pointer events; … at the button's point:
div#ccc-overlay (fixed, 1280×720 at 0,0) > input (static, 130×21 at 238,566)
```

Civic CookieControl's backdrop, the whole viewport, over the button: the fifth hypothesis on this
one step and the first measured rather than reasoned. Six ways past it were put to Vahid with
their costs (state doc, blocker 47), ordered by how much each asserts on the student's behalf:
measure at every press; stop and name it; the student decides; a fixed minimal choice; do not
load the consent script; pre-set the consent cookie; push past it.

## Decision — the student decides, and the reasons for the refusals stay on record

> *"Option 0 always, option 2 on top of it. Not 3."*

On the student deciding:

> *"a cookie choice is a choice made on the student's account, in their name, against an
> institution that may one day be asked what they consented to. A system that asks for a yes
> before typing a date of birth cannot decide this one by itself."*

With two conditions:

> *"The choice is per portal and it is durable, but it is not permanent. A student who chose once
> on Sheffield should not be asked again on Sheffield, and should be asked afresh on Manchester.
> And they must be able to see what they chose and change it — not buried, but somewhere they can
> reach."*

> *"the question must be answerable by someone who does not know what a cookie banner is. Not
> 'what is your consent preference' — what the banner actually offers, in the portal's own words
> if they are quotable, with what each means in plain terms. If the honest version of that
> question is three sentences long, it is three sentences."*

On the fixed minimal choice, refused, with the reason kept because it will be proposed again:

> *"'We declined non-essential cookies for you' is still a choice we made. Telling the student
> afterwards is not the same as asking. The convenience is real and the principle is the one this
> whole system is built on."*

Two more refused, with my reasons, which he adopted: pre-setting the consent cookie is **a
fabricated consent record** on the student's account with the university; removing, hiding or
force-pressing through the overlay is **an assertion that a person clicked where a person could
not**. Not loading the consent script at all: agreed not to build.

## What is built

1. **The blueprint records the notice** (`authentication.consent`): its own words, and two or
   more choices, each with the button's label, what choosing it means in plain terms, and where
   the button is. Reviewed and signed like every locator: the canonical form carries it, so a
   changed notice needs a new signature.
2. **The runner presses nothing on it without the student's choice.** A press that another element
   intercepted, on a portal whose blueprint records a notice, with one of the notice's buttons on
   the page, is the notice. With the student's choice carried on the work item the runner presses
   that button and the sign-in once more; without one it reports its own code,
   `consent_banner_met`, which the plane does not count as a failed sign-in — nothing was tried
   against the portal. An obstacle that is not the notice fails as it always did. Keys and
   locators cross to the runner; the notice's words never do.
3. **The question comes before any password.** The plane's next step is `consent_choice`, ahead
   of the password box, so a third password is not spent on the same notice. The student is told
   the notice was met and pressed nothing; then asked, in the notice's own words with what each
   choice means, as many sentences as the honest question takes.
4. **The choice is a decision of the student's** (`consent_choice`, naming the blueprint's key),
   accepted whenever the portal records a notice — before the runner meets it, and again later to
   change it — and refused for a key the notice does not offer. Recorded **per student and
   portal**, durable across runs and cases (migration 0023): not asked again on that portal, asked
   afresh on another. Visible and changeable on the run reading (`consent`) and in the student's
   page, with one button per other choice.
5. **The runner's line says what it did**: the notice met and nothing pressed, or answered with the
   student's recorded choice, then the button pressed — through ADR-0124's vocabulary.

## What this does not decide

The Sheffield entry's notice. Its words and its buttons have never been read: the as-runner read
of 2026-09-18 had no notice on the page, and the runner's lines carry structure only, by rule. The
entry's `authentication.consent` is authored from a read of the notice when it is present — the
attached reader as the runner, with `--covering` — and signed by Vahid. Until then a press the
notice intercepts stops for a person, as attempt 1 did.

## Consequences

- No cookie choice is ever made by this system on a student's account. The one it presses is the
  one they chose, recorded under their name, and they can see and change it.
- A run that meets a notice with no choice on record costs one password: the one spent on the
  press. The question follows before the next is asked for.
- Blocker 47 is closed for the mechanism and open for the Sheffield notice's read.

## Amended — P166, 2026-09-19: a control with no words is never a choice

Vahid read the Sheffield notice from a fresh profile on 2026-09-19, structure and the banner's own
words only, nothing clicked. It offers two buttons with words — *Accept all cookies* and
*Settings* — and a third with none: the close control, `#ccc-notify-dismiss`. What that third
button does is not readable from the page: whether it leaves the overlay up, leaves consent unset
or silently defaults is set by the configuration the page hands the consent library, and that
configuration is not something a student sees. Reading the library from here was refused by the
network policy; the portal is off limits by his rule; so what dismiss does is **not known**, and
the finding, when he makes it on his own account, is a finding and not a dependency.

His rule, in his words, recorded as the rule and not as this portal's case:

> *"A button whose meaning is set by configuration the student cannot see is a button nobody can
> be honestly asked about. Record that as the rule rather than as this portal's case — it will be
> true of the next portal's close control too."*

So: **a control with no words of its own is never a choice on a notice.** The reviewer cannot
quote it, the student cannot be asked about it in the notice's own words, and its meaning can
change without the button changing. Structurally, `readConsentBanner` refuses a choice whose
label is blank — empty or whitespace — with the reason in the refusal, so the next portal's X
cannot be authored as a choice by anyone. The runner was already unable to press it: it presses
only a button the signed entry names.

What this amendment does not decide: the Sheffield entry's consent block. The notice offers no
refusal in words — *accept all*, or *Settings*, a second surface nobody has read — and whether
option 2 as built can express that honestly is answered separately and decided by him.
