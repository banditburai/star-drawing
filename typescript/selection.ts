/**
 * Selection analysis and toolbar sync — pure functions extracted from controller.
 *
 * Consolidates duplicated hasLine/hasText loops and toolbar property sync
 * into reusable helpers.
 */

import { reverseFontSizeMap } from "./constants.js";
import type {
  DrawingElement,
  DrawingState,
  Point,
} from "./types.js";
import { isLine, isShape, isText } from "./types.js";

// ─── Selection type analysis ────────────────────────────────────────────────

export interface SelectionTypes {
  hasLine: boolean;
  hasText: boolean;
}

/** Determine which element types are present in a selection. */
export function analyzeSelectionTypes(
  selectedIds: Set<string>,
  elements: Map<string, DrawingElement>,
): SelectionTypes {
  let hasLine = false;
  let hasText = false;
  for (const id of selectedIds) {
    const el = elements.get(id);
    if (!el) continue;
    if (el.type === "line" || el.type === "arrow") hasLine = true;
    if (el.type === "text") hasText = true;
  }
  return { hasLine, hasText };
}

// ─── Toolbar sync ───────────────────────────────────────────────────────────

/** Build a state patch that syncs a single selected element's properties to the toolbar. */
export function buildSelectionPatch(
  el: DrawingElement,
): Partial<DrawingState> {
  const patch: Partial<DrawingState> = {
    stroke_color: el.stroke_color,
    opacity: el.opacity,
  };

  if (el.type !== "text") {
    patch.stroke_width = el.stroke_width;
  }
  if (typeof el.dash_length === "number") {
    patch.dash_length = el.dash_length;
  }
  if (typeof el.dash_gap === "number") {
    patch.dash_gap = el.dash_gap;
  }
  if (isShape(el)) {
    if (el.fill_color) {
      patch.fill_color = el.fill_color;
    }
  }
  if (isLine(el)) {
    patch.start_arrowhead = el.start_arrowhead || "none";
    patch.end_arrowhead = el.end_arrowhead || "none";
  }
  if (isText(el)) {
    patch.font_family = el.font_family;
    patch.font_size = reverseFontSizeMap[el.font_size] ?? el.font_size;
    patch.text_align = el.text_align;
  }

  return patch;
}

// ─── Duplication ────────────────────────────────────────────────────────────

/** Duplicate elements with a 2-unit offset, returning new elements keyed by new ID. */
export function duplicateElements(
  selectedIds: Set<string>,
  elements: Map<string, DrawingElement>,
): DrawingElement[] {
  const duplicates: DrawingElement[] = [];

  for (const id of selectedIds) {
    const original = elements.get(id);
    if (!original) continue;

    const newId = `${original.type}-${crypto.randomUUID().split("-")[0]}`;
    const duplicate = { ...original, id: newId, created_at: Date.now() };

    if (isShape(duplicate) || isText(duplicate)) {
      duplicate.x += 2;
      duplicate.y += 2;
    } else if ("points" in duplicate) {
      duplicate.points = (duplicate.points as Point[]).map((p: Point) => ({
        x: p.x + 2,
        y: p.y + 2,
      }));
    }

    duplicates.push(duplicate);
  }

  return duplicates;
}
