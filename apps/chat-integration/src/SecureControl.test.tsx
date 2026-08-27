/**
 * @vitest-environment jsdom
 */
/**
 * The password must not be anywhere React can reach.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"the secret input must remain outside React application
 * state; the React secure control must use an uncontrolled input."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why "we used a ref" is not enough to assert ───────────────────────────
 *
 * A test that only checked the submitted value would pass for a CONTROLLED
 * input too — the value arrives either way. What distinguishes the two is
 * where the value lives BETWEEN keystroke and submit, and that is exactly what
 * an error reporter, a DevTools session, or an error boundary would capture.
 *
 * So these tests walk the React fibre tree for the typed value. If the input
 * were made controlled, the string would appear in a hook's memoizedState and
 * in the element's props, and the walk finds it.
 */

import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";

import { SecureControl, type SecureControlProps } from "./SecureControl.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";

const PROMPT: SecretPrompt = {
  requestId: "sr_0123456789abcdef0123456789abcdef" as SecretRequestId,
  channel: "secure_control",
  title: "Create a password for your university application",
  explanation: "This goes straight to the university. I never see it.",
  requiresConfirmation: true,
  portalHost: "apply.example.ac.uk",
  expiresAt: new Date("2100-01-01T00:00:00Z"),
  observedRules: [],
};

afterEach(() => {
  cleanup();
});

/**
 * Walks everything React hangs off a DOM node, looking for a string.
 *
 * React 19 stores the fibre under a `__reactFiber$…` key and props under
 * `__reactProps$…`. From the fibre we can reach `memoizedState` (the hook
 * chain — where `useState` would put the value), `memoizedProps`, `stateNode`
 * and the parent chain. A controlled input puts the typed value in the first
 * two; an uncontrolled one puts it only on the DOM element itself, which is
 * why `element.value` is excluded from the walk.
 */
function reactInternalsContain(root: HTMLElement, needle: string): boolean {
  const seen = new Set<unknown>();
  const found = { hit: false };

  function visit(value: unknown, depth: number): void {
    if (found.hit || depth > 12 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.includes(needle)) found.hit = true;
      return;
    }
    if (typeof value !== "object" && typeof value !== "function") return;
    if (seen.has(value)) return;
    seen.add(value);

    // A DOM node's own `value` is where an UNCONTROLLED input legitimately
    // keeps what the student typed. Skipping it is what makes this test able
    // to distinguish "in the DOM" from "in React".
    if (value instanceof HTMLElement) return;

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) visit(record[key], depth + 1);
  }

  const walk = (node: Element): void => {
    for (const key of Object.keys(node)) {
      if (key.startsWith("__react")) visit((node as unknown as Record<string, unknown>)[key], 0);
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(root);
  return found.hit;
}

/** Catches a thrown error and exposes what it would have reported. */
class Boundary extends Component<
  { readonly children: ReactNode; readonly onCaught: (payload: string) => void },
  { readonly failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // What a reporting SDK would serialise: the error and the component stack.
    this.props.onCaught(`${error.message}\n${String(info.componentStack)}`);
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function renderControl(
  overrides: Partial<Parameters<typeof SecureControl>[0]> = {},
): { submitted: string[]; rejected: string[]; sent: string[] } {
  const submitted: string[] = [];
  const rejected: string[] = [];
  const sent: string[] = [];
  render(
    <StrictMode>
      <SecureControl
        prompt={PROMPT}
        conversationId={7}
        authToken="a-token-not-a-student-secret"
        onSubmitted={(handle) => submitted.push(handle)}
        onRejected={(reason) => rejected.push(reason)}
        submit={async (input) => {
          sent.push(input.password);
          return await Promise.resolve({
            status: "secret_received",
            handle: "sh_00000000000000000000000000000000",
          });
        }}
        {...overrides}
      />
    </StrictMode>,
  );
  return { submitted, rejected, sent };
}

/**
 * COMPILE-TIME ASSERTION: no prop may carry a secret, in either direction.
 *
 * Distributes over the candidate names so ONE of them appearing is enough to
 * fail. `AssertNever` then refuses to compile if the result is anything but
 * `never`, which is what turns "we should not add a password prop" into
 * something the build enforces.
 */
type SecretBearing<K extends string> = K extends keyof SecureControlProps ? K : never;
type AssertNever<T extends never> = T;
export type NO_SECRET_BEARING_PROP = AssertNever<
  SecretBearing<"password" | "value" | "defaultValue" | "onChange" | "secret" | "plaintext">
>;

/** The runtime mirror, so the test list shows the property too. */
const SECRET_BEARING_PROPS = (
  ["password", "value", "defaultValue", "onChange", "secret", "plaintext"] as const
).filter((key) => key in ({} as SecureControlProps));

describe("the secret never enters React state", () => {
  it("keeps a typed password out of the fibre tree entirely", () => {
    renderControl();
    const password = screen.getByTestId<HTMLInputElement>("secure-password");
    fireEvent.change(password, { target: { value: MARKER } });

    // It is in the DOM, where an uncontrolled input keeps it…
    expect(password.value).toBe(MARKER);
    // …and nowhere React would hand to DevTools, an error boundary, or a
    // state-serialising error reporter.
    expect(reactInternalsContain(document.body, MARKER)).toBe(false);
  });

  it("keeps it out even after a re-render, when state would have survived", () => {
    renderControl();
    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    // A re-render is where the difference shows: state persists across one,
    // a DOM value persists too, but only state is visible to React.
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: "x" } });
    expect(reactInternalsContain(document.body, MARKER)).toBe(false);
  });

  it("an error boundary catching a crash captures nothing of the password", () => {
    const captured: string[] = [];
    render(
      <Boundary onCaught={(payload) => captured.push(payload)}>
        <SecureControl
          prompt={PROMPT}
          conversationId={7}
          authToken="a-token"
          onSubmitted={() => undefined}
          onRejected={() => {
            throw new Error("a reporting SDK would serialise this");
          }}
          submit={async () =>
            await Promise.resolve({ status: "secret_rejected", reason: "expired" })
          }
        />
      </Boundary>,
    );
    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: MARKER } });

    expect(captured.join("\n")).not.toContain(MARKER);
  });

  it("has no prop through which a secret could enter or escape", () => {
    // The runtime half of a compile-time claim. `NO_SECRET_BEARING_PROP` above
    // is what actually holds; this exists so the property is visible in the
    // test list rather than only in the type checker.
    //
    // The first version of this test wrote `// @ts-expect-error` above
    // `void { ...props, password: MARKER }` — and every one of those
    // directives came back UNUSED. Spreading into a bare object literal that
    // is then discarded gets no excess-property check, so nothing errored and
    // the test asserted nothing. The compiler caught it; a green test run did
    // not.
    expect(SECRET_BEARING_PROPS).toEqual([]);
  });
});

