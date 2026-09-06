/**
 * What may leave the system when a run stops (ADR-0071).
 *
 * The tests that matter here are the negative ones. A notice goes to a URL an
 * operator configures, which is outside every boundary this repository
 * controls, so the interesting question is not "did it arrive" but "what was in
 * it".
 */

import { describe, expect, it } from "vitest";

import type { StoredIntervention } from "@askimate/aas-case-store/interventions";
import { idempotencyKeyFor } from "@askimate/aas-domain";
import type { BlueprintVersion, CaseId, CourseId, InstitutionId, InterventionId, RunId } from "@askimate/aas-domain";

import { noticeFor, NoticeDeliveryError } from "./notice.js";
import { InsecureNotifierUrlError, WebhookNotifier, isDeliverableUrl } from "./webhook.js";

const RAISED = new Date("2026-09-06T09:00:00Z");

/**
 * An intervention with a value in every free-text field.
 *
 * The strings are what a real one could plausibly carry: a portal quoting back
 * what was typed into a field is the ordinary shape of an
 * `unfamiliar_validation_error`, and that is exactly how a value reaches prose
 * nobody audits.
 */
function held(overrides: Partial<StoredIntervention> = {}): StoredIntervention {
  return {
    interventionId: "int-1" as InterventionId,
    runId: "run_case_conv_1" as RunId,
    idempotencyKey: idempotencyKeyFor({
      runId: "run_case_conv_1" as RunId,
      action: "advance_portal_page",
      target: "page-application",
    }),
    caseId: "case_conv" as CaseId,
    studentRef: "student-4f2c",
    escalation: {
      reason: "unfamiliar_validation_error",
      priority: "high",
      encountered: 'The portal answered: "AB123456 is not a valid passport number".',
      expected: "The blueprint records no validation rule for this field.",
      checkpoint: {
        blueprintVersion: "1.4.0" as BlueprintVersion,
        action: "advance_portal_page",
        target: "page-application",
        page: "page-application",
        phase: "filling",
        pagesCompleted: ["page-account"],
        capturedAt: RAISED,
      },
      raisedAt: RAISED,
    },
    context: {
      institutionId: "inst-ulster-birmingham" as InstitutionId,
      portal: "apply.qahighereducation.com",
      courseId: "course-msc-ib" as CourseId,
      blueprintVersion: "1.4.0" as BlueprintVersion,
      page: "page-application",
    },
    lifecycle: "captured",
    ...overrides,
  };
}

describe("what a notice carries", () => {
  it("names the intervention, the case and where to look", () => {
    const notice = noticeFor(held());

    expect(notice.interventionId).toBe("int-1");
    expect(notice.runId).toBe("run_case_conv_1");
    expect(notice.caseId).toBe("case_conv");
    expect(notice.reason).toBe("unfamiliar_validation_error");
    expect(notice.priority).toBe("high");
    expect(notice.institutionId).toBe("inst-ulster-birmingham");
    expect(notice.portal).toBe("apply.qahighereducation.com");
    expect(notice.page).toBe("page-application");
    expect(notice.raisedAt).toBe(RAISED.toISOString());
  });

  it("carries NO free text from the failure", () => {
    // `encountered` here quotes a value back from the portal. It is the
    // specialist's most useful field and the one that must not go to a chat
    // channel: it is composed at the point of failure and nothing audits it.
    const serialised = JSON.stringify(noticeFor(held()));

    expect(serialised).not.toContain("AB123456");
    expect(serialised).not.toContain("not a valid passport number");
    expect(serialised).not.toContain("The blueprint records no validation rule");
  });

  it("carries NO identifier for the student", () => {
    // Pseudonymous is still personal, and it buys the specialist nothing —
    // the CLI and the internal route both take the case and the run.
    expect(JSON.stringify(noticeFor(held()))).not.toContain("student-4f2c");
  });

  it("carries NO checkpoint", () => {
    // Structured rather than free text, but it names the pages of a real
    // application in progress, and a webhook subscriber has authenticated to
    // nothing.
    const notice = noticeFor(held());
    expect(Object.keys(notice)).not.toContain("checkpoint");
    expect(JSON.stringify(notice)).not.toContain("page-account");
  });

  it("has exactly the fields it declares, and no others", () => {
    // The assertion that catches a future field added to `StoredIntervention`
    // arriving here by accident. `noticeFor` reads named fields rather than
    // spreading, so this passing is a consequence of that choice rather than a
    // restatement of it — but it fails loudly if anyone changes the choice.
    expect(Object.keys(noticeFor(held())).sort()).toEqual([
      "caseId",
      "courseId",
      "institutionId",
      "interventionId",
      "page",
      "portal",
      "priority",
      "raisedAt",
      "reason",
      "runId",
    ]);
  });

  it("omits the page when the stop was not on one", () => {
    const { page: _page, ...withoutPage } = held().context;
    const notice = noticeFor(held({ context: withoutPage }));
    expect(Object.keys(notice)).not.toContain("page");
  });
});

