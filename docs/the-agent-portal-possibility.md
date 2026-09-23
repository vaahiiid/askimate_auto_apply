# The agent-portal possibility — a different product, and probably a better one

**Raised 2026-09-22 by Vahid**, reading the answer on submission: *"if Sheffield has a separate
agent portal with its own agent account, that is a different product and probably a better one — we
would be submitting as Universitio on the student's behalf rather than driving the student's own
account."* Recorded here as a **live possibility**, not a footnote, at his instruction. **Nothing is
built and nothing is decided.**

> **Updated 2026-09-23 — question 1 is answered: the route EXISTS on this portal.** See *What is
> known, and what is not* below. Questions 2 to 5 are unread, and the existence of a login page
> settles none of them.

---

## What it would be

Every route this system has taken so far assumes **one shape**: the student holds an account on the
university's portal, and AskiMate operates that account on their behalf. ADR-0020 is that shape's
charter (*"the account belongs to the student"*); ADR-0110 lets a run start on an account the
student already holds; ADR-0101 governs how a runner is signed into it.

UK universities routinely accept applications from **education agents**, and the usual mechanism is
not an agent driving the applicant's account. It is a **separate portal with the agent's own
account**, where the agent submits on the applicant's behalf as a named representative. Universitio
is an education consultancy. If Sheffield has that route, AskiMate on that route is **not the same
product with a different login** — it is a different relationship, and most of what makes the
current route hard comes from the relationship rather than from the engineering.

---

## What it would change, item by item

| | Today's route | The agent route |
|---|---|---|
| **The credential (item 2)** | Hold the student's university password — the whole sheet, ADR-0020 §1 reopened, a DPIA change, and a clause in the portal's own terms that may forbid it | **The question disappears.** The credential is *ours*, an operational secret for a service account: held in a secret manager, rotated, never the student's, never a personal-data question. This is a solved class of problem |
| **Account creation (item 4)** | Create an account for a student who has none; e-mail verification is a step only they can take | **The question disappears.** There is no student account to create. Whatever identity the applicant needs comes later, from the university, after an offer |
| **Submission (item 5)** | The declaration on the final page is written in the first person; an agent pressing it makes the applicant's declaration for them, and whether that is honest depends on clauses nobody has read | **Honest by construction.** An agent portal exists so that a named agent can submit on an applicant's behalf. The declaration is the agent's to make, which is what the route is for |
| **The consent** | *"We will use your university password to sign in as you"* — a sentence students have been trained by phishing to distrust | *"We will submit your application to Sheffield as your agent"* — the thing students already understand from real agencies |
| **The hard stop** | Unchanged: no live submission without his explicit act | Unchanged |

**Three of the four consequences he listed stop being engineering problems.** That is the reason
this is not a footnote.

---

## What it would mean for the architecture

**Most of the work transfers.** This is the important part, and it is not obvious.

The agent portal is **a different set of pages**, which means a new capture, a new blueprint, a new
mapping set, a new reviewed and signed entry. It does **not** mean new machinery: discovery, the
blueprint schema, the mapping set, `checkUsable`, `planFill`, the preview, the content hash, the
approval registry, the runner's fill / read-back / listing count, the network guard and the
transmission record are all portal-agnostic by design. The investment is in the *shape*, and the
shape holds.

**What changes in the architecture:**

- **ADR-0020 and ADR-0110 are scoped, not overturned.** They govern the applicant-account route,
  which remains the right answer for a portal with no agent route. A second route does not make the
  first wrong.
- **`portalAuthentication` on the entry gains a route dimension** — who the account belongs to.
  Reviewed and signed like everything else, so no one can switch routes without a signature.
- **The secure box's job narrows.** Its reason to exist is keeping a *student's* plaintext out of
  the conversation plane. An operational credential of ours never enters that plane at all, so the
  box is unused on this route — and stays exactly as it is for the other one.
- **The disclosure gates get harder, not easier, in one respect.** Sending a student's documents
  through an agent account means the destination inside the yes (ADR-0075) must name the agent
  relationship, not just the host. A student authorising *"this goes to Sheffield"* is authorising
  something slightly different from *"Universitio sends this to Sheffield as your agent"*, and the
  preview must say which.
