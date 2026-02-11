/**
 * Text editing textarea overlay — DOM lifecycle management.
 *
 * Handles creation, styling, updating, and cleanup of the textarea
 * overlay used for editing text elements. Controller owns the commit
 * logic and event binding.
 */

import { fontFamilyMap, fontSizeMap } from "./constants.js";
import type { Point, TextElement } from "./types.js";

// ─── State ─────────────────────────────────────────────────────────────────

/** Bundles all text-editing state that was previously scattered across 7 fields. */
export interface TextEditState {
  overlay: HTMLTextAreaElement;
  editingId: string | null;
  svgPoint: Point;
  commitFn: (() => void) | null;
  blurTimeout: ReturnType<typeof setTimeout> | null;
  committed: boolean;
}

// ─── Textarea positioning ──────────────────────────────────────────────────

export interface TextOverlayPosition {
  /** Container-relative left px */
  left: number;
  /** Container-relative top px */
  top: number;
  /** Font size in screen pixels */
  fontSizePx: number;
  /** Horizontal stretch factor (SVG rect.width / rect.height) */
  stretchX: number;
}

export interface TextOverlayStyle {
  fontFamily: TextElement["font_family"];
  fontSize: string | number;
  textAlign: TextElement["text_align"];
  color: string;
}

/** Compute CSS transform for textarea alignment + SVG aspect ratio correction. */
function computeTransform(textAlign: string, stretchX: number): string {
  const scaleXCss = `scaleX(${stretchX})`;
  if (textAlign === "center") return `${scaleXCss} translateX(-50%)`;
  if (textAlign === "right") return `${scaleXCss} translateX(-100%)`;
  return scaleXCss;
}

/** Resolve font size to numeric viewBox units. */
export function resolveFontSize(raw: string | number): number {
  return typeof raw === "string" ? (fontSizeMap[raw] ?? 4) : raw;
}

// ─── Create ────────────────────────────────────────────────────────────────

/** Create a textarea overlay positioned over the SVG canvas. */
export function createTextOverlay(
  position: TextOverlayPosition,
  style: TextOverlayStyle,
  existingText?: string,
): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = "drawing-text-input";
  textarea.value = existingText ?? "";

  const fontSizePx = position.fontSizePx;
  const transformCss = computeTransform(style.textAlign, position.stretchX);

  Object.assign(textarea.style, {
    left: `${position.left}px`,
    top: `${position.top}px`,
    fontSize: `${fontSizePx}px`,
    fontFamily: fontFamilyMap[style.fontFamily] || fontFamilyMap.normal,
    textAlign: style.textAlign,
    color: style.color,
    minWidth: "20px",
    minHeight: `${fontSizePx * 1.4}px`,
    transformOrigin: "0 0",
    transform: transformCss,
  });

  return textarea;
}

/** Auto-resize textarea to fit content. */
export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
  textarea.style.width = "auto";
  textarea.style.width = `${Math.max(40, textarea.scrollWidth + 4)}px`;
}

// ─── Update ────────────────────────────────────────────────────────────────

/** Update the visible textarea overlay to match current element state. */
export function updateTextOverlayStyle(
  textarea: HTMLTextAreaElement,
  el: TextElement,
  svgRect: DOMRect,
  svgToContainerPx: (x: number, y: number) => { left: number; top: number },
  svgUnitsToPx: (units: number, axis: "x" | "y") => number,
): Point {
  const pos = svgToContainerPx(el.x, el.y);
  const fontSizePx = svgUnitsToPx(el.font_size, "y");
  const stretchX = svgRect.width / svgRect.height;
  const transformCss = computeTransform(el.text_align, stretchX);

  Object.assign(textarea.style, {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    fontSize: `${fontSizePx}px`,
    fontFamily: fontFamilyMap[el.font_family] || fontFamilyMap.normal,
    textAlign: el.text_align,
    color: el.stroke_color,
    minHeight: `${fontSizePx * 1.4}px`,
    transform: transformCss,
  });

  return { x: el.x, y: el.y };
}

// ─── Close ─────────────────────────────────────────────────────────────────

/** Remove textarea overlay and clean up timers. */
export function closeTextOverlay(state: TextEditState): void {
  if (state.blurTimeout) {
    clearTimeout(state.blurTimeout);
    state.blurTimeout = null;
  }
  state.overlay.remove();
  state.commitFn = null;
}
