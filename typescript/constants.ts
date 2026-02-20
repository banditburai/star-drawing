import type { DrawingConfig, HandleType, TextElement, Theme, ThemeColors, Tool, ToolSettings } from "./types.js";
import { DEFAULT_STROKE_TOKEN } from "./palette.js";

export const DEFAULT_FONT_EMBED_URLS: Record<string, string> = {
  "hand-drawn": "https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@400&display=swap",
};

export const THEME_COLORS: Record<Theme, ThemeColors> = {
  light: {
    highlightStroke: "#ffff00",
    canvasBackground: "#ffffff",
    handleFill: "#ffffff",
    handlePrimary: "#0066ff",
    handleAccent: "#10b981",
  },
  dark: {
    highlightStroke: "#ffe066",
    canvasBackground: "#1e1e2e",
    handleFill: "#2a2a3e",
    handlePrimary: "#4d94ff",
    handleAccent: "#34d399",
  },
};

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

export const fontFamilyMap: Record<TextElement["font_family"], string> = {
  "hand-drawn": '"Shantell Sans", "Caveat", cursive, sans-serif',
  normal: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  monospace: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

export const fontSizeMap: Record<"small" | "medium" | "large", number> = {
  small: 3,
  medium: 4,
  large: 6,
};

export const reverseFontSizeMap: Record<number, string> = Object.fromEntries(
  Object.entries(fontSizeMap).map(([k, v]) => [v, k]),
);

export const textAnchorMap: Record<TextElement["text_align"], string> = {
  left: "start",
  center: "middle",
  right: "end",
};

// stroke_color intentionally excluded: it persists globally across tools so switching
// between pen/line/rect/etc keeps whatever color the user chose.  Only tools that need
// a *different* default (highlighter → yellow, text → ink) override it explicitly.
const BASE = { stroke_width: 2, opacity: 1, dash_length: 0, dash_gap: 0 } as const;

export const TOOL_DEFAULTS = {
  pen: { ...BASE },
  highlighter: { ...BASE, stroke_width: 4, opacity: 0.4, stroke_color: THEME_COLORS.light.highlightStroke },
  line: { ...BASE, start_arrowhead: "none", end_arrowhead: "none" },
  arrow: { ...BASE, start_arrowhead: "none", end_arrowhead: "arrow" },
  rect: { ...BASE },
  ellipse: { ...BASE },
  diamond: { ...BASE },
  text: { opacity: 1, stroke_color: DEFAULT_STROKE_TOKEN },
  select: {},
  eraser: { stroke_width: 5 },
} satisfies Record<Tool, ToolSettings>;

export function getToolDefaults(theme: Theme): Record<Tool, ToolSettings> {
  const colors = THEME_COLORS[theme];
  return {
    ...TOOL_DEFAULTS,
    highlighter: { ...TOOL_DEFAULTS.highlighter, stroke_color: colors.highlightStroke },
  };
}

export const DEFAULT_CONFIG: DrawingConfig = {
  signal: "drawing",
  defaultStrokeColor: DEFAULT_STROKE_TOKEN,
  defaultFillColor: "",
  defaultStrokeWidth: 2,
  defaultOpacity: 1,
  defaultTool: "pen",
  defaultLayer: "default",
  throttleMs: 16,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
};

export const SNAP_THRESHOLD = 1.5;
export const TEXT_MARGIN_VB = 2;
export const MIN_TEXT_WIDTH_VB = 10;
export const MIN_POINT_DISTANCE_VB = 0.5;
export const DUPLICATE_OFFSET_VB = 2;

export const DOUBLE_CLICK_MS = 400;
export const BLUR_COMMIT_DELAY_MS = 100;
export const NUDGE_STEP = 1;
export const NUDGE_STEP_SHIFT = 5;
export const ROTATION_SNAP_DEG = 15;
export const PREVIEW_OPACITY = 0.6;
export const TEXT_LINE_HEIGHT = 1.4;
export const MIN_TEXTAREA_WIDTH_PX = 40;

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