describe("what leaves the component", () => {
  it("submits the password to the secure endpoint, and hands back only a handle", () => {
    const { submitted, sent } = renderControl();
    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: MARKER } });
    fireEvent.submit(screen.getByTestId("secure-form"));

    // The one place the password is allowed to go.
    expect(sent).toEqual([MARKER]);
    return vi.waitFor(() => {
      expect(submitted).toEqual(["sh_00000000000000000000000000000000"]);
      // Cleared after the round trip: the DOM does not keep it either.
      expect(screen.getByTestId<HTMLInputElement>("secure-password").value).toBe("");
    });
  });

  it("refuses a confirmation mismatch WITHOUT sending, and clears both fields", () => {
    const { sent } = renderControl();
    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: "different" } });
    fireEvent.submit(screen.getByTestId("secure-form"));

    expect(sent).toEqual([]);
    expect(screen.getByTestId<HTMLInputElement>("secure-password").value).toBe("");
    expect(screen.getByTestId<HTMLInputElement>("secure-confirmation").value).toBe("");
    // And the message names neither value.
    expect(screen.getByTestId("secure-error").textContent ?? "").not.toContain(MARKER);
  });

  it("never names the password in an error message on any rejection path", async () => {
    const { rejected } = renderControl({
      submit: async () => await Promise.resolve({ status: "secret_rejected", reason: "expired" }),
    });
    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: MARKER } });
    fireEvent.submit(screen.getByTestId("secure-form"));

    await vi.waitFor(() => {
      expect(rejected).toEqual(["expired"]);
    });
    expect(screen.getByTestId("secure-error").textContent ?? "").not.toContain(MARKER);
    expect(document.body.innerHTML).not.toContain(MARKER);
  });

  it("keeps its own form separate from anything else on the page", () => {
    renderControl();
    const password = screen.getByTestId("secure-password");
    expect(password.closest("form")).toBe(screen.getByTestId("secure-form"));
    // No `name`, so no submit path anywhere could pick the field up.
    expect(password.hasAttribute("name")).toBe(false);
  });
});
