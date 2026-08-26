# Phase 3 — Discovery Report

**Run:** `disc-ulster-birmingham-msc-ib-2026-09-2026-08-26T16-13-48-262Z`
**Target:** Ulster University · MSc International Business · Birmingham · September 2026
**Capture:** 45 pages, 0 failed, 864 blocked requests
**Every claim below cites the captured file it came from.** Where the capture cannot answer, it says so.

---

## A · Confirmed from the capture

### A1 · The course page

`https://qa.ulster.ac.uk/course/msc-international-business/` — **page 039**, confirmed by its own
`rel="canonical"`.

Note the host: **`qa.ulster.ac.uk`**, QA Higher Education's Ulster branch-campus site. Not
`www.ulster.ac.uk`, which is Ulster's own institution site and a different route entirely.

### A2 · The application entry point — exact URL

From page 039, inside the block headed `APPLY FOR SEPTEMBER 2026`, as a table row:

```html
<tr>
<td><strong>Birmingham</strong></td>
<td><a href="https://apply.qahighereducation.com/s/login/SelfRegister?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ"
       class="btn btn-default btn-lg btn btn-green" target="_blank">
  MSc International Business – Apply for September</a></td>
</tr>
```

**`https://apply.qahighereducation.com/s/login/SelfRegister?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ`**

The campus is bound to the Salesforce product ID in `startURL`, one per campus, in document order
within the September block:

| Campus | Product ID | Byte offset of label → link |
|---|---|---|
| London | `01tTv00000F73QpIAJ` | 339 → 417 |
| **Birmingham** | **`01tTv00000F73QqIAJ`** | **667 → 749** |
| Manchester | `01tTv00000F73QrIAJ` | 999 → 1081 |

January 2027: London is `COMING SOON`; Birmingham `01tTv00000JNcUxIAL`, Manchester
`01tTv00000JNcUyIAL`.

**This is the single most important fact in the report and it is structural, not inferred** — a
`<td>` label immediately followed by its `<td>` link.

### A3 · The portal says an account is required, in its own words

Page 039, verbatim:

> *"You will be directed to a QA Higher Education portal to set up an account and complete your
> application."*

The URL path `/s/login/SelfRegister` is Salesforce Experience Cloud's standard self-registration
route. Consistent with the sentence above, but the page itself was never rendered — see C.

### A4 · Entry requirements, verbatim from page 039

> *"Entry requirements: A 2:2 honours degree, or equivalent"*
> *"English language requirements: IELTS 6.0 with no component less than 5.5, or equivalent"*

Also stated: Full-time · 1 year · Coursework only · Locations London, Birmingham, Manchester ·
Start dates January, May, September.

**This confirms the target's IELTS claim** (`IELTS 6.0 with no band below 5.5`) against the
institution's own page.

**The application deadline is a placeholder.** The page reads *"Application deadline: Next
application deadline"* — literally that string, no date.

### A5 · Login is a stock Salesforce LoginForm, and it has a forgot-password link

The login page HTML carries no form at all, but the blocked Aura calls name the components the page
tried to load (`run.json`):

```
POST /s/sfsites/aura?r=4&applauncher.LoginForm.getForgotPasswordUrl=1&applauncher.LoginForm…
POST /s/sfsites/aura?r=6&applauncher.LoginForm.getLoginRightFrameUrl=1
```

`applauncher.LoginForm` is Salesforce's standard login component. **A component asking for its
forgot-password URL is direct evidence that a forgot-password link is present on that page.**

### A6 · No application submission or account creation occurred

**Confirmed, three independent ways:**

1. **Only 16 of the 864 blocked requests were state-changing** (POST). Every one is
   `apply.qahighereducation.com/s/sfsites/aura` — Aura framework RPC. The remaining **848 were
   GETs**, blocked by the host allow-list, not by method: `use.typekit.net` (183),
   `cdn.jsdelivr.net` (122), `googletagmanager` (80), `frontify` CDN (76), `google.com` (51),
   `clarity.ms` (20).
2. The 16 POSTs are 8 distinct calls repeated across two visits to the login URL. Named components:
   `HostConfig.getConfigData`, `Component.reportFailedAction`, `forceCommunity-richText`,
   `LoginForm.getForgotPasswordUrl`, `LoginForm.getLoginRightFrameUrl`, `ApexAction.execute` ×2.
   **None creates a record, registers a user, or submits an application.**
3. **All of them were blocked and never sent.** The runner cannot type, click or submit
   (ADR-0014).

**A correction to my own earlier summary:** I described these as "864 blocked state-changing
requests". That was wrong — 848 were ordinary GETs for fonts, CDN assets and analytics on
off-allow-list hosts. Only 16 were state-changing.

### A7 · CAPTCHA is on the marketing site, on the enquiry forms

