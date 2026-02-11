import { fontFamilyMap, textAnchorMap } from "./constants.js";
import { getBoundingBox, pointsToPath, wrapTextToLines } from "./geometry.js";
import type {
  ArrowheadStyle,
  BaseElement,
  DrawingElement,
  LineElement,
  PathElement,
  ShapeElement,
  TextBoundsMap,
  TextElement,
} from "./types.js";

export function renderElement(el: DrawingElement, textBounds?: TextBoundsMap): SVGElement | null {
  switch (el.type) {
    case "pen":
    case "highlighter":
      return renderPath(el);
    case "line":
    case "arrow":
      return renderLine(el);
    case "rect":
      return renderRect(el);
    case "ellipse":
      return renderEllipse(el);
    case "diamond":
      return renderDiamond(el);
    case "text":
      return renderText(el, textBounds);
    default:
      return null;
  }
}

/**
 * Apply stroke style (dashed/dotted) to an SVG element using numeric dash_length + dash_gap.
 * solid: dash_length === 0 && dash_gap === 0
 * dotted: dash_length < 1 && dash_gap > 0  (tiny dash + user-controlled gap)
 * dashed: dash_length >= 1                   (user-controlled length, auto-derived gap)
 */
function applyStrokeStyle(svgEl: SVGElement, el: BaseElement): void {
  if (el.dash_length === 0 && el.dash_gap === 0) return; // solid
  const sw = el.stroke_width;
  // Cap scale factor at 3 to prevent dashes from becoming rectangles at large widths
  const scale = Math.max(1, Math.min(Math.sqrt(sw * 2), 3));
  if (el.dash_length < 1 && el.dash_gap > 0) {
    // Round linecap extends each dot by sw/2 on both sides, eating into the gap.
    // Add stroke_width so the user's gap value represents edge-to-edge spacing.
    const dotGap = el.dash_gap + sw;
    svgEl.setAttribute("stroke-dasharray", `0.1,${dotGap}`);
    svgEl.setAttribute("stroke-linecap", "round");
  } else if (el.dash_length >= 1) {
    const dashLen = el.dash_length * scale;
    const gap = el.dash_gap > 0 ? el.dash_gap : Math.max(1, dashLen * 0.6);
    svgEl.setAttribute("stroke-dasharray", `${dashLen},${gap}`);
  }
}

export function renderPath(el: PathElement): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("id", el.id);
  path.setAttribute("d", pointsToPath(el.points));
  path.setAttribute("stroke", el.stroke_color);
  path.setAttribute("stroke-width", String(el.stroke_width));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", String(el.opacity));
  // Dashed/dotted looks bad on freehand paths
  if (el.type === "highlighter") {
    path.style.mixBlendMode = "multiply";
  }
  if (el.rotation !== 0 && el.points.length > 0) {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    path.setAttribute("transform", `rotate(${el.rotation}, ${cx}, ${cy})`);
  }
  return path;
}

// tan(25°) ≈ 0.466 — half-angle for arrowhead triangles
const ARROW_TAN = Math.tan((25 * Math.PI) / 180);

function renderArrowhead(
  tip: { x: number; y: number },
  dir: { x: number; y: number },
  arrowLen: number,
  style: ArrowheadStyle,
  strokeColor: string,
): { element: SVGElement | null; shortenDistance: number } {
  if (style === "none") return { element: null, shortenDistance: 0 };

  const px = -dir.y;
  const py = dir.x;

  if (style === "arrow" || style === "triangle") {
    const halfWidth = arrowLen * ARROW_TAN;
    const baseX = tip.x + dir.x * arrowLen;
    const baseY = tip.y + dir.y * arrowLen;
    const lx = baseX + px * halfWidth;
    const ly = baseY + py * halfWidth;
    const rx = baseX - px * halfWidth;
    const ry = baseY - py * halfWidth;
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", `${tip.x},${tip.y} ${lx},${ly} ${rx},${ry}`);
    poly.setAttribute("fill", strokeColor);
    poly.setAttribute("stroke", "none");
    return { element: poly, shortenDistance: arrowLen };
  }

  if (style === "circle") {
    const radius = arrowLen * 0.5;
    const cx = tip.x + dir.x * radius;
    const cy = tip.y + dir.y * radius;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", strokeColor);
    circle.setAttribute("stroke", "none");
    return { element: circle, shortenDistance: radius * 2 };
  }

  if (style === "bar") {
    const halfWidth = arrowLen * 0.7;
    const thickness = arrowLen * 0.3;
    const barLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    barLine.setAttribute("x1", String(tip.x + px * halfWidth));
    barLine.setAttribute("y1", String(tip.y + py * halfWidth));
    barLine.setAttribute("x2", String(tip.x - px * halfWidth));
    barLine.setAttribute("y2", String(tip.y - py * halfWidth));
    barLine.setAttribute("stroke", strokeColor);
    barLine.setAttribute("stroke-width", String(thickness));
    barLine.setAttribute("stroke-linecap", "round");
    return { element: barLine, shortenDistance: 0 };
  }

  if (style === "diamond") {
    // Equilateral diamond (rotated square): tip → side → back → side
    const half = arrowLen * 0.5;
    const backX = tip.x + dir.x * half * 2;
    const backY = tip.y + dir.y * half * 2;
    const midX = tip.x + dir.x * half;
    const midY = tip.y + dir.y * half;
    const lx = midX + px * half;
    const ly = midY + py * half;
    const rx = midX - px * half;
    const ry = midY - py * half;
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", `${tip.x},${tip.y} ${lx},${ly} ${backX},${backY} ${rx},${ry}`);
    poly.setAttribute("fill", strokeColor);
    poly.setAttribute("stroke", "none");
    return { element: poly, shortenDistance: half };
  }

  return { element: null, shortenDistance: 0 };
}

