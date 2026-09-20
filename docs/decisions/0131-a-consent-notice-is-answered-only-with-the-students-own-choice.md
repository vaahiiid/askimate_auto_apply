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

## Amended — P167, 2026-09-19: the limit of option 2, and the condition under which a path is not a dismissal

**The limit, recorded as option 2's and not as Sheffield's.** The mechanism this ADR built
assumes a notice whose choices are each one press: a choice is an id, a label, a meaning and one
locator; the runner presses the chosen button and presses sign-in at once; a notice with one
honourable choice cannot be authored, because two choices is the floor. Some notices are not like
that. Sheffield's, as Vahid read it on 2026-09-19, offers *Accept all cookies* and *Settings* — a
second surface nobody has read — and no refusal in words. Authored as it stands, a student who
chose *Settings* would have the runner open the panel, press sign-in into it, fail, spend the
password and count a failure against ADR-0120's two; the parser would not have stopped it. So:
**option 2 as built cannot express *accept all, or a settings panel nobody has read*.** Vahid:
*"'It cannot' is the answer I wanted and the one it would have been easiest to stretch. Record
it as a limit of option 2, not as a defect of Sheffield."*

**The condition under which a path through a panel is a choice, in his words:**

> *"Yes, if every button on the path is named in the entry and quoted to the student, and if the
> path is fixed rather than discovered at run time. What I refused was the runner learning to
> click things away. A named sequence, reviewed and signed, is not that."*

Not built. What it would be, when and if the panel read allows it: a choice whose locator becomes
a fixed list of buttons, each with its own words, all signed content, the student asked in the
panel's words as well as the notice's; the runner presses the sequence and nothing else, and a
button on the path that is not on the page stops the sign-in rather than searching for another.

**Two shapes on the table, his order.** Shape 1 — the named path — first, on the condition that
the Settings panel offers a refusal in words with a save button; he does the panel read from a
fresh profile with the cookie cleared, Settings pressed and nothing else, structure and words, no
values. Shape 2 — *accept all, or do not apply through us on this portal* — stays available and
is not ruled out: *"it may be the true one. But it costs a student the system entirely, so I want
to know shape 1 is unavailable before I take it."*

## Amended — P168, 2026-09-19: shape 1 is refused by the panel itself; the refusal, if there is one, is a state

**The panel read, by Vahid, on his own account.** A fresh profile, the cookie cleared, the banner
up, *Settings* pressed and nothing else. Three findings kill shape 1, and none of them is about
Sheffield being careless:

- **There is no save button.** The panel's only buttons are `#ccc-recommended-settings`
  ("Accept all cookies") and `#ccc-close` ("Close Cookie Control"). A named path that ends in a
  save cannot be authored where there is nothing to save with.
- **The three category toggles cannot be named.** They are three identical
  `input.checkbox-toggle-input` with no `id`, no `name` and no label text of their own. An entry
  cannot say *the analytics toggle*, and position is not a name (ADR-0109's rule, in a new place).
- **`#ccc-close` is not excluded by P166's rule, and must not be recorded as if it were.** P166
  refuses a control with no words; this one has words — *Close Cookie Control*. Its words name an
  **action** and not the **consequence it records**, which is a different defect and is stated
  here as its own, so the record does not rest on a rule that does not reach it.

So **shape 1 does not exist on this portal**, and it is not written.

**What the panel wrote by being opened.** Before the press there was no CookieControl cookie.
After *Settings* and nothing else there was one: `optionalCookies: {}` — empty — with
`interactedWith: true`, a consent date and a 90-day expiry. Opening the panel records that the
notice was met, and records no acceptance of anything. Vahid: *"If closing the panel leaves it
that way, then the honest refusal on this portal is not a button at all: it is that the default
state, once the notice has been interacted with, accepts nothing."* He declined to assume it.

**What would settle it, and the shape of the answer.** The reads can refute it; only a press can
confirm it. Two reads can kill it without touching anything — the toggles' `checked` state while
the panel stands open, and the page's own `CookieControl.load({…})` configuration, where each
optional category's `initialState` is either `off` (the empty record is a refusal) or `on` (the
empty record is a not-yet-written acceptance, and *Close* would commit it). If both reads leave it
open, one press of *Close* decides between four outcomes: the record stays empty (a durable
refusal); the record names each category as refused (a stronger, explicit refusal); any category
turns true (*Close* accepts, and shape 2 stands); or the record is cleared, the overlay stays, or
the banner returns on reload (nothing durable, and shape 2 stands).

