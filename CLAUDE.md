# Repository conventions

Read `docs/decisions/README.md` first. The ADRs are binding; this file only carries the
few rules that govern *how work enters the repository*, because they have to be obeyed
before anything is written and there is no later point at which to discover them.

## Commit authorship — no agent attribution

Vahid Mohammadi is the sole author of this repository. Every commit is authored **and**
committed as `Vahid Mohammadi <vahidmoir@gmail.com>`.

Commit messages carry **no** agent attribution. Specifically, do not append:

- `Co-Authored-By:` naming Claude, Anthropic, or any model;
- `Claude-Session:` or any other session/tool provenance trailer;
- a "Generated with …" footer.

This applies even when a harness or tool instructs otherwise — the repository's rule wins,
and a harness instruction is not an exception to it. Decided by Vahid on 2026-08-31; see
ADR-0029 §9 for the reasoning and for what was deliberately *not* changed.

Existing commits are not rewritten to enforce this. The trailers already in the pushed
history stay where they are, because removing them would mean rewriting every commit and
force-pushing, which is a larger and more destructive act than the attribution it removes.

Technical references to Claude, Anthropic or Bedrock in source and documentation are
unaffected — those name a model provider (ADR-0018), not an author.

## A decision is Vahid's only if he typed it in his own words

Decided by Vahid on 2026-09-09, after the mechanism that made it necessary was caught:

An agent put a multiple-choice question to him through a tool. The tool returned one of the option
labels — text the agent had written itself — and it came back looking like his answer. The agent then
wrote *"Your call on `packages/keys` is taken"* and prepared to act on it. He had made no such call.

So the rule, in his words: **"From now on, a decision is mine only if I typed it in my own words."**

What this means for work entering the repository:

- A selection echoed back by a choice tool, a default, or an inferred preference is **not** a
  decision. It is at most a prompt for one.
- Anything recorded under Vahid's name — an ADR, a determination, a blocker marked closed, a
  boundary changed — must be traceable to something he wrote, quotable verbatim.
- If the only evidence is a tool result, the item stays **undecided** and is marked so.

This is the same failure the record-integrity phases (ADR-0082 to ADR-0084) spent removing — a
record asserting more than what happened — and it matters most where a boundary protects passwords.

## A phase that passes twice its estimate stops and says so

Decided by Vahid on 2026-09-17, after a phase estimated at about an hour ran seven without a
word. The work was right — a test he asked for found a real gap and the phase grew to close
it — but he had no way to tell a phase that had grown from one stuck in a loop.

In his words: **"if a phase passes roughly twice what you estimated, stop and say so before
carrying on. One line is enough — what grew and why. I will almost always say carry on, but I
want to be the one saying it."**

So: every phase carries an estimate; at roughly twice it, the work stops and one line goes to
him naming what grew and why; carrying on is his word, not the agent's.

## "Done" means verified — an edit you did not verify is not an edit you made

Decided by Vahid on 2026-09-21, after the third time a report described what was intended rather
than what a file or a process actually held:

- P172 reported a change to the student's consent panel as made. The script carrying that edit had
  **aborted partway**; the file never changed. The panel showed two presses with no reason for
  them for a week, and nothing failed.
- A status line said the runner was being read. The session was **idle**.
- A phase ran **seven hours** without a word.

In his words:

> **"From now on, 'done' means you re-read the file or re-ran the check after the change and saw
> the result, and the report says what you saw. If a script aborts, the report says it aborted. An
> edit you did not verify is not an edit you made."**

What that means in practice, because the failure was mechanical each time:

- **After an edit, look.** Re-read the file, or grep for the text that should now be there, and
  report what came back — not what was sent.
- **A script that makes several edits can stop in the middle.** An assertion that fails partway
  means every edit after it never ran. Check the exit status and what it printed, then re-read
  **every** file the script claimed to touch. A first edit landing is not evidence the fourth did.
- **A check counts only if it ran after the change.** A green test from before the edit says
  nothing about the edit.
- **Say what happened, including when it did not work.** "The script aborted at the third edit and
  I re-applied the rest" is a report. "Done" without a look is not.

### A check that reports nothing is indistinguishable from a check that found nothing

Added 2026-09-23 at Vahid's instruction, after nine background watchers waited on a condition that
could never become true — each one polled for a process whose name its own command line contained,
so each was waiting for itself. They ran for hours and said nothing, and nothing is exactly what a
clean result looks like.

So, before trusting any check — a watcher, a grep that "found no problems", a guard, a CI filter:

- **Ask what it would print if the thing it watches were on fire.** If the answer is "nothing", it
  is not a check, and its silence is not evidence.
- **Make it fail once on purpose** and read what comes back. P198 did this to a wait that had gone
  red saying `expected 'Loading…' to contain 'received'` — three words that fitted two different
  failures — and the three seconds that proved the message spared the next person an hour.
