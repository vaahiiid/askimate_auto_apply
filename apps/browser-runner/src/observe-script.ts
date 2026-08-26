/**
 * The in-page observation script.
 *
 * Runs inside the browser and returns plain data. It READS the DOM — it does
 * not click, type, focus, or dispatch events. Anything that could change page
 * state belongs to a later capability level, not to discovery.
 *
 * Kept as a standalone function so it can be unit-tested against a fixture
 * without launching a browser.
 */

import type { ObservedField, ObservedForm } from "./session.js";
import type { FieldLocator } from "@askimate/aas-blueprint";

export interface RawObservation {
  readonly forms: readonly ObservedForm[];
  readonly candidateAdvanceControls: readonly FieldLocator[];
}

/**
 * Serialised and evaluated in the page context, so it may not close over
 * anything from this module.
 */
export const OBSERVE_SCRIPT = (): RawObservation => {
  const labelFor = (element: Element): string | undefined => {
    const id = element.getAttribute("id");
    if (id !== null) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent != null) return explicit.textContent.trim();
    }
    const wrapping = element.closest("label");
    if (wrapping?.textContent != null) return wrapping.textContent.trim();
    const aria = element.getAttribute("aria-label");
    return aria ?? undefined;
  };

  const readField = (element: Element): ObservedField => {
    const tagName = element.tagName.toLowerCase();
    const attr = (name: string): string | undefined => element.getAttribute(name) ?? undefined;

    const options =
      tagName === "select"
        ? [...element.querySelectorAll("option")].map((option) => ({
            value: option.getAttribute("value") ?? option.textContent?.trim() ?? "",
            label: option.textContent?.trim() ?? "",
          }))
        : undefined;

    const maxLengthRaw = attr("maxlength");
    const maxLength = maxLengthRaw === undefined ? undefined : Number(maxLengthRaw);

    const field: Record<string, unknown> = {
      tagName,
      required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
    };
    const name = attr("name");
    if (name !== undefined) field["name"] = name;
    const id = attr("id");
    if (id !== undefined) field["id"] = id;
    const label = labelFor(element);
    if (label !== undefined) field["label"] = label;
    const type = attr("type");
    if (type !== undefined) field["type"] = type;
    const placeholder = attr("placeholder");
    if (placeholder !== undefined) field["placeholder"] = placeholder;
    if (maxLength !== undefined && Number.isFinite(maxLength)) field["maxLength"] = maxLength;
    const pattern = attr("pattern");
    if (pattern !== undefined) field["pattern"] = pattern;
    const accept = attr("accept");
    if (accept !== undefined) field["accept"] = accept;
    if (options !== undefined) field["options"] = options;

    return field as unknown as ObservedField;
  };

  const forms: ObservedForm[] = [...document.querySelectorAll("form")].map((form, index) => {
    const observed: Record<string, unknown> = {
      formIndex: index,
      fields: [...form.querySelectorAll("input, select, textarea")]
        // Hidden inputs and CSRF tokens are machinery, not questions asked of
        // the student, so they are not part of the blueprint's field list.
        .filter((element) => element.getAttribute("type") !== "hidden")
        .map(readField),
    };
    const action = form.getAttribute("action");
    if (action !== null) observed["action"] = action;
    const method = form.getAttribute("method");
    if (method !== null) observed["method"] = method;
    return observed as unknown as ObservedForm;
  });

  // Controls that plausibly advance a flow. Candidates only — which one really
  // advances is a decision for the reviewing specialist, not for a heuristic.
  const advanceWords = /\b(next|continue|proceed|save and continue|start|apply|begin)\b/i;
  const candidateAdvanceControls: FieldLocator[] = [
    ...document.querySelectorAll("button, a[href], input[type=submit], input[type=button]"),
  ]
    .filter((element) => {
      const text = (element.textContent ?? "") + " " + (element.getAttribute("value") ?? "");
      return advanceWords.test(text);
    })
    .slice(0, 20)
    .map((element) => {
      const id = element.getAttribute("id");
      if (id !== null) return { strategy: "id" as const, value: id };
      const text = (element.textContent ?? element.getAttribute("value") ?? "").trim();
      return { strategy: "label" as const, value: text };
    });

  return { forms, candidateAdvanceControls };
};
