# Sheffield PGT — the entry page, read signed out — 2026-09-11

`run.json` and `blueprint.draft.json` are the attached inspection's own output, unedited, from a
second Chrome profile signed in to nothing, on port 9223 (the runbook's signed-out read). Three
URLs, three pages visited, zero failed, three refusals — all `www.googletagmanager.com`, rule
`host`. The first URL, `postgradapplication` without a trailing slash, landed on the trailing-slash
URL; the landing was on the list, so it was read rather than refused, and the same page appears
twice in `visited`.

What Vahid saw on screen, in his words, so it can be checked against the capture: *"registration
and login are the same page, and that page is the entry point. There is no separate registration
URL. New Applicants takes email, password, confirm password, and a Start Application button.
Logged in Before takes email and password, with a Login button and a Forgotten Password link. No
CAPTCHA visible, no magic-link or emailed-code option offered."*

## What the capture shows

`https://www.sheffield.ac.uk/postgradapplication/` — three forms: the site search (`query`,
`btnG`, excluded as before), a **New Applicants** form (`newemail`, `newpassword`,
`newconfirmpassword`, `startApplicationBtn`) and a **Logged in Before** form (`returnemail`,
`returnpass`, `loginBtn`). `forgottenPassword.do` — the search form and one of `email` and
`sendBtn`. Six signals, all `login` or `account_creation`; no `captcha`, no `mfa_or_otp`, no
`email_verification` on any of the three pages. That matches his description.

Two things in the draft are the tool's, not the page's, and are fixed in P91: the three password
inputs came back `inputType: "unknown"` because the converter had no case for `password` — the one
type the schema names so a blueprint can be honest about a credential field; and the three
buttons came back as fields, because the observer excluded only hidden inputs. A re-read would
show `password` twice on the registration form, once on the login form, and no button as a field.

## The eight AUTH questions, from the capture

Answered from what the three pages show and nothing else. *Settled* means the capture answers
it; *cannot* means these pages cannot, whatever anyone recalls.

| | Question | Answer | From |
|---|---|---|---|
| AUTH 1 | Does the applicant choose their own password at account creation? | **Yes — settled.** The New Applicants form asks for a password and its confirmation before *Start Application*. | `newpassword`, `newconfirmpassword` |
| AUTH 2 | Does the portal generate a credential and email it to them? | **No, on this page — settled for the entry.** The registration form takes a password rather than promising one; no page carries an `email_verification` signal or any "we will send your login details" wording. That an email is sent *after* registration is not something an unsubmitted page can show; Vahid's own registration (P84) says none was. | signals, form 2 |
| AUTH 3 | Is there passwordless sign-in — a magic link or emailed code? | **None offered — settled for these pages.** The login form is email and password; the only other route is `forgottenPassword.do`, which takes an email and a *send* button — a reset, not a sign-in. | forms 2, 3, page 3 |
| AUTH 4 | Must the email be verified before the form is reachable? | **Cannot be settled by this page.** Verification happens, if at all, between *Start Application* and the first form page, and nothing was submitted. The read shows no verification wording on the entry page, which is not the same as no verification. Vahid registered and reached the form; whether a verification step stood between is his to state, not this capture's. | — |
| AUTH 5 | Is MFA or a one-time code required, and where? | **Not on these pages — partly settled.** No `mfa_or_otp` signal on registration, login or reset (the P82 heuristic no longer counts a postcode). What happens *after* the login button is pressed was not observed. The eleven signed-in pages (P81) carried none either. | signals |
| AUTH 6 | Is a CAPTCHA present, and where? | **Not on these pages — settled with one caveat.** No CAPTCHA script, iframe, widget or marker on any of the three. The caveat: Google Tag Manager was refused on every page, so a CAPTCHA a tag would inject could not have loaded; on his screen, with tags allowed, Vahid saw none. | signals, `blockedRequests` |
| AUTH 7 | Does 'Forgot password' work, and does the reset reach the account's own address? | **The page exists — the rest cannot be settled.** `forgottenPassword.do` takes an email and a send button. Nothing was sent, so whether it works and where the mail goes are unobserved. | page 3 |
| AUTH 8 | Can control be handed back cleanly? | **Yes — settled by AUTH 1, not by a page.** The password is the student's own, chosen at registration and never held here (ADR-0020, ADR-0101); handover is the design's, and this portal offers nothing that would prevent it. | — |

So: 1, 3, 6 and 8 settled; 2 and 5 settled for what the pages show and open for what happens after
a submit; 4 and 7 not settled by any page that was read, and not inferred.

`portal-authentication.draft.json` beside the curated draft carries these as the eight facts the
reviewed entry records (`ObservedPortalAuthentication`), with `unobserved` where the answer above
is *cannot* — AUTH 4, and AUTH 5 for what follows the login button. **And on those two the
chooser refuses**: `chooseApproach` will not pick an approach while any fact is unobserved,
because *"an unobserved answer is not a 'no' — treating it as one is how the password path wins
by default"* (ADR-0020). The test holds both: the refusal naming exactly those two questions, and
that with both observed as false the same facts choose `student_chosen`. What settles them is not
a page: it is Vahid's own account of registering and signing in — whether a verification step
stood between *Start Application* and the first form page, and whether the login button led to a
code — recorded as his statement the way the password question was; or a run that does both.

## The locators, authored

From this capture, into `../sheffield-pgt-2026-09-10/blueprint.draft.curated.json` (0.2.3):

- `authentication.loginUrl` — `https://www.sheffield.ac.uk/postgradapplication/`
- `authentication.login` — email by id `returnemail`, password by id `returnpass`, submit by name
  `loginBtn`
- a registration page, `page0`, first in the walk, with `newemail`, `newpassword`,
  `newconfirmpassword` (the two password fields typed `password`, all three `required` from the
  form's purpose rather than a captured asterisk) and `startApplicationBtn` as its advance
  control, leading to the first form page after sign-in.

And into the mapping set (0.3.0): `newemail` from the profile's contact e-mail; the two password
fields as `secure_credential` for `portal_account_creation` — the Secure Plane fills them from a
value nothing else holds, which `checkUsable` requires of any `password` field.
