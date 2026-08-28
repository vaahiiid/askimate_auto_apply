/**
 * The secure password control, as a React component.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"the secret input must remain outside React application
 * state; the React secure control must use an uncontrolled input."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The leak this file exists to avoid, which the vanilla prototype cannot ─
 *
 * In the plain-DOM harness the password exists only as an input element's
 * `.value`. Moving to React introduces a hazard the prototype does not have:
 * the idiomatic React input is CONTROLLED —
 *
 *     const [password, setPassword] = useState("");
 *     <input value={password} onChange={(e) => setPassword(e.target.value)} />
 *
 * — and that puts the password in component state, where it is visible in
 * React DevTools, reachable by an error boundary that serialises the tree, and
 * captured by any error reporter that snapshots component state. The value
 * also survives in the fibre until the component unmounts and is garbage
 * collected, rather than dying at the end of a submit handler.
 *
 * So this component is UNCONTROLLED. The inputs own their values; a ref reads
 * them at the moment of submission; nothing is stored, and there is no state
 * setter anywhere in this file that could accidentally receive one.
 *
 * ── What holds this rule in place ─────────────────────────────────────────
 *
 * A comment is not a mechanism. Three things enforce it:
 *
 *   1. `SecureControlProps` has no field that could carry a secret, and no
 *      callback that receives one — `onSubmitted` is handed a HANDLE.
 *   2. `SecureControl.test.tsx` renders the component, types a password, and
 *      asserts the value appears in no React internals, no serialised tree and
 *      no error-boundary capture.
 *   3. `scripts/check-boundaries.ts` forbids `useState` and a `value=` prop in
 *      this file, so making the input controlled fails the build rather than
 *      only failing a test somebody might delete.
 *
 * ── PROVISIONAL ───────────────────────────────────────────────────────────
 *
 * The MARKUP AND COPY BELOW ARE PLACEHOLDERS AND ARE NOT APPROVED. Layout,
 * styling, wording, and interaction detail are Vahid's to decide. What is
 * being proposed here is the DATA SHAPE and the STATE DISCIPLINE — where the
 * value lives, what leaves the component, and what cannot. A visual redesign
 * should be able to replace every element in the returned tree without
 * touching any of that.
 */

import { useCallback, useRef } from "react";
import type { FormEvent, JSX } from "react";

import type { SecretPrompt } from "@askimate/aas-secrets";

import { parseRejectionReason, type SecretRejectionReason } from "./chat-transport.js";

/**
 * What the component is given, and what it hands back.
 *
 * Note what is absent: no `password`, no `value`, no `defaultValue`, no
 * `onChange`. There is no prop through which a secret could be passed in, and
 * no callback through which one could escape. `onSubmitted` receives the
 * opaque handle the server minted — which resolves to nothing outside the
 * secret store — and `onRejected` receives a code from a closed set.
 */
export interface SecureControlProps {
  readonly prompt: SecretPrompt;
  readonly conversationId: number;
  /** Bearer token for the secure endpoint. Not a secret of the student's. */
  readonly authToken: string;
  readonly onSubmitted: (handle: string) => void;
  /**
   * A member of the closed set, never a bare string.
   *
   * This was `(reason: string) => void`, which is weaker than the transport it
   * feeds: the parent turns this value into a `secret_rejected` turn, and that
   * turn's `reason` is `SecretRejectionReason`. A `string` here meant the
   * narrowing happened somewhere else, or nowhere. It happens below, once, in
   * `report`.
   */
  readonly onRejected: (reason: SecretRejectionReason) => void;
  /**
   * Called when the student abandons the step.
   *
   * Deliberately a bare callback rather than a request. Cancelling is a
   * LIFECYCLE transition — `DELETE /api/askimate/secret/:id`, then a
   * `secret_status` turn — and lifecycle belongs to whoever owns the turn list.
   * This component owns exactly one piece of transport, the one that carries a
   * password, and adding a second would blur the line that makes the first one
   * auditable.
   */
  readonly onCancelled?: () => void;
  /** Injected so a test can observe the request without a live server. */
  readonly submit?: (input: {
    readonly requestId: string;
    readonly password: string;
    readonly confirmation: string;
    readonly conversationId: number;
    readonly authToken: string;
  }) => Promise<{
    readonly status: string;
    readonly handle?: string;
    readonly reason?: string;
    /** The HTTP response's `ok`. See the narrowing note in `onSubmit`. */
    readonly ok?: boolean;
  }>;
}

