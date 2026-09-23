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

## Trunk

`main` is the trunk. Branch from it, and open changes against it. See ADR-0029.
