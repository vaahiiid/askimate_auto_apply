/**
 * What stands at a control's centre point (ADR-0128, ADR-0129).
 *
 * One in-page read, two callers with two allowances:
 *
 *   - the attached reader (`--covering`) keeps each layer's visible TEXT,
 *     because a capture is something a person looks at and the text is what
 *     names a banner;
 *   - the runner, at the moment a press fails, keeps STRUCTURE ONLY — tag,
 *     id, classes, computed position, box — because its line goes to a log,
 *     and ADR-0124's rule is that nothing a page says reaches one.
 *
 * `document.elementsFromPoint` at the control's own centre, top-most first,
 * down to the control. `covered` is true when the top-most element is neither
 * the control nor inside it: the fact a press cannot get past. It dispatches
 * nothing and changes nothing.
 */
import type { ElementHandle } from "playwright";

/** One layer at the point. `text` is present only when the caller allowed it. */
export interface LayerAtPoint {
  readonly tag: string;
  readonly id: string | null;
  readonly classes: readonly string[];
  /** Computed `position`, the thing an overlay is usually made of. */
  readonly position: string;
  readonly zIndex: string;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** `iframe`, `dialog`, `[role=…]`, `aria-modal` — the shapes a banner takes. */
  readonly role: string | null;
  /** Its own visible text, trimmed to 160 characters. Absent for the runner. */
  readonly text?: string;
}

export interface StackAtPoint {
  readonly covered: boolean;
  /** Top-most first, ending at the control itself. */
  readonly layers: readonly LayerAtPoint[];
}

/**
 * Reads the stack at the handle's centre. Serialised into the page, so it may
 * close over nothing but its arguments.
 */
export async function stackAtPoint(
  control: ElementHandle<Element>,
  options: { readonly withText: boolean },
): Promise<StackAtPoint> {
  return control.evaluate((element, withText): StackAtPoint => {
    const describe = (layer: Element): LayerAtPoint => {
      const style = getComputedStyle(layer);
      const rect = layer.getBoundingClientRect();
      const tag = layer.tagName.toLowerCase();
      const role =
        tag === "iframe" || tag === "dialog"
          ? tag
          : layer.getAttribute("role") ?? (layer.hasAttribute("aria-modal") ? "aria-modal" : null);
      const base: LayerAtPoint = {
        tag,
        id: layer.id === "" ? null : layer.id,
        classes: [...layer.classList],
        position: style.position,
        zIndex: style.zIndex,
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        role,
      };
      return withText ? { ...base, text: (layer.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160) } : base;
    };
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const layers: LayerAtPoint[] = [];
    for (const layer of document.elementsFromPoint(x, y)) {
      layers.push(describe(layer));
      if (layer === element) break;
    }
    const top = document.elementFromPoint(x, y);
    return { covered: top !== null && top !== element && !element.contains(top), layers };
  }, options.withText);
}

/**
 * A layer as a log may say it (ADR-0129): structure, no text, no value.
 * `div#cover.ccc-overlay (fixed, 1280×720 at 0,0)`.
 */
export function layerInWords(layer: LayerAtPoint): string {
  const name = `${layer.tag}${layer.id === null ? "" : `#${layer.id}`}${layer.classes.length === 0 ? "" : `.${layer.classes.join(".")}`}`;
  const role = layer.role === null ? "" : ` ${layer.role}`;
  return `${name} (${layer.position}${role}, ${String(layer.box.width)}×${String(layer.box.height)} at ${String(layer.box.x)},${String(layer.box.y)})`;
}