async function postSecret(input: {
  readonly requestId: string;
  readonly password: string;
  readonly confirmation: string;
  readonly conversationId: number;
  readonly authToken: string;
}): Promise<{ status: string; handle?: string; reason?: string; ok: boolean }> {
  const response = await fetch(`/api/askimate/secret/${input.requestId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.authToken}`,
    },
    // The one request in the whole client that carries a password.
    body: JSON.stringify({
      password: input.password,
      confirmation: input.confirmation,
      conversationId: input.conversationId,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    status?: string;
    handle?: string;
    reason?: string;
  };
  // `ok` travels with the body because the two together say something neither
  // says alone: a 500 carrying no recognisable reason is a broken endpoint,
  // while a 400 carrying an unrecognised one is a server this client is older
  // than. The narrowing below needs to tell those apart.
  return { ...body, status: body.status ?? "", ok: response.ok };
}

export function SecureControl(props: SecureControlProps): JSX.Element {
  // Refs, not state. The elements own the values; these are handles to the
  // elements, and they hold no copy of anything typed.
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const say = useCallback((message: string): void => {
    // Written straight to the DOM rather than through state, for the same
    // reason as the inputs: an error message assembled near a password is a
    // place a password ends up. This one is a fixed string in every branch.
    if (errorRef.current !== null) errorRef.current.textContent = message;
  }, []);

  const clear = useCallback((): void => {
    if (passwordRef.current !== null) passwordRef.current.value = "";
    if (confirmationRef.current !== null) confirmationRef.current.value = "";
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();

      // Read at the moment of use. These two locals are the entire lifetime of
      // the password inside this component: they are not assigned to a ref,
      // not closed over by anything that outlives this call, and not put in
      // state. When this function returns they are unreachable.
      const password = passwordRef.current?.value ?? "";
      const confirmation = confirmationRef.current?.value ?? "";

      if (password.length === 0) {
        say("Please enter a password.");
        return;
      }
      if (props.prompt.requiresConfirmation && password !== confirmation) {
        // Cleared before the message, so a retry starts from empty fields.
        // Checked again on the server, which is the check that counts.
        clear();
        say("The two passwords did not match. Please try again.");
        return;
      }

      const send = props.submit ?? postSecret;
      void send({
        requestId: props.prompt.requestId,
        password,
        confirmation,
        conversationId: props.conversationId,
        authToken: props.authToken,
      })
        .then((result) => {
          clear();
          if (result.status === "secret_received" && result.handle !== undefined) {
            props.onSubmitted(result.handle);
            return;
          }

          // ── The one narrowing point ─────────────────────────────────────
          //
          // `result.reason` came off the wire, so it is a string that hopes to
          // be a reason. `secret-routes.ts` asserts at compile time that every
          // reason the endpoint returns is a member of the closed set, so a
          // value outside it did not come from a build matching this one — and
          // the two ways that happens want different codes:
          //
          //   - a response that named SOMETHING unrecognised is a server
          //     speaking a protocol this client does not know;
          //   - a response that named nothing usable — a 500, a proxy error
          //     page, a body that would not parse — is an endpoint that did not
          //     answer, which is what `endpoint_unreachable` already means.
          const reason =
            parseRejectionReason(result.reason) ??
            (typeof result.reason === "string" && result.reason.length > 0
              ? "client_does_not_support_secure_control"
              : "endpoint_unreachable");

          if (reason === "confirmation_mismatch") {
            say("The two passwords did not match. Please try again.");
          } else {
            say(
              "I could not accept that password. I will ask you again in a moment. " +
                "Do not type it into the chat.",
            );
          }
          props.onRejected(reason);
        })
        .catch(() => {
          // A dropped connection mid-submission. Clear, say nothing about what
          // was typed, and never route it to the ordinary chat.
          clear();
          say("I could not reach the secure service. Do not type it into the chat.");
          props.onRejected("endpoint_unreachable");
        });
    },
    [clear, props, say],
  );

  return (
    // PROVISIONAL MARKUP — not an approved design.
    <section className="secure-control" aria-live="polite" data-testid="secure-control">
      <h2>{props.prompt.title}</h2>
      <p>{props.prompt.explanation}</p>
      <p>{`For your account on ${props.prompt.portalHost}.`}</p>

      {/*
        Its OWN form. Not nested in the composer's, and sharing no submit
        handler with it, so a stray Enter in the password field submits here
        and cannot reach the message pipeline. The inputs carry no `name`, so
        no other submit path could pick them up either.
      */}
      <form onSubmit={onSubmit} autoComplete="off" data-testid="secure-form">
        <label>
          Password
          <input
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            data-testid="secure-password"
            required
          />
        </label>
        {props.prompt.requiresConfirmation ? (
          <label>
            Confirm password
            <input
              ref={confirmationRef}
              type="password"
              autoComplete="new-password"
              data-testid="secure-confirmation"
            />
          </label>
        ) : null}
        <button type="submit" data-testid="secure-submit">
          Set password
        </button>
        {props.onCancelled === undefined ? null : (
          <button
            type="button"
            data-testid="secure-cancel"
            onClick={() => {
              clear();
              props.onCancelled?.();
            }}
          >
            Cancel
          </button>
        )}
      </form>

      <p ref={errorRef} role="alert" data-testid="secure-error" />
    </section>
  );
}
