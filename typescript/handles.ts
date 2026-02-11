import { cursorForHandle } from "./constants.js";
import {
  getBoundingBox,
  getGroupBoundingBox,
  getRotatedCursor,
  rotatePoint,
} from "./geometry.js";
import type {
  BoundingBox,
  DrawingElement,
  Handle,
  HandleType,
  LineElement,
  Point,
} from "./types.js";
import { isLine } from "./types.js";

// ─── Snap indicator ────────────────────────────────────────────────────────

export function createSnapIndicator(point: Point): SVGCircleElement {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(point.x));
  circle.setAttribute("cy", String(point.y));
  circle.setAttribute("r", "0.6");
  circle.setAttribute("fill", "white");
  circle.setAttribute("stroke", "#10b981");
  circle.setAttribute("stroke-width", "0.15");
  circle.style.pointerEvents = "none";
  return circle;
}

// ─── Midpoint position ────────────────────────────────────────────────────

/** Returns the effective midpoint handle position for a line element.
 *  Uses the stored midpoint if set, otherwise computes a perpendicular offset from the line center. */
export function getLineMidpointPosition(el: LineElement): Point {
  if (el.midpoint) return { x: el.midpoint.x, y: el.midpoint.y };

  const centerX = (el.points[0].x + el.points[1].x) / 2;
  const centerY = (el.points[0].y + el.points[1].y) / 2;

  const dx = el.points[1].x - el.points[0].x;
  const dy = el.points[1].y - el.points[0].y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length > 0.1) {
    const perpX = -dy / length;
    const perpY = dx / length;
    const offset = 2;
    return { x: centerX + perpX * offset, y: centerY + perpY * offset };
  }
  return { x: centerX, y: centerY };
}

// ─── Handle positions ──────────────────────────────────────────────────────

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

    const addHandle = (type: HandleType, x: number, y: number, cursor: string) => {
      const rotatedCursor = getRotatedCursor(type, el.rotation) ?? cursor;
      if (el.rotation !== 0) {
        const rotated = rotatePoint({ x, y }, center, el.rotation);
        handles.push({ type, x: rotated.x, y: rotated.y, cursor: rotatedCursor });
      } else {
        handles.push({ type, x, y, cursor: rotatedCursor });
      }
    };

    addHandle("nw", bbox.x, bbox.y, cursorForHandle.nw);
    addHandle("ne", bbox.x + bbox.width, bbox.y, cursorForHandle.ne);
    addHandle("se", bbox.x + bbox.width, bbox.y + bbox.height, cursorForHandle.se);
    addHandle("sw", bbox.x, bbox.y + bbox.height, cursorForHandle.sw);

    // Edge handles (not for text — text scales proportionally from corners only)
    if (el.type !== "text") {
      addHandle("n", cx, bbox.y, cursorForHandle.n);
      addHandle("e", bbox.x + bbox.width, cy, cursorForHandle.e);
      addHandle("s", cx, bbox.y + bbox.height, cursorForHandle.s);
      addHandle("w", bbox.x, cy, cursorForHandle.w);
    }

    addHandle("rotation", cx, bbox.y - 3.5, cursorForHandle.rotation);
  }

  return handles;
}

// ─── Hit testing ───────────────────────────────────────────────────────────

export function hitTestHandle(
  clientX: number,
  clientY: number,
  selectedIds: Set<string>,
  _elements: Map<string, DrawingElement>,
): Handle | null {
  if (selectedIds.size === 0) return null;
  const target = document.elementFromPoint(clientX, clientY) as SVGElement | null;
  if (!target) return null;
  const handleType = target.getAttribute("data-handle") as HandleType | null;
  if (!handleType) return null;
  return { type: handleType, x: 0, y: 0, cursor: cursorForHandle[handleType] };
}

// ─── SVG rendering ─────────────────────────────────────────────────────────

// Lazy creation, above elements layer
export function ensureHandlesGroup(
  existing: SVGGElement | null,
  svg: SVGSVGElement | null,
): SVGGElement {
  if (existing) return existing;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "selection-handles");
  svg?.appendChild(group);
  return group;
}

export interface RenderHandlesOptions {
  snapTarget: Point | null;
  activeHandle: HandleType | null;
  bboxOverrides?: Map<string, BoundingBox>;
}

