import { cursorForHandle, THEME_COLORS } from "./constants.js";
import {
  getBoundingBox,
  getGroupBoundingBox,
  rotatePoint,
} from "./geometry.js";
import type {
  BoundingBox,
  DrawingElement,
  Handle,
  HandleType,
  LineElement,
  Point,
  ThemeColors,
} from "./types.js";
import { isLine, isText } from "./types.js";

const ROTATION_HANDLE_GAP = 3.5;
const MIDPOINT_HANDLE_OFFSET = 2;

// Snap handle cursor to nearest 45° octant, adjusted for element rotation
const HANDLE_BASE_ANGLE: Partial<Record<HandleType, number>> = {
  n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
};
const CURSOR_BY_OCTANT = [
  "ns-resize", "nesw-resize", "ew-resize", "nwse-resize",
  "ns-resize", "nesw-resize", "ew-resize", "nwse-resize",
] as const;

function getRotatedCursor(handleType: HandleType, rotationDeg: number): string | null {
  const base = HANDLE_BASE_ANGLE[handleType];
  if (base === undefined) return null;
  const angle = ((base + rotationDeg) % 360 + 360) % 360;
  return CURSOR_BY_OCTANT[Math.round(angle / 45) % 8];
}
const HANDLE_HALF_SIZE = 0.4;
const DEFAULT_COLORS = THEME_COLORS.light;

export function createSnapIndicator(point: Point, colors?: ThemeColors): SVGCircleElement {
  const c = colors ?? DEFAULT_COLORS;
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(point.x));
  circle.setAttribute("cy", String(point.y));
  circle.setAttribute("r", "0.6");
  circle.setAttribute("fill", c.handleFill);
  circle.setAttribute("stroke", c.handleAccent);
  circle.setAttribute("stroke-width", "0.15");
  circle.style.pointerEvents = "none";
  return circle;
}

function createHandleCircle(handle: Handle, r: number, stroke: string, strokeWidth: number, fill?: string): SVGCircleElement {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(handle.x));
  circle.setAttribute("cy", String(handle.y));
  circle.setAttribute("r", String(r));
  circle.setAttribute("fill", fill ?? "white");
  circle.setAttribute("stroke", stroke);
  circle.setAttribute("stroke-width", String(strokeWidth));
  circle.setAttribute("data-handle", handle.type);
  circle.style.cursor = handle.cursor;
  return circle;
}

function createHandleRect(handle: Handle, halfSize: number, stroke: string, strokeWidth: number, fill: string): SVGRectElement {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(handle.x - halfSize));
  rect.setAttribute("y", String(handle.y - halfSize));
  rect.setAttribute("width", String(halfSize * 2));
  rect.setAttribute("height", String(halfSize * 2));
  rect.setAttribute("fill", fill);
  rect.setAttribute("stroke", stroke);
  rect.setAttribute("stroke-width", String(strokeWidth));
  rect.setAttribute("data-handle", handle.type);
  rect.style.cursor = handle.cursor;
  return rect;
}

function createConnectorLine(x1: number, y1: number, x2: number, y2: number, accentColor?: string): SVGLineElement {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", accentColor ?? DEFAULT_COLORS.handleAccent);
  line.setAttribute("stroke-width", "0.08");
  line.setAttribute("stroke-dasharray", "0.3 0.2");
  line.setAttribute("opacity", "0.6");
  return line;
}

export function getLineMidpointPosition(el: LineElement): Point {
  if (el.midpoint) return { x: el.midpoint.x, y: el.midpoint.y };

  const centerX = (el.points[0].x + el.points[1].x) / 2;
  const centerY = (el.points[0].y + el.points[1].y) / 2;

  const dx = el.points[1].x - el.points[0].x;
  const dy = el.points[1].y - el.points[0].y;
  const length = Math.hypot(dx, dy);

  if (length > 0.1) {
    const perpX = -dy / length;
    const perpY = dx / length;
    return { x: centerX + perpX * MIDPOINT_HANDLE_OFFSET, y: centerY + perpY * MIDPOINT_HANDLE_OFFSET };
  }
  return { x: centerX, y: centerY };
}

function getHandlePositions(el: DrawingElement, bboxOverride?: BoundingBox): Handle[] {
  const handles: Handle[] = [];

  if (isLine(el)) {
    handles.push({
      type: "start",
      x: el.points[0].x,
      y: el.points[0].y,
      cursor: cursorForHandle.start,
    });
    handles.push({
      type: "end",
      x: el.points[1].x,
      y: el.points[1].y,
      cursor: cursorForHandle.end,
    });

    const mid = getLineMidpointPosition(el);
    handles.push({
      type: "midpoint",
      x: mid.x,
      y: mid.y,
      cursor: cursorForHandle.midpoint,
    });
  } else {
    const bbox = bboxOverride ?? getBoundingBox(el);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const center = { x: cx, y: cy };

    const addHandle = (type: HandleType, x: number, y: number) => {
      const cursor = getRotatedCursor(type, el.rotation) ?? cursorForHandle[type];
      if (el.rotation !== 0) {
        const rotated = rotatePoint({ x, y }, center, el.rotation);
        handles.push({ type, x: rotated.x, y: rotated.y, cursor });
      } else {
        handles.push({ type, x, y, cursor });
      }
    };

    addHandle("nw", bbox.x, bbox.y);
    addHandle("ne", bbox.x + bbox.width, bbox.y);
    addHandle("se", bbox.x + bbox.width, bbox.y + bbox.height);
    addHandle("sw", bbox.x, bbox.y + bbox.height);

    if (isText(el)) {
      addHandle("e", bbox.x + bbox.width, cy);
      addHandle("w", bbox.x, cy);
    } else {
      addHandle("n", cx, bbox.y);
      addHandle("e", bbox.x + bbox.width, cy);
      addHandle("s", cx, bbox.y + bbox.height);
      addHandle("w", bbox.x, cy);
    }

    addHandle("rotation", cx, bbox.y - ROTATION_HANDLE_GAP);
  }

  return handles;
}