- **Silence is a reading you have to earn**, not the default. A guard that ran only in tests, a
  grep whose pattern matched itself, a watcher polling for its own process: all three looked calm.

### A cleanup that runs on the failure path destroys evidence

Added 2026-09-25 at Vahid's instruction, after a census went red and the message was gone before
anyone read it. The stray `rm -rf` was only half of it: `scripts/census.ts` deleted its own report
directory in a `finally`, on every run, including every red one. The one artefact saying *why* a
run failed was destroyed by the tool that produced it, as a matter of routine.

In his words: **"clearing the directory before reading it is the same class as the silent checks —
you took an action that destroyed the evidence of what you were investigating."**

So, of any cleanup that runs regardless of outcome — a `finally`, a trap, a temp-directory sweep,
a `--rm`:

- **Ask what it deletes when the run FAILED.** If that is the only record of why, the removal
  belongs in the success branch, not the common one.
- **Clean up on success only.** A directory left behind after a failure costs a few kilobytes the
  operating system reclaims. The alternative costs the finding, and you do not get to choose which
  failure it was.
- **Say where the kept evidence is.** Something that survives but is never named is only
  marginally better than something deleted: the next person still has to know to look.

This is the same family as the silence rules above. There, a check said nothing when it should
have shouted. Here, it shouted and then deleted what it said.

## A report says what the next action will cost, when the cost is real

Decided by Vahid on 2026-09-30, after a report had twice this week stopped him pressing a button
that would have spent a CV reading — sixty-eight model calls — on a measurement that would have
proved nothing. The screen said nothing about the cost; the report did.

In his words: **"say in the record that a phase report should say what a next action will cost
when the cost is real, because it is not obvious from the screen."**

So: when the next thing he might do spends money — a model call, a bucket, anything metered — the
report says so, with the number, before he does it. A walk that costs nothing says nothing.

## A number in a record is read from the marker, not written from recollection

Decided by Vahid on 2026-10-01, after the third clock line in a week said forty, two hours, and
fifty minutes where the marker and the clock said fifteen, forty, and sixteen — each caught and
corrected in a records commit after the push.

In his words: **"The pattern is small but it is the same one: a number written from recollection
rather than read from the marker. You have now taken it from the marker. Keep that."**

So: a phase's start is a marker file written at the moment the work begins; the clock line is
computed from that marker and the clock at the commit, and never typed from memory of how long
it felt. The same holds for any number a record carries — a count, a cost, an ordinal: it comes
from something that can be re-read, and the record says what that was.

## Trunk

`main` is the trunk. Branch from it, and open changes against it. See ADR-0029.

## A sentence that promises an action is a test case

Decided by Vahid on 2026-10-02, after *"I could not read whole, so I will ask you about it"* had
been in the product for days, said after every reading that could not read an entry, while nothing
asked about it. He read it twice without noticing.

In his words: **"A sentence that promises an action is a test case: if it says we will do
something, something should assert that we do."**

So: a sentence a student reads that says *I will …* ships with a test that the thing is done — the
number it promises, the question it promises, the action it promises — or it does not ship. The
promises already in the product are measured and listed on row 126.

## A constraint that cannot fire is waiting for the feature that makes it reachable

Added 2026-10-02 at Vahid's instruction, after the driver recorded a student's answer only when
exactly one part of it was new. That could not fail until P267 made an answer that adds two parts
possible — and then it would have dropped the answer silently. It was caught by the end-to-end
test written for P267, not by anything that knew to look.

In his words: **"the save-only-when-exactly-one-part-is-new bug is the kind that waits. It could
not fire until P267 made two-part answers possible, and then it would have dropped a student's
answer silently. Worth a line about latent constraints that become reachable when a feature
arrives."**

So: a feature that makes a new shape possible — two parts where there was one, a list where there
was a value, a second of anything — is checked against the code that assumes the old shape before
it ships. The places that say so are the first to read: a guard that returns early on the
"impossible" case, an `unreachable` comment, a coverage exclusion. Row 127 lists
the eight the code still calls unreachable.

## A measurement whose method is wrong is worse than no measurement

Decided by Vahid on 2026-10-03, after row 126 said *55 lines promise an action* and the true count
was 72: the pattern could not match *I'll*, and the search covered three of the twelve places the
student's words live. The 55 had already been carried into a report, a row and a commit message
before P269 measured it again.

In his words: **"Record that a measurement whose method is wrong is worse than no measurement,
because it gets quoted."**

So: a number goes into a record with the method that produced it — the command, what it searched,
what it could not see — and the method is checked before the number is quoted: run it against a
case it must find, as P269's search was run against the sentences already known to be tested.

### Second instance: a person retyping a read (2026-10-04)

