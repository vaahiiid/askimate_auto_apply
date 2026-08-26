# ADR-0024 — A controlled inspection mode, because Salesforce renders over POST

**Status:** **Accepted** — Vahid's authorisation, 2026-08-26
**Supersedes nothing.** [ADR-0014](./0014-discovery-cannot-submit.md) is unchanged and still governs
discovery.

## The problem

Salesforce Experience Cloud delivers its interface over POST. Every component a Lightning page needs
is fetched by posting an action batch to `/s/sfsites/aura`.

Discovery blocks POST by method. So the Phase 3 capture of the real Ulster/QA portal is 164 KB of
shell whose entire visible text is *"Loading × Sorry to interrupt CSS Error Refresh"* — no form, no
inputs, one of only two pages in a 45-page run with zero fields.

**Read-only-by-method can never see this portal.** Not that run, not a better-configured one. The
choice was between never inspecting a Salesforce portal, and permitting exactly the traffic that
draws one.

## The decision

A **separate mode**, not a flag on the existing one.

Vahid: *"Do not merely weaken the existing safety guard globally. Build a separate
capability/mode with explicit allow-lists and hard safety boundaries."*

`PlaywrightDiscoverySession` is untouched and still refuses POST by method. Choosing inspection
means naming `PlaywrightInspectionSession`. A boolean would have left every discovery run one
argument away from permitting POST.

## The four boundaries

| | Boundary | Rule |
|---|---|---|
| 1 | **Method** | GET/HEAD/OPTIONS as before. POST only to the render endpoint. **PUT, PATCH and DELETE are refused unconditionally** — no allow-list, no configuration, no exception. |
| 2 | **Endpoint** | A POST reaches exactly `/s/sfsites/aura` on an allow-listed host. A POST anywhere else is refused *even on that host*: `/services/apply/submitApplication` is not a render. |
| 3 | **Action** | Aura batches named actions into one POST. Each is judged. Unknown descriptors are **refused** and recorded. Any consequential pattern anywhere in the decoded body refuses the **whole batch** — Aura executes a batch together, and permitting the safe half is not something the protocol offers. |
| 4 | **Capability** | The session has no `fill`, `click`, `upload` or `submit`. Unchanged from discovery, and the one boundary that does not depend on getting a regex right. |

Navigation carries its own allow-list, checked on every frame navigation. The network guard governs
subresources; it would wave through `window.location = "/s/application/submit-confirm"` as an
ordinary GET to an allow-listed host.

## The rule doing the real work: `cacheable`

`ApexAction.execute` runs arbitrary server-side Apex. Names prove nothing —
`PageController.getSettings` can do anything `ApplicationController.createApplication` can.

Salesforce's own platform contract is the lever: a method declared `@AuraEnabled(cacheable=true)`
**cannot perform DML**; the platform refuses it at runtime. The client marks such calls
`cacheable: true`.

**So Apex is permitted only when marked cacheable.** That is a property the server enforces, not a
heuristic about naming. Non-cacheable Apex is refused, `cacheable` merely *absent* is refused
(unknown fails closed like everything else), and the run reports what it refused so a partial render
is visible rather than silent.

If a portal will not render without non-cacheable Apex, that is a finding for a human — not
something the guard concedes.

## Proven, not asserted

`inspection.test.ts` runs a real Chromium against a hostile fixture that attempts, on page load and
unprompted: application creation, saving applicant data, submission, file upload, self-navigation to
a consequential endpoint, non-cacheable Apex with an innocuous name, and PUT/PATCH/DELETE.

**The tests assert on what reached the server**, not on what the guard returned. A guard that
returns the right verdict but fails to abort passes a unit test and fails these.

Two tests carry the weight:

- **"lets the interface RENDER"** — without it, every other test is satisfied by a mode that blocks
  everything, which is what discovery already does.
- **"lets EXACTLY ONE kind of write through"** — of everything the page attempted, only the render
  batch landed.

### Three bugs the fixture caught

1. **The allow-list was written in the wrong form.** Aura names an action two ways: a query summary
   (`?r=4&applauncher.LoginForm.getForgotPasswordUrl=1`, which is what the Phase 3 capture recorded)
   and a full descriptor in the body
   (`serviceComponent://applauncher.LoginFormController/ACTION$getForgotPasswordUrl`). Written
   against the only shape I had seen, the list refused every real rendering call.
   `normaliseDescriptor` folds one onto the other.
2. **URL-encoding defeated the body scan.** `"saveRecord"` arrives as `%22saveRecord%22`, and
   `\bsave` finds no word boundary after `%22` because `2` is a word character. The scan silently
   matched nothing at all. Caught by a test asserting a hidden `saveRecord` payload was refused.
3. **A self-redirecting page blanks the capture.** Aborting a navigation leaves Chromium on its own
   error page with an empty DOM. Real portals redirect themselves; the runner therefore captures
   HTML as soon as the render settles.

## What this does not authorise

No account creation. No sign-in. No typing, clicking, uploading, payment, declaration or submission.
No CAPTCHA, MFA or OTP handling of any kind. No exploitation of any weakness.

The objective is to understand a normal application workflow well enough to automate it
legitimately, and inspection is how a Salesforce portal's interface becomes readable at all.