describe("where a notice may be sent", () => {
  it("accepts HTTPS anywhere", () => {
    expect(isDeliverableUrl(new URL("https://hooks.example.com/services/abc"))).toBe(true);
  });

  it("accepts plain HTTP only to loopback", () => {
    expect(isDeliverableUrl(new URL("http://127.0.0.1:9000/notify"))).toBe(true);
    expect(isDeliverableUrl(new URL("http://localhost:9000/notify"))).toBe(true);
    expect(isDeliverableUrl(new URL("http://[::1]:9000/notify"))).toBe(true);
  });

  it("REFUSES plain HTTP to anywhere else", () => {
    // A notice names the institution, the course and the case of a real
    // application in progress. In clear text, on somebody else's network, that
    // is not a deployment choice anyone makes on purpose.
    expect(isDeliverableUrl(new URL("http://hooks.example.com/notify"))).toBe(false);
    expect(isDeliverableUrl(new URL("http://10.0.0.7/notify"))).toBe(false);
  });

  it("REFUSES a scheme that is not HTTP at all", () => {
    expect(isDeliverableUrl(new URL("ftp://files.example.com/notify"))).toBe(false);
    expect(isDeliverableUrl(new URL("file:///tmp/notify"))).toBe(false);
  });

  it("refuses at CONSTRUCTION, not at send time", () => {
    // So a misconfigured destination stops the worker starting (ADR-0055),
    // rather than failing on the first stopped run at three in the morning.
    expect(() => new WebhookNotifier({ url: "http://hooks.example.com/notify" })).toThrow(
      InsecureNotifierUrlError,
    );
    expect(() => new WebhookNotifier({ url: "not a url" })).toThrow();
  });
});

describe("delivering a notice", () => {
  it("POSTs the notice as JSON", async () => {
    const sent: { url: string; body: unknown; contentType: string | undefined }[] = [];
    const notifier = new WebhookNotifier({
      url: "https://hooks.example.com/notify",
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        const body = init?.body;
        sent.push({
          url: url instanceof URL ? url.toString() : typeof url === "string" ? url : url.url,
          body: JSON.parse(typeof body === "string" ? body : "null") as unknown,
          contentType: headers.get("content-type") ?? undefined,
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    await notifier.notify(noticeFor(held()));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://hooks.example.com/notify");
    expect(sent[0]?.contentType).toBe("application/json");
    expect((sent[0]?.body as { interventionId: string }).interventionId).toBe("int-1");
  });

  it("THROWS when the endpoint refuses, so the caller cannot mark it delivered", async () => {
    const notifier = new WebhookNotifier({
      url: "https://hooks.example.com/notify",
      fetch: () => Promise.resolve(new Response("nope", { status: 500 })),
    });

    await expect(notifier.notify(noticeFor(held()))).rejects.toThrow(NoticeDeliveryError);
  });

  it("THROWS when the request itself fails", async () => {
    const notifier = new WebhookNotifier({
      url: "https://hooks.example.com/notify",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(notifier.notify(noticeFor(held()))).rejects.toThrow(NoticeDeliveryError);
  });

  it("does not put the endpoint's response body into the error", async () => {
    // The error goes into a log. A webhook endpoint's error page is content
    // from outside the system, and there is a measured precedent for what
    // happens when an error object carries a body it was handed
    // (`err.body`, check-boundaries).
    const notifier = new WebhookNotifier({
      url: "https://hooks.example.com/notify",
      fetch: () =>
        Promise.resolve(new Response("upstream said: token=sk-secret", { status: 502 })),
    });

    await notifier.notify(noticeFor(held())).then(
      () => expect.unreachable("a 502 is not a delivery"),
      (error: unknown) => {
        expect(String(error)).toContain("502");
        expect(String(error)).not.toContain("sk-secret");
        expect(JSON.stringify(error)).not.toContain("sk-secret");
      },
    );
  });
});
