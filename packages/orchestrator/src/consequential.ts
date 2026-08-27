/**
 * Doing something that cannot be undone, exactly once — or knowing that we
 * cannot know.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27, approving the model:
 *
 *   *"Never blindly retry a consequential external action. Where certainty is
 *   impossible, detect the uncertainty, verify where possible, and escalate
 *   where necessary."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The three crash windows, and the one that cannot be closed ────────────
 *
 *   (a) BEFORE the action        no intent record  →  provably did not happen
 *   (b) DURING the action        intent, no completion  →  UNCERTAIN
 *   (c) AFTER external success,
 *       before we recorded it    intent, no completion  →  UNCERTAIN
 *
 * **(b) and (c) are indistinguishable from inside this process, and no design
 * closes that gap.** Record-after leaves a window; record-before produces a
 * record for something that may never have happened. The two-phase intent
 * record does not remove the uncertainty — it makes it *detectable*, which is
 * the most any system can do.
 *
 * So the problem is converted from *"did it happen?"* into *"can we find
 * out?"*:
 *
 *   verifiable   → look first; act only if looking says it did not happen
 *   not          → **escalate.** A specialist opens the portal and sees.
 *
 * ── The one thing this must never do ──────────────────────────────────────
 *
 * Automatically retry an unverifiable consequential action. Creating a second
 * university account for a student who already has one is not a bug that gets
 * noticed in a log — it is a mess in a real admissions system with a real
 * person's name on it.
 *
 * There is no code path here that does it, and `assessIntent` in the domain
 * has no verdict that means "retry". Both are tested by enumeration, because
 * an absence needs a test or it is just a thing nobody has done yet.
 */

import { assessIntent, idempotencyKeyFor } from "@askimate/aas-domain";
import type {
  ActionIntent,
  ConsequentialAction,
  IntentOutcome,
  IntentVerdict,
  RunId,
} from "@askimate/aas-domain";
import type { WorkflowRunStore } from "@askimate/aas-case-store/workflow";

/**
 * What looking at the outside world established.
 *
 * `unknown_still` is not a failure of the check — it is the honest answer when
 * a portal is down, a page will not load, or the evidence is ambiguous. It
 * must not be collapsed into "did not happen", which is the tempting
 * simplification and the one that causes the duplicate.
 */
export type VerificationResult =
  | { readonly kind: "already_happened" }
  | { readonly kind: "did_not_happen" }
  | { readonly kind: "unknown_still"; readonly detail: string };

/** Looks at the outside world to see whether an action landed. */
export type Verifier = (intent: ActionIntent) => Promise<VerificationResult>;

/** What `performOnce` decided and did. */
export type ActionOutcome<T> =
  /** It ran now, for the first time. */
  | { readonly kind: "performed"; readonly result: T }
  /** It had already been done and recorded. Nothing ran. */
  | { readonly kind: "already_done"; readonly outcome: IntentOutcome }
  /** Verification found it had landed before the crash. Nothing ran. */
  | { readonly kind: "confirmed_already_happened" }
  /**
   * Nobody can say whether it happened. **Nothing ran, and nothing will.**
   *
   * Carries what a specialist needs: which action, against what, and why the
   * system stopped rather than guessing.
   */
  | {
      readonly kind: "escalate";
      readonly action: ConsequentialAction;
      readonly target: string;
      readonly why: string;
    };

export interface PerformOnceInput<T> {
  readonly store: WorkflowRunStore;
  readonly runId: RunId;
  readonly action: ConsequentialAction;
  /** What it acts on: a portal host, a document id. Never a value. */
  readonly target: string;
  readonly now: () => Date;
  /** The consequential thing itself. */
  readonly perform: () => Promise<T>;
  /**
   * How to find out afterwards whether it landed.
   *
   * Required for every verifiable action and **ignored for the rest** — an
   * action the domain says cannot be checked is not made checkable by a caller
   * supplying an optimistic function. `isVerifiable` is data in the domain
   * precisely so this is not a judgement made in the moment.
   */
  readonly verify?: Verifier;
}

