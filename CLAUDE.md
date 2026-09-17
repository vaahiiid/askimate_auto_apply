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

## Trunk

`main` is the trunk. Branch from it, and open changes against it. See ADR-0029.
