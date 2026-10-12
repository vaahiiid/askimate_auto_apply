# Is the profile portal-neutral? (P297)

Vahid, 2026-10-12, in his words ([the message](./run-a/p297-his-decisions-as-sent.txt)):

> *"Profile data must be portal-neutral, so a second university asks only that portal's own
> questions. Confirm whether it already is."*

**Partly.** The way the profile is stored and the way the interview decides what to ask are
portal-neutral. Several of the profile's value sets were cut to Sheffield and to the UK, and two
mechanisms would fail a second portal quietly. The exceptions are listed below, each with where it
was read.

## What is neutral, and how it was measured

- **Stored once per student, never per portal or per application.** The profile holds 34 typed
  keys, one row per (student, key) (`apps/conversation-service/migrations/0003_profile_entries.sql`,
  `packages/profile/src/fields.ts`). No Sheffield option code, no *"Not in list"* and no portal
  label is held as profile data; each portal's codes live in its own mapping set (the ISO code
  `IR` becomes Sheffield's Iran there, not in the profile).
- **What belongs to one form is stored outside the profile.** A choice from a portal's list or
  its escape is kept per application (`entry_choices`, keyed by case); a cookie banner's answer per
  student and portal host; a part a portal demanded on the conversation log.
- **A second portal asks only what the profile lacks.** The interview's worklist is the profile
  keys the portal's mapping requires, less those the profile already holds
  (`packages/orchestrator/src/run.ts`, `requiredFieldsFor`; `packages/profile/src/profile.ts`,
  `missingFields`).

Measured by `pnpm exec tsx scripts/portal-neutral-walk.ts` (deterministic; no model, nothing
written), at P297's commit, over the three portals the repository holds:

```
sheffield: interview worklist on an empty profile 18: …
fixture (Example University) after sheffield: already asked contact.email, identity.date_of_birth, identity.family_name, identity.given_name, identity.nationality; new study.personal_statement
gated (Gated University) after sheffield: already asked contact.email, identity.date_of_birth, identity.family_name, identity.given_name, identity.nationality; new study.personal_statement
```

So after Sheffield, each test portal would ask one key: the personal statement, which Sheffield
does not map. Nothing Sheffield already asked is asked again.

**What that cannot show.** The repository holds one real portal; the two others are test portals
it wrote itself. The walk shows the mechanism, not what another university asks.

## The exceptions

1. **Optional parts a first portal never asked are not asked by a second; the run stops for a
   person instead.** Under Sheffield's part policy the interview never asks a passport's issuing
   country, an address's second line and region, or a job's basis, referee name and role. A later
   portal that requires one of them finds the field already held, so it is not on the worklist;
   the plan refuses with `no_such_part`, and the step function sends every such blocker to a
   specialist (`packages/orchestrator/src/run.ts`, the blocker routing), not to the student.
   Measured with a test portal built in scratch with a required "County / State" box.
2. **The test portals key nationality on demonyms.** Both map `"Iranian"` to their option while
   the interview stores the ISO code `IR` (since P199), so a profile made by the interview is
   refused at nationality on both, and at passport country on the gated one (the walk's last lines
   print it). The tests pass because they feed `"Iranian"` directly. As they stand, they cannot
   carry a test with students of several nationalities.
3. **Several value sets are Sheffield's lists, one for one.** The seven UK-status claims are
   Sheffield's seven boxes; the six UK-study levels are its six options; the five funding stages
   are its own; three residence claims were renamed from its script. Six keys are about the UK
   only (`residence.in_uk_now`, `residence.uk_entry_date`, `residence.always_in_eu`,
   `immigration.previous_uk_visas`, `immigration.uk_status`, `immigration.uk_study`). The values
   are AskiMate's own words, mapped per portal, so another UK university can reuse them; a portal
   outside the UK would need new keys.
4. **The grade scale was four values, and "GPA" was stored as out of 4.** Fixed in P297 (decision
   3): the scale is kept as the student states it, with its maximum, and "GPA" alone is asked
   again.
5. **The qualification level is six values.** "PhD", "B.Tech" and "Postgraduate Diploma" cannot be
   stated in the interview, although the CV reader accepts "phd" (`packages/interview/src/field-specs.ts`,
   `packages/extraction/src/plans.ts`).
6. **The personal statement and intended start are held once per student.** A second portal would
   reuse the first statement without asking, though a statement is usually written per course.
   Whether it should be per application is his to say; no ADR says either way.
7. **ADR-0156's standing rules are not built**, so a list choice is asked again on every new
   application, a re-application to Sheffield included.

In [`state-of-the-system.md`](./state-of-the-system.md): exception 1 is row 156, 2 is row 157, 3 is
row 158, 4 is row 146 (closed in P297), 5 is row 159 and 6 is row 160; 7 is ADR-0156's unbuilt
part, recorded there.