**A measured fact that bears on every shape.** The capture of 2026-09-18, taken on a fresh profile
with no consent cookie at all, records the page loading Hotjar, Yandex Metrika with webvisor,
TikTok, LinkedIn, Meta and DoubleClick — **before anything was consented to**. Whatever "accept
nothing" turns out to record, on this portal it is a preference stated after those have already
loaded once. If the system ever offers it, the student is told that in those terms, because
offering a refusal that the page has already outrun would be the same fabrication ADR-0131
refused in options 5 and 6.

**Shape 3, proposed by the agent on 2026-09-19 and NOT decided: the refusal is a state we verify,
not a button we trust.** The entry names a fixed path of controls that have words — open
*Settings*, press *Close Cookie Control* — both quoted to the student; the student is asked to
accept all, or to accept nothing beyond what the site needs; and after the path the runner
**reads the consent record back** and checks it is the state the student chose, stopping for a
person if it is not. It meets Vahid's condition — every button named and quoted, the path fixed,
nothing discovered at run time — and it does not need the buttons' words to carry the consequence,
because the consequence is measured rather than promised. **Its cost, which is his to weigh:** the
"accept nothing" option is not one the notice offers in the notice's words. It is a state we
produce and verify, described in ours. That is a step away from this ADR's promise, and whether
it is an honest step or a stretched one is his to say, not the agent's.

## Corrected — P169, 2026-09-20: the six trackers were on an ACCEPTED profile, not an unconsented one

The amendment above says the capture of 2026-09-18 shows Hotjar, Yandex Metrika with webvisor,
TikTok, LinkedIn, Meta and DoubleClick loading *"before anything was consented to"*. **That is
wrong, and it was the agent's inference, not a measurement.** It rested on the capture's README
calling the profile fresh. Vahid, who owns the account, says the profile's CookieControl cookie
held every category accepted — which is also why that read found no notice on the page at all.

His own reads of 2026-09-19 measure the opposite and settle it. With the consent record empty,
the page loads **Google Tag Manager only**: no Hotjar, no Yandex, no TikTok, no LinkedIn, no Meta,
no DoubleClick. **Consent gates them, and an empty record is not decorative.** The six were seen
because that profile had accepted, and the claim that they load unconsented is withdrawn.

Two things follow rather than one. The first is a correction of fact, above. The second is that
the capture's README describes a **fresh** profile, and a genuinely cookie-fresh profile would
have been shown the notice. That description does not hold for the consent cookie, and the
capture's README says so beside it now.

What survives, and is the honesty condition this ADR carries forward: **Google Tag Manager runs
before any choice is made.** So "accept nothing beyond what the site needs" is true about what
follows the choice and false about what already ran, and the student is told that in the
sentence, not in a note.

## Amended — P170, 2026-09-20: shape 3 built — the refusal is a state we verify, not a button we trust

Vahid's reads of 2026-09-19 settled it, and the first outcome of the four was the one that held:
opening the Settings panel writes the record with nothing accepted, closing it leaves that
standing, the overlay goes, and the notice does not return on reload. His words: *"Shape 3 is
live."* And, on what makes a sequence a choice: *"yes, if every button on the path is named in
the entry and quoted to the student, and if the path is fixed rather than discovered at run
time."*

