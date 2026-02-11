/**
 * Geometry utilities for the drawing plugin
 * All functions are pure - no side effects or external dependencies
 */

import type {
  BoundingBox,
  DrawingElement,
  HandleType,
  Point,
} from "./types.js";
import { isLine, isShape } from "./types.js";

/**
 * Get bounding box for an element (without rotation applied)
 */
export function getBoundingBox(el: DrawingElement): BoundingBox {
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "diamond": {
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    }
    case "text": {
      const lines = el.text.split("\n");
      const maxLineLen = Math.max(...lines.map((l) => l.length));
      const approxWidth = maxLineLen * el.font_size * 0.6;
      const approxHeight = el.font_size * 1.2 * lines.length;
      // With dominant-baseline: text-before-edge, el.y is the top of the text.
      // Adjust x based on text alignment (text-anchor shifts the origin).
      const x = el.text_align === "center" ? el.x - approxWidth / 2
              : el.text_align === "right" ? el.x - approxWidth
              : el.x;
      return { x, y: el.y, width: approxWidth, height: approxHeight };
    }
    case "line":
    case "arrow": {
      const minX = Math.min(el.points[0].x, el.points[1].x);
      const minY = Math.min(el.points[0].y, el.points[1].y);
      const maxX = Math.max(el.points[0].x, el.points[1].x);
      const maxY = Math.max(el.points[0].y, el.points[1].y);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "pen":
    case "highlighter": {
      if (el.points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const xs = el.points.map((p) => p.x);
      const ys = el.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * Get element center point for rotation calculations
 */
export function getElementCenter(el: DrawingElement): Point {
  const bbox = getBoundingBox(el);
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

/**
 * Get the four corners of a bounding box after rotation
 */
export function getRotatedCorners(bbox: BoundingBox, rotation: number): Point[] {
  if (rotation === 0) {
    // No rotation - return original corners
    return [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
      { x: bbox.x, y: bbox.y + bbox.height },
    ];
  }

  // Rotate corners around center
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const angleRad = (rotation * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ];

  return corners.map((corner) => {
    const dx = corner.x - cx;
    const dy = corner.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
}

/**
 * Get combined bounding box for multiple elements, accounting for rotation
 */
export function getGroupBoundingBox(elements: DrawingElement[]): BoundingBox {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const el of elements) {
    const bbox = getBoundingBox(el);
    // Account for rotation by computing rotated corners
    const corners = getRotatedCorners(bbox, el.rotation);
    for (const corner of corners) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Rotate a point around a center by angleDeg degrees
 */
export function rotatePoint(point: Point, center: Point, angleDeg: number): Point {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Convert points array to SVG path string with smooth curves
 */
export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    const midX = (p.x + next.x) / 2;
    const midY = (p.y + next.y) / 2;
    d += ` Q ${p.x} ${p.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Calculate angle in degrees from a point to a center
 * Used for rotation calculations
 */
export function getAngleFromPoint(point: Point, center: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/**
 * Deep clone a drawing element
 * More efficient than JSON.parse/JSON.stringify for known structures
 */
export function cloneElement<T extends DrawingElement>(el: T): T {
  // Handle different element types appropriately
  if ("points" in el) {
    const clone = {
      ...el,
      points: (el.points as Point[]).map((p) => ({ ...p })),
    } as T;
    // Deep clone midpoint and bindings for LineElement
    const lineClone = clone as any;
    if (lineClone.midpoint) lineClone.midpoint = { ...lineClone.midpoint };
    if (lineClone.startBinding) lineClone.startBinding = { ...lineClone.startBinding, anchor: { ...lineClone.startBinding.anchor } };
    if (lineClone.endBinding) lineClone.endBinding = { ...lineClone.endBinding, anchor: { ...lineClone.endBinding.anchor } };
    return clone;
  }
  // For elements without points, shallow clone is sufficient
  return { ...el } as T;
}

/**
 * Get the appropriate CSS resize cursor for a handle, adjusted for element rotation.
 * Each handle has a base angle (n=0, ne=45, e=90, etc.). Adding the element's rotation
 * and snapping to the nearest 45deg gives the correct cursor for the visual direction.
 */
const handleBaseAngle: Partial<Record<HandleType, number>> = {
  n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
};
const cursorAt45: string[] = [
  "ns-resize",    // 0
  "nesw-resize",  // 45
  "ew-resize",    // 90
  "nwse-resize",  // 135
  "ns-resize",    // 180
  "nesw-resize",  // 225
  "ew-resize",    // 270
  "nwse-resize",  // 315
];

/**
 * Snap result containing the snapped point and optional binding info
 */
export interface SnapResult {
  point: Point;
  elementId?: string;     // Shape that was snapped to
  anchor?: Point;         // Normalized 0-1 position on that shape's bbox
}

/**
 * Find the nearest snap point within threshold distance.
 * Checks line/arrow endpoints and shape edge midpoints (rotated).
 * Returns the closest snap result or null if none within threshold.
 */
export function findSnapPoint(
  point: Point,
  elements: Map<string, DrawingElement>,
  threshold: number,
  excludeId?: string,
): SnapResult | null {
  let bestResult: SnapResult | null = null;
  let bestDist = threshold;

  for (const [id, el] of elements) {
    if (id === excludeId) continue;

    const candidates: Array<{ point: Point; elementId?: string; anchor?: Point }> = [];

    if (isLine(el)) {
      // Line endpoints snap but don't create bindings
      candidates.push({ point: el.points[0] });
      candidates.push({ point: el.points[1] });
    } else if (isShape(el)) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const center: Point = { x: cx, y: cy };
      // Edge midpoints with normalized anchors
      const edgeMidpoints: Array<{ point: Point; anchor: Point }> = [
        { point: { x: cx, y: el.y }, anchor: { x: 0.5, y: 0 } },           // top
        { point: { x: el.x + el.width, y: cy }, anchor: { x: 1, y: 0.5 } }, // right
        { point: { x: cx, y: el.y + el.height }, anchor: { x: 0.5, y: 1 } }, // bottom
        { point: { x: el.x, y: cy }, anchor: { x: 0, y: 0.5 } },           // left
      ];
      for (const mp of edgeMidpoints) {
        const rotatedPoint = el.rotation !== 0 ? rotatePoint(mp.point, center, el.rotation) : mp.point;
        candidates.push({ point: rotatedPoint, elementId: id, anchor: mp.anchor });
      }
    }

    for (const c of candidates) {
      const dx = c.point.x - point.x;
      const dy = c.point.y - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestResult = c;
      }
    }
  }

  return bestResult;
}

/**
 * Resolve a binding to a world-space point.
 * Uses the bound shape's bounding box and rotation to compute the actual position.
 */
export function resolveBindingPoint(
  binding: { elementId: string; anchor: Point },
  elements: Map<string, DrawingElement>,
): Point | null {
  const target = elements.get(binding.elementId);
  if (!target) return null;
  const bbox = getBoundingBox(target);
  const point: Point = {
    x: bbox.x + binding.anchor.x * bbox.width,
    y: bbox.y + binding.anchor.y * bbox.height,
  };
  if (target.rotation !== 0) {
    const center = getElementCenter(target);
    return rotatePoint(point, center, target.rotation);
  }
  return point;
}

export function getRotatedCursor(handleType: HandleType, rotationDeg: number): string | null {
  const base = handleBaseAngle[handleType];
  if (base === undefined) return null; // not a resize handle
  const angle = ((base + rotationDeg) % 360 + 360) % 360; // normalize to 0-360
  const index = Math.round(angle / 45) % 8;
  return cursorAt45[index];
}
