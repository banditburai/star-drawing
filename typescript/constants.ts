import type { DrawingConfig, HandleType, Tool, ToolSettings } from "./types.js";

// solid: both 0, dashed: length 6 + gap 0 (auto-derived), dotted: length 0 + gap 5
export const DASH_PRESETS: Record<string, { dash_length: number; dash_gap: number }> = {
  solid: { dash_length: 0, dash_gap: 0 },
  dashed: { dash_length: 6, dash_gap: 0 },
  dotted: { dash_length: 0, dash_gap: 5 },
};

export const cursorForHandle: Record<HandleType, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  rotation: "grab",
  start: "move",
  end: "move",
  midpoint: "move",
};

export const fontFamilyMap: Record<string, string> = {
  "hand-drawn": '"Shantell Sans", "Caveat", cursive, sans-serif',
  normal: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  monospace: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

// viewBox percentage values
export const fontSizeMap: Record<string, number> = {
  small: 3,
  medium: 4,
  large: 6,
};

// Derived inverse lookup: font size → preset name
export const reverseFontSizeMap: Record<number, string> = Object.fromEntries(
  Object.entries(fontSizeMap).map(([k, v]) => [v, k]),
);

export const textAnchorMap: Record<string, string> = {
  left: "start",
  center: "middle",
  right: "end",
};

export const TOOL_DEFAULTS = {
  pen: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0 },
  highlighter: { stroke_width: 10, opacity: 0.4, dash_length: 0, dash_gap: 0 },
  line: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0, start_arrowhead: "none" as const, end_arrowhead: "none" as const },
  arrow: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0, start_arrowhead: "none" as const, end_arrowhead: "arrow" as const },
  rect: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0 },
  ellipse: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0 },
  diamond: { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0 },
  text: { opacity: 1 },
  select: {},
  eraser: { stroke_width: 5 },
} satisfies Record<Tool, ToolSettings>;

export const DEFAULT_CONFIG: DrawingConfig = {
  signal: "drawing",
  defaultStrokeColor: "#000000",
  defaultFillColor: "#ffffff",
  defaultStrokeWidth: 2,
  defaultOpacity: 1,
  defaultTool: "pen",
  defaultLayer: "default",
  throttleMs: 8,
};

// viewBox units, 0-100 coordinate space
export const SNAP_THRESHOLD = 1.5;

export const toolCursorMap: Record<Tool, string> = {
  select: "default",
  pen: "crosshair",
  highlighter: "crosshair",
  line: "crosshair",
  arrow: "crosshair",
  rect: "crosshair",
  ellipse: "crosshair",
  diamond: "crosshair",
  text: "text",
  eraser: "crosshair",
};