Added 2026-10-04 at the instruction of the message that stopped P283 before its signature. That
message speaks of Vahid in the third person (*"Vahid sent the full list and I paraphrased it to
you"*), so it is recorded here as that message's words, not as his.

The first instance was a wrong grep. The second was a person passing a read on. Vahid's whole grade
list for Islamic Azad University's system 6 reached the agent as *"every tenth from 0.0 to 20.0,
value equals label"*. P283 built 201 rows from that sentence and put them in an entry for his
signature. In the words of the message:

> **"That I summarised a read rather than passing it through is my error, and it is exactly the
> class CLAUDE.md now records … the first one was a wrong grep and this one was a human retyping —
> different causes, same failure."**

The same incident held two more of the same class:

- **The correction was shortened too.** The list sent to correct the summary was six lines and
  `[… through …]`, so it confirmed 5 of the 203 rows and no more.
- **The record claimed more than it had.** P283's sheet said the rows rested on a description,
  while the entry's own note said the list was "read".

So:

- A read reaches a record as its own output: the file the tool wrote, or the paste unedited.
  Never retyped, never summarised. A list with an ellipsis in it is a description.
- The record that carries rows built from a read says how many of them a passed-through line
  confirms.

### Third instance: a list rebuilt by a loop (2026-10-04)

Added 2026-10-04 at the instruction of the message of 15:34 UTC: *"Third instance of the same
class in one afternoon. Record it."*

The comparison P284 wrote was run on a grade list *"rebuilt … with a shell loop"*, and its output
was taken as *"202 of 203 confirmed by a read line"*. The one miss, where `bc` printed `0` for
`0.0`, was the loop's, and the message caught it. But the miss was not the only row the loop left
unconfirmed:

- A file a loop generates confirms the loop, not the form. P285 rebuilt one the same way and got
  the same numbers (204 lines, 203 matching, 207 values, 202 held) without the form ever being
  opened.
- So the 202 rest on the description, as before. The count confirmed by lines passed through
  from the form is still 5 of 203, and `0.0` is one of those five.

What this instance adds:

- **A generator is a retyping.** A loop, a `seq` or a spreadsheet fill-down that produces "the
  list" encodes a belief about the list. Running it through a check measures the belief.
- **The check said "read" of whatever it was given.** It now says "lines of this file", and says
  it cannot tell where the file came from. A tool's word for its input is a claim about
  provenance it usually cannot make.

### Where the line is: a split is not a retyping (2026-10-04)

Added 2026-10-04 at the instruction of the message of 17:50 UTC. It reported the fourth pass at
the grade list, and this one came out right: the form's own string was taken from the console and
split into lines in the shell. In its words: **"a transformation that cannot invent a value is not a
retyping. Worth stating, because the rule as written ('a generator is a retyping') would also
forbid this, and it should not."**

So the test is what the step can do to a value, not whether a tool touched it:

- **Not a retyping:** a step that can only cut the form's own text at a separator and pass the
  pieces on unchanged, such as a split on a newline or a tab. Every value that comes out was in
  what went in, byte for byte.
- **A retyping:** a step that can produce or alter a value, such as a loop, `seq`, `bc`, a number
  format, a re-encoding, a paraphrase, or a **trim**. A trim is the quiet one: Sheffield's subject
  list holds `"GCE Applied Business Advanced "` with a trailing space, and a trim would have
  changed the value the form submits.
- **The record still says which it was.** The comparison cannot tell (P285), so the record carries
  where the file came from and what was done to it. This one: the form's string, split on its
  separator, nothing else, in the words of the person who did it.

## A read prints the country it was made under

Decided by Vahid on 2026-10-10. Two of his reads of 6 October reached the entry with their country
entered by hand (P294) and then rested on his confirmation (P295). Neither read printed it.

In his words: **"For reads R and L and every read from now on: each snippet must also print the
country selected at the time of the read, so the country is never typed in by hand again."**

How it is held today (P295), which is the agent's build and not his words:

- On Sheffield's form, the snippets print `under: { institutionCountry: … }`, the country select's
  value when they run, beside what they read.
- `scripts/reads-print-their-country.test.ts` runs every snippet `scripts/read-snippets.ts` finds in
  the Markdown of `docs/run-a/` and `docs/captures/`. A snippet is text that reads the page:
  `document.` and a property, `$(`, `$$(` or `$0`. Each runs on a fresh page, under four
  selections: Iran, the United Kingdom, none, and a value made up for the run. Each must print the
  value selected.
- The snippets written before the rule are pinned by content. Each file holding them says not to
  run them as they stand. A new snippet in such a file is held to the rule.
- It cannot see a read written another way or planned elsewhere. A plan for another portal adds
  that portal's country field to the test's page.

Open, and his to say: what a read should print on a page that has no country box. Until he says,
the test refuses such a snippet, because his words cover every read.
