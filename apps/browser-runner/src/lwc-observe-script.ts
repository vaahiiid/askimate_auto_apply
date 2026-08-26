/**
 * An observer that can read a Salesforce Lightning (LWC) interface.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Why the old one saw nothing.
 *
 * The controlled inspection run rendered the QA Higher Education registration
 * page perfectly — the screenshot shows nine controls, a password policy, two
 * dropdowns, a checkbox group and a Create Account button. The extractor
 * reported **0 forms, 0 fields**.
 *
 * The cause was one line: `observe-script.ts` built its field list from
 * `document.querySelectorAll("form")` and then read `form.querySelectorAll(…)`.
 *
 * **Salesforce LWC renders no `<form>` element at all.** Zero, on the real
 * page. No form ancestor, therefore no fields, therefore an empty observation
 * of a page that was fully drawn.
 *
 * It was not the accessibility tree and not a timing problem.
 *
 * ── A correction: this portal DOES use native shadow DOM ──────────────────
 *
 * An earlier version of this comment said Experience Cloud ran LWC in
 * *synthetic* shadow mode, on the evidence that `pages/*.html` showed the
 * markup in the light DOM with `lwc-*` scoping attributes. That was wrong, and
 * wrong for an instructive reason: `page.content()` FLATTENS shadow content
 * when it serialises, so a saved capture cannot tell you which mode the live
 * page used.
 *
 * The run of 2026-08-26T18:10 settled it. Its Playwright trace records the
 * live DOM as `["template", {"__playwright_shadow_root_": "open"}, …]` around
 * every `lightning-input` — **real, open shadow roots.**
 *
 * That matters here because `Element.parentElement` STOPS at a shadow
 * boundary. Walking up from an `<input>` inside `lightning-input` returns
 * null at the top of its shadow root rather than continuing to the host, so
 * any rule that climbs the tree silently gets a truncated one. Live, that made
 * Date of Birth and the applicant-type combobox look optional and left the
 * marketing checkbox group with no label — none of which reproduced against
 * the flattened capture, because flattening had removed the boundary.
 *
 * So every ancestor walk in this file uses `ascend`, which crosses into the
 * host, and every by-id lookup is scoped to the node's own root.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What LWC does that a plain-HTML observer gets wrong ───────────────────
 *
 * | | Plain HTML | What the portal actually serves |
 * |---|---|---|
 * | grouping | `<form>` | nothing — components sit loose in a `<div>` |
 * | naming | `name="firstName"` | **no `name` at all**; `id="input-13"`, regenerated per render |
 * | labelling | `<label for=…>` | a label inside the component, plus `placeholder`, plus `aria-label` |
 * | required | `required` | `required` on inputs, but `<abbr title="required">*</abbr>` on comboboxes |
 * | select | `<select><option>` | `<button role="combobox">` whose options do not exist until it is opened |
 * | checkboxes | `<input type=checkbox>` | `<lightning-checkbox-group>` with an **empty** control container |
 *
 * ── The rule this file follows ────────────────────────────────────────────
 *
 * **It reads. It never acts.** No click to open a dropdown, no focus, no
 * dispatch, no attribute write. Where a control's options are genuinely not in
 * the DOM, it records *why they are unavailable* rather than opening the
 * control to find out. A closed combobox is a fact about the page, and getting
 * its options is a job for a session that is allowed to click — which this one
 * is not, and must never become.
 *
 * Every label carries the attribute it came from, because "First Name" read
 * from a `placeholder` and "First Name" read from a `<label for>` are not
 * equally good evidence, and the mapping specialist needs to know which.
 */

/** Where a label was found. Ordered best-first; the observer records which won. */
export type LabelSource =
  | "label_for"
  | "wrapping_label"
  | "aria_labelledby"
  | "component_label"
  | "aria_label"
  | "legend"
  | "placeholder"
  | "adjacent_text"
  | "none";

/** Where required-ness was established. */
export type RequiredSource =
  | "required_attribute"
  | "aria_required"
  | "abbr_in_label"
  | "asterisk_marker"
  | "not_observed";

/** What kind of control this is, in the portal's own terms. */
export type LwcControlKind =
  | "text"
  | "email"
  | "password"
  | "date"
  | "number"
  | "tel"
  | "textarea"
  | "select"
  | "combobox"
  | "checkbox"
  | "checkbox_group"
  | "radio_group"
  | "file"
  | "button"
  | "link"
  | "unknown";

