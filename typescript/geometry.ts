import type {
  BoundingBox,
  DrawingElement,
  HandleType,
  LineElement,
  PathElement,
  Point,
  ShapeElement,
  TextBoundsMap,
  TextElement,
} from "./types.js";
import { isLine, isShape } from "./types.js";
import { fontFamilyMap } from "./constants.js";

let _measureCtx: CanvasRenderingContext2D | null = null;

function measureText(text: string, fontSize: number, fontFamily: TextElement["font_family"]): number {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d")!;
  const REF = 100;
  _measureCtx.font = `${REF}px ${fontFamilyMap[fontFamily] || fontFamilyMap.normal}`;
  return _measureCtx.measureText(text).width * (fontSize / REF);
}

/** Word-wrap text into lines that fit within maxWidth viewBox units. */
export function wrapTextToLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: TextElement["font_family"],
): string[] {
  const measure = (s: string) => measureText(s, fontSize, fontFamily);
  const result: string[] = [];

  for (const rawLine of text.split("\n")) {
    if (!rawLine) { result.push(""); continue; }
    const words = rawLine.split(" ");
    let current = "";

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (current && measure(test) > maxWidth) {
        result.push(current);
        current = word;
      } else {
        current = test;
      }
      // Break words longer than a full line
      while (measure(current) > maxWidth && current.length > 1) {
        let lo = 1, hi = current.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (measure(current.slice(0, mid)) <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        result.push(current.slice(0, lo));
        current = current.slice(lo);
      }
    }
    result.push(current);
  }

  return result;
}