- **An agent portal may not need a browser at all.** Several have structured intake — an API, a
  bulk upload, a defined file format. If Sheffield's does, the browser runner is unnecessary on that
  route, which would be a larger change and a better one: no typeahead, no focus theft, no consent
  overlay, no read-back-by-DOM. The ten attempts that cost Run A were all browser problems.

**What gets harder, and is not engineering:**

- **It is a contractual relationship.** Universitio would need to be an approved agent of the
  University of Sheffield — an agency agreement, with commercial terms and obligations. That is a
  business act with a lead time, not a sprint.
- **The data-protection position changes shape.** Acting as a named agent under an agreement is a
  different controller/processor analysis from acting purely on a student's instruction. It is not
  obviously worse and may be clearer, but it is a fresh analysis, not a transfer of the existing one.
- **Student visibility may be worse.** On the student's own account, the student can see their own
  application whenever they like. Through an agent portal they may see nothing until an offer, and
  the product would have to carry that visibility itself. Worth naming as a real downside.

---

## What is known, and what is not (2026-09-23)

**From a site search by Vahid, not from the portal.** Nothing here was read on the application
system itself, and no account of any kind was used.

**Known — the route exists on this portal:**

- `sheffield.ac.uk/postgradapplication/representative…` — *"University Representative Login:
  Student recruitment representatives can sign in here."* A representative login **on the same
  application system**.
- An **Agent Representation Authority Form**.
- A **"Notification of Use of Services of a Recognised Agent"** form.
- **Agent training pages**.
- A **"Representatives in your region"** section, written for students.

So Sheffield runs a representative login on the same application system, and has a **formal agent
process with its own paperwork**. That is question 1 answered, and it is more than question 1 asked
for: the paperwork means the process is defined rather than ad hoc.

**Not known, and NOT to be inferred from the login page's existence** — Vahid's instruction, in his
own words: *"What it requires, whether a representative may submit, and whether it is a separate
portal or the same one under a different login are all unread. Do not infer any of them from the
login page's existence."*

| | Unread |
|---|---|
| What the route **requires** | The Authority Form and the Notification form exist; what they oblige, of whom, and on what terms is unread |
| Whether a representative **may submit** | A login is not a submission right. The declaration on the final page is the thing to read, and it has not been |
| Whether it is a **separate portal or the same one under a different login** | The URL sits under `/postgradapplication/`, which is suggestive and is not evidence. It decides whether the blueprint machinery transfers whole, partly, or not at all |

**And a business fact, not an engineering one.** Vahid: *"we are not an agent, and becoming one is a
business step I will take when I take it."* Nothing here is a route this system can take today.

---

## What would settle the rest

Questions 2 to 5, unchanged. Question 1 is answered above.

The questions that decide it:

1. ~~**Does Sheffield have an agent or representative route at all**, and is it named on the site?~~
   **Answered 2026-09-23: yes**, with its own login and its own paperwork. See above.
2. **Does it cover postgraduate taught direct applications**, or only certain programmes or regions?
3. **Does it require an agency agreement**, and what does becoming an approved agent involve?
4. **Is it a portal, or structured intake?** A portal means the same machinery against new pages; an
   API means a different and smaller build.
5. **What does the applicant declaration look like on that route** — who makes it, and about what?

Likely places: an *agents* or *representatives* section (often under international or partnerships);
the *how to apply* pages; the international office's pages for counsellors.

---

## Status

**Open. The route exists; its terms are unread.**

Vahid, 2026-09-23, closing the question for now: *"Keep the current path — the student's own account
— as what we build. The agent route is a live alternative with real evidence behind it, not a
plan."*

So nothing changes in what is built. The student's own account (ADR-0020, ADR-0101, ADR-0110) stays
the path. What changed today is the **quality of the alternative**: it was a possibility argued from
how UK universities generally work, and it is now a route with a named login and named forms on the
portal this system already targets. That is the difference between a hypothesis and an unread
document.

It still does not block item 1 (the interview), which is the same work on either route — the
registry's fields are the student's facts regardless of who submits them. It would substantially
change items 2, 4 and 5, all of which are unstarted.

The right next act remains a decision sheet weighing the two routes side by side, **after** the
terms are read — and reading them is downstream of a business step that is Vahid's to take.
