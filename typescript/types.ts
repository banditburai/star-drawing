/**
 * Type definitions for the drawing plugin
 */

// Arrowhead styles for line/arrow endpoints
export type ArrowheadStyle = "none" | "arrow" | "triangle" | "circle" | "bar" | "diamond";

// Tool types
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

// Geometry types
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

// Element types
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
  midpoint?: Point; // Optional bezier control point for curved lines
  startBinding?: Binding;
  endBinding?: Binding;
}

// Binding for connecting arrows to shapes
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
}

export type DrawingElement = PathElement | LineElement | ShapeElement | TextElement;

// Type guards
export const isLine = (el: DrawingElement): el is LineElement =>
  el.type === "line" || el.type === "arrow";
export const isShape = (el: DrawingElement): el is ShapeElement =>
  el.type === "rect" || el.type === "ellipse" || el.type === "diamond";
export const isPath = (el: DrawingElement): el is PathElement =>
  el.type === "pen" || el.type === "highlighter";
export const isText = (el: DrawingElement): el is TextElement =>
  el.type === "text";

// Handle types for selection manipulation
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

// Per-tool settings for remembering each tool's last-used configuration
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

// Configuration
export interface DrawingConfig {
  signal: string;
  defaultStrokeColor: string;
  defaultFillColor: string;
  defaultStrokeWidth: number;
  defaultOpacity: number;
  defaultTool: Tool;
  defaultLayer: Layer;
  throttleMs: number;
}

// Position types for move operations
export type MovePosition = { x: number; y: number } | { points: Point[]; midpoint?: Point };

// Undo/Redo action types (discriminated union for type safety)
export type UndoAction =
  | { action: "add"; data: DrawingElement }
  | { action: "remove"; data: DrawingElement }
  | {
      action: "move";
      data: Array<{
        id: string;
        before: MovePosition;
        after: MovePosition;
      }>;
    }
  | { action: "resize"; data: { id: string; before: DrawingElement; after: DrawingElement } }
  | { action: "rotate"; data: { id: string; before: DrawingElement; after: DrawingElement } }
  | {
      action: "group-resize";
      data: Array<{ id: string; before: DrawingElement; after: DrawingElement }>;
    }
  | {
      action: "group-rotate";
      data: Array<{ id: string; before: DrawingElement; after: DrawingElement }>;
    };