// Without rotation applied
export function getBoundingBox(el: DrawingElement, textBounds?: TextBoundsMap): BoundingBox {
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "diamond": {
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    }
    case "text": {
      const measured = textBounds?.get(el.id);
      if (measured) return measured;
      // Fallback for elements not yet rendered — textBoundsCache provides real values after render
      const lines = el.width
        ? wrapTextToLines(el.text, el.width, el.font_size, el.font_family)
        : el.text.split("\n");
      const widest = Math.max(...lines.map((l) => measureText(l, el.font_size, el.font_family)));
      const approxWidth = el.width ?? widest;
      const approxHeight = el.font_size * 1.2 * lines.length;
      const x = el.text_align === "center" ? el.x - approxWidth / 2
              : el.text_align === "right" ? el.x - approxWidth
              : el.x;
      return { x, y: el.y, width: approxWidth, height: approxHeight };
    }
    case "line":
    case "arrow": {
      let minX = Math.min(el.points[0].x, el.points[1].x);
      let minY = Math.min(el.points[0].y, el.points[1].y);
      let maxX = Math.max(el.points[0].x, el.points[1].x);
      let maxY = Math.max(el.points[0].y, el.points[1].y);
      if (el.midpoint) {
        // Quadratic bezier is contained within the convex hull of its 3 points
        minX = Math.min(minX, el.midpoint.x);
        minY = Math.min(minY, el.midpoint.y);
        maxX = Math.max(maxX, el.midpoint.x);
        maxY = Math.max(maxY, el.midpoint.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "pen":
    case "highlighter": {
      if (el.points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      // Single-pass to avoid Math.min(...spread) stack overflow on large freehand paths
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function getElementCenter(el: DrawingElement, textBounds?: TextBoundsMap): Point {
  const bbox = getBoundingBox(el, textBounds);
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

export function getRotatedCorners(bbox: BoundingBox, rotation: number): Point[] {
  if (rotation === 0) {
    return [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
      { x: bbox.x, y: bbox.y + bbox.height },
    ];
  }

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

export function getGroupBoundingBox(elements: DrawingElement[], textBounds?: TextBoundsMap): BoundingBox {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const el of elements) {
    const bbox = getBoundingBox(el, textBounds);
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

export function getAngleFromPoint(point: Point, center: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

// More efficient than JSON.parse/JSON.stringify for known structures
export function cloneElement<T extends DrawingElement>(el: T): T {
  if ("points" in el) {
    const clone = {
      ...el,
      points: (el.points as Point[]).map((p) => ({ ...p })),
    } as T;
    if (isLine(el)) {
      const lineClone = clone as T & { midpoint?: Point; startBinding?: { elementId: string; anchor: Point }; endBinding?: { elementId: string; anchor: Point } };
      if (lineClone.midpoint) lineClone.midpoint = { ...lineClone.midpoint };
      if (lineClone.startBinding) lineClone.startBinding = { ...lineClone.startBinding, anchor: { ...lineClone.startBinding.anchor } };
      if (lineClone.endBinding) lineClone.endBinding = { ...lineClone.endBinding, anchor: { ...lineClone.endBinding.anchor } };
    }
    return clone;
  }
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

export interface SnapResult {
  point: Point;
  elementId?: string;     // Shape that was snapped to
  anchor?: Point;         // Normalized 0-1 position on that shape's bbox
}

/**
 * Find the nearest snap point within threshold distance.
 * Checks line/arrow endpoints and shape edge midpoints (rotated).
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
      candidates.push({ point: el.points[0] });
      candidates.push({ point: el.points[1] });
    } else if (isShape(el)) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const center: Point = { x: cx, y: cy };
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
  textBounds?: TextBoundsMap,
): Point | null {
  const target = elements.get(binding.elementId);
  if (!target) return null;
  const bbox = getBoundingBox(target, textBounds);
  const point: Point = {
    x: bbox.x + binding.anchor.x * bbox.width,
    y: bbox.y + binding.anchor.y * bbox.height,
  };
  if (target.rotation !== 0) {
    const center = getElementCenter(target, textBounds);
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

// ---------------------------------------------------------------------------
// Geometric hit-testing primitives
// ---------------------------------------------------------------------------

/** Shortest distance from point (px,py) to line segment (ax,ay)-(bx,by). */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(px: number, py: number, verts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Min distance from point to any edge of a polygon. */
export function distanceToPolygonEdge(px: number, py: number, verts: Point[]): number {
  let minDist = Infinity;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const d = distanceToSegment(px, py, verts[j].x, verts[j].y, verts[i].x, verts[i].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Test if point is inside an axis-aligned ellipse (after un-rotation). */
export function pointInEllipse(px: number, py: number, cx: number, cy: number, rx: number, ry: number, rotationDeg: number): boolean {
  const p = rotationDeg !== 0 ? rotatePoint({ x: px, y: py }, { x: cx, y: cy }, -rotationDeg) : { x: px, y: py };
  if (rx === 0 || ry === 0) return false;
  const dx = (p.x - cx) / rx;
  const dy = (p.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Approximate distance from point to ellipse edge. */
export function distanceToEllipseEdge(px: number, py: number, cx: number, cy: number, rx: number, ry: number, rotationDeg: number): number {
  const p = rotationDeg !== 0 ? rotatePoint({ x: px, y: py }, { x: cx, y: cy }, -rotationDeg) : { x: px, y: py };
  if (rx === 0 || ry === 0) return Math.hypot(p.x - cx, p.y - cy);
  const angle = Math.atan2((p.y - cy) / ry, (p.x - cx) / rx);
  const nearX = cx + rx * Math.cos(angle);
  const nearY = cy + ry * Math.sin(angle);
  return Math.hypot(p.x - nearX, p.y - nearY);
}

/** Approximate min distance from point to a quadratic bezier curve. */
export function distanceToQuadraticBezier(
  px: number, py: number,
  x0: number, y0: number,
  cpx: number, cpy: number,
  x1: number, y1: number,
): number {
  const STEPS = 10;
  let minDist = Infinity;
  let prevX = x0, prevY = y0;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const mt = 1 - t;
    const curX = mt * mt * x0 + 2 * mt * t * cpx + t * t * x1;
    const curY = mt * mt * y0 + 2 * mt * t * cpy + t * t * y1;
    const d = distanceToSegment(px, py, prevX, prevY, curX, curY);
    if (d < minDist) minDist = d;
    prevX = curX;
    prevY = curY;
  }
  return minDist;
}

// ---------------------------------------------------------------------------
// Per-shape hit-test functions
// ---------------------------------------------------------------------------

function hasFill(el: DrawingElement): boolean {
  return el.fill_color !== "" && el.fill_color !== "none";
}

function hitTestRect(px: number, py: number, el: ShapeElement, tol: number, textBounds?: TextBoundsMap): boolean {
  const bbox = getBoundingBox(el, textBounds);
  const center: Point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  const p = el.rotation !== 0 ? rotatePoint({ x: px, y: py }, center, -el.rotation) : { x: px, y: py };
  const corners: Point[] = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ];
  if (hasFill(el)) return pointInPolygon(p.x, p.y, corners);
  return distanceToPolygonEdge(p.x, p.y, corners) <= tol + el.stroke_width / 2;
}

function hitTestEllipse(px: number, py: number, el: ShapeElement, tol: number, textBounds?: TextBoundsMap): boolean {
  const bbox = getBoundingBox(el, textBounds);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const rx = bbox.width / 2;
  const ry = bbox.height / 2;
  if (hasFill(el)) return pointInEllipse(px, py, cx, cy, rx + tol, ry + tol, el.rotation);
  return distanceToEllipseEdge(px, py, cx, cy, rx, ry, el.rotation) <= tol + el.stroke_width / 2;
}

function hitTestDiamond(px: number, py: number, el: ShapeElement, tol: number, textBounds?: TextBoundsMap): boolean {
  const bbox = getBoundingBox(el, textBounds);
  const center: Point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  const p = el.rotation !== 0 ? rotatePoint({ x: px, y: py }, center, -el.rotation) : { x: px, y: py };
  const verts: Point[] = [
    { x: center.x, y: bbox.y },             // top
    { x: bbox.x + bbox.width, y: center.y }, // right
    { x: center.x, y: bbox.y + bbox.height }, // bottom
    { x: bbox.x, y: center.y },             // left
  ];
  if (hasFill(el)) return pointInPolygon(p.x, p.y, verts);
  return distanceToPolygonEdge(p.x, p.y, verts) <= tol + el.stroke_width / 2;
}

function hitTestLine(px: number, py: number, el: LineElement, tol: number): boolean {
  const halfStroke = el.stroke_width / 2;
  const threshold = tol + halfStroke;
  if (el.midpoint) {
    return distanceToQuadraticBezier(
      px, py,
      el.points[0].x, el.points[0].y,
      el.midpoint.x, el.midpoint.y,
      el.points[1].x, el.points[1].y,
    ) <= threshold;
  }
  return distanceToSegment(
    px, py,
    el.points[0].x, el.points[0].y,
    el.points[1].x, el.points[1].y,
  ) <= threshold;
}

function hitTestPath(px: number, py: number, el: PathElement, tol: number): boolean {
  const threshold = tol + el.stroke_width / 2;
  for (let i = 1; i < el.points.length; i++) {
    if (distanceToSegment(px, py, el.points[i - 1].x, el.points[i - 1].y, el.points[i].x, el.points[i].y) <= threshold) {
      return true;
    }
  }
  return false;
}

function hitTestText(px: number, py: number, el: TextElement, tol: number, textBounds?: TextBoundsMap): boolean {
  const bbox = getBoundingBox(el, textBounds);
  const center: Point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  const p = el.rotation !== 0 ? rotatePoint({ x: px, y: py }, center, -el.rotation) : { x: px, y: py };
  return p.x >= bbox.x - tol && p.x <= bbox.x + bbox.width + tol &&
         p.y >= bbox.y - tol && p.y <= bbox.y + bbox.height + tol;
}

// ---------------------------------------------------------------------------
// Unified hit-test entry points
// ---------------------------------------------------------------------------

/** AABB pre-filter using rotated corners, then dispatch to shape-specific test. */
export function hitTestElement(px: number, py: number, el: DrawingElement, tolerance: number, textBounds?: TextBoundsMap): boolean {
  // Fast AABB rejection
  const bbox = getBoundingBox(el, textBounds);
  const corners = getRotatedCorners(bbox, el.rotation);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  const margin = tolerance + el.stroke_width;
  if (px < minX - margin || px > maxX + margin || py < minY - margin || py > maxY + margin) {
    return false;
  }

  switch (el.type) {
    case "rect": return hitTestRect(px, py, el, tolerance, textBounds);
    case "ellipse": return hitTestEllipse(px, py, el, tolerance, textBounds);
    case "diamond": return hitTestDiamond(px, py, el, tolerance, textBounds);
    case "line":
    case "arrow": return hitTestLine(px, py, el, tolerance);
    case "pen":
    case "highlighter": return hitTestPath(px, py, el, tolerance);
    case "text": return hitTestText(px, py, el, tolerance, textBounds);
    default: return false;
  }
}

/** Return all elements hit at (px, py), front-to-back order (last drawn = first). */
export function getElementsAtPoint(
  px: number, py: number,
  elements: Map<string, DrawingElement>,
  tolerance: number,
  textBounds?: TextBoundsMap,
): DrawingElement[] {
  const hits: DrawingElement[] = [];
  for (const el of elements.values()) {
    if (hitTestElement(px, py, el, tolerance, textBounds)) {
      hits.push(el);
    }
  }
  hits.reverse(); // last drawn (front) first
  return hits;
}

/** Return the ID of the topmost (last drawn) element at point, or null. */
export function getTopmostElementAtPoint(
  px: number, py: number,
  elements: Map<string, DrawingElement>,
  tolerance: number,
  textBounds?: TextBoundsMap,
): string | null {
  // Last match in insertion order = topmost (avoids array allocation)
  let topmost: string | null = null;
  for (const el of elements.values()) {
    if (hitTestElement(px, py, el, tolerance, textBounds)) {
      topmost = el.id;
    }
  }
  return topmost;
}
