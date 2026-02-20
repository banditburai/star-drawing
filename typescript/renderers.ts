import { fontFamilyMap, textAnchorMap } from "./constants.js";
import { isToken, resolveColor } from "./palette.js";
import { getBoundingBox, pointsBounds, pointsToPath, wrapTextToLines } from "./geometry.js";
import type {
  ArrowheadStyle,
  BaseElement,
  DrawingElement,
  LineElement,
  PathElement,
  Point,
  ShapeElement,
  TextBoundsMap,
  TextElement,
  Theme,
} from "./types.js";

/** Returns true if updated in-place, false if a full re-render is needed. */
export function updateElementInPlace(svgEl: SVGElement, el: DrawingElement): boolean {
  switch (el.type) {
    case "rect": {
      svgEl.setAttribute("x", String(el.x));
      svgEl.setAttribute("y", String(el.y));
      svgEl.setAttribute("width", String(el.width));
      svgEl.setAttribute("height", String(el.height));
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      setRotationTransform(svgEl, el.rotation, cx, cy);
      return true;
    }
    case "ellipse": {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      svgEl.setAttribute("cx", String(cx));
      svgEl.setAttribute("cy", String(cy));
      svgEl.setAttribute("rx", String(el.width / 2));
      svgEl.setAttribute("ry", String(el.height / 2));
      setRotationTransform(svgEl, el.rotation, cx, cy);
      return true;
    }
    case "diamond": {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      svgEl.setAttribute("points", `${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}`);
      setRotationTransform(svgEl, el.rotation, cx, cy);
      return true;
    }
    case "pen":
    case "highlighter": {
      svgEl.setAttribute("d", pointsToPath(el.points));
      svgEl.setAttribute("data-points", el.points.map(p => `${p.x},${p.y}`).join(" "));
      if (el.rotation !== 0 && el.points.length > 0) {
        const b = pointsBounds(el.points);
        setRotationTransform(svgEl, el.rotation, b.x + b.width / 2, b.y + b.height / 2);
      } else {
        svgEl.removeAttribute("transform");
      }
      return true;
    }
    case "line":
    case "arrow": {
      const p0 = el.points[0], p1 = el.points[1];
      const hasArrows = el.start_arrowhead !== "none" || el.end_arrowhead !== "none";

      if (!hasArrows) {
        const needsPath = !!el.midpoint;
        if (needsPath !== (svgEl.tagName === "path")) return false;
        if (needsPath) {
          svgEl.setAttribute("d", `M ${p0.x} ${p0.y} Q ${el.midpoint!.x} ${el.midpoint!.y} ${p1.x} ${p1.y}`);
        } else {
          svgEl.setAttribute("x1", String(p0.x));
          svgEl.setAttribute("y1", String(p0.y));
          svgEl.setAttribute("x2", String(p1.x));
          svgEl.setAttribute("y2", String(p1.y));
        }
        setLineDataAttrs(svgEl, el);
      } else {
        const shaft = svgEl.firstElementChild as SVGElement | null;
        if (!shaft) return false;
        const { shaftStart, shaftEnd, arrowLen } = computeArrowGeometry(el);
        const needsPath = !!el.midpoint;
        if (needsPath !== (shaft.tagName === "path")) return false;
        if (needsPath) {
          shaft.setAttribute("d", `M ${shaftStart.x} ${shaftStart.y} Q ${el.midpoint!.x} ${el.midpoint!.y} ${shaftEnd.x} ${shaftEnd.y}`);
        } else {
          shaft.setAttribute("x1", String(shaftStart.x));
          shaft.setAttribute("y1", String(shaftStart.y));
          shaft.setAttribute("x2", String(shaftEnd.x));
          shaft.setAttribute("y2", String(shaftEnd.y));
        }
        let childIdx = 1;
        if (el.end_arrowhead !== "none") {
          const child = svgEl.children[childIdx] as SVGElement | undefined;
          if (child) {
            applyArrowheadAttrs(child, p1, arrowDir(el, "end"), arrowLen, el.end_arrowhead);
            childIdx++;
          }
        }
        if (el.start_arrowhead !== "none") {
          const child = svgEl.children[childIdx] as SVGElement | undefined;
          if (child) applyArrowheadAttrs(child, p0, arrowDir(el, "start"), arrowLen, el.start_arrowhead);
        }
        svgEl.setAttribute("data-p0", `${p0.x},${p0.y}`);
        svgEl.setAttribute("data-p1", `${p1.x},${p1.y}`);
        setLineDataAttrs(svgEl, el);
      }

      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      setRotationTransform(svgEl, el.rotation, midX, midY);
      return true;
    }
    default:
      return false;
  }
}