export interface LwcOption {
  readonly value: string;
  readonly label: string;
}

export interface LwcControl {
  /** A stable-ish reference. See `stability` — LWC ids are regenerated. */
  readonly ref: string;
  readonly kind: LwcControlKind;
  readonly label: string;
  readonly labelSource: LabelSource;
  readonly required: boolean;
  readonly requiredSource: RequiredSource;
  readonly disabled: boolean;
  /** `name`, when the portal supplies one. LWC usually does not. */
  readonly name?: string;
  readonly id?: string;
  readonly placeholder?: string;
  readonly autocomplete?: string;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly accept?: string;
  /** Options, when they exist in the DOM without opening anything. */
  readonly options?: readonly LwcOption[];
  /** Why options are absent, when they are. */
  readonly optionsUnavailable?: string;
  /** Text from `aria-describedby`, and constraint text near the control. */
  readonly helpText: readonly string[];
  /** The custom-element ancestry, outermost first: `c-registration > lightning-input`. */
  readonly componentPath: readonly string[];
  /** How likely the locator is to survive a re-render. */
  readonly stability: "stable" | "generated" | "positional";
  /** Selectors a later fill layer could use, best first. Read-only advice. */
  readonly locators: readonly string[];
}

export interface LwcButton {
  readonly ref: string;
  readonly text: string;
  readonly disabled: boolean;
  readonly type: string;
  readonly componentPath: readonly string[];
}

export interface LwcLink {
  readonly text: string;
  readonly href: string;
}

export interface LwcObservation {
  readonly controls: readonly LwcControl[];
  readonly buttons: readonly LwcButton[];
  readonly links: readonly LwcLink[];
  /** Free-standing instruction text: password rules, applicant-type guidance. */
  readonly instructions: readonly string[];
  /** Custom-element tag names present, with counts. The component structure. */
  readonly components: readonly { readonly tag: string; readonly count: number }[];
  /** True when the page contains no `<form>` element, which for LWC is normal. */
  readonly formless: boolean;
  /** Notes about what could not be observed and why. */
  readonly limitations: readonly string[];
}

/**
 * Runs in the page. Serialised by Playwright, so it must be self-contained.
 *
 * Written as one function expression for that reason: no imports, no closures
 * over module scope, no helpers defined outside it.
 */