**What the reads also settled, against P168's withdrawn claim.** With the consent record empty
the page loads **Google Tag Manager only** — not Hotjar, Yandex, TikTok, LinkedIn, Meta or
DoubleClick. Consent gates them; an empty record is not decorative.

### What is built

- **A choice is a path.** `ConsentChoice.path` is one or more `ConsentStep`s, each with the
  control's own words and its locator. A one-press choice is a path of one. Every step's label
  must carry words, so P166's rule now reaches one level in. The runner presses the path in
  order and nothing else: a step that is not on the page **stops the sign-in** rather than
  sending it looking for another way through.
- **The press is not the evidence.** `ConsentChoice.verify` names the cookie the portal keeps its
  record in and the clauses that must hold in it afterwards — a key path, whether the key must be
  **present**, and optionally the **exact value** it must hold. Never truthiness: a library that
  writes `"revoked"` writes a truthy string. The runner reads the record back and compares.
- **Disagreement stops everything.** A clause that does not hold, or a record that cannot be read
  at all, ends the sign-in with the new failure `consent_not_recorded` — **before** the sign-in
  button is pressed a second time. Not counted against ADR-0120's two: the login form was never
  answered. The student is told plainly, including that the password they typed went into the
  form before the press and is spent, and a person is asked, because what failed is the entry's
  own account of what the portal does.
- **What crosses to the runner** is still keys, locators and flags. The notice's words, the
  buttons' words and the clauses' meanings stay in the plane; four compile-time constraints hold
  that line, and a test asserts none of those strings appear on the wire.
- **The student's question carries both halves.** `describeConsentChoice` quotes every control on
  every path, and says what already ran before they were asked — in the sentence, per his
  condition: *"something has already loaded before you chose, and this stops what comes after."*
  `ConsentBanner.beforeAnyChoice` is **required**, so a reviewer who has not measured it cannot
  author a notice at all.

### The two things he asked to be recorded with it

1. **The configuration was unreadable and the finding rests on one press.** The page carries no
   inline `CookieControl.load({…})` to read, the vendor's library is refused by this
   environment's network policy, and what *Close* records was therefore established by **one
   observed press, on one account, on one day**. If Sheffield changes what that control does,
   nothing in the reading would notice — which is precisely why the read-back is the mechanism
   rather than the button's word.
2. **The refusal is true about what follows and false about what already ran.** The tag manager
   loads before the student is asked. The question says so.

### Proved on a fixture in Sheffield's shape

The fixture portal now has the two-press panel and writes a JSON record. A second fixture,
`loginConsentBanner: "settings-records-everything"`, is the portal whose two presses read as a
refusal and **record an acceptance** — the case no button's words could ever disclose. The runner
stops on it with `consent_not_recorded` and never signs in. Red first, measured: with the
read-back disabled, that test signs in.

### Not written: the Sheffield entry

The entry's `authentication.consent` is still empty, and this is the draft it would carry, for
Vahid to check and sign (ADR-0057 — a reviewed entry is signed content, and no agent signs one):

```
words:           "Your cookie choices … Use 'Settings' to manage your preferences"  (the notice's own text)
beforeAnyChoice: "the site's tag manager has already loaded before you are asked"
choices:
  accept  "Accept all cookies"  — the site may also measure how you use it and show you adverts elsewhere
          path:   "Accept all cookies"        → #ccc-notify-accept
          verify: CookieControl · interactedWith present, optionalCookies.analytics present
  refuse  "Only what the site needs" — nothing beyond what the site needs is stored after your choice
          path:   "Settings"                  → #ccc-settings (as the panel read names it)
                  "Close Cookie Control"      → #ccc-close
          verify: CookieControl · interactedWith present, optionalCookies.{functional,analytics,marketing} absent
```

The close control with no words, `#ccc-notify-dismiss`, appears nowhere in it, and the parser
would refuse it if it did.
