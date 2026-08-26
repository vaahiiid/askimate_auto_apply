# Route Discovery — Ulster University Birmingham, MSc International Business, Sept 2026

**Target:** Ulster University · Birmingham campus · MSc International Business · 2026-09
**Discovery date:** 2026-08-26
**Status:** ⚠️ **ROUTE HYPOTHESIS — NOT VERIFIED.** No primary source was reachable. See §4.
**Authorised by:** Vahid, 2026-08-26 — discovery and inspection only, no submission.

---

## 1. The headline finding

**Applications for the Birmingham campus almost certainly do NOT go through Ulster University's
own admissions system.**

Vahid's instruction — *"Record the actual route and provenance rather than assuming it from the
university website"* — turns out to be the decisive call on this target. Assuming the obvious route
would have pointed the build at the wrong platform:

| | System | Evidence |
|---|---|---|
| **Assumed route** (wrong) | `srssb.ulster.ac.uk/PROD/bwskalog.P_DispChoices` | Ulster's own portal. The `bwsk*` path is **Ellucian Banner** Student Web. |
| **Actual route** (hypothesis) | `apply.qahighereducation.com/s/login/` | QA Higher Education's portal. The `/s/` path is the **Salesforce Experience Cloud** convention. |

These are two entirely different platforms. A blueprint built against Banner would not have
survived first contact with the Birmingham application.

## 2. Why the route is different

Ulster University Birmingham is a **branch campus**, not a satellite of Belfast:

> Programmes at the London and Birmingham branch campuses are **validated by Ulster University and
> taught by QA Higher Education**.

So the awarding body and the admitting body are different organisations, and admissions run on the
teaching partner's systems.

**Campus:** 5th Floor, Centre City, 5–7 Hill Street, Birmingham, B5 4UA.

## 3. Route candidates, ranked

| # | Route | Platform | Status |
|---|---|---|---|
| 1 | `apply.qahighereducation.com` | Salesforce Experience Cloud *(inferred from URL shape)* | **Most likely primary.** Unverified. |
| 2 | QA Higher Education direct application form | unknown | Referenced but not located. Unverified. |
| 3 | Ulster's own Banner portal | Ellucian Banner | **Probably not applicable** to Birmingham. |
| 4 | Agent aggregators — ApplyBoard, IDP, ApplyZones, Canam, Student Connect | various | Third-party agent routes, not the official one. Out of scope for now. |

### Why the Salesforce signal matters beyond this target

If route 1 holds, it is **strategically significant for Phase 7**. Salesforce Experience Cloud is
used by a large number of UK institutions, and its portals share a common DOM and navigation
structure. A `SalesforceExperienceCloudAdapter` could then generalise across many universities
rather than one.

That is exactly the "which parts should become reusable abstractions" question — but it is
**premature to act on**, per Vahid's instruction not to generalise early. It is recorded as a
hypothesis to test *after* this specific application is understood end to end, not before.

## 4. ⚠️ Provenance — read this before relying on anything above

**No primary source was reachable from this environment.** Every attempt to fetch
`ulster.ac.uk`, `qa.com`, `qahighereducation.com` or `postgraduatesearch.com` returned
`EGRESS_BLOCKED` from the organisation's network egress proxy. Per the proxy's own guidance, a 403
is a policy denial to be reported rather than worked around.

So everything here comes from **search-result summaries and URL patterns** — the weakest evidence
class this system recognises. Under ADR-0009 this does not even reach `official_only`:

| Requirement | Status | Note |
|---|---|---|
| Application route is `apply.qahighereducation.com` | `unverified` | URL seen in search results; page never loaded |
| Portal platform is Salesforce Experience Cloud | `unverified` | Inferred from the `/s/login/` path convention alone |
| Birmingham is a QA-taught branch campus | `unverified` | Consistent across several independent sources |
| IELTS 6.0, no band below 5.5 | `unverified` | Third-party aggregator, not the institution |
| **"Applicants must be 18 at course start"** | `unverified` | Third-party aggregator. **Directly relevant to ADR-0011/0013 — verify first.** |
| Required documents: transcripts, certified translations, English test | `unverified` | Third-party aggregator |

**None of this may inform an application decision** in its current state. The evidence bar in
ADR-0009 exists precisely so that material like this cannot quietly become fact, and it is doing
its job here.

### Sources consulted (search summaries only — none of these pages was loaded)

- `qahighereducation.com/partner-institutions/ulster-university/`
- `apply.qahighereducation.com/s/login/`
- `srssb.ulster.ac.uk/PROD/bwskalog.P_DispChoices`
- `ulster.ac.uk/study/postgraduate/apply`, `ulster.ac.uk/global/apply`
- `canamgroup.com`, `postgraduatesearch.com`, `studylink.com`, `applyboard.com`, `idp.com`

## 5. What is needed to finish this

Live discovery requires network egress to at minimum:

```
apply.qahighereducation.com
qahighereducation.com
www.ulster.ac.uk
```

Two ways forward, for Vahid to choose — see the Phase 3 report.

## 6. Scope boundary — reaffirmed

Nothing here involved submitting an application, creating an account, or entering data anywhere.
No consequential action was taken against any real system. Per Vahid's instruction, submission
requires a further explicit approval, and the browser runtime built in this phase is
**structurally incapable of submitting in discovery mode** — see `apps/browser-runner`.