export const LWC_OBSERVE_SCRIPT = (): LwcObservation => {
  // ── Deep element walk, through shadow roots where they are real ─────────
  const all: Element[] = [];
  const walk = (root: Document | ShadowRoot | Element): void => {
    const children = root.querySelectorAll("*");
    for (const element of children) {
      all.push(element);
      const shadow = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (shadow != null) walk(shadow);
    }
  };
  walk(document);

  const text = (node: Element | null | undefined): string =>
    (node?.textContent ?? "").replace(/\s+/g, " ").trim();

  const visible = (element: Element): boolean => {
    const rects = element.getClientRects();
    if (rects.length === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  /**
   * One step up the tree, CROSSING shadow boundaries.
   *
   * `parentElement` is null at the top of a shadow root. This continues from
   * the root's host, which is what "up" means on a page built out of
   * components. Every ancestor walk here goes through this.
   */
  const ascend = (node: Element): Element | null => {
    if (node.parentElement !== null) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };

  /**
   * Counts controls under a node, THROUGH shadow roots.
   *
   * `querySelectorAll` does not pierce a shadow boundary, so on the live
   * portal a field container reported ZERO controls — its input lives in
   * `lightning-input`'s shadow root. Both the marker test and the climb's stop
   * condition read as "this holds nothing", which is the opposite of true.
   */
  const CONTROL_QUERY =
    'input:not([type="hidden"]), textarea, select, [role="combobox"], ' +
    "lightning-checkbox-group, lightning-radio-group";

  const countControls = (node: Element | ShadowRoot): number => {
    let total = node.querySelectorAll(CONTROL_QUERY).length;
    for (const child of node.querySelectorAll("*")) {
      const shadow = (child as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (shadow != null) total += countControls(shadow);
    }
    return total;
  };

  /** The document or shadow root a node belongs to, for by-id lookups. */
  const rootOf = (node: Element): Document | ShadowRoot => {
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root : document;
  };

  /** Looks an id up in the node's own root first, then the document. */
  const byId = (node: Element, id: string): Element | null =>
    rootOf(node).querySelector(`#${CSS.escape(id)}`) ?? document.getElementById(id);

  /** A label or legend inside this element, including its shadow root. */
  const innerLabel = (element: Element): Element | null =>
    element.querySelector("label, legend") ??
    (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot?.querySelector(
      "label, legend",
    ) ??
    null;

  /** The chain of custom elements above this node, outermost first. */
  const componentPath = (element: Element): string[] => {
    const path: string[] = [];
    let current: Element | null = ascend(element);
    while (current != null) {
      const tag = current.tagName.toLowerCase();
      if (tag.includes("-")) path.unshift(tag);
      current = ascend(current);
    }
    return path.slice(-4);
  };

  /** The nearest LWC component wrapping this control, for label lookup. */
  const componentHost = (element: Element): Element | null => {
    let current: Element | null = ascend(element);
    while (current != null) {
      const tag = current.tagName.toLowerCase();
      if (tag.startsWith("lightning-") || tag.startsWith("c-")) return current;
      current = ascend(current);
    }
    return null;
  };

  /**
   * Finds the label, best source first.
   *
   * `placeholder` is deliberately last but deliberately present: on this
   * portal several fields carry their visible text ONLY as a placeholder, so
   * refusing to read it would lose real labels. The source is recorded so a
   * reviewer can weigh it.
   */
  const labelFor = (element: Element): { label: string; source: LabelSource } => {
    const id = element.getAttribute("id");
    if (id != null && id !== "") {
      const explicit =
        rootOf(element).querySelector(`label[for="${CSS.escape(id)}"]`) ??
        document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit != null && text(explicit) !== "") {
        return { label: stripMarker(text(explicit)), source: "label_for" };
      }
    }

    const wrapping = element.closest("label");
    if (wrapping != null && text(wrapping) !== "") {
      return { label: stripMarker(text(wrapping)), source: "wrapping_label" };
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy != null && labelledBy !== "") {
      const parts = labelledBy
        .split(/\s+/)
        .map((token) => text(byId(element, token)))
        .filter((value) => value !== "");
      if (parts.length > 0) return { label: stripMarker(parts.join(" ")), source: "aria_labelledby" };
    }

    // The component's own label — LWC puts it inside the host, often marked
    // slds-assistive-text so it is visually hidden but perfectly readable.
    //
    // When the control IS a component (lightning-checkbox-group), look inside
    // ITSELF first. Going straight to the ancestor walked all the way up to
    // <c-registration> and returned the first label in the whole form, so the
    // marketing checkbox group came back labelled "First Name".
    const ownTag = element.tagName.toLowerCase();
    if (ownTag.includes("-")) {
      // Including this element's OWN shadow root — a lightning-checkbox-group
      // keeps its <legend> in there, and plain querySelector does not look.
      const own = innerLabel(element);
      if (own != null && text(own) !== "") {
        return { label: stripMarker(text(own)), source: "component_label" };
      }
    }

    const host = componentHost(element);
    if (host != null && host.tagName.toLowerCase().startsWith("lightning-")) {
      // Only a `lightning-*` host, never a page-level `c-*` component: the
      // latter contains every label on the page.
      const inner = innerLabel(host);
      if (inner != null && text(inner) !== "") {
        return { label: stripMarker(text(inner)), source: "component_label" };
      }
    }

    const aria = element.getAttribute("aria-label");
    if (aria != null && aria !== "") return { label: stripMarker(aria), source: "aria_label" };

    const fieldset = element.closest("fieldset");
    const legend = fieldset?.querySelector("legend");
    if (legend != null && text(legend) !== "") {
      return { label: stripMarker(text(legend)), source: "legend" };
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder != null && placeholder !== "") {
      return { label: placeholder, source: "placeholder" };
    }

    return { label: "", source: "none" };
  };

  /** Drops the leading asterisk LWC renders inside a required label. */
  const stripMarker = (value: string): string => value.replace(/^\*\s*/, "").trim();

  const requiredFor = (element: Element): { required: boolean; source: RequiredSource } => {
    if (element.hasAttribute("required")) {
      return { required: true, source: "required_attribute" };
    }
    if (element.getAttribute("aria-required") === "true") {
      return { required: true, source: "aria_required" };
    }

    // The control's OWN label, never one borrowed from an ancestor. Going up
    // to <c-registration> and taking its first label returned First Name's
    // markup for every unlabelled control, which made the optional marketing
    // checkbox group required — the same ancestor-borrowing mistake the label
    // lookup made, with a worse consequence.
    const id = element.getAttribute("id");
    const host = componentHost(element);
    const ownLabel =
      (id != null && id !== ""
        ? rootOf(element).querySelector(`label[for="${CSS.escape(id)}"]`)
        : null) ??
      (element.tagName.toLowerCase().includes("-") ? innerLabel(element) : null) ??
      (host != null && host.tagName.toLowerCase().startsWith("lightning-")
        ? innerLabel(host)
        : null);

    if (ownLabel?.querySelector('abbr[title="required"]') != null) {
      return { required: true, source: "abbr_in_label" };
    }

    // This portal marks a required control with an asterisk in a PRECEDING
    // SIBLING container rather than with aria-required, which reads `false` on
    // the control itself:
    //
    //   <div><p class="qahe-error_text">*</p></div>      ← the marker
    //   <div class="qahe-reg-input"><lightning-input …>  ← the control
    //
    // The marker sits beside the control's own wrapper, and the wrapper is at
    // a different depth for every kind of control: 5 levels above a date
    // input, 8 above a combobox, and 0 above a checkbox group. Two earlier
    // attempts got this wrong in both directions — a fixed depth of six missed
    // the comboboxes, and climbing to the outermost single-control ancestor
    // overshot and gave the optional marketing checkbox the asterisk belonging
    // to the field above it.
    //
    // What works is to check the siblings at EVERY level while climbing, and
    // to stop the moment an ancestor holds more than one control: such an
    // ancestor is a shared container and its siblings belong to somebody else.
    // Only the IMMEDIATE previous sibling. Every marker on this page sits
    // directly before its control's wrapper; looking two or three back reached
    // the previous field's marker and made the optional marketing checkbox
    // required, which is the one error here with a real consequence — it would
    // have the automation demand consent a student does not have to give.
    let node: Element = element;
    for (;;) {
      const sibling = node.previousElementSibling;
      // A marker holds the asterisk and nothing else. Checking the text alone
      // is not enough once the walk crosses shadow boundaries: a whole FIELD
      // container's textContent is also exactly "*", because inputs
      // contribute no text and the only text in it is its own marker. That
      // made an unmarked field inherit the asterisk of the field above it.
      if (sibling !== null && text(sibling) === "*" && countControls(sibling) === 0) {
        return { required: true, source: "asterisk_marker" };
      }
      // `ascend`, not `parentElement`. The marker sits beside the field's
      // wrapper in the LIGHT dom, and the control is inside a shadow root, so
      // a walk that stops at the boundary never reaches it. That is exactly
      // what happened live: Date of Birth and the applicant-type combobox
      // reported "not_observed" against a screenshot showing both asterisked.
      const parent = ascend(node);
      if (parent === null || countControls(parent) > 1) break;
      node = parent;
    }

    return { required: false, source: "not_observed" };
  };

  const helpFor = (element: Element): string[] => {
    const notes: string[] = [];
    const describedBy = element.getAttribute("aria-describedby");
    if (describedBy != null) {
      for (const token of describedBy.split(/\s+/)) {
        const value = text(byId(element, token));
        if (value !== "") notes.push(value);
      }
    }
    return notes;
  };

  const kindOf = (element: Element): LwcControlKind => {
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (element.getAttribute("role") === "combobox") return "combobox";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      const known: LwcControlKind[] = [
        "text", "email", "password", "date", "number", "tel", "checkbox", "file",
      ];
      return (known as string[]).includes(type) ? (type as LwcControlKind) : "text";
    }
    if (tag === "lightning-checkbox-group") return "checkbox_group";
    if (tag === "lightning-radio-group") return "radio_group";
    return "unknown";
  };

  const locatorsFor = (element: Element): { locators: string[]; stability: LwcControl["stability"] } => {
    const locators: string[] = [];
    const name = element.getAttribute("name");
    const id = element.getAttribute("id");
    const placeholder = element.getAttribute("placeholder");
    const ariaLabel = element.getAttribute("aria-label");

    // `data-id` on the enclosing component is the best locator this portal
    // offers: semantic (`firstName`, `dateOfBirth`), author-written, and not
    // regenerated the way `input-13` is. Worth preferring over everything else.
    //
    // `closest` does not cross shadow boundaries, and on the live portal the
    // host carrying data-id is in the LIGHT dom above the control's shadow
    // root — so the best locator silently disappeared there while still
    // working against a flattened capture.
    let dataIdHost: Element | null = element;
    while (dataIdHost !== null && !dataIdHost.hasAttribute("data-id")) {
      dataIdHost = ascend(dataIdHost);
    }
    const dataId = dataIdHost?.getAttribute("data-id");
    if (dataId != null && dataId !== "") locators.push(`[data-id="${dataId}"]`);

    if (name != null && name !== "" && name !== "progress") locators.push(`[name="${name}"]`);
    if (placeholder != null && placeholder !== "") locators.push(`[placeholder="${placeholder}"]`);
    if (ariaLabel != null && ariaLabel !== "") locators.push(`[aria-label="${ariaLabel}"]`);
    if (id != null && id !== "") locators.push(`#${id}`);

    // LWC ids look like `input-13` / `combobox-button-49` and are regenerated
    // on every render, so an id is a locator of last resort here rather than
    // the obvious first choice it would be on an ordinary page.
    const generated = id != null && /^(input|combobox-button|checkbox|radio)-\d+$/.test(id);
    const stability =
      dataId != null && dataId !== ""
        ? "stable"
        : name != null && name !== "" && name !== "progress"
          ? "stable"
          : placeholder != null || ariaLabel != null
            ? "stable"
            : generated
              ? "generated"
              : "positional";

    return { locators, stability };
  };

  // ── Controls ────────────────────────────────────────────────────────────
  const controls: LwcControl[] = [];
  let index = 0;

  const CONTROL_SELECTOR =
    'input, textarea, select, [role="combobox"], lightning-checkbox-group, lightning-radio-group';

  for (const element of all) {
    if (!element.matches(CONTROL_SELECTOR)) continue;
    if (element.getAttribute("type") === "hidden") continue;
    if (!visible(element)) continue;

    const kind = kindOf(element);
    const { label, source } = labelFor(element);
    const { required, source: requiredSource } = requiredFor(element);
    const { locators, stability } = locatorsFor(element);

    let options: LwcOption[] | undefined;
    let optionsUnavailable: string | undefined;

    if (kind === "select") {
      options = [...element.querySelectorAll("option")].map((option) => ({
        value: option.getAttribute("value") ?? "",
        label: text(option),
      }));
    } else if (kind === "combobox") {
      // The listbox this combobox controls, IF the portal has populated it.
      const controlsId = element.getAttribute("aria-controls");
      const listbox = controlsId != null ? byId(element, controlsId) : null;
      const items = listbox?.querySelectorAll('[role="option"]') ?? [];
      if (items.length > 0) {
        options = [...items].map((item) => ({
          value: item.getAttribute("data-value") ?? text(item),
          label: text(item),
        }));
      } else {
        optionsUnavailable =
          "The listbox is empty until the combobox is opened. Reading the options would mean " +
          "clicking, and this observer never acts.";
      }
    } else if (kind === "checkbox_group" || kind === "radio_group") {
      const boxes = element.querySelectorAll('input[type="checkbox"], input[type="radio"]');
      if (boxes.length > 0) {
        options = [...boxes].map((box) => ({
          value: box.getAttribute("value") ?? "",
          label: labelFor(box).label,
        }));
      } else {
        optionsUnavailable =
          "The group's control container is empty — the component had not populated its options " +
          "at the moment of observation.";
      }
    }

    index += 1;
    controls.push({
      ref: `control-${String(index)}`,
      kind,
      label,
      labelSource: source,
      required,
      requiredSource,
      disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
      ...(element.getAttribute("name") != null ? { name: element.getAttribute("name") as string } : {}),
      ...(element.getAttribute("id") != null ? { id: element.getAttribute("id") as string } : {}),
      ...(element.getAttribute("placeholder") != null
        ? { placeholder: element.getAttribute("placeholder") as string }
        : {}),
      ...(element.getAttribute("autocomplete") != null
        ? { autocomplete: element.getAttribute("autocomplete") as string }
        : {}),
      ...(element.getAttribute("maxlength") != null
        ? { maxLength: Number(element.getAttribute("maxlength")) }
        : {}),
      ...(element.getAttribute("pattern") != null
        ? { pattern: element.getAttribute("pattern") as string }
        : {}),
      ...(element.getAttribute("accept") != null
        ? { accept: element.getAttribute("accept") as string }
        : {}),
      ...(options !== undefined ? { options } : {}),
      ...(optionsUnavailable !== undefined ? { optionsUnavailable } : {}),
      helpText: helpFor(element),
      componentPath: componentPath(element),
      stability,
      locators,
    });
  }

  // ── Buttons ─────────────────────────────────────────────────────────────
  const buttons: LwcButton[] = [];
  let buttonIndex = 0;
  for (const element of all) {
    if (!element.matches('button, input[type="submit"], input[type="button"], [role="button"]')) {
      continue;
    }
    // A combobox trigger is a button element, but it is a control, not an action.
    if (element.getAttribute("role") === "combobox") continue;
    if (!visible(element)) continue;

    const label = text(element) || element.getAttribute("aria-label") || "";
    if (label === "") continue;

    buttonIndex += 1;
    buttons.push({
      ref: `button-${String(buttonIndex)}`,
      text: label,
      disabled:
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
      type: element.getAttribute("type") ?? "button",
      componentPath: componentPath(element),
    });
  }

  // ── Links ───────────────────────────────────────────────────────────────
  const links: LwcLink[] = [];
  for (const element of all) {
    if (!element.matches("a[href]")) continue;
    if (!visible(element)) continue;
    const label = text(element);
    if (label === "") continue;
    links.push({ text: label, href: (element as HTMLAnchorElement).href });
  }

  // ── Instruction text ────────────────────────────────────────────────────
  //
  // The password policy and the applicant-type guidance are plain paragraphs
  // next to the controls, not help text wired by aria-describedby. They are
  // requirements a student has to satisfy, so they are worth capturing.
  const instructions: string[] = [];
  for (const element of all) {
    if (!element.matches("p, li, legend, h1, h2, h3")) continue;
    if (!visible(element)) continue;
    if (element.querySelector("p, li")) continue;
    const value = text(element);
    if (value.length < 3 || value.length > 400) continue;
    if (value === "*") continue;
    if (!instructions.includes(value)) instructions.push(value);
  }

  // ── Component structure ─────────────────────────────────────────────────
  const counts = new Map<string, number>();
  for (const element of all) {
    const tag = element.tagName.toLowerCase();
    if (!tag.includes("-")) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const components = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  // ── What could not be seen, and why ─────────────────────────────────────
  const limitations: string[] = [];
  const formless = document.querySelectorAll("form").length === 0;
  if (formless) {
    limitations.push(
      "The page contains no <form> element. That is normal for Lightning Web Components and it " +
        "is why a form-based extractor reports nothing here.",
    );
  }
  const closedComboboxes = controls.filter((control) => control.optionsUnavailable !== undefined);
  if (closedComboboxes.length > 0) {
    limitations.push(
      `${String(closedComboboxes.length)} control(s) have options that are not in the DOM: ` +
        `${closedComboboxes.map((control) => control.label || control.ref).join(", ")}. ` +
        `Reading them requires opening the control, which this observer will not do.`,
    );
  }
  // A `name` is only useful if it identifies the field. LWC comboboxes carry a
  // framework name (`name="progress"`) shared between controls, which is worse
  // than none: it looks like a locator and identifies nothing.
  const usefullyNamed = controls.filter(
    (control) => control.name !== undefined && control.name !== "progress",
  );
  if (usefullyNamed.length < controls.length) {
    limitations.push(
      `${String(controls.length - usefullyNamed.length)} control(s) have no usable name ` +
        `attribute; several carry generated ids that change on re-render. Prefer the ` +
        `data-id locator where one is offered, then the label or placeholder.`,
    );
  }

  const unstable = controls.filter((control) => control.stability !== "stable");
  if (unstable.length > 0) {
    limitations.push(
      `${String(unstable.length)} control(s) have no stable locator at all: ` +
        `${unstable.map((control) => control.label || control.ref).join(", ")}.`,
    );
  }

  return { controls, buttons, links, instructions, components, formless, limitations };
};