export function renderLine(el: LineElement): SVGElement {
  const p0 = el.points[0];
  const p1 = el.points[1];
  const startStyle = el.start_arrowhead || "none";
  const endStyle = el.end_arrowhead || "none";
  const hasArrows = startStyle !== "none" || endStyle !== "none";

  let shaft: SVGElement;
  if (el.midpoint) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${p0.x} ${p0.y} Q ${el.midpoint.x} ${el.midpoint.y} ${p1.x} ${p1.y}`;
    path.setAttribute("d", d);
    shaft = path;
  } else {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(p0.x));
    line.setAttribute("y1", String(p0.y));
    line.setAttribute("x2", String(p1.x));
    line.setAttribute("y2", String(p1.y));
    shaft = line;
  }
  shaft.setAttribute("stroke", el.stroke_color);
  shaft.setAttribute("stroke-width", String(el.stroke_width));
  shaft.setAttribute("fill", "none");
  shaft.setAttribute("stroke-linecap", hasArrows ? "butt" : "round");
  shaft.setAttribute("stroke-linejoin", "round");

  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const rotateTransform = el.rotation !== 0 ? `rotate(${el.rotation}, ${midX}, ${midY})` : "";

  if (!hasArrows) {
    applyStrokeStyle(shaft, el);
    shaft.setAttribute("id", el.id);
    shaft.setAttribute("opacity", String(el.opacity));
    if (rotateTransform) shaft.setAttribute("transform", rotateTransform);
    return shaft;
  }

  // Arrowhead sizing: proportional to stroke width (3x), capped by shaft length (30%).
  // Floor at sw*1.1 ensures the triangle base always covers the stroke width.
  let shaftLength: number;
  if (el.midpoint) {
    const d01 = Math.hypot(el.midpoint.x - p0.x, el.midpoint.y - p0.y);
    const d12 = Math.hypot(p1.x - el.midpoint.x, p1.y - el.midpoint.y);
    const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    shaftLength = (d01 + d12 + chord) / 2;
  } else {
    shaftLength = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }
  const arrowLen = Math.max(
    3,
    el.stroke_width * 1.1,
    Math.min(el.stroke_width * 3, shaftLength * 0.3),
  );

  // Overlap: shorten shaft slightly less so it tucks under the opaque arrowhead,
  // preventing anti-aliasing seams at the junction (especially on axis-aligned lines)
  const OVERLAP = 0.3;
  const arrowElements: SVGElement[] = [];
  let s0 = p0;
  let s1 = p1;

  if (endStyle !== "none") {
    let dx: number, dy: number;
    if (el.midpoint) {
      dx = el.midpoint.x - p1.x;
      dy = el.midpoint.y - p1.y;
    } else {
      dx = p0.x - p1.x;
      dy = p0.y - p1.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const result = renderArrowhead(p1, { x: ux, y: uy }, arrowLen, endStyle, el.stroke_color);
    if (result.element) arrowElements.push(result.element);
    if (result.shortenDistance > 0) {
      const shorten = Math.max(0, result.shortenDistance - OVERLAP);
      s1 = { x: p1.x + ux * shorten, y: p1.y + uy * shorten };
    }
  }

  if (startStyle !== "none") {
    let dx: number, dy: number;
    if (el.midpoint) {
      dx = el.midpoint.x - p0.x;
      dy = el.midpoint.y - p0.y;
    } else {
      dx = p1.x - p0.x;
      dy = p1.y - p0.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const result = renderArrowhead(p0, { x: ux, y: uy }, arrowLen, startStyle, el.stroke_color);
    if (result.element) arrowElements.push(result.element);
    if (result.shortenDistance > 0) {
      const shorten = Math.max(0, result.shortenDistance - OVERLAP);
      s0 = { x: p0.x + ux * shorten, y: p0.y + uy * shorten };
    }
  }

  if (el.midpoint) {
    const path = shaft as SVGPathElement;
    path.setAttribute("d", `M ${s0.x} ${s0.y} Q ${el.midpoint.x} ${el.midpoint.y} ${s1.x} ${s1.y}`);
  } else {
    const line = shaft as SVGLineElement;
    line.setAttribute("x1", String(s0.x));
    line.setAttribute("y1", String(s0.y));
    line.setAttribute("x2", String(s1.x));
    line.setAttribute("y2", String(s1.y));
  }

  applyStrokeStyle(shaft, el);

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("id", el.id);
  group.setAttribute("opacity", String(el.opacity));
  if (rotateTransform) group.setAttribute("transform", rotateTransform);
  group.appendChild(shaft);
  for (const arrowEl of arrowElements) group.appendChild(arrowEl);

  return group;
}

export function renderRect(el: ShapeElement): SVGRectElement {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("id", el.id);
  rect.setAttribute("x", String(el.x));
  rect.setAttribute("y", String(el.y));
  rect.setAttribute("width", String(el.width));
  rect.setAttribute("height", String(el.height));
  rect.setAttribute("stroke", el.stroke_color);
  rect.setAttribute("stroke-width", String(el.stroke_width));
  rect.setAttribute("fill", el.fill_color || "none");
  rect.setAttribute("opacity", String(el.opacity));
  applyStrokeStyle(rect, el);
  if (el.rotation !== 0) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    rect.setAttribute("transform", `rotate(${el.rotation}, ${cx}, ${cy})`);
  }
  return rect;
}

export function renderEllipse(el: ShapeElement): SVGEllipseElement {
  const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  ellipse.setAttribute("id", el.id);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ellipse.setAttribute("cx", String(cx));
  ellipse.setAttribute("cy", String(cy));
  ellipse.setAttribute("rx", String(el.width / 2));
  ellipse.setAttribute("ry", String(el.height / 2));
  ellipse.setAttribute("stroke", el.stroke_color);
  ellipse.setAttribute("stroke-width", String(el.stroke_width));
  ellipse.setAttribute("fill", el.fill_color || "none");
  ellipse.setAttribute("opacity", String(el.opacity));
  applyStrokeStyle(ellipse, el);
  if (el.rotation !== 0) {
    ellipse.setAttribute("transform", `rotate(${el.rotation}, ${cx}, ${cy})`);
  }
  return ellipse;
}

export function renderDiamond(el: ShapeElement): SVGPolygonElement {
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
  polygon.setAttribute("stroke", el.stroke_color);
  polygon.setAttribute("stroke-width", String(el.stroke_width));
  polygon.setAttribute("fill", el.fill_color || "none");
  polygon.setAttribute("opacity", String(el.opacity));
  applyStrokeStyle(polygon, el);
  if (el.rotation !== 0) {
    polygon.setAttribute("transform", `rotate(${el.rotation}, ${cx}, ${cy})`);
  }
  return polygon;
}

export function renderText(el: TextElement, textBounds?: TextBoundsMap): SVGTextElement {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("id", el.id);
  text.setAttribute("x", String(el.x));
  text.setAttribute("y", String(el.y));
  text.setAttribute("fill", el.stroke_color);
  text.setAttribute("font-size", String(el.font_size));
  text.setAttribute("font-family", fontFamilyMap[el.font_family] || fontFamilyMap.normal);
  text.setAttribute("text-anchor", textAnchorMap[el.text_align] || "start");
  text.setAttribute("dominant-baseline", "text-before-edge");
  text.setAttribute("opacity", String(el.opacity));

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
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    text.setAttribute("transform", `rotate(${el.rotation}, ${cx}, ${cy})`);
  }
  return text;
}