/**
 * Performs a consequential action at most once, across restarts.
 *
 * The ordering is the mechanism, and it only works in this order:
 *
 *   1. look for an existing intent  → decide what may be done at all
 *   2. record the intent            → durable, BEFORE acting
 *   3. act
 *   4. record the completion        → durable, AFTER acting
 *
 * A crash between 2 and 4 is the uncertainty window. It is detectable because
 * step 2 happened, and that is the whole design.
 */
export async function performOnce<T>(input: PerformOnceInput<T>): Promise<ActionOutcome<T>> {
  const idempotencyKey = idempotencyKeyFor({
    runId: input.runId,
    action: input.action,
    target: input.target,
  });

  const existing = await input.store.findIntent(input.runId, idempotencyKey);
  const verdict: IntentVerdict = assessIntent({
    ...(existing === null ? {} : { intent: existing.intent }),
    ...(existing?.completed === undefined ? {} : { completed: existing.completed }),
  });

  switch (verdict.kind) {
    case "already_done":
      // Recorded as finished. Not repeated, whatever the outcome was: a
      // `failed_cleanly` action still ran, and running it again is a second
      // attempt nobody decided to make.
      return { kind: "already_done", outcome: verdict.outcome };

    case "escalate":
      return {
        kind: "escalate",
        action: verdict.action,
        target: input.target,
        why: verdict.why,
      };

    case "verify_first": {
      // The uncertainty window, for something we can look at.
      if (input.verify === undefined) {
        return {
          kind: "escalate",
          action: input.action,
          target: input.target,
          why:
            `A "${input.action}" was started against ${input.target} and no completion was ` +
            `recorded. It is verifiable in principle, but no verifier was supplied, so this ` +
            `process cannot establish what happened. Escalating rather than guessing.`,
        };
      }

      const verification = await input.verify(existing?.intent ?? intentFor());
      if (verification.kind === "already_happened") {
        // Reconcile the record with the world, so the next resume needs no
        // verification at all.
        await input.store.completeIntent(input.runId, idempotencyKey, "succeeded", input.now());
        return { kind: "confirmed_already_happened" };
      }
      if (verification.kind === "unknown_still") {
        // The honest answer. NOT collapsed into "did not happen" — that
        // collapse is exactly what creates the duplicate account.
        return {
          kind: "escalate",
          action: input.action,
          target: input.target,
          why:
            `A "${input.action}" against ${input.target} was started and never recorded as ` +
            `finished, and checking could not establish what happened: ${verification.detail}. ` +
            `Assuming it failed would risk doing it twice; assuming it worked would risk losing ` +
            `the application. A specialist looks and says which.`,
        };
      }

      // Verified as not having happened. Safe to do now — and it is the only
      // branch in this function that performs an action that was previously
      // attempted.
      const result = await input.perform();
      await input.store.completeIntent(input.runId, idempotencyKey, "succeeded", input.now());
      return { kind: "performed", result };
    }

    case "not_started": {
      // ── The ordering that makes the whole thing work ────────────────
      //
      // The intent is durable BEFORE the action. If the process dies between
      // these two lines, the next resume finds an intent with no completion
      // and takes the uncertain path — which is correct, because the action
      // may well have reached the portal.
      await input.store.recordIntent(input.runId, intentFor());
      const result = await input.perform();
      await input.store.completeIntent(input.runId, idempotencyKey, "succeeded", input.now());
      return { kind: "performed", result };
    }
  }

  function intentFor(): ActionIntent {
    return {
      idempotencyKey,
      action: input.action,
      target: input.target,
      startedAt: input.now(),
    };
  }
}

/**
 * Records that an action failed *without* reaching the outside world.
 *
 * Use only where the failure is provably local — a validation error before the
 * request was sent, a locator that matched nothing. A network error is NOT
 * this: a request that timed out may have been received and acted upon, and
 * recording it as `failed_cleanly` would turn a genuine uncertainty into a
 * false certainty, which is worse than not recording it at all.
 */
export async function recordCleanFailure(input: {
  readonly store: WorkflowRunStore;
  readonly runId: RunId;
  readonly action: ConsequentialAction;
  readonly target: string;
  readonly now: Date;
}): Promise<void> {
  await input.store.completeIntent(
    input.runId,
    idempotencyKeyFor({ runId: input.runId, action: input.action, target: input.target }),
    "failed_cleanly",
    input.now,
  );
}