47 blocked requests to `google.com/recaptcha/api.js`, and 177 `captcha` signals across the QA and
Ulster **WordPress marketing pages**. Each sits with a WPForms enquiry form
(`<input type="hidden" name="wpforms[recaptcha]">` on page 039).

**Nothing tells us whether the applicant portal has a CAPTCHA** — that page never rendered.

---

## B · Likely but unverified

| Claim | Why it is likely | Why it is not confirmed |
|---|---|---|
| The applicant sets their own password at sign-up | `/s/login/SelfRegister` is Salesforce's self-registration route, and page 039 says "set up an account" | The page never rendered; no password field was observed anywhere in the capture |
| Birmingham September 2026 is open for applications | A live apply button exists, versus `COMING SOON` for Birmingham January 2027 | "Open" is a portal state, not a page state |
| `01tTv00000F73QqIAJ` pre-selects the Birmingham intake | `startURL` targets that product record | Requires following the link into the portal |
| Documents needed are passport, transcripts/certificates, CV | Stated on the **London Metropolitan** page (038) for a QA-run course on the same portal | **This is a different university.** See E. |

---

## C · Not discoverable without authentication

**The whole applicant portal.** Page 001 (`apply.qahighereducation.com/s/login/`) is 164 KB of
Salesforce Lightning shell whose entire visible text is:

> `Login Template Title Loading × Sorry to interrupt CSS Error Refresh`

Zero `<form>`, zero `<input>`. It is one of only **two pages in the whole capture with no fields**,
and the other is the same URL visited twice.

**The cause is structural, and it is the most important technical finding here.**

> Salesforce Experience Cloud delivers its UI **over POST** to `/s/sfsites/aura`. Read-only
> discovery blocks POST by design. **Therefore read-only discovery can never capture this portal's
> interface** — not this run, not a better-configured run, not ever.

This is not a bug in the run and not something to work around. It means:

- **All 8 ADR-0020 authentication questions remain unobserved**, including question 7 — A5 shows a
  forgot-password link exists, but not that it works or where it sends.
- **The application form, its fields, validations, dropdown options, document uploads, conditional
  logic, submission step and any MFA/CAPTCHA are all unobserved.**
- `chooseApproach` will refuse rather than default to a password. That is correct and unchanged.

---

## D · The actual application journey

```
qa.ulster.ac.uk/course/msc-international-business/        ← page 039, the course page
        │  "APPLY FOR SEPTEMBER 2026" table, Birmingham row
        ▼
apply.qahighereducation.com/s/login/SelfRegister
        ?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ      ← NOT CAPTURED (Lightning, POST-rendered)
        ▼
   [ everything from here is unobserved ]
```

**Two pages, and the boundary is exactly at the portal.** Everything before it is WordPress and
fully captured; everything at or after it is Lightning and entirely invisible to read-only
discovery.

