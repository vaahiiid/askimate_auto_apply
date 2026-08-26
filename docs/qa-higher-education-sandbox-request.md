# QA Higher Education — sandbox / UAT access request

**Purpose:** obtain a non-production applicant environment for QA Higher Education's admissions
portal, so AskiMate's application automation can be tested end to end **without creating anything in
the live admissions system**.

**Target:** Ulster University Birmingham · MSc International Business · September 2026 —
delivered by QA Higher Education, applications through `apply.qahighereducation.com`.

---

## Part 1 — What we need from them

Ask for all of it; expect to get some of it. Ordered by how much each one unblocks.

### Essential

| # | What | Why it matters |
|---|---|---|
| 1 | **A non-production applicant account** on a UAT/sandbox instance of the application portal | Everything else is negotiable. Without this the only alternative is a real applicant's real account. |
| 2 | **The URL of that instance** | It will not be `apply.qahighereducation.com`. We need the exact host so it can be added to the run's allow-list — the automation refuses to touch anything not explicitly listed. |
| 3 | **Confirmation that submissions in it are non-consequential** — that a submitted test application creates no record anyone acts on, and reaches no admissions team | This is the sentence that makes the eventual live-run test safe. Get it in writing. |
| 4 | **Whether the sandbox carries the September 2026 MSc International Business course**, or a representative equivalent | A sandbox with a different course still proves the automation; it does not prove *this* application. |

### Important

| # | What | Why it matters |
|---|---|---|
| 5 | **Whether the sandbox uses the same portal platform and version as production** | If the sandbox is an older build, the blueprint we build against it will drift from production, and we need to know that in advance rather than discover it. |
| 6 | **How authentication works** — MFA, OTP, email verification, and whether any of it is disabled in the sandbox | We never bypass MFA or OTP; they are deliberate handoffs to the applicant. But knowing which are present tells us where the automation will pause. |
| 7 | **Whether test data is periodically reset**, and on what cycle | Determines whether a draft survives between test runs. |
| 8 | **A named technical contact** | So a failure has somewhere to go that is not a general enquiries inbox. |

### Useful

| # | What | Why it matters |
|---|---|---|
| 9 | Any **rate limits or acceptable-use conditions** for automated access | We will honour them. We would rather be told than guess. |
| 10 | Whether they would like us to **identify our traffic** with a specific user agent | Ours already identifies itself honestly as AskiMate automation; we can use whatever string helps them see it in their logs. |
| 11 | Whether **document upload** works in the sandbox | Uploads are part of the flow; a sandbox that silently discards them tests less than it appears to. |

### What we are *not* asking for

Worth saying explicitly, because it heads off the obvious concern:

- **No access to production.** Not read access, not an API key, nothing.
- **No applicant data.** We bring our own, or the applicant brings theirs.
- **No credentials to anything shared.** A single-purpose account we can rotate.

---

## Part 2 — The request, ready to send

> Adjust the sender details and the relationship framing — you know how Universitio's relationship
> with QA is best described, and that framing matters more than anything else in this email.

---

**Subject:** Request for UAT / sandbox applicant access — application automation testing

Hello [Name],

I'm writing on behalf of Universitio regarding the applications we submit to QA Higher Education
programmes, in particular Ulster University Birmingham's MSc International Business.

We are building an internal tool that helps our students complete their applications more
accurately — it works through the information a student gives us, checks it with them, and prepares
the application for them to review and approve before anything is submitted. Our aim is fewer
incomplete and incorrect applications reaching your admissions team, not more volume.

To test it properly we need somewhere that is **not** your live admissions system. Creating test
applicant records in production is not something we're willing to do, so I'd like to ask whether QA
Higher Education can provide access to a **UAT or sandbox instance** of the application portal.

Specifically, we would need:

1. A non-production applicant account on a test instance
2. The URL of that instance
3. Written confirmation that applications submitted there are non-consequential and do not reach
   your admissions team
4. Ideally, the September 2026 MSc International Business course present in that environment (or a
   representative equivalent)

It would also help to know:

- whether the sandbox runs the same portal platform and version as production
- how authentication is configured there (MFA / OTP / email verification), and whether any of it
  differs from production
- whether test data is reset periodically, and on what cycle
- whether document upload is functional in that environment
- any rate limits or acceptable-use conditions you would like us to work within
- a named technical contact for the environment

On how we would use it, so there are no surprises:

- Our tooling identifies itself honestly in its user agent. It does not disguise itself as an
  ordinary browser, and we're happy to use a specific identifier if that helps you see it in your
  logs.
- It does not bypass MFA, OTP, CAPTCHA, payment, or any legal declaration. Each of those is passed
  to the applicant to complete themselves, by design.
- We would keep activity to a low, agreed volume and stop immediately on request.
- We are not asking for any access to your production environment or to any applicant data.

If a sandbox isn't available, could you let us know? We would then look at a different approach with
a consenting applicant, and I would rather discuss that with you than proceed without telling you.

Happy to talk this through on a call, or to complete whatever access request process you use.

Many thanks,

[Name]
[Role], Universitio
[Contact details]

---

## Part 3 — If they say no

The fallback is **a genuinely consenting real applicant** who actually intends to apply to this
course: their account, their data, their application, with informed consent, stopping before submit
and showing them exactly what would be sent. Nothing fictitious is created, and the preview is
genuinely useful to them rather than merely a test.

What would need to be in place first:

- **Written informed consent** covering what the system will do, what data it will hold, and that a
  draft application will exist in the university's system in their name.
- **The applicant present**, or reachable, during the run — for MFA, OTP, and to approve the content.
- **A named specialist watching**, able to stop the run.
- **The applicant's own email** as the application's contact address, as product rule 7 requires.

**What we do not do:** create a fabricated applicant account in the live admissions system. It
sounds safer than using a real applicant and is the opposite — it means a fake person's record in a
live admissions system, likely a terms-of-service breach, and damaging to the QA relationship if
noticed. The word "test" does not change what it is.