function setRotationTransform(svgEl: SVGElement, rotation: number, cx: number, cy: number): void {
  if (rotation !== 0) {
    svgEl.setAttribute("transform", `rotate(${rotation}, ${cx}, ${cy})`);
  } else {
    svgEl.removeAttribute("transform");
  }
}

function computeArrowLen(el: LineElement): number {
  const p0 = el.points[0], p1 = el.points[1];
  let shaftLength: number;
  if (el.midpoint) {
    const d01 = Math.hypot(el.midpoint.x - p0.x, el.midpoint.y - p0.y);
    const d12 = Math.hypot(p1.x - el.midpoint.x, p1.y - el.midpoint.y);
    const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    shaftLength = (d01 + d12 + chord) / 2;
  } else {
    shaftLength = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }
  return Math.max(3, el.stroke_width * 1.1, Math.min(el.stroke_width * 3, shaftLength * 0.3));
}

const ARROWHEAD_OVERLAP = 0.3;
const ARROW_TAN = Math.tan((25 * Math.PI) / 180);

function arrowDir(el: LineElement, end: "start" | "end"): Point {
  const p0 = el.points[0], p1 = el.points[1];
  let dx: number, dy: number;
  if (end === "end") {
    dx = (el.midpoint ? el.midpoint.x : p0.x) - p1.x;
    dy = (el.midpoint ? el.midpoint.y : p0.y) - p1.y;
  } else {
    dx = (el.midpoint ? el.midpoint.x : p1.x) - p0.x;
    dy = (el.midpoint ? el.midpoint.y : p1.y) - p0.y;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function computeArrowGeometry(el: LineElement): { shaftStart: Point; shaftEnd: Point; arrowLen: number } {
  const p0 = el.points[0], p1 = el.points[1];
  const arrowLen = computeArrowLen(el);
  let shaftStart = p0, shaftEnd = p1;
  if (el.end_arrowhead !== "none") {
    const dir = arrowDir(el, "end");
    const shorten = Math.max(0, shortenDistance(el.end_arrowhead, arrowLen) - ARROWHEAD_OVERLAP);
    shaftEnd = { x: p1.x + dir.x * shorten, y: p1.y + dir.y * shorten };
  }
  if (el.start_arrowhead !== "none") {
    const dir = arrowDir(el, "start");
    const shorten = Math.max(0, shortenDistance(el.start_arrowhead, arrowLen) - ARROWHEAD_OVERLAP);
    shaftStart = { x: p0.x + dir.x * shorten, y: p0.y + dir.y * shorten };
  }
  return { shaftStart, shaftEnd, arrowLen };
}

function shortenDistance(style: ArrowheadStyle, arrowLen: number): number {
  if (style === "arrow" || style === "triangle" || style === "circle") return arrowLen;
  if (style === "diamond") return arrowLen * 0.5;
  return 0;
}

function arrowheadAttrs(
  tip: Point,
  dir: Point,
  arrowLen: number,
  style: ArrowheadStyle,
): { tag: "polygon" | "circle" | "line"; attrs: Record<string, string> } | null {
  const perpX = -dir.y;
  const perpY = dir.x;

  if (style === "arrow" || style === "triangle") {
    const hw = arrowLen * ARROW_TAN;
    const bx = tip.x + dir.x * arrowLen;
    const by = tip.y + dir.y * arrowLen;
    return { tag: "polygon", attrs: {
      points: `${tip.x},${tip.y} ${bx + perpX * hw},${by + perpY * hw} ${bx - perpX * hw},${by - perpY * hw}`,
    }};
  }
  if (style === "circle") {
    const r = arrowLen * 0.5;
    return { tag: "circle", attrs: {
      cx: String(tip.x + dir.x * r), cy: String(tip.y + dir.y * r), r: String(r),
    }};
  }
  if (style === "bar") {
    const hw = arrowLen * 0.7;
    return { tag: "line", attrs: {
      x1: String(tip.x + perpX * hw), y1: String(tip.y + perpY * hw),
      x2: String(tip.x - perpX * hw), y2: String(tip.y - perpY * hw),
    }};
  }
  if (style === "diamond") {
    const h = arrowLen * 0.5;
    const mx = tip.x + dir.x * h, my = tip.y + dir.y * h;
    return { tag: "polygon", attrs: {
      points: `${tip.x},${tip.y} ${mx + perpX * h},${my + perpY * h} ${tip.x + dir.x * h * 2},${tip.y + dir.y * h * 2} ${mx - perpX * h},${my - perpY * h}`,
    }};
  }
  return null;
}

function applyArrowheadAttrs(el: SVGElement, tip: Point, dir: Point, arrowLen: number, style: ArrowheadStyle): void {
  const geo = arrowheadAttrs(tip, dir, arrowLen, style);
  if (geo) for (const [k, v] of Object.entries(geo.attrs)) el.setAttribute(k, v);
}

export function renderElement(el: DrawingElement, theme: Theme, textBounds?: TextBoundsMap): SVGElement | null {
  switch (el.type) {
    case "pen":
    case "highlighter":
      return renderPath(el, theme);
    case "line":
    case "arrow":
      return renderLine(el, theme);
    case "rect":
      return renderRect(el, theme);
    case "ellipse":
      return renderEllipse(el, theme);
    case "diamond":
      return renderDiamond(el, theme);
    case "text":
      return renderText(el, theme, textBounds);
    default:
      return null;
  }
}

function setLayerAttr(svgEl: SVGElement, el: BaseElement): void {
  if (el.layer !== "default") svgEl.setAttribute("data-layer", el.layer);
}

function applyShapeAttrs(svgEl: SVGElement, el: BaseElement, theme: Theme): void {
  svgEl.setAttribute("stroke", resolveColor(el.stroke_color, theme));
  svgEl.setAttribute("stroke-width", String(el.stroke_width));
  svgEl.setAttribute("fill", el.fill_color ? resolveColor(el.fill_color, theme) : "none");
  svgEl.setAttribute("opacity", String(el.opacity));
  if (isToken(el.stroke_color)) svgEl.setAttribute("data-stroke-token", el.stroke_color);
  if (isToken(el.fill_color)) svgEl.setAttribute("data-fill-token", el.fill_color);
  applyStrokeStyle(svgEl, el);
  setLayerAttr(svgEl, el);
}

function setOrRemoveAttr(svgEl: SVGElement, attr: string, value: string | undefined): void {
  if (value !== undefined) svgEl.setAttribute(attr, value);
  else svgEl.removeAttribute(attr);
}

function setLineDataAttrs(svgEl: SVGElement, el: LineElement): void {
  setOrRemoveAttr(svgEl, "data-start-binding", el.startBinding ? JSON.stringify(el.startBinding) : undefined);
  setOrRemoveAttr(svgEl, "data-end-binding", el.endBinding ? JSON.stringify(el.endBinding) : undefined);
  setOrRemoveAttr(svgEl, "data-start-arrowhead", el.start_arrowhead !== "none" ? el.start_arrowhead : undefined);
  setOrRemoveAttr(svgEl, "data-end-arrowhead", el.end_arrowhead !== "none" ? el.end_arrowhead : undefined);
  setOrRemoveAttr(svgEl, "data-midpoint", el.midpoint ? `${el.midpoint.x},${el.midpoint.y}` : undefined);
}

function applyStrokeStyle(svgEl: SVGElement, el: BaseElement): void {
  if (el.dash_length === 0 && el.dash_gap === 0) return;
  // Preserve raw model values so import can recover them without inverting the visual scaling
  svgEl.setAttribute("data-dash-length", String(el.dash_length));
  svgEl.setAttribute("data-dash-gap", String(el.dash_gap));
  const sw = el.stroke_width;
  const scale = Math.max(1, Math.min(Math.sqrt(sw * 2), 3));
  if (el.dash_length < 1 && el.dash_gap > 0) {
    // Round linecap extends each dot by sw/2 per side, so add sw to keep edge-to-edge gap correct
    const dotGap = el.dash_gap + sw;
    svgEl.setAttribute("stroke-dasharray", `0.1,${dotGap}`);
    svgEl.setAttribute("stroke-linecap", "round");
  } else if (el.dash_length >= 1) {
    const dashLen = el.dash_length * scale;
    const gap = el.dash_gap > 0 ? el.dash_gap : Math.max(1, dashLen * 0.6);
    svgEl.setAttribute("stroke-dasharray", `${dashLen},${gap}`);
  }
}

export function renderPath(el: PathElement, theme: Theme): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("id", el.id);
  path.setAttribute("d", pointsToPath(el.points));
  path.setAttribute("stroke", resolveColor(el.stroke_color, theme));
  path.setAttribute("stroke-width", String(el.stroke_width));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", String(el.opacity));
  path.setAttribute("data-points", el.points.map(p => `${p.x},${p.y}`).join(" "));
  if (isToken(el.stroke_color)) path.setAttribute("data-stroke-token", el.stroke_color);
  setLayerAttr(path, el);
  if (el.type === "highlighter") {
    path.setAttribute("data-type", "highlighter");
  }
  if (el.rotation !== 0 && el.points.length > 0) {
    const b = pointsBounds(el.points);
    setRotationTransform(path, el.rotation, b.x + b.width / 2, b.y + b.height / 2);
  }
  return path;
}

function renderArrowhead(
  tip: Point,
  dir: Point,
  arrowLen: number,
  style: ArrowheadStyle,
  strokeColor: string,
): SVGElement | null {
  const geo = arrowheadAttrs(tip, dir, arrowLen, style);
  if (!geo) return null;

  const el = document.createElementNS("http://www.w3.org/2000/svg", geo.tag);
  for (const [k, v] of Object.entries(geo.attrs)) el.setAttribute(k, v);

  if (geo.tag === "line") {
    el.setAttribute("stroke", strokeColor);
    el.setAttribute("stroke-width", String(arrowLen * 0.3));
    el.setAttribute("stroke-linecap", "round");
  } else {
    el.setAttribute("fill", strokeColor);
    el.setAttribute("stroke", "none");
  }
  return el;
}

export function renderLine(el: LineElement, theme: Theme): SVGElement {
  const p0 = el.points[0];
  const p1 = el.points[1];
  const hasArrows = el.start_arrowhead !== "none" || el.end_arrowhead !== "none";
  const resolvedStroke = resolveColor(el.stroke_color, theme);

  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const rotateTransform = el.rotation !== 0 ? `rotate(${el.rotation}, ${midX}, ${midY})` : "";

  // Compute shortened shaft endpoints once (identity when no arrows)
  let s0 = p0, s1 = p1;
  let arrowLen = 0;
  if (hasArrows) {
    const geo = computeArrowGeometry(el);
    s0 = geo.shaftStart;
    s1 = geo.shaftEnd;
    arrowLen = geo.arrowLen;
  }

  let shaft: SVGElement;
  if (el.midpoint) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${s0.x} ${s0.y} Q ${el.midpoint.x} ${el.midpoint.y} ${s1.x} ${s1.y}`);
    shaft = path;
  } else {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(s0.x));
    line.setAttribute("y1", String(s0.y));
    line.setAttribute("x2", String(s1.x));
    line.setAttribute("y2", String(s1.y));
    shaft = line;
  }
  shaft.setAttribute("stroke", resolvedStroke);
  shaft.setAttribute("stroke-width", String(el.stroke_width));
  shaft.setAttribute("fill", "none");
  shaft.setAttribute("stroke-linecap", hasArrows ? "butt" : "round");
  shaft.setAttribute("stroke-linejoin", "round");
  applyStrokeStyle(shaft, el);

  if (!hasArrows) {
    shaft.setAttribute("id", el.id);
    shaft.setAttribute("opacity", String(el.opacity));
    if (isToken(el.stroke_color)) shaft.setAttribute("data-stroke-token", el.stroke_color);
    if (rotateTransform) shaft.setAttribute("transform", rotateTransform);
    setLineDataAttrs(shaft, el);
    setLayerAttr(shaft, el);
    return shaft;
  }

  const arrowElements: SVGElement[] = [];
  if (el.end_arrowhead !== "none") {
    const head = renderArrowhead(p1, arrowDir(el, "end"), arrowLen, el.end_arrowhead, resolvedStroke);
    if (head) arrowElements.push(head);
  }
  if (el.start_arrowhead !== "none") {
    const head = renderArrowhead(p0, arrowDir(el, "start"), arrowLen, el.start_arrowhead, resolvedStroke);
    if (head) arrowElements.push(head);
  }

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("id", el.id);
  group.setAttribute("opacity", String(el.opacity));
  if (isToken(el.stroke_color)) group.setAttribute("data-stroke-token", el.stroke_color);
  if (rotateTransform) group.setAttribute("transform", rotateTransform);
  setLineDataAttrs(group, el);
  setLayerAttr(group, el);
  group.setAttribute("data-p0", `${p0.x},${p0.y}`);
  group.setAttribute("data-p1", `${p1.x},${p1.y}`);
  group.appendChild(shaft);
  for (const arrowEl of arrowElements) group.appendChild(arrowEl);

  return group;
}

export function renderRect(el: ShapeElement, theme: Theme): SVGRectElement {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("id", el.id);
  rect.setAttribute("x", String(el.x));
  rect.setAttribute("y", String(el.y));
  rect.setAttribute("width", String(el.width));
  rect.setAttribute("height", String(el.height));
  applyShapeAttrs(rect, el, theme);
  setRotationTransform(rect, el.rotation, el.x + el.width / 2, el.y + el.height / 2);
  return rect;
}

export function renderEllipse(el: ShapeElement, theme: Theme): SVGEllipseElement {
  const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  ellipse.setAttribute("id", el.id);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ellipse.setAttribute("cx", String(cx));
  ellipse.setAttribute("cy", String(cy));
  ellipse.setAttribute("rx", String(el.width / 2));
  ellipse.setAttribute("ry", String(el.height / 2));
  applyShapeAttrs(ellipse, el, theme);
  setRotationTransform(ellipse, el.rotation, cx, cy);
  return ellipse;
}

export function renderDiamond(el: ShapeElement, theme: Theme): SVGPolygonElement {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const points = [
    `${cx},${el.y}`,
    `${el.x + el.width},${cy}`,
    `${cx},${el.y + el.height}`,
    `${el.x},${cy}`,
  ].join(" ");

  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("id", el.id);
  polygon.setAttribute("points", points);
  applyShapeAttrs(polygon, el, theme);
  setRotationTransform(polygon, el.rotation, cx, cy);
  return polygon;
}

export function renderText(el: TextElement, theme: Theme, textBounds?: TextBoundsMap): SVGTextElement {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("id", el.id);
  text.setAttribute("x", String(el.x));
  text.setAttribute("y", String(el.y));
  text.setAttribute("fill", resolveColor(el.stroke_color, theme));
  text.setAttribute("font-size", String(el.font_size));
  text.setAttribute("font-family", fontFamilyMap[el.font_family] ?? fontFamilyMap.normal);
  text.setAttribute("text-anchor", textAnchorMap[el.text_align] ?? "start");
  text.setAttribute("dominant-baseline", "text-before-edge");
  text.setAttribute("opacity", String(el.opacity));
  text.setAttribute("data-font-family", el.font_family);
  if (isToken(el.stroke_color)) text.setAttribute("data-stroke-token", el.stroke_color);
  setLayerAttr(text, el);
  if (el.width != null) text.setAttribute("data-wrap-width", String(el.width));

  const lines = el.width
    ? wrapTextToLines(el.text, el.width, el.font_size, el.font_family)
    : el.text.split("\n");

  if (lines.length > 1) {
    for (let i = 0; i < lines.length; i++) {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(el.x));
      tspan.setAttribute("dy", i === 0 ? "0" : "1.2em");
      tspan.textContent = lines[i];
      text.appendChild(tspan);
    }
  } else {
    text.textContent = el.text;
  }

  if (el.rotation !== 0) {
    const bbox = getBoundingBox(el, textBounds);
    setRotationTransform(text, el.rotation, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  }
  return text;
}