Supporting pages on `qa.ulster.ac.uk` are linked from 039 but **were not captured** (outside the
crawl's link patterns): `/apply/`, `/apply/entry-requirements/`, `/apply/important-dates/`,
`/apply/dates-and-fees/`, `/apply/finance/`, `/apply/make-a-payment/`, `/enquire/`. The
important-dates page is where the real application deadline probably lives, given A4.

---

## E · Irrelevant / unrelated captured pages

**551 fields were found. Zero are application fields.** Breakdown by name:

| Count | What | Verdict |
|---|---|---|
| 272 | `wpforms[fields][…]` | WordPress **enquiry/lead** forms — marketing, not application |
| ~215 | `f.School_u`, `aoi[]`, `start[]`, `level[]`, `partners[]`, `city[]`, `f.Campus_u`, … | **Course-search facet filters** |
| 64 | `s`, `search`, `query` | **Site search boxes** |
| **0** | `type="file"` | **No document upload anywhere in the capture** |

The MSc IB course page's own 22 fields are 1 site-search box + 21 enquiry-form fields: name, email,
telephone, *"Do you require a student visa"*, subject interest, preferred location, nationality,
three marketing-consent checkboxes, and hidden UTM tracking. **Mapping any of these to a student's
application data would be a serious error** — they generate a sales lead, not an application.

Unrelated pages captured:

- **`qa.londonmet.ac.uk/courses/msc-international-business-management/`** (page 038) — London
  Metropolitan University. The *only* page in the capture describing document requirements. **Do
  not treat its list as Ulster's.**
- 6 QA news posts (Swansea, Manchester campus, London Met, Northumbria) — 5 of 6 concern other
  universities.
- 6 `extended-msc-international-business*` variants and 5 other MSc IB variants — different courses.
- ~20 `www.ulster.ac.uk` postgraduate pages — Ulster's **own** institution route (`portal.ulster.ac.uk`),
  not the Birmingham branch campus.

---

## F · Security and safety findings

| | Finding | Severity |
|---|---|---|
| 1 | **No write reached the portal.** 16 POSTs attempted, all Aura framework RPC, all blocked. No account created, nothing submitted. | ✅ as designed |
| 2 | **`qahighereducation.com/how-to-apply/` is a soft 404** — the page returns "Page not found" content, yet `run.json` records `failed: 0`. **The runner does not detect soft 404s**, so a dead URL looks like a successful capture. | ⚠️ tooling gap |
| 3 | **A UAT host leaks into production pages.** 28 blocked GETs to `qahighereducation-uat.tglserver.net` for `style.css` and `custom-form-wp.js` — the live marketing site references a UAT server for a form script. Worth telling QA HE; not ours to act on. | ⚠️ note |
| 4 | **The observer's signals are noisy on real sites.** 30 `account_creation` signals are all *"page text contains 'register'"* (open-day sign-ups); 32 `submission` signals are mostly `"Search Submit"`. The draft blueprint's `handoffPoints` consequently list `final_submission` for site-search buttons. | ⚠️ do not trust unreviewed |
| 5 | The draft blueprint's `authentication.notes` rests on those weak signals. Its conclusion (`required: true`) happens to be right, for the wrong reason. | ⚠️ |
| 6 | Blueprint `status: "draft"`, `submission: null`. `checkExecutable` refuses it. | ✅ as designed |

---

## G · What we can build now, with no live account

1. **Requirements Service entries for this course** — the 2:2 and IELTS 6.0/5.5 lines are captured
   verbatim with a source URL and hash. This is the official-source channel's input; a specialist
   supplies the curated channel and the gate corroborates them.
2. **Course/campus/intake identity as reviewed data** — the product-ID table (A2) is exactly the
   kind of reviewed constant ADR-0017 requires.
3. **The offline replay harness over the 43 WordPress pages** — real HTML, real reCAPTCHA tags, real
   consent banners. Proves navigation and the read-only guard against a real site.
4. **Soft-404 detection in the runner** (finding F2) — small, and it prevents a dead URL being read
   as evidence.
5. **Signal-quality fixes** (F4) — `"page text contains 'register'"` should not be an
   account-creation signal, and `"Search Submit"` should not be a submission signal.
6. **AskiMate Chat interview integration** — the one item on the live-run checklist that was already
   mine, unblocked by any of this.
7. **Retention determinations and the lawful-basis registration** — still yours, still blocking, and
   entirely independent of the portal.

**What we cannot build:** the mapping set, the field list, the validation rules, the submission
preview for this portal. All need the form, and the form is behind C.

---

## H · The single smallest live action required next

**Open `https://apply.qahighereducation.com/s/login/SelfRegister?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ`
in an ordinary browser and capture what the page shows — without registering.**

That one page load answers, or begins to answer, five of ADR-0020's eight questions: whether the
applicant chooses a password, whether passwordless sign-in is offered, whether a CAPTCHA is present,
what the registration form asks for, and whether email verification is announced up front.

It is not automatable by the current runner (POST-rendered), it creates nothing, and it needs no
account. **Save the page and its DOM; do not submit the form.**

If you would rather this be automated and repeatable, the alternative is a **capture mode that
permits the portal's own Aura GET/POST render traffic while still blocking navigation, typing,
clicking and file selection.** That is a deliberate loosening of ADR-0014 and a decision for you,
not me — see I.

---

## I · Fastest path to the first real end-to-end test

**Do we need a consenting real student?** Not yet — and not for the next two steps.

| Step | Needs an account? | Blocked by |
|---|---|---|
| 1. Capture the SelfRegister page (H) | **No** | Nothing — five minutes |
| 2. Requirements + product-ID table into the KB; replay harness over the 43 pages | **No** | Nothing |
| 3. Capture the portal *after* sign-in: form, fields, uploads, submit step | **Yes** | An account |
| 4. Author + review the mapping set | No (needs step 3's output) | Step 3 |
| 5. Run the chain against the replay, offline | No | Step 4 |
| 6. Live run to Preview/Authorisation, stopping before submit | **Yes** | Steps 4–5, retention, lawful basis, Bedrock |

**Step 3 is the real gate, and it needs exactly one account on that portal.** The choice is yours:

- **A consenting applicant who genuinely intends to apply to Birmingham September 2026.** Their own
  email, their own account, informed written consent, supervised — and it doubles as the first real
  run. Per ADR-0020 the account is theirs and is handed back before the case can close.
- **A QA HE sandbox**, if one ever arrives. Not worth waiting for.

**My recommendation, in order:**

1. **Do H today.** It costs five minutes and materially changes what we know.
2. **In parallel, do G1–G5** — none of it waits on anybody.
3. **Then decide on the ADR-0014 question**: whether discovery may render Lightning portals. Without
   that decision, every future Salesforce portal is invisible to us and every capture is manual.
4. **Then find the consenting applicant.** By then the requirements are curated, the replay works,
   and their session is spent capturing the form rather than debugging our tooling.

The retention determinations and the lawful-basis registration remain blocking for step 6 and are
unaffected by any of the above.
