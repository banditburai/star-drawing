export type ArrowheadStyle = "none" | "arrow" | "triangle" | "circle" | "bar" | "diamond";

export type Theme = "light" | "dark";

export interface PaletteData {
  stroke: Record<Theme, string[]>;
  fill: Record<Theme, string[]>;
}

export interface ThemeColors {
  highlightStroke: string;
  canvasBackground: string;
  handleFill: string;
  handlePrimary: string;
  handleAccent: string;
}

export type Tool =
  | "select"
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "diamond"
  | "text"
  | "eraser";

export type Layer = "background" | "default" | "foreground";

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Overrides text-size approximation with SVG getBBox() measurements. */
export type TextBoundsMap = ReadonlyMap<string, BoundingBox>;

export interface BaseElement {
  id: string;
  type: Tool;
  layer: Layer;
  stroke_color: string;
  stroke_width: number;
  dash_length: number;
  dash_gap: number;
  fill_color: string;
  opacity: number;
  created_at: number;
  rotation: number;
}

export interface PathElement extends BaseElement {
  type: "pen" | "highlighter";
  points: Point[];
}

export interface LineElement extends BaseElement {
  type: "line" | "arrow";
  points: [Point, Point];
  start_arrowhead: ArrowheadStyle;
  end_arrowhead: ArrowheadStyle;
  midpoint?: Point | undefined;
  startBinding?: Binding | undefined;
  endBinding?: Binding | undefined;
}

export interface Binding {
  elementId: string;
  anchor: Point;
}

export interface SnapResult {
  point: Point;
  elementId?: string;
  anchor?: Point;
}

export interface ShapeElement extends BaseElement {
  type: "rect" | "ellipse" | "diamond";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  x: number;
  y: number;
  text: string;
  font_size: number;
  font_family: "hand-drawn" | "normal" | "monospace";
  text_align: "left" | "center" | "right";
  width?: number | undefined;
}

export type DrawingElement = PathElement | LineElement | ShapeElement | TextElement;

export const isLine = (el: DrawingElement): el is LineElement =>
  el.type === "line" || el.type === "arrow";
export const isShape = (el: DrawingElement): el is ShapeElement =>
  el.type === "rect" || el.type === "ellipse" || el.type === "diamond";
export const isPath = (el: DrawingElement): el is PathElement =>
  el.type === "pen" || el.type === "highlighter";
export const isText = (el: DrawingElement): el is TextElement =>
  el.type === "text";

export function cloneElement<T extends DrawingElement>(el: T): T {
  if ("points" in el) {
    const clone = {
      ...el,
      points: (el.points as Point[]).map((p) => ({ ...p })),
    } as T;
    if (isLine(el)) {
      const lineClone = clone as T & { midpoint?: Point; startBinding?: Binding; endBinding?: Binding };
      if (lineClone.midpoint) lineClone.midpoint = { ...lineClone.midpoint };
      if (lineClone.startBinding) lineClone.startBinding = { ...lineClone.startBinding, anchor: { ...lineClone.startBinding.anchor } };
      if (lineClone.endBinding) lineClone.endBinding = { ...lineClone.endBinding, anchor: { ...lineClone.endBinding.anchor } };
    }
    return clone;
  }
  return { ...el } as T;
}

export type HandleType =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotation"
  | "start"
  | "end"
  | "midpoint";

export interface Handle {
  type: HandleType;
  x: number;
  y: number;
  cursor: string;
}

export interface ToolSettings {
  stroke_width?: number;
  opacity?: number;
  stroke_color?: string;
  fill_color?: string;
  dash_length?: number;
  dash_gap?: number;
  start_arrowhead?: ArrowheadStyle;
  end_arrowhead?: ArrowheadStyle;
}

export interface DrawingConfig {
  signal: string;
  defaultStrokeColor: string;
  defaultFillColor: string;
  defaultStrokeWidth: number;
  defaultOpacity: number;
  defaultTool: Tool;
  defaultLayer: Layer;
  throttleMs: number;
  readonly?: boolean;
  viewBoxWidth: number;
  viewBoxHeight: number;
  fontEmbedUrls?: Record<string, string>;
  palette?: PaletteData;
  theme?: Theme;
}

export type ResizeHandleType = Exclude<HandleType, "rotation" | "start" | "end" | "midpoint">;

export type StyleProperty =
  | "stroke_color"
  | "fill_color"
  | "fill_enabled"
  | "stroke_width"
  | "opacity"
  | "dash_length"
  | "dash_gap"
  | "start_arrowhead"
  | "end_arrowhead";

export type MovePosition = Point | { points: Point[]; midpoint?: Point | undefined };

export interface DrawingState {
  tool: Tool;
  is_drawing: boolean;
  can_undo: boolean;
  can_redo: boolean;
  text_editing: boolean;
  stroke_color: string;
  fill_color: string;
  fill_enabled: boolean;
  stroke_width: number;
  dash_length: number;
  dash_gap: number;
  opacity: number;
  selected_ids: string[];
  active_layer: Layer;
  font_family: TextElement["font_family"];
  font_size: string | number;
  text_align: TextElement["text_align"];
  start_arrowhead: ArrowheadStyle;
  end_arrowhead: ArrowheadStyle;
  selected_is_line: boolean;
  selected_is_text: boolean;
  selected_is_highlighter: boolean;
  theme: Theme;
}

export interface GroupResizeState {
  elements: Array<{
    id: string;
    bounds: BoundingBox;
    rotation: number;
    originalElement: DrawingElement;
  }>;
  groupBounds: BoundingBox;
}

export interface GroupRotationState {
  elements: Array<{
    id: string;
    position: Point;
    rotation: number;
    originalElement: DrawingElement;
  }>;
  center: Point;
  startAngle: number;
}

export type ElementChangeEvent =
  | { type: "create"; element: DrawingElement }
  | { type: "update"; element: DrawingElement }
  | { type: "delete"; elementId: string }
  | { type: "reorder"; order: string[] };

export type UndoAction =
  | { action: "add"; data: DrawingElement[] }
  | { action: "remove"; data: DrawingElement[] }
  | {
      action: "move";
      data: Array<{
        id: string;
        before: MovePosition;
        after: MovePosition;
      }>;
    }
  | { action: "modify"; data: Array<{ id: string; before: DrawingElement; after: DrawingElement }> }
  | { action: "reorder"; before: string[]; after: string[] };
