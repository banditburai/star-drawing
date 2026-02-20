import { DEFAULT_CONFIG, fontSizeMap } from "./constants.js";
import { pointsBounds } from "./geometry.js";
import type {
  ArrowheadStyle,
  Binding,
  DrawingElement,
  Layer,
  Point,
  TextElement,
} from "./types.js";

const attrNum = (el: Element, attr: string, fallback = 0) =>
  Number.parseFloat(el.getAttribute(attr) ?? String(fallback));

const parseBinding = (el: Element, attr: string): Binding | undefined => {
  const raw = el.getAttribute(attr);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as Binding; }
  catch { return undefined; }
};

const parsePoint = (el: Element, attr: string): Point | undefined => {
  const raw = el.getAttribute(attr);
  if (!raw) return undefined;
  const [x, y] = raw.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
};

const parseArrowhead = (el: Element, attr: string, fallback: ArrowheadStyle): ArrowheadStyle =>
  (el.getAttribute(attr) as ArrowheadStyle) || fallback;

const parseRotation = (el: Element): number => {
  const t = el.getAttribute("transform");
  if (!t) return 0;
  const m = t.match(/rotate\(\s*(-?[\d.]+)/);
  return m ? Number(m[1]) || 0 : 0;
};

const parseDash = (el: Element): { dash_length: number; dash_gap: number } => {
  // Prefer raw model values written by applyStrokeStyle (avoids stroke-width scaling drift)
  const rawLen = el.getAttribute("data-dash-length");
  const rawGap = el.getAttribute("data-dash-gap");
  if (rawLen != null && rawGap != null) return { dash_length: Number(rawLen) || 0, dash_gap: Number(rawGap) || 0 };
  const raw = el.getAttribute("stroke-dasharray");
  if (!raw) return { dash_length: 0, dash_gap: 0 };
  const parts = raw.split(",").map(Number);
  if (parts.length < 2) return { dash_length: 0, dash_gap: 0 };
  if (parts[0] < 1) return { dash_length: 0, dash_gap: parts[1] };
  return { dash_length: parts[0], dash_gap: parts[1] };
};

const parseTextContent = (el: Element): string => {
  const tspans = el.querySelectorAll("tspan");
  if (tspans.length > 0) return Array.from(tspans, ts => ts.textContent ?? "").join("\n");
  return el.textContent ?? "";
};

const parsePointList = (raw: string): Point[] =>
  raw.trim().split(/\s+/).flatMap(p => {
    const [x, y] = p.split(",").map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });

const pathEndpoints = (el: Element): [Point, Point] => {
  const nums = (el.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
  return [
    { x: nums[0] ?? 0, y: nums[1] ?? 0 },
    { x: nums[nums.length - 2] ?? 0, y: nums[nums.length - 1] ?? 0 },
  ];
};

const lineProps = (src: Element, defaultEndArrowhead: ArrowheadStyle = "none") => ({
  start_arrowhead: parseArrowhead(src, "data-start-arrowhead", "none"),
  end_arrowhead: parseArrowhead(src, "data-end-arrowhead", defaultEndArrowhead),
  midpoint: parsePoint(src, "data-midpoint"),
  startBinding: parseBinding(src, "data-start-binding"),
  endBinding: parseBinding(src, "data-end-binding"),
});

export function parseSvgToElements(svg: string): DrawingElement[] | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    console.error("Failed to parse SVG:", parseError.textContent);
    return null;
  }

  const svgEl = doc.querySelector("svg");
  if (!svgEl) return null;

  const elements: DrawingElement[] = [];
  const elementsGroup = svgEl.querySelector(".elements") || svgEl;

  for (const el of elementsGroup.querySelectorAll(":scope > line, :scope > g, :scope > rect, :scope > ellipse, :scope > polygon, :scope > text, :scope > path")) {
    const id = el.getAttribute("id") ?? `imported-${crypto.randomUUID().split("-")[0]}`;
    const tagName = el.tagName.toLowerCase();
    const layer = (el.getAttribute("data-layer") as Layer) || "default";
    const dash = parseDash(el);

    const baseElement = {
      id,
      layer,
      stroke_color: el.getAttribute("data-stroke-token") ?? el.getAttribute("stroke") ?? DEFAULT_CONFIG.defaultStrokeColor,
      stroke_width: attrNum(el, "stroke-width", DEFAULT_CONFIG.defaultStrokeWidth),
      dash_length: dash.dash_length,
      dash_gap: dash.dash_gap,
      fill_color: el.getAttribute("fill") === "none" ? "" : (el.getAttribute("data-fill-token") ?? el.getAttribute("fill") ?? ""),
      opacity: attrNum(el, "opacity", DEFAULT_CONFIG.defaultOpacity),
      created_at: Date.now(),
      rotation: parseRotation(el),
    };

    if (tagName === "g") {
      const shaft = el.querySelector("line, path");
      if (!shaft) continue;
      const shaftDash = parseDash(shaft);
      // Prefer canonical endpoint data attrs (shaft coordinates are shortened for arrowhead overlap)
      const rawP0 = parsePoint(el, "data-p0");
      const rawP1 = parsePoint(el, "data-p1");
      let p0: Point, p1: Point;
      if (rawP0 && rawP1) {
        p0 = rawP0;
        p1 = rawP1;
      } else if (shaft.tagName.toLowerCase() === "line") {
        p0 = { x: attrNum(shaft, "x1"), y: attrNum(shaft, "y1") };
        p1 = { x: attrNum(shaft, "x2"), y: attrNum(shaft, "y2") };
      } else {
        [p0, p1] = pathEndpoints(shaft);
      }
      elements.push({
        ...baseElement,
        stroke_color: el.getAttribute("data-stroke-token") ?? shaft.getAttribute("stroke") ?? baseElement.stroke_color,
        stroke_width: attrNum(shaft, "stroke-width", baseElement.stroke_width),
        dash_length: shaftDash.dash_length,
        dash_gap: shaftDash.dash_gap,
        type: "arrow",
        points: [p0, p1],
        ...lineProps(el, "arrow"),
      });
    } else if (tagName === "line") {
      elements.push({
        ...baseElement, type: "line",
        points: [
          { x: attrNum(el, "x1"), y: attrNum(el, "y1") },
          { x: attrNum(el, "x2"), y: attrNum(el, "y2") },
        ],
        ...lineProps(el),
      });
    } else if (tagName === "rect") {
      elements.push({
        ...baseElement, type: "rect",
        x: attrNum(el, "x"), y: attrNum(el, "y"),
        width: attrNum(el, "width"), height: attrNum(el, "height"),
      });
    } else if (tagName === "ellipse") {
      const cx = attrNum(el, "cx"), cy = attrNum(el, "cy");
      const rx = attrNum(el, "rx"), ry = attrNum(el, "ry");
      elements.push({
        ...baseElement, type: "ellipse",
        x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2,
      });
    } else if (tagName === "polygon") {
      const pts = parsePointList(el.getAttribute("points") ?? "");
      if (pts.length >= 4) {
        const b = pointsBounds(pts);
        elements.push({
          ...baseElement, type: "diamond",
          x: b.x, y: b.y, width: b.width, height: b.height,
        });
      }
    } else if (tagName === "text") {
      const anchor = el.getAttribute("text-anchor") ?? "start";
      const rawFill = el.getAttribute("data-stroke-token") ?? el.getAttribute("fill");
      elements.push({
        ...baseElement, type: "text",
        stroke_color: rawFill ?? baseElement.stroke_color,
        stroke_width: 0,
        x: attrNum(el, "x"), y: attrNum(el, "y"),
        text: parseTextContent(el),
        font_size: attrNum(el, "font-size", fontSizeMap.medium),
        font_family: (el.getAttribute("data-font-family") ?? "hand-drawn") as TextElement["font_family"],
        text_align: ({ start: "left", middle: "center", end: "right" }[anchor] ?? "left") as TextElement["text_align"],
        width: el.hasAttribute("data-wrap-width") ? attrNum(el, "data-wrap-width") : undefined,
      });
    } else if (tagName === "path") {
      const isCurvedLine = el.hasAttribute("data-midpoint") || el.hasAttribute("data-start-binding") || el.hasAttribute("data-end-binding");
      if (isCurvedLine) {
        const [p0, p1] = pathEndpoints(el);
        elements.push({
          ...baseElement, type: "line",
          points: [p0, p1],
          ...lineProps(el),
        });
      } else {
        // Pen/highlighter: prefer lossless data-points (d attribute contains smoothed bezier, not original vertices)
        const rawPoints = el.getAttribute("data-points");
        let points: Point[];
        if (rawPoints) {
          points = parsePointList(rawPoints);
        } else {
          const d = el.getAttribute("d") ?? "";
          const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
          points = [];
          for (let i = 0; i + 1 < nums.length; i += 2) {
            points.push({ x: nums[i], y: nums[i + 1] });
          }
        }
        if (points.length > 0) {
          const isHighlighter = el.getAttribute("data-type") === "highlighter"
            || id.startsWith("highlighter-");
          elements.push({
            ...baseElement,
            type: isHighlighter ? "highlighter" : "pen",
            points,
          });
        }
      }
    }
  }

  return elements;
}
