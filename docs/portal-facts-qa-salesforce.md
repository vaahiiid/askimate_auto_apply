# Confirmed portal facts — QA Higher Education (Salesforce Experience Cloud)

**Source:** controlled inspection run `insp-ulster-birmingham-msc-ib-2026-09-2026-08-26T17-11-48-973Z`
**Entry point:** `apply.qahighereducation.com/s/login/SelfRegister?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ`
(Birmingham · MSc International Business · September 2026)

Every line below is quoted from captured markup or read from a screenshot of the rendered page.
Nothing here is inferred.

---

## 1 · Account creation

| | |
|---|---|
| **The applicant creates the account with their own email** | The registration form asks for `Email` and `Confirm Email`, both required. No AskiMate address is involved at any point. |
| **The applicant chooses the password** | Two required password fields, `Password` and `Confirm Password`, on the registration form itself. The portal does not issue one. |
| **A welcome email follows** | Verbatim: *"Once your account is created we will send you a welcome email. Check any junk/spam folders if you do not receive anything in your email inbox."* |

### The registration form, as rendered

Ten controls, **nine required** — matching the nine asterisks in `001-page-1.png` exactly.

| Control | Type | Required | Locator |
|---|---|---|---|
| First Name | text | ● | `[data-id="firstName"]` |
| Last Name | text | ● | `[data-id="lastName"]` |
| Email | text | ● | `[data-id="email"]` |
| Confirm Email | text | ● | `[data-id="confirmEmail"]` |
| Date of Birth | text (datepicker) | ● | `[data-id="dateOfBirth"]` |
| Password | password | ● | `[data-id="password"]` |
| Confirm Password | password | ● | `[data-id="confirmPassword"]` |
| What type of Applicant do you consider yourself as? | combobox | ● | no `data-id` |
| How have you heard about us? | combobox | ● | no `data-id` |
| Would like to receive marketing content? | checkbox group | ○ **optional** | no `data-id` |

**Password policy**, stated on the page: *"Make sure to include at least: 8 characters · 1 number ·
1 symbol."*

**Date of Birth carries a range constraint**: *"Select a date before 31 Dec 2009."* On the capture
date that is a **minimum age of roughly 16**, not 18. It does not confirm the unverified "must be 18
at course start" claim, and it is the portal's own rule rather than the course's.

**Applicant type is explained on the page**, and the student will need to answer it:
*"Domestic/Home: Home applicants are those living in the UK or Republic of Ireland, and EU nationals
with settled status in the UK… International: Nationals outside the UK who come to study at
institutions in England and most probably require a visa."*

**Create Account is disabled** until the form is valid.

---

## 2 · Password reset

Verbatim from the Forgot Password page:

> *"To reset your password, we'll need the email address associated with your account. This will be
> your personal email address. We'll send password reset instructions to the email."*

One field (`Password Reset Email`) and a `Reset Password` button.

This is the handback route in ADR-0020, confirmed on the portal itself: the reset goes to the
student's own address, which AskiMate never reads.

---

## 3 · Can the account be created without AskiMate learning the password?

**Asked directly, and the answer from the captured evidence is: not by any mechanism this portal
offers.**

What was looked for, and what was found:

| Mechanism | Evidence |
|---|---|
| Passwordless / magic link | **None.** No such option on the login page or the registration page. |
| Emailed one-time code | **None observed.** |
| SSO / social sign-in | **None observed.** |
| Portal-issued credential | **No.** The registration form requires the applicant to set a password; the portal sends a *welcome* email, not a credential. |
| Registration without a password | **No.** Both password fields are required, and Create Account stays disabled. |

**Consequence for ADR-0020's preference order.** Rank 1 (passwordless) and rank 3 (portal-issued)
are unavailable on this portal. That leaves:

- **Rank 2 — `student_chosen`:** the student is present and types their own password. **We never
  learn it.** This is available and it is what the portal is built for.
- **Rank 4 — `generated_ephemeral`:** only if the student cannot be present.

**So the preferred approach here is `student_chosen`**, and it needs the student at their keyboard
for the ninety seconds registration takes. That is a scheduling constraint, not an architectural
one, and it is strictly better than any arrangement in which we hold a secret.

Two caveats, stated because they are not yet evidence:

1. The login page's own options were **not fully rendered** — see §4. A passwordless option that
   appears only after a failed sign-in, or behind an "other ways to sign in" control, would not have
   shown up. Ruling it out entirely needs a look at the login page with its components complete.
2. Whether email verification is required *before* the application form becomes reachable is still
   unobserved. The welcome email is stated; a blocking verification step is not.

---

## 4 · What is still unobserved, and why

**Dropdown options.** All three option-bearing controls (applicant type, how-you-heard, marketing)
have **empty containers in the DOM**. Their options load when the control is opened, and the
observer will not open them — that is a click. The values are needed for the mapping set, so they
have to come from a session permitted to interact.

**Everything behind sign-in.** The application form itself, its fields, validation, document
uploads, conditional logic and submission step. None of it is reachable without an account.

