# Row 126 — every sentence that promises an action, and whether anything asserts it

*2026-10-02, P269.* Vahid: *"What I want first is the list: every one of those lines, what it
promises, and whether anything asserts it … Give me that list and I will say which ones matter."*
This is that list. Nothing in the code was changed to make it.

## How it was measured

- **The lines.** `grep -rnE "\bI will\b|\bI'll\b" --include=*.ts apps packages`, test files,
  compiled output, fixtures (a university's own words, such as *I will send it later*) and code
  comments excluded: **72 lines in 12 files**, one promise each. Row 126 first said 55: that
  pattern could not match *I'll*, and it searched three of the twelve places the student's words
  live. Both faults are corrected here.
- **The sentence.** Whether any test quotes the promise's own words: 46 of the 72 are quoted by
  no test.
- **The action.** Whether any test asserts that the promised thing *happens* — a second attempt
  claimed, a box reopened, a question asked when the walk reaches the field. Quoting the sentence
  does not count. Read by four agents in parallel, each citing the test line and the `expect`;
  one citation from each was re-read against the file and held, and the four findings below
  marked *contradicted* were re-read in the code.
- **Tested against** the code at `cbd87b3`. Many of the assertions cited sit in database-gated
  suites (`describeIfDatabase`); they run in the census and in CI's integration lane.

## What the 72 come to

| Verdict | Count |
|---|---|
| The action is asserted by a test | 36 |
| Partly asserted — one clause of two, or only on a unit no live path calls | 6 |
| **Live, and nothing asserts the action** | 10 |
| **Contradicted by the code — the promise cannot be kept, or says something untrue** | 4 |
| Never shown to a student — dead text, or a branch nothing reaches | 15 |
| A promise not to know something — nothing to assert | 1 |

## Contradicted by the code (read first)

*Since the list was made:* D25 fixed in P271 — the reply after a reading now says where the CV is. The abandon path fixed in P272 — the student is told; row 129 holds what it does not do. W7 kept in P274: the sweep deletes a CV a year after its last use and tells the student (row 128). D6 and D31 kept in P275 (row 130, stage A): *remove those too* and *delete my data* reach a person, the student is told what the university already has, and the new promise the handoff makes — *"I will tell you here when it is done"* (P1 below) — is asserted by the test that closes a request.


| # | Where | The promise | What the code does |
|---|---|---|---|
| D25 | run-driver.ts:1339, said at :8432 | *"I do not hold a CV for you. If you upload one … I will ask whether to use it when we reach your jobs."* | Said to a student who types *use my CV* **after a normal reading**. `heldFor` returns only `held`, `offered`, `pending` and `leased` rows, never `read`, so the branch meant for this case — *"I have already read your CV and filled in what it gave."* — cannot be reached, and the student is told something untrue about a CV we hold for a year. No test types *use my CV* after a reading. |
| W7 | client/words.ts:92, the CV upload sentence | *"I will keep it for one year from the last time I use it"* | Nothing deletes a CV when a period elapses: `decideRetention` and `startRetentionClock` have no production caller, and no sweep exists (ADR-0096 and the journal already say the retention sweep has no caller). The clock, where set, is set once and not moved on by use. A CV is deleted only when the student asks. The *read it only to fill in …* half is partly asserted (the reader's targets are the two lists). |
| D6 | run-driver.ts:777, the stop message | *"If you want your data deleted rather than just stopped, tell me — that is a separate request and I will pass it to a person."* | No code passes a deletion request to a person. A deletion request deletes documents, at once, itself. |
| D31 | run-driver.ts:5456, after a deletion | *"If you want any of those removed too, tell me and I will say what that takes."* | Nothing says what removing confirmed details takes: a reply such as *remove those too* is read as an unclear deletion request and answered with the document question. |

And one path on which several promises cannot be kept: when a person resolves an intervention
with the outcome `abandon`, the student is told nothing (run-driver.ts:6657–6672). Every
*I will come back to you* (D9, D12, W2, W5, W6) is unkept on that path.

## Live, and nothing asserts the action

The shape of the one that hid: a promise about something later, said, with nothing checking it
ever happens.

| # | Where | The promise | Kind | What is and is not tested |
|---|---|---|---|---|
| D4 | run-driver.ts:773 | *"I will tell you when it is finished."* (after a stop with an account still in our hands) | later | The message exists (`cancellationFinishedMessage`, sent at :7306) and the case is asserted closed, but no test reads the conversation for the message. |
| D9 | run-driver.ts:898 | *"Someone is looking at it, and I will come back to you."* (consent record mismatch, sign-in) | later | The escalation is asserted; no test resolves a consent intervention and sees the student told. |
| D12 | run-driver.ts:929 | the same, at account creation | later | As D9. |
| D29 | run-driver.ts:1359 | *"I have your CV. I will ask whether to use it when we reach your jobs."* | later | The tests that say it never walk to the field; the one that asks at the field never said it. |
| D33 | run-driver.ts:8428 | *"I am reading your CV now; I will tell you what it gave as soon as it is done."* | later | No test types *use my CV* during a reading. |
| D21 | run-driver.ts:1335 | *"Reading your CV now … I'll ask you the rest in the meantime."* | now | Every fixture that says it has nothing else to ask, so the *meantime* is never exercised. |
| D11 | run-driver.ts:916 | *"if it has lapsed by the time I get back to it, I will open the secure box again."* (after a consent notice at creation) | conditional | Only the opposite — no second box when nothing was spent — is asserted. |
| D24 | run-driver.ts:1338 | *"… upload it again from the documents panel and I will ask you again."* | conditional | No test uploads a CV again after a no. |
| D16 | run-driver.ts:975 | *"I will try again shortly."* (creation failed once, no password spent) | now | No test fails a creation that had no password. |
| R2 | reading-account.ts:244 | *"I read your CV but could not read any … whole, so I will ask you about … as usual."* | later | Not asserted, and since P266 not quite true: the entries are asked by hand with their lines, not *as usual*. |

## Partly asserted

| # | Where | The promise | The gap |
|---|---|---|---|
| D32 | run-driver.ts:5833 | *"I will ask you about it again, and then read the whole list back to you."* | Asserted for a typed list; for a list a CV filled, only the re-asking is asserted, not the playback after it. Row 121 is the same question on his log. |
| I1 | interview.ts:578 | *"I will ask you for each part of the first; you can add the second when I ask whether there is another."* | The closing question is asserted; no test walks such an entry part by part (both leave it out). |
| I2 | interview.ts:581 | *"I will ask you for each part."* (invented span) | The opening is asserted; the walk is proven for the one-span case only. |
| R1 | reading-account.ts:234 | *"I could not read your CV as text, so I will ask you about … as usual."* | The sentence is unit-tested; no driver test reports a failed reading. |
| F5 | field-specs.ts:1167 | *"If I do not recognise what you tell me I will say so and ask again."* (address country) | The refusal is asserted; the asking again, for the address's country, is not. |
| C3 | conversation/rendering.ts:83 | *"The password box timed out before it opened. I will ask you again in a moment."* | Asserted at the orchestrator's decision only; nothing delivers the new box end to end after the expiry. |

## Never shown to a student

Dead text or unreachable branches: their promises cost nothing today and would become live the
day the branch does — row 127's family.

| # | Where | Why it is never shown |
|---|---|---|
| F3, F4, F6, F7, F8 | field-specs.ts:1048, 1113, 1519, 1672, 1738 | The top-level `rationale` of a composite or list spec, which nothing reads (the interview passes a part's or a scalar's rationale). The actions — *one job at a time*, *I will record it* for no passport — are asserted. |
| A5, A6, A7, A8 | account/ownership.ts:555–577 | The account-creation request goes into the `create_account` step's words, which the driver never posts; and both catalogue entries use the student-chosen password, so the passwordless and generated modes are unreachable. A8 — *"When the application is finished I will ask you to set your own password"* — would be a later promise with nothing behind it if the generated mode were ever reached. |
| X1 | disclosure.ts:454 | *"I will tell you if anything about this changes."* — `renderDisclosureRequest` has no live caller (a dev script only), and nothing notifies a student of a change. |
| E1 | documents/expiry.ts:266 | *"If you carry on, I will use this one and will not ask again."* — `decideExpiryWarning` has no live caller. |
| W4 | client/words.ts:65 | *"I will carry on shortly."* — nothing writes the `suspended` status. |
| W3 | client/words.ts:47 | *fix_content*: the driver escalates in the same advance, so the student sees the escalated words. |
| C1 | conversation/rendering.ts:73 | *"I will wait."* — the only caller passes a client that supports the secure box; and what the code would do is let the request lapse, not wait. |
| D7 | run-driver.ts:862 | *"I will not go on past that"* — the failure code is caught by both handlers before these words; the stop itself is asserted. |

## The action asserted (36)

RDT is `apps/conversation-service/src/run-driver.test.ts`; lines are at `cbd87b3`.

| # | The promise, in short | Where the action is asserted |
|---|---|---|
| D1 | told when a paused run moves again | RDT:4029 (*moving again*, said once after the resolution) |
| D2, D3 | help taking control of an account; come back about it | RDT:7674 (*hand_over_account*), :7684 (handover pursued), :10913 (case closed after it) |
| D5 | nothing new started on a stopped application | RDT:7628, :7891 (no work offered, no account creation started) |
| D8 | the consent choice asked, then the password again | RDT:13703 (*consent_choice*), :13752 (*request_secret*) |
| D10 | the consent choice asked, then the account created | RDT:13868, :13881, :13886 |
| D13 | the recorded consent choice pressed whenever the notice appears | RDT:13764, :13796, :13979; `browser-runner/src/sign-in-settle.test.ts:338` |
| D14 | creation tried once more | RDT:8939 |
| D15 | the secure box opened again for the second attempt | RDT:8921, :8924 |
| D17 | the box opened again when the student asks to apply again | RDT:8698 |
| D18 | sign-in tried again; a second failure stops for a person | RDT:13482, :14017, :14031 |
| D19 | the secure box opened again after a failed sign-in | RDT:13469, :13470 |
| D20 | a failed page tried once more | RDT:14134 |
| D22 | the walk carries on the moment the reading is done | RDT:14937, :15941 |
| D23 | asked about jobs and qualifications as usual after a no | RDT:15960 |
| D26 | a late reading shown and confirmed again | RDT:15107, :15115, :15116 |
| D27 | what was read is used, and the rest asked | RDT:15282 |
| D28 | asked as usual after the reading is set aside | RDT:15256 |
| D30 | an entry pressed is asked about again | RDT:11345 |
| R3 | the entries the sentence counts are asked by hand | RDT:15782, :15799, :15801 |
| I3 | an unreadable entry asked part by part | `packages/interview/src/interview.test.ts:1892`, :1896, :1901 |
| W1, W5 | a person has it; the run moves and the student is told | RDT:4013, :4029 |
| W2, W6 | the same, after an escalation | RDT:6720, :6730 |
| F1 | an amount without a currency refused | `interview.test.ts:857`–858 |
| F2 | a month and a year stored without a day | `interview.test.ts:839`, :843–844 |
| C2 | no password asked on an insecure page | `scripts/journey.test.ts:1057`, :1066 |
| A1 | the same password box shown after a sign-out | `packages/orchestrator/src/orchestrator.test.ts:1697`, :1700 |
| A2, A3 | sign-in instead of creation, through the password box | RDT:13072–13076, :13086, :13097 |
| A4 | a password box in the chat before creation | `orchestrator.test.ts:1405`, :1411 |
| A10 | an attachment recorded on the student's word | `scripts/journey.test.ts:989`–990 |
| A11 | the handover closed on the student's word | `scripts/journey.test.ts:1726`, :1728 |
| O1 | the run waits for e-mail verification | RDT:5677, :5693, :5754 |
| O2 | the consent choice done whenever the notice appears | RDT:13764, :13979 |

A9 (*"… and I will not know"*) promises not to know something; there is nothing to assert.

## Added since the list was made

Promises written after P269's measurement, each shipped with its assertion. RDT lines at P275.

| # | Where | The promise | Where the action is asserted |
|---|---|---|---|
| P1 | run-driver.ts, `#passTheDetailsToAPerson` (P275) | *"I will tell you here when it is done."* | RDT:14868 (a person closes it; the student is told, once), :14928 (a refusal, with the person's reason) |
| P2 | run-driver.ts, the everything question (P275) | *"I hold a passport, which I can delete myself, now."* | RDT:14887 (*both* deletes the documents at once) |