export function hitTestHandle(clientX: number, clientY: number): HandleType | null {
  const target = document.elementFromPoint(clientX, clientY) as SVGElement | null;
  return target?.getAttribute("data-handle") as HandleType | null;
}

export function ensureHandlesGroup(
  existing: SVGGElement | null,
  svg: SVGSVGElement | null,
): SVGGElement | null {
  if (existing) return existing;
  if (!svg) return null;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "selection-handles");
  svg.appendChild(group);
  return group;
}

export interface RenderHandlesOptions {
  snapTarget: Point | null;
  activeHandle: HandleType | null;
  bboxOverrides?: Map<string, BoundingBox>;
  themeColors?: ThemeColors;
}

function updateHandlePositions(group: SVGGElement, handles: Handle[]): boolean {
  const existing = group.querySelectorAll<SVGElement>("[data-handle]");
  if (existing.length !== handles.length) return false;
  // Connector lines don't have data-handle — skip fast path when they're present
  if (group.children.length !== existing.length) return false;
  for (let i = 0; i < handles.length; i++) {
    if (existing[i].getAttribute("data-handle") !== handles[i].type) return false;
  }
  for (let i = 0; i < handles.length; i++) {
    const el = existing[i];
    const handle = handles[i];
    if (el.tagName === "circle") {
      el.setAttribute("cx", String(handle.x));
      el.setAttribute("cy", String(handle.y));
    } else if (el.tagName === "rect") {
      el.setAttribute("x", String(handle.x - HANDLE_HALF_SIZE));
      el.setAttribute("y", String(handle.y - HANDLE_HALF_SIZE));
    }
    el.style.cursor = handle.cursor;
  }
  return true;
}

export function renderHandles(
  group: SVGGElement,
  selectedElements: DrawingElement[],
  options?: RenderHandlesOptions,
): void {
  if (selectedElements.length === 0) {
    group.replaceChildren();
    return;
  }

  let handles: Handle[];
  if (selectedElements.length === 1) {
    const override = options?.bboxOverrides?.get(selectedElements[0].id);
    handles = getHandlePositions(selectedElements[0], override);
  } else {
    const groupBbox = getGroupBoundingBox(selectedElements);
    const { x: minX, y: minY, width, height } = groupBbox;
    const maxX = minX + width;
    const maxY = minY + height;
    const cx = minX + width / 2;
    const cy = minY + height / 2;

    handles = [
      { type: "nw", x: minX, y: minY, cursor: cursorForHandle.nw },
      { type: "n", x: cx, y: minY, cursor: cursorForHandle.n },
      { type: "ne", x: maxX, y: minY, cursor: cursorForHandle.ne },
      { type: "e", x: maxX, y: cy, cursor: cursorForHandle.e },
      { type: "se", x: maxX, y: maxY, cursor: cursorForHandle.se },
      { type: "s", x: cx, y: maxY, cursor: cursorForHandle.s },
      { type: "sw", x: minX, y: maxY, cursor: cursorForHandle.sw },
      { type: "w", x: minX, y: cy, cursor: cursorForHandle.w },
      { type: "rotation", x: cx, y: minY - ROTATION_HANDLE_GAP, cursor: cursorForHandle.rotation },
    ];
  }

  if (updateHandlePositions(group, handles)) return;

  const tc = options?.themeColors ?? DEFAULT_COLORS;
  const children: SVGElement[] = [];

  for (const handle of handles) {
    if (handle.type === "rotation") {
      let topCenterX = handle.x;
      let topCenterY = handle.y + ROTATION_HANDLE_GAP;
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        const bbox = options?.bboxOverrides?.get(el.id) ?? getBoundingBox(el);
        const elCx = bbox.x + bbox.width / 2;
        const elCy = bbox.y + bbox.height / 2;
        const rotated = rotatePoint({ x: elCx, y: bbox.y }, { x: elCx, y: elCy }, el.rotation);
        topCenterX = rotated.x;
        topCenterY = rotated.y;
      }
      children.push(createConnectorLine(handle.x, handle.y, topCenterX, topCenterY, tc.handleAccent));
      children.push(createHandleCircle(handle, 0.55, tc.handleAccent, 0.15, tc.handleFill));
    } else if (handle.type === "midpoint") {
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        if (isLine(el)) {
          for (const pt of el.points) {
            children.push(createConnectorLine(pt.x, pt.y, handle.x, handle.y, tc.handleAccent));
          }
        }
      }
      children.push(createHandleCircle(handle, 0.5, tc.handleAccent, 0.15, tc.handleFill));
    } else if (handle.type === "start" || handle.type === "end") {
      let stroke = tc.handlePrimary;
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        if (isLine(el)) {
          if ((handle.type === "start" && el.startBinding) ||
              (handle.type === "end" && el.endBinding)) {
            stroke = tc.handleAccent;
          }
        }
      }
      children.push(createHandleCircle(handle, 0.45, stroke, 0.12, tc.handleFill));
    } else {
      children.push(createHandleRect(handle, HANDLE_HALF_SIZE, tc.handlePrimary, 0.1, tc.handleFill));
    }
  }

  if (options?.snapTarget && (options.activeHandle === "start" || options.activeHandle === "end")) {
    children.push(createSnapIndicator(options.snapTarget, tc));
  }

  group.replaceChildren(...children);
}