**The login page rendered incompletely.** Both the login and Forgot Password captures carry
*"Failing descriptor: {markup://force:hostConfig}"* — the visible symptom of the guard refusing
component traffic. See the note below.

---

## 6 · A correction to the inspection run itself

The run reported **"0 refused batches"** while in fact refusing **all 17** Aura POSTs.

The cause: the consequential-pattern scan ran over the entire request body, and an Aura POST carries
`aura.pageURI` — the address of the page being drawn. On `/s/login/SelfRegister` that made
`\bselfRegister\b` and `\blogin\b` match **the URL of the very page we came to inspect**, so every
render batch was refused. The refusal returned before the actions were parsed, so nothing appeared
in the report.

**The registration form rendered anyway**, from Experience Cloud's bootstrap payload — which is why
the mistake nearly went unnoticed. What actually fixed the Phase 3 "Loading… CSS Error" capture was
not the POST permission at all: it was **waiting for the page to finish rendering** (`settle()`),
which discovery never did.

Both are fixed: the scan now runs over the parsed actions rather than the raw body, and every
refusal carries its per-action verdicts. A re-run should show permitted render traffic and a
complete login page.


---

## 7 · Run of 2026-08-26T17:45:55Z — the three refused actions, resolved

### The required-count discrepancy: **9 is correct**

That run reported **7 required**; the screenshot shows **9**. The screenshot is right.

The run used the observer as it stood *before* the asterisk-detection fix. Replaying the run's own
captured `pages/001.html` through the current observer gives **10 controls, 9 required** — Date of
Birth and the applicant-type combobox recovered, marketing correctly optional. **No code change was
needed; the run predated the fix.** The markup in that capture is byte-identical to the committed
fixture for the fields concerned.

### Why the login page was empty

The page says so itself, in an error string in `pages/002.html`:

> `Callback() [Cannot read properties of undefined (reading 'isUsernamePasswordEnabled')]`
> `Callback failed: apex://applauncher.LoginFormController/ACTION$…`

The component asked whether username/password sign-in is enabled, got nothing because the guard
refused the call, and crashed. Hence "ACCESS YOUR ACCOUNT" with no fields.

### What the portal actually sent, from the run's Playwright trace

| | Batch (query string, verbatim) | Outcome |
|---|---|---|
| r=0 | `hostConfig.HostConfig.getConfigData` | allowed |
| r=3 | `LoginForm.getForgotPasswordUrl` + `LoginForm.getSelfRegistrationUrl` + `LoginForm.getUsernamePasswordSelfRegEnabled` | **blocked** |
| r=5 | `LoginForm.getLoginRightFrameUrl` | allowed, **200** |
| r=2/4 | `RichText.getParsedRichTextValue` | allowed once, blocked once |
| r=2/4/7 | `aura.ApexAction.execute` (non-cacheable) | **blocked** |
| r=3/6 | `aura.ApexAction.execute` (cacheable) | allowed |

The three login getters arrive as **one batch**. Aura executes a batch as a unit, so refusing two
killed the third as well — including one already on the allow-list.

### The two now permitted, and the evidence

`applauncher.LoginForm.getSelfRegistrationUrl` · `applauncher.LoginForm.getUsernamePasswordSelfRegEnabled`

1. **The server declares the sibling read-only.** `getLoginRightFrameUrl`, same controller, was
   permitted in the same run and answered:
   `{"state":"SUCCESS","returnValue":null,"error":[],"storable":true}`.
   **`storable: true`** is Aura's own marker that a response may be cached and replayed without
   contacting the server — a property the framework applies only to side-effect-free reads. Same
   class of guarantee as `cacheable` for Apex, and asserted by the server.
2. **Batched with an already-permitted read** (`getForgotPasswordUrl`) as one page-configuration
   fetch.
3. **`applauncher` is a Salesforce-managed namespace** — the platform's own Identity login
   component, not customer Apex.
4. **They run at component init, before any user input exists.** There is no form yet, so nothing
   to persist.
5. **Behavioural match.** The UI that disappeared is exactly what these two values gate: whether
   username/password self-registration is on, and where the self-registration page lives. The error
   above names the first of them directly.

Also added: `RichText.getParsedRichTextValue`, the rich-text render call the portal batches on both
pages, which was inconsistently matched before.

**Named individually. Not a namespace wildcard and not a rule about `get` prefixes** — a regression
test asserts `applauncher.LoginForm.login` is still refused.

### What stays blocked, and why

**Non-cacheable `aura.ApexAction.execute` — three calls, still refused.**

It cannot be proven safe because it cannot even be *identified*: the trace records only
`aura.ApexAction.execute=1`, with no class or method. "The page renders better with it" is not
evidence about what it does. Custom Apex that is not marked cacheable may perform DML by definition
of the platform contract.

The guard now records the Apex **class and method** (names only, never parameter values) in every
verdict, so the next run will name what it refused and that refusal can actually be reviewed.


---

## 8 · Run of 2026-08-26T18:10 — login rendered, and the discrepancy explained