export function renderHandles(
  group: SVGGElement,
  selectedElements: DrawingElement[],
  options?: RenderHandlesOptions,
): void {
  group.innerHTML = "";

  if (selectedElements.length === 0) return;

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
      { type: "rotation", x: cx, y: minY - 3.5, cursor: cursorForHandle.rotation },
    ];
  }

  for (const handle of handles) {
    if (handle.type === "rotation") {
      let topCenterX = handle.x;
      let topCenterY = handle.y + 3.5;
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        const bbox = options?.bboxOverrides?.get(el.id) ?? getBoundingBox(el);
        const elCx = bbox.x + bbox.width / 2;
        const elCy = bbox.y + bbox.height / 2;
        const rotatedTopCenter = rotatePoint(
          { x: elCx, y: bbox.y },
          { x: elCx, y: elCy },
          el.rotation,
        );
        topCenterX = rotatedTopCenter.x;
        topCenterY = rotatedTopCenter.y;
      }
      const connector = document.createElementNS("http://www.w3.org/2000/svg", "line");
      connector.setAttribute("x1", String(handle.x));
      connector.setAttribute("y1", String(handle.y));
      connector.setAttribute("x2", String(topCenterX));
      connector.setAttribute("y2", String(topCenterY));
      connector.setAttribute("stroke", "#10b981");
      connector.setAttribute("stroke-width", "0.08");
      connector.setAttribute("stroke-dasharray", "0.3 0.2");
      connector.setAttribute("opacity", "0.6");
      group.appendChild(connector);

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(handle.x));
      circle.setAttribute("cy", String(handle.y));
      circle.setAttribute("r", "0.55");
      circle.setAttribute("fill", "white");
      circle.setAttribute("stroke", "#10b981");
      circle.setAttribute("stroke-width", "0.15");
      circle.setAttribute("data-handle", handle.type);
      circle.style.cursor = handle.cursor;
      group.appendChild(circle);
    } else if (handle.type === "midpoint") {
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        if (isLine(el)) {
          for (const pt of el.points) {
            const arm = document.createElementNS("http://www.w3.org/2000/svg", "line");
            arm.setAttribute("x1", String(pt.x));
            arm.setAttribute("y1", String(pt.y));
            arm.setAttribute("x2", String(handle.x));
            arm.setAttribute("y2", String(handle.y));
            arm.setAttribute("stroke", "#10b981");
            arm.setAttribute("stroke-width", "0.08");
            arm.setAttribute("stroke-dasharray", "0.3 0.2");
            arm.setAttribute("opacity", "0.6");
            group.appendChild(arm);
          }
        }
      }

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(handle.x));
      circle.setAttribute("cy", String(handle.y));
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "white");
      circle.setAttribute("stroke", "#10b981");
      circle.setAttribute("stroke-width", "0.15");
      circle.setAttribute("data-handle", handle.type);
      circle.style.cursor = handle.cursor;
      group.appendChild(circle);
    } else if (handle.type === "start" || handle.type === "end") {
      let handleStroke = "#0066ff";
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        if (isLine(el)) {
          if ((handle.type === "start" && el.startBinding) ||
              (handle.type === "end" && el.endBinding)) {
            handleStroke = "#10b981";
          }
        }
      }
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(handle.x));
      circle.setAttribute("cy", String(handle.y));
      circle.setAttribute("r", "0.45");
      circle.setAttribute("fill", "white");
      circle.setAttribute("stroke", handleStroke);
      circle.setAttribute("stroke-width", "0.12");
      circle.setAttribute("data-handle", handle.type);
      circle.style.cursor = handle.cursor;
      group.appendChild(circle);
    } else {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(handle.x - 0.4));
      rect.setAttribute("y", String(handle.y - 0.4));
      rect.setAttribute("width", "0.8");
      rect.setAttribute("height", "0.8");
      rect.setAttribute("fill", "white");
      rect.setAttribute("stroke", "#0066ff");
      rect.setAttribute("stroke-width", "0.1");
      rect.setAttribute("data-handle", handle.type);
      rect.style.cursor = handle.cursor;
      group.appendChild(rect);
    }
  }

  if (options?.snapTarget && (options.activeHandle === "start" || options.activeHandle === "end")) {
    group.appendChild(createSnapIndicator(options.snapTarget));
  }
}
