export type ArrowheadStyle = "none" | "arrow" | "triangle" | "circle" | "bar" | "diamond";

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
  x: number; // 0-100 percentage
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Map from element ID → measured bounding box. Used to override text approximation with SVG getBBox() results. */
export type TextBoundsMap = ReadonlyMap<string, BoundingBox>;

export interface BaseElement {
  id: string;
  type: Tool;
  layer: Layer;
  stroke_color: string;
  stroke_width: number;
  dash_length: number; // 0 = solid/dotted, >=1 = dashed (viewBox units before scaling)
  dash_gap: number;    // 0 = solid (when dash_length also 0), >0 = gap between dashes/dots
  fill_color: string;
  opacity: number;
  created_at: number;
  rotation: number; // degrees, default 0
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
  midpoint?: Point | undefined; // Optional bezier control point for curved lines
  startBinding?: Binding | undefined;
  endBinding?: Binding | undefined;
}

export interface Binding {
  elementId: string;       // ID of the bound shape
  anchor: Point;           // Normalized 0-1 within shape's bounding box
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
  width?: number | undefined; // If set, text wraps at this width (viewBox units)
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
}

export type ResizeHandleType = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type StyleProperty =
  | "stroke_color"
  | "fill_color"
  | "stroke_width"
  | "opacity"
  | "dash_length"
  | "dash_gap"
  | "start_arrowhead"
  | "end_arrowhead";

export type MovePosition = { x: number; y: number } | { points: Point[]; midpoint?: Point | undefined };

// Typed contract between TypeScript controller and Datastar signals
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
  | { action: "add"; data: DrawingElement }
  | { action: "remove"; data: DrawingElement }
  | { action: "remove_batch"; data: DrawingElement[] }
  | {
      action: "move";
      data: Array<{
        id: string;
        before: MovePosition;
        after: MovePosition;
      }>;
    }
  | { action: "modify"; data: Array<{ id: string; before: DrawingElement; after: DrawingElement }> };
