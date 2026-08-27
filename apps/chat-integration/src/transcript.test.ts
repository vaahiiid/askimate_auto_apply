/**
 * The secure request occupies its real position in the conversation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"render the secure request as an inline, first-class
 * turn inside the conversation transcript, while keeping its data completely
 * outside the ordinary chat message pipeline."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Both halves of that sentence get a test ───────────────────────────────
 *
 * The first half — *inline, first-class* — is an ORDERING claim, and the tests
 * below check it by position rather than by presence. "The directive is
 * somewhere in the output" would pass for a projection that appended every
 * control at the end, which is a different product.
 *
 * The second half — *completely outside the ordinary pipeline* — is checked by
 * running the same turn list through `buildModelRequest` and `persistableContent`
 * and asserting the directive contributes nothing but a fixed sentence. The
 * two halves are tested together, in the same tests, because the whole risk of
 * this change is that moving the pixels drags the bytes along with them.
 */

import { describe, expect, it } from "vitest";

import type { SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";

import { buildModelRequest, persistableContent, type ChatTurn } from "./chat-transport.js";
import { openSecureRequest, projectTranscript, type TranscriptItem } from "./transcript.js";

const PROMPT: SecretPrompt = {
  requestId: "sr_0123456789abcdef0123456789abcdef" as SecretRequestId,
  channel: "secure_control",
  title: "Create a password for your university application",
  explanation: "This goes straight to the university. I never see it.",
  requiresConfirmation: true,
  portalHost: "apply.example.ac.uk",
  expiresAt: new Date("2026-08-27T10:05:00Z"),
  observedRules: [],
};

/** A conversation with a secure request in the MIDDLE, which is the whole point. */
const CONVERSATION: readonly ChatTurn[] = [
  { kind: "message", sender: "user", content: "I want to apply to Ulster." },
  { kind: "message", sender: "ai", content: "I can create your account now." },
  { kind: "directive", directive: "request_secret", prompt: PROMPT },
  { kind: "secret_status", lifecycle: "secret_received", handle: "sh_deadbeef" },
  { kind: "message", sender: "ai", content: "Your account is being created." },
];

describe("the transcript keeps the secure request in place", () => {
  it("drops nothing — every turn produces exactly one item", () => {
    const items = projectTranscript(CONVERSATION);
    expect(items).toHaveLength(CONVERSATION.length);
  });

  it("puts the secure control BETWEEN the messages around it, not at the end", () => {
    const items = projectTranscript(CONVERSATION);

    // Checked by index, not by presence. A projection that appended every
    // control after the messages would satisfy "contains a secure_control" and
    // would be exactly the detached panel this change removes.
    expect(items.map((item) => item.render)).toEqual([
      "message",
      "message",
      "secure_control",
      "secret_status",
      "message",
    ]);
  });

  it("reports the ORIGINAL position, so a persisted ordinal stays meaningful", () => {
    const items = projectTranscript(CONVERSATION);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("carries the prompt metadata the card needs to draw itself", () => {
    const items = projectTranscript(CONVERSATION);
    const card = items[2];
    if (card?.render !== "secure_control") throw new Error("expected the control at index 2");
    expect(card.prompt.portalHost).toBe("apply.example.ac.uk");
    expect(card.prompt.requiresConfirmation).toBe(true);
  });

  it("carries the lifecycle and the opaque handle, and nothing else", () => {
    const items = projectTranscript(CONVERSATION);
    const status = items[3];
    if (status?.render !== "secret_status") throw new Error("expected a status at index 3");
    expect(status.lifecycle).toBe("secret_received");
    expect(status.handle).toBe("sh_deadbeef");
  });

  it("omits the handle rather than rendering undefined when there is none", () => {
    const items = projectTranscript([
      { kind: "secret_status", lifecycle: "secret_expired" },
    ]);
    expect(items[0]).not.toHaveProperty("handle");
  });
});

/**
 * COMPILE-TIME ASSERTION: no transcript item except a message may carry free text.
 *
 * ── Why this is not an `@ts-expect-error` on `item.content` ───────────────
 *
 * The obvious version of this test is to narrow away the message variant and
 * write `// @ts-expect-error` before reading `.content`. I wrote that first,
 * then tried to break it by giving `secure_control` a `content` field — and it
 * kept passing.
 *
 * The reason is that `keyof` over a union is the INTERSECTION of the members'
 * keys. Reading `.content` off `secure_control | secret_status` stays an error
 * while *either* variant lacks the field, so the directive remained "used" and
 * nothing failed. That test only tripped if EVERY non-message variant grew a
 * free-text field at once, which is not how the mistake happens: it happens to
 * one variant, in one commit, for one plausible reason.
 *
 * `ContentBearing` distributes over the union, so it catches a single variant.
 * `AssertNever` then fails the build if the result is anything but `never`.
 */
type ContentBearing<T> = T extends unknown ? ("content" extends keyof T ? T : never) : never;
type AssertNever<T extends never> = T;
export type NO_FREE_TEXT_OUTSIDE_MESSAGES = AssertNever<
  ContentBearing<Exclude<TranscriptItem, { readonly render: "message" }>>
>;

describe("moving the pixels does not move the bytes", () => {
  it("gives the model the fixed sentence and no prompt content", () => {
    const request = buildModelRequest({ utterance: "ok", turns: CONVERSATION });
    const contents = request.history.map((entry) => entry.content);

    expect(contents).toContain("[A secure password box was shown to the student.]");

    // The explanation, the title and the host are all shown to the STUDENT.
    // None of them may travel to the model through the directive, because a
    // template that interpolated one is where a value ends up later.
    for (const entry of contents) {
      expect(entry).not.toContain("apply.example.ac.uk");
      expect(entry).not.toContain("Create a password");
      expect(entry).not.toContain("I never see it");
    }
  });

  it("gives the model a lifecycle word and an opaque handle for the status", () => {
    const request = buildModelRequest({ utterance: "ok", turns: CONVERSATION });
    expect(request.history.map((entry) => entry.content)).toContain(
      "[secret_received · sh_deadbeef]",
    );
  });

  it("refuses to persist anything that is not a message", () => {
    for (const turn of CONVERSATION) {
      const content = persistableContent(turn);
      if (turn.kind === "message") expect(content).toBe(turn.content);
      else expect(content).toBeNull();
    }
  });

  it("has exactly one variant carrying free text — checked at runtime", () => {
    const items = projectTranscript(CONVERSATION);

    for (const item of items) {
      if (item.render === "message") {
        expect(typeof item.content).toBe("string");
        continue;
      }
      // The runtime half. `NO_FREE_TEXT_OUTSIDE_MESSAGES` above is the half
      // that holds when nobody runs the test.
      expect(Object.keys(item)).not.toContain("content");
    }
  });
});

describe("whether a secure request is open, derived from the transcript", () => {
  it("is open when a control has no status after it", () => {
    expect(
      openSecureRequest(
        projectTranscript([
          { kind: "message", sender: "ai", content: "one moment" },
          { kind: "directive", directive: "request_secret", prompt: PROMPT },
        ]),
      ),
    ).toEqual(PROMPT);
  });

  it("is closed once any status arrives — received, consumed or expired", () => {
    for (const lifecycle of ["secret_received", "secret_consumed", "secret_expired"] as const) {
      expect(
        openSecureRequest(
          projectTranscript([
            { kind: "directive", directive: "request_secret", prompt: PROMPT },
            { kind: "secret_status", lifecycle },
          ]),
        ),
      ).toBeNull();
    }
  });

  it("is closed in an ordinary conversation with no secure turn at all", () => {
    expect(
      openSecureRequest(
        projectTranscript([{ kind: "message", sender: "user", content: "hello" }]),
      ),
    ).toBeNull();
  });

  it("tracks the LATER request when one supersedes an earlier settled one", () => {
    const second: SecretPrompt = {
      ...PROMPT,
      requestId: "sr_ffffffffffffffffffffffffffffffff" as SecretRequestId,
    };
    expect(
      openSecureRequest(
        projectTranscript([
          { kind: "directive", directive: "request_secret", prompt: PROMPT },
          { kind: "secret_status", lifecycle: "secret_expired" },
          { kind: "directive", directive: "request_secret", prompt: second },
        ]),
      ),
    ).toEqual(second);
  });
});