### Login: CONFIRMED email + password

The two allow-listed getters worked. The batch that failed before now returns **200**, and the page
renders:

| Control | Type | Required |
|---|---|---|
| Email | text | ● |
| Password | password | ● |
| **Log in** | button | — |

Links: *"Forgot your password?"* and *"Don't have an account? Sign up here"*, both
`href="javascript:void(0)"` — client-side routing rather than plain hrefs.

**No passwordless mechanism anywhere.** With the login form now fully rendered, no magic link, no
emailed code, no SSO and no "other ways to sign in". This is the first time that absence is
meaningful, because previously the component had not drawn at all.

### The 7-vs-9 discrepancy: native shadow DOM, and a correction to §4

**9 is correct.** Replaying this run's own `pages/001.html` through the current observer gives
**10 controls, 9 required**.

The cause was not stale code — both fixes were in the branch the run used. It was this:

> **The live portal uses real, open shadow roots.** Its trace records
> `["template", {"__playwright_shadow_root_": "open"}, …]` around every `lightning-input`.

An earlier note in this document said Experience Cloud ran LWC in *synthetic* shadow mode, on the
evidence that `pages/*.html` showed the markup in the light DOM. **That was wrong, and wrong for an
instructive reason: `page.content()` flattens shadow content when it serialises**, so a saved
capture cannot tell you which mode the live page used. The observer therefore passed every test
against the capture while getting the live portal wrong, and nothing in the artefacts revealed it.

`Element.parentElement` stops at a shadow boundary. The required-marker is a `<p>*</p>` sitting
beside the field's wrapper **in the light DOM**, and the control is **inside** the shadow root — so
the walk could never reach it. Live consequences: Date of Birth and the applicant-type combobox
reported `not_observed`, the marketing checkbox group lost its label (its `<legend>` is in its own
shadow root), and the `data-id` locator vanished (`closest` does not cross boundaries either).

Fixed by making every ancestor walk cross into the shadow host, scoping by-id lookups to the node's
own root, and counting controls **through** shadow roots. Two further bugs surfaced only once the
walk could cross:

- `querySelectorAll` does not pierce a shadow root either, so a field container reported **zero**
  controls — the opposite of true — and both the marker test and the climb's stop condition read it
  as empty.
- A field container's own `textContent` is exactly `"*"`, because inputs contribute no text. An
  unmarked field inherited the asterisk of the field above it. A marker must now contain no controls
  at all.

A second fixture (`fixtures/lwc-shadow/`) builds the same structure with real `attachShadow`, and
asserts the fixture actually uses shadow DOM — otherwise it would silently re-test the flattened
case.

### Still blocked: two custom Apex methods

| Class.method | Verdict |
|---|---|
| `CommunityAuthController.getResidenceOptions` | **BLOCKED** |
| `CommunityLoginRedirectController.getRedirectUrl` | **BLOCKED** |

Taking `getResidenceOptions` on its own terms, against the seven questions asked of it:

| | Question | Answer from evidence |
|---|---|---|
| 1 | What data does it read or return? | **Unknown.** The call was blocked, so there is no response to inspect. |
| 2 | Does it only retrieve residence/country options? | **Unproven.** Its name says so and the applicant-type combobox is empty without it — but a name is not evidence about server behaviour, and that is the reasoning this guard exists to refuse. |
| 3 | Does it create, update or persist anything? | **Unknown, and the platform permits it to.** Not marked `cacheable`, so Salesforce imposes no DML restriction. |
| 4 | Does the request contain student data? | **Not yet recorded.** Playwright resource-snapshots do not store request bodies. The guard now records the Apex **argument keys** (never values), so the next run answers this. |
| 5 | Is the response purely reference data? | **Unknown** — no response. |
| 6 | Does Salesforce provide evidence establishing it read-only? | **No.** The two positive signals the platform offers are `cacheable: true` on the request and `storable: true` on the response. This call has neither: it is explicitly not cacheable, and it produced no response. |
| 7 | Is it needed for the application form, or only registration/login? | **Registration only, on the evidence so far.** It fires on the SelfRegister page and populates the applicant-type (residence/fee-status) dropdown. Nothing is known about the application form. |

**So it stays blocked.** The developer's choice *not* to mark it cacheable is itself weak evidence
against it being a pure reference lookup — `cacheable=true` is the obvious annotation for one,
because it enables client-side caching. And `CommunityAuthController` is an authentication class,
where session-touching work would not be surprising.

**What would settle it**, none of which is available from the current artefacts:

1. QA Higher Education confirming the method is a read-only picklist lookup, or marking it
   `cacheable`.
2. The argument keys, from the next run — if it takes no arguments, it cannot carry student data,
   which narrows the risk considerably without closing it.
3. Observing it in a context where it is already permitted — circular here, and not a route to take.

**Practical consequence:** the applicant-type dropdown's options remain unobserved. They are needed
for the mapping set, and they are already on the list of things that require a session permitted to
click (§4). This does not block the blueprint, the field list, or anything before account creation.
