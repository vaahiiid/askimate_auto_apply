# ADR-0015 — The interview is a capability of AskiMate Chat, not a new interface

**Status:** **Accepted** — Vahid's clarification, 2026-08-26
**Corrects:** my framing in the gap analysis, which implied a chat channel of our own

## The clarification

> When you refer to the "Interview Engine", I mean the existing AskiMate Chat itself. The student
> must NOT be presented with a separate interview UI, questionnaire, application form, or a new
> data-entry screen. […] The Interview Engine is therefore a capability of the existing AskiMate
> conversation layer, not a separate product or UI.

## What this changes

I had been treating the interview as something with a front end. It is not. It is a **headless
capability** that AskiMate Chat calls, and which returns *what to say next*. AskiMate Chat renders
it in the conversation the student is already having.

```
   Student ⟷ AskiMate Chat            ← the ONLY surface the student ever sees
                  │
                  │  "what does this application need next?"
                  ▼
   AAS interview capability            ← headless. Returns text and intent. Renders nothing.
                  │
                  ▼
   confirmed profile → mapping → autonomous completion
```

**Nothing in this repository will ever render a screen for a student.** The capability returns an
`InterviewAction` — ask this, request that document, confirm this reading, done, or escalate — and
AskiMate Chat decides how to present it in its own conversation.

## The consequence for the first demonstration

A CLI harness stands in for AskiMate Chat during development, so the loop can be exercised end to
end before the integration exists. **That harness is a test driver, not a product surface**, and it
ships in `scripts/`, not in an app. It is how we prove the capability works; it is not how a
student will ever meet it.

## What is unchanged

- The agent asks **one thing at a time**, progressively (ADR-0007).
- The question may be model-written — it is shown to a human, never submitted.
- The student's **answer** is a model interpretation and becomes a `ProposedValue`, which must be
  played back and confirmed before it enters the profile. The playback is rendered
  **deterministically** from the structured value, not paraphrased by a model, so the student
  confirms exactly what will be stored.
- Documents are requested **in the conversation**, not on an upload page.
- If the agent asks and the information genuinely cannot be obtained, that is
  `information_unobtainable` → escalate. Never guess.

## Consequences

- The capability's public API is the contract with AskiMate Chat, and it is designed to be called
  over the ADR-0001 integration boundary.
- No UI work belongs in this repository at all.
- The capability is fully testable headlessly, which is why it can be built now, before the
  integration exists.
