import { DASH_PRESETS, DEFAULT_CONFIG, SNAP_THRESHOLD, TOOL_DEFAULTS, fontFamilyMap, fontSizeMap, reverseFontSizeMap, toolCursorMap } from "./constants.js";
import {
  cloneElement,
  findSnapPoint,
  getAngleFromPoint,
  getBoundingBox,
  getElementCenter,
  getGroupBoundingBox,
  resolveBindingPoint,
} from "./geometry.js";
import type { SnapResult } from "./geometry.js";
import {
  createSnapIndicator,
  ensureHandlesGroup,
  getHandlePositions,
  hitTestHandle,
  renderHandles,
} from "./handles.js";
import { processRedo, processUndo } from "./history.js";
import {
  applyGroupResize,
  applyGroupRotation,
  applyResize,
  calculateResizeBounds,
} from "./transforms.js";
import { renderElement as renderElementPure } from "./renderers.js";
import type {
  ArrowheadStyle,
  Binding,
  BoundingBox,
  DrawingConfig,
  DrawingElement,
  DrawingState,
  GroupResizeState,
  GroupRotationState,
  HandleType,
  Layer,
  LineElement,
  PathElement,
  Point,
  ResizeHandleType,
  ShapeElement,
  TextElement,
  Tool,
  ToolSettings,
  UndoAction,
} from "./types.js";
import { isLine, isShape, isPath, isText } from "./types.js";

export interface DrawingCallbacks {
  onStateChange(patch: Partial<DrawingState>): void;
  getState<K extends keyof DrawingState>(key: K): DrawingState[K];
}

// DrawingController class
class DrawingController {
  private container: HTMLElement;
  private config: DrawingConfig;
  private callbacks: DrawingCallbacks;

  // State
  private elements: Map<string, DrawingElement> = new Map();
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private selectedIds: Set<string> = new Set();

  // Drawing state
  private isDrawing = false;
  private currentElement: DrawingElement | null = null;
  private currentPoints: Point[] = [];
  private anchorPoint: Point | null = null;

  // Drag state for moving selected elements
  private isDragging = false;
  private dragStartPoint: Point | null = null;
  private dragStartPositions: Map<string, { x: number; y: number; points?: Point[]; midpoint?: Point | undefined }> = new Map();

  // Snap state for endpoint snapping
  private snapTarget: Point | null = null;
  private lastSnapResult: SnapResult | null = null;

  // Eraser state
  private isErasing = false;

  // Text editing state
  private textOverlay: HTMLTextAreaElement | null = null;
  private editingTextId: string | null = null;
  private textEditSvgPoint: Point | null = null;
  private textCommitFn: (() => void) | null = null;
  private textBlurTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastClickTime = 0;
  private lastClickId: string | null = null;

  // Resize state
  private activeHandle: HandleType | null = null;
  private resizeStartBounds: BoundingBox | null = null;
  private resizeStartPoint: Point | null = null;
  private resizeElementId: string | null = null;
  private resizeOriginalFontSize: number | null = null;
  private resizeOriginalElement: DrawingElement | null = null;

  private groupResizeStart: GroupResizeState | null = null;

  // Rotation state
  private rotationStartAngle = 0;
  private elementStartRotation = 0;
  private rotationElementId: string | null = null;
  private rotationOriginalElement: DrawingElement | null = null;

  private groupRotationStart: GroupRotationState | null = null;

  // Per-tool settings memory
  private toolSettings: Map<Tool, ToolSettings> = new Map();
  private currentTool: Tool = "select";

  // SVG elements
  private svg: SVGSVGElement | null = null;
  private elementsGroup: SVGGElement | null = null;
  private previewGroup: SVGGElement | null = null;
  private handlesGroup: SVGGElement | null = null;

  // Bound event handlers (stored for cleanup)
  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundPointerCancel: ((e: PointerEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  // Preview rendering state
  private pendingRender = false;

  // Cached SVG rect for performance during continuous pointer movement
  // Updated on resize (via ResizeObserver) and on pointerdown (handles scroll/layout changes)
  private svgRect: DOMRect | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, config: DrawingConfig, callbacks: DrawingCallbacks) {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;
    this.init();
  }

  private init(): void {
    // Initialize per-tool settings with defaults
    for (const [tool, defaults] of Object.entries(TOOL_DEFAULTS)) {
      this.toolSettings.set(tool as Tool, { ...defaults });
    }

    // Set current tool from config
    this.currentTool = this.config.defaultTool;

    // Get the default tool's settings (cast to ToolSettings for type safety)
    const defaultToolSettings: ToolSettings =
      this.toolSettings.get(this.currentTool) ?? TOOL_DEFAULTS[this.currentTool];

    this.callbacks.onStateChange({
      tool: this.currentTool,
      is_drawing: false,
      can_undo: false,
      can_redo: false,
      text_editing: false,
      stroke_color: defaultToolSettings.stroke_color ?? this.config.defaultStrokeColor,
      fill_color: defaultToolSettings.fill_color ?? this.config.defaultFillColor,
      fill_enabled: false,
      stroke_width: defaultToolSettings.stroke_width ?? this.config.defaultStrokeWidth,
      dash_length: defaultToolSettings.dash_length ?? 0,
      dash_gap: defaultToolSettings.dash_gap ?? 0,
      opacity: defaultToolSettings.opacity ?? this.config.defaultOpacity,
      selected_ids: [],
      active_layer: this.config.defaultLayer,
      font_family: "normal",
      font_size: "medium",
      text_align: "left",
      start_arrowhead: defaultToolSettings.start_arrowhead ?? "none",
      end_arrowhead: defaultToolSettings.end_arrowhead ?? "arrow",
      selected_is_line: false,
      selected_is_text: false,
    });
    this.createSvgLayer();
    this.bindEvents();
  }

  private createSvgLayer(): void {
    const container = this.container;

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "drawing-svg");
    this.svg.setAttribute("viewBox", "0 0 100 100");
    this.svg.setAttribute("preserveAspectRatio", "none");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    this.svg.appendChild(defs);

    this.elementsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.elementsGroup.setAttribute("class", "elements");
    this.svg.appendChild(this.elementsGroup);

    this.previewGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.previewGroup.setAttribute("class", "preview");
    this.svg.appendChild(this.previewGroup);

    container.appendChild(this.svg);

    // Set up ResizeObserver to cache SVG rect (avoids getBoundingClientRect on every mouse move)
    this.updateSvgRect();
    this.resizeObserver = new ResizeObserver(() => this.updateSvgRect());
    this.resizeObserver.observe(this.svg);
  }

  private updateSvgRect(): void {
    this.svgRect = this.svg?.getBoundingClientRect() ?? null;
  }

  /** Walk up from a target element to find the drawing element id (handles <g> groups) */
  private resolveElementId(target: SVGElement | null): string | null {
    let el = target;
    while (el && el !== this.svg) {
      if (el.id && this.elements.has(el.id)) return el.id;
      el = el.parentElement as SVGElement | null;
    }
    return null;
  }

  private bindEvents(): void {
    if (!this.svg) return;
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.svg.addEventListener("pointerdown", this.boundPointerDown);
    this.svg.addEventListener("pointermove", this.boundPointerMove);
    this.svg.addEventListener("pointerup", this.boundPointerUp);
    this.svg.addEventListener("pointercancel", this.boundPointerCancel);
    document.addEventListener("keydown", this.boundKeyDown);

    // Update cursor based on tool changes
    this.updateCursor();
  }

  private updateCursor(): void {
    if (!this.svg) return;
    const tool = this.callbacks.getState("tool");

    this.svg.style.cursor = toolCursorMap[tool] || "default";
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore key events when typing in an input/textarea (e.g. text editing)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Delete selected elements on Backspace or Delete
    if (e.key === "Backspace" || e.key === "Delete") {
      if (this.selectedIds.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
      return;
    }

    // Escape: deselect all
    if (e.key === "Escape") {
      if (this.selectedIds.size > 0) {
        e.preventDefault();
        this.deselectAll();
      }
      return;
    }

    // Tool-switching shortcuts (Excalidraw/tldraw conventions)
    // Only fire on bare key presses (no Ctrl/Cmd/Alt modifiers)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const toolMap: Record<string, Tool> = {
      v: "select",
      p: "pen",
      h: "highlighter",
      l: "line",
      a: "arrow",
      r: "rect",
      o: "ellipse",
      d: "diamond",
      t: "text",
      e: "eraser",
    };
    const tool = toolMap[e.key.toLowerCase()];
    if (tool) {
      e.preventDefault();
      // Blur any focused toolbar button so its focus ring doesn't linger
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.switchTool(tool);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    // If text overlay is active, commit and close it first
    if (this.textOverlay && this.textCommitFn) {
      this.textCommitFn();
      return;
    }

    // Refresh cached rect on each interaction (handles scroll/layout changes)
    this.updateSvgRect();

    const tool = this.callbacks.getState("tool");
    const point = this.pointerToSvgCoords(e);

    // Update cursor for non-select tools
    if (tool !== "select") {
      this.updateCursor();
    }

    // Check for handle click when using select tool with a selection
    if (tool === "select" && this.selectedIds.size > 0) {
      const handle = hitTestHandle(e.clientX, e.clientY, this.selectedIds, this.elements);
      if (handle) {
        e.preventDefault();
        this.svg?.setPointerCapture(e.pointerId);
        this.activeHandle = handle.type;

        // Check if multiple elements are selected
        if (this.selectedIds.size > 1) {
          // Initialize group resize/rotate state
          const selectedElements: DrawingElement[] = [];
          for (const id of this.selectedIds) {
            const el = this.elements.get(id);
            if (el) selectedElements.push(el);
          }

          if (handle.type === "rotation") {
            // Initialize group rotation state
            const groupBounds = getGroupBoundingBox(selectedElements);
            const groupCenter: Point = {
              x: groupBounds.x + groupBounds.width / 2,
              y: groupBounds.y + groupBounds.height / 2,
            };
            const startAngle = getAngleFromPoint(point, groupCenter);

            this.groupRotationStart = {
              elements: selectedElements.map((el) => {
                const elCenter = getElementCenter(el);
                return {
                  id: el.id,
                  position: elCenter,
                  rotation: el.rotation,
                  originalElement: cloneElement(el),
                };
              }),
              center: groupCenter,
              startAngle,
            };
            this.rotationStartAngle = startAngle;
          } else {
            // Initialize group resize state
            const groupBounds = getGroupBoundingBox(selectedElements);
            this.groupResizeStart = {
              elements: selectedElements.map((el) => ({
                id: el.id,
                bounds: getBoundingBox(el),
                rotation: el.rotation,
                originalElement: cloneElement(el),
              })),
              groupBounds,
            };
            this.resizeStartBounds = groupBounds;
            this.resizeStartPoint = point;
          }
        } else {
          // Single element resize/rotate
          const selectedId = Array.from(this.selectedIds)[0];
          const element = this.elements.get(selectedId);
          if (element) {
            if (handle.type === "rotation") {
              // Initialize rotation state
              const center = getElementCenter(element);
              this.rotationStartAngle = getAngleFromPoint(point, center);
              this.elementStartRotation = element.rotation;
              this.rotationElementId = selectedId;
              this.rotationOriginalElement = cloneElement(element);
            } else {
              // Initialize resize state
              this.resizeStartBounds = getBoundingBox(element);
              this.resizeStartPoint = point;
              this.resizeElementId = selectedId;
              this.resizeOriginalElement = cloneElement(element);
            }
          }
        }
        return;
      }
    }

    if (tool === "pen" || tool === "highlighter") {
      e.preventDefault();
      this.svg?.setPointerCapture(e.pointerId);
      this.startDrawing(point);
      return;
    }

    if (tool === "line" || tool === "arrow") {
      e.preventDefault();
      this.svg?.setPointerCapture(e.pointerId);
      this.startLineTool(point);
      return;
    }

    if (tool === "rect" || tool === "ellipse" || tool === "diamond") {
      e.preventDefault();
      this.svg?.setPointerCapture(e.pointerId);
      this.startShapeTool(point);
      return;
    }

    if (tool === "eraser") {
      e.preventDefault();
      this.svg?.setPointerCapture(e.pointerId);
      this.isErasing = true;
      this.eraseAtPoint(e.clientX, e.clientY);
      return;
    }

    if (tool === "select") {
      e.preventDefault();
      const target = document.elementFromPoint(e.clientX, e.clientY) as SVGElement | null;
      const clickedId = this.resolveElementId(target);

      // Double-click to edit existing text elements
      const now = Date.now();
      if (clickedId && clickedId === this.lastClickId && now - this.lastClickTime < 400) {
        const el = this.elements.get(clickedId);
        if (el && isText(el)) {
          this.startTextEditing({ x: el.x, y: el.y }, el);
          this.lastClickTime = 0;
          this.lastClickId = null;
          return;
        }
      }
      this.lastClickTime = now;
      this.lastClickId = clickedId;

      // If clicking on an already-selected element, start dragging
      if (clickedId && this.selectedIds.has(clickedId)) {
        this.svg?.setPointerCapture(e.pointerId);
        this.startDragging(point);
        return;
      }

      // Otherwise, select (or add to selection with shift)
      this.selectAtPoint(e.clientX, e.clientY, e.shiftKey);

      // If we selected something and it's the only selection, start dragging immediately
      if (clickedId && this.selectedIds.has(clickedId)) {
        this.svg?.setPointerCapture(e.pointerId);
        this.startDragging(point);
      }
      return;
    }

    if (tool === "text") {
      e.preventDefault();
      const point = this.pointerToSvgCoords(e);
      this.startTextEditing(point);
      return;
    }
  }

  private startTextEditing(svgPoint: Point, existingElement?: TextElement): void {
    if (this.textOverlay) return;

    const container = this.container;
    const rect = this.svgRect;
    if (!rect) return;

    const isEditing = !!existingElement;
    const fm = isEditing ? existingElement.font_family : this.callbacks.getState("font_family");
    const rawFs = isEditing ? existingElement.font_size : this.callbacks.getState("font_size");
    // Resolve string presets ("small"/"medium"/"large") to numeric viewBox values
    const fs: number = typeof rawFs === "string" ? (fontSizeMap[rawFs] ?? 4) : (rawFs as number);
    const ta = isEditing ? existingElement.text_align : this.callbacks.getState("text_align");
    const color = isEditing ? existingElement.stroke_color : (this.callbacks.getState("stroke_color"));

    this.editingTextId = existingElement?.id ?? null;
    this.textEditSvgPoint = svgPoint;

    const pos = this.svgToContainerPx(svgPoint.x, svgPoint.y);
    const fontSizePx = this.svgUnitsToPx(fs, "y");

    // The SVG uses preserveAspectRatio="none" so text is horizontally stretched.
    // Apply the same stretch to the textarea so editing is WYSIWYG.
    const stretchX = rect.width / rect.height;
    const scaleXCss = `scaleX(${stretchX})`;
    // Transform order: scale first (inner), then translate (outer) — CSS applies right-to-left
    const transformCss = ta === "center" ? `${scaleXCss} translateX(-50%)`
                       : ta === "right" ? `${scaleXCss} translateX(-100%)`
                       : scaleXCss;

    const textarea = document.createElement("textarea");
    textarea.className = "drawing-text-input";
    textarea.value = existingElement?.text ?? "";

    Object.assign(textarea.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      fontSize: `${fontSizePx}px`,
      fontFamily: fontFamilyMap[fm] || fontFamilyMap.normal,
      textAlign: ta,
      color,
      minWidth: "20px",
      minHeight: `${fontSizePx * 1.4}px`,
      transformOrigin: "0 0",
      transform: transformCss,
    });

    const autoResize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.style.width = "auto";
      textarea.style.width = `${Math.max(40, textarea.scrollWidth + 4)}px`;
    };

    const commit = () => {
      if (this._textCommitted) return;
      this._textCommitted = true;
      const text = textarea.value.trim();
      if (text) {
        this.commitTextEdit(text);
      } else if (isEditing) {
        // Empty text on existing element = restore original (don't delete)
      }
      this.closeTextOverlay();
    };
    this.textCommitFn = commit;

    textarea.addEventListener("input", autoResize);
    textarea.addEventListener("blur", () => {
      this.textBlurTimeout = setTimeout(commit, 100);
    });
    textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation(); // Don't trigger tool shortcuts while typing
      if (e.key === "Escape") {
        e.preventDefault();
        this._textCommitted = true; // Prevent blur handler from committing
        this.closeTextOverlay();
        if (!isEditing) this.switchTool("select");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });

    // Hide SVG text if editing an existing element
    if (isEditing && existingElement) {
      this.elementsGroup?.querySelector(`#${existingElement.id}`)?.setAttribute("display", "none");
    }

    this._textCommitted = false;
    container.appendChild(textarea);
    this.textOverlay = textarea;
    this.callbacks.onStateChange({ text_editing: true });

    requestAnimationFrame(() => {
      textarea.focus();
      if (isEditing) textarea.select();
      autoResize();
    });
  }

  private _textCommitted = false;

  private commitTextEdit(text: string): void {
    const svgPoint = this.textEditSvgPoint;
    if (!svgPoint) return;

    if (this.editingTextId) {
      // Update existing text element — only change text content.
      // Style properties (font_family, font_size, text_align, stroke_color)
      // are already current on the element via setTextProperty/setStyleProperty.
      const el = this.elements.get(this.editingTextId) as TextElement | undefined;
      if (el) {
        el.text = text;
        this.rerenderElements();
      }
    } else {
      // Create new text element — read current signal values (not stale closures)
      const fm = this.callbacks.getState("font_family") as TextElement["font_family"];
      const rawFs = this.callbacks.getState("font_size");
      const fs: number = typeof rawFs === "string" ? (fontSizeMap[rawFs] ?? 4) : (rawFs as number);
      const ta = this.callbacks.getState("text_align") as TextElement["text_align"];
      const color = this.callbacks.getState("stroke_color");
      const opacity = this.callbacks.getState("opacity");
      const layer = this.callbacks.getState("active_layer");

      const textElement: TextElement = {
        id: `text-${crypto.randomUUID().split("-")[0]}`,
        type: "text",
        layer,
        stroke_color: color,
        stroke_width: 0,
        dash_length: 0,
        dash_gap: 0,
        fill_color: "",
        opacity,
        created_at: Date.now(),
        rotation: 0,
        x: svgPoint.x,
        y: svgPoint.y,
        text,
        font_size: fs,
        font_family: fm,
        text_align: ta,
      };

      this.elements.set(textElement.id, textElement);
      const svgEl = this.renderElement(textElement);
      if (svgEl && this.elementsGroup) {
        this.elementsGroup.appendChild(svgEl);
      }

      this.undoStack.push({ action: "add", data: textElement });
      this.redoStack = [];
      this.callbacks.onStateChange({
        can_undo: true,
        can_redo: false,
      });

      // Auto-switch to select tool and select the new text
      this.switchTool("select");
      this.selectElement(textElement.id, false);
    }
  }

  private closeTextOverlay(): void {
    // Clear stale blur timeout to prevent race conditions
    if (this.textBlurTimeout) {
      clearTimeout(this.textBlurTimeout);
      this.textBlurTimeout = null;
    }
    if (this.textOverlay) {
      this.textOverlay.remove();
      this.textOverlay = null;
    }
    this.textCommitFn = null;
    // Show SVG text again if we were editing
    if (this.editingTextId) {
      this.elementsGroup?.querySelector(`#${this.editingTextId}`)?.removeAttribute("display");
      this.editingTextId = null;
    }
    this.textEditSvgPoint = null;
    this.callbacks.onStateChange({ text_editing: false });
  }

  /** Update the visible textarea overlay to match current element state */
  private updateTextOverlay(el: TextElement): void {
    if (!this.textOverlay) return;
    const rect = this.svgRect;
    if (!rect) return;

    const pos = this.svgToContainerPx(el.x, el.y);
    const fontSizePx = this.svgUnitsToPx(el.font_size, "y");
    const stretchX = rect.width / rect.height;
    const scaleXCss = `scaleX(${stretchX})`;
    const ta = el.text_align;
    const transformCss = ta === "center" ? `${scaleXCss} translateX(-50%)`
                       : ta === "right" ? `${scaleXCss} translateX(-100%)`
                       : scaleXCss;

    Object.assign(this.textOverlay.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      fontSize: `${fontSizePx}px`,
      fontFamily: fontFamilyMap[el.font_family] || fontFamilyMap.normal,
      textAlign: ta,
      color: el.stroke_color,
      minHeight: `${fontSizePx * 1.4}px`,
      transform: transformCss,
    });

    // Update stored SVG point for commit
    this.textEditSvgPoint = { x: el.x, y: el.y };

    // Cancel blur timeout and refocus (clicking toolbar button triggers blur)
    if (this.textBlurTimeout) {
      clearTimeout(this.textBlurTimeout);
      this.textBlurTimeout = null;
    }
    this.textOverlay.focus();
  }

  private selectAtPoint(clientX: number, clientY: number, additive: boolean): void {
    const target = document.elementFromPoint(clientX, clientY) as SVGElement | null;
    const id = this.resolveElementId(target);
    if (!id) {
      if (!additive) this.deselectAll();
      return;
    }
    this.selectElement(id, additive);
  }

  private startDragging(point: Point): void {
    if (this.selectedIds.size === 0) return;

    this.isDragging = true;
    this.dragStartPoint = point;
    this.dragStartPositions.clear();

    // Store original positions for all selected elements
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el) continue;

      if (isShape(el) || isText(el)) {
        this.dragStartPositions.set(id, { x: el.x, y: el.y });
      } else if (isLine(el)) {
        this.dragStartPositions.set(id, {
          x: 0,
          y: 0,
          points: el.points.map((p) => ({ ...p })),
          midpoint: el.midpoint ? { ...el.midpoint } : undefined,
        });
      } else if (isPath(el)) {
        this.dragStartPositions.set(id, {
          x: 0,
          y: 0,
          points: el.points.map((p) => ({ ...p })),
        });
      }
    }

    // Also snapshot bound arrows for undo
    for (const [id, el] of this.elements) {
      if (this.selectedIds.has(id)) continue;
      if (!isLine(el)) continue;
      const line = el;
      if ((line.startBinding && this.selectedIds.has(line.startBinding.elementId)) ||
          (line.endBinding && this.selectedIds.has(line.endBinding.elementId))) {
        this.dragStartPositions.set(id, {
          x: 0,
          y: 0,
          points: line.points.map(p => ({ ...p })),
          midpoint: line.midpoint ? { ...line.midpoint } : undefined,
        });
      }
    }

    // Change cursor to grabbing
    if (this.svg) {
      this.svg.style.cursor = "grabbing";
    }
  }

  private moveDragging(point: Point): void {
    if (!this.isDragging || !this.dragStartPoint) return;

    const dx = point.x - this.dragStartPoint.x;
    const dy = point.y - this.dragStartPoint.y;

    // Update positions of all selected elements
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      const startPos = this.dragStartPositions.get(id);
      if (!el || !startPos) continue;

      if (isShape(el) || isText(el)) {
        el.x = startPos.x + dx;
        el.y = startPos.y + dy;
      } else if (isLine(el) && startPos.points) {
        el.points = startPos.points.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        })) as [Point, Point];
        // Also translate midpoint for curved lines
        if (startPos.midpoint && el.midpoint) {
          el.midpoint = {
            x: startPos.midpoint.x + dx,
            y: startPos.midpoint.y + dy,
          };
        }
      } else if (isPath(el) && startPos.points) {
        el.points = startPos.points.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        }));
      }
    }

    // Update arrows bound to moved shapes
    this.updateBoundArrows(this.selectedIds);
    this.rerenderElements();
  }

  private commitDragging(): void {
    if (!this.isDragging) return;

    // Push move action to undo stack (store before/after positions)
    const moveData: { id: string; before: any; after: any }[] = [];
    // Include both selected elements and bound arrows
    for (const [id, startPos] of this.dragStartPositions) {
      const el = this.elements.get(id);
      if (!el || !startPos) continue;

      if ((isShape(el) || isText(el)) && !startPos.points) {
        moveData.push({
          id,
          before: { x: startPos.x, y: startPos.y },
          after: { x: el.x, y: el.y },
        });
      } else if (isLine(el) && startPos.points) {
        moveData.push({
          id,
          before: { points: startPos.points, midpoint: startPos.midpoint },
          after: {
            points: el.points.map((p) => ({ ...p })),
            midpoint: el.midpoint ? { ...el.midpoint } : undefined,
          },
        });
      } else if (isPath(el) && startPos.points) {
        moveData.push({
          id,
          before: { points: startPos.points },
          after: {
            points: el.points.map((p) => ({ ...p })),
          },
        });
      }
    }

    if (moveData.length > 0) {
      this.undoStack.push({ action: "move", data: moveData });
      this.redoStack = [];
      this.callbacks.onStateChange({
        can_undo: true,
        can_redo: false,
      });
    }

    this.isDragging = false;
    this.dragStartPoint = null;
    this.dragStartPositions.clear();
    this.updateCursor();
  }

  private cancelDragging(): void {
    if (!this.isDragging) return;

    // Restore original positions (includes bound arrows)
    for (const [id, startPos] of this.dragStartPositions) {
      const el = this.elements.get(id);
      if (!el || !startPos) continue;

      if ((isShape(el) || isText(el)) && !startPos.points) {
        el.x = startPos.x;
        el.y = startPos.y;
      } else if (isLine(el) && startPos.points) {
        el.points = startPos.points as [Point, Point];
        if (startPos.midpoint) {
          el.midpoint = startPos.midpoint;
        }
      } else if (isPath(el) && startPos.points) {
        el.points = startPos.points;
      }
    }

    this.rerenderElements();
    this.isDragging = false;
    this.dragStartPoint = null;
    this.dragStartPositions.clear();
    this.updateCursor();
  }

  private eraseAtPoint(clientX: number, clientY: number): void {
    const target = document.elementFromPoint(clientX, clientY) as SVGElement | null;
    const id = this.resolveElementId(target);
    if (!id) return;

    const element = this.elements.get(id);
    if (!element) return;
    this.elements.delete(id);
    // Remove the top-level DOM element (may be a <g> group, not the hit child)
    this.elementsGroup?.querySelector(`#${id}`)?.remove();

    // Clear bindings referencing deleted element
    for (const [, el] of this.elements) {
      if (isLine(el)) {
        if (el.startBinding?.elementId === id) el.startBinding = undefined;
        if (el.endBinding?.elementId === id) el.endBinding = undefined;
      }
    }

    // Clear from selection and update handles if this element was selected
    if (this.selectedIds.delete(id)) {
      this.callbacks.onStateChange({ selected_ids: [...this.selectedIds] });
      this.updateSelectionVisual();
    }

    this.undoStack.push({ action: "remove", data: element });
    this.redoStack = [];
    this.callbacks.onStateChange({
      can_undo: true,
      can_redo: false,
    });
  }

  private startLineTool(point: Point): void {
    const tool = this.callbacks.getState("tool");
    const strokeColor = this.callbacks.getState("stroke_color");
    const strokeWidth = this.callbacks.getState("stroke_width");
    const dashLength = this.callbacks.getState("dash_length") || 0;
    const dashGap = this.callbacks.getState("dash_gap") || 0;
    const opacity = this.callbacks.getState("opacity");
    const layer = this.callbacks.getState("active_layer");
    const startArrowhead = this.callbacks.getState("start_arrowhead") || "none";
    const endArrowhead = this.callbacks.getState("end_arrowhead") || (tool === "arrow" ? "arrow" : "none");

    // Snap start point to nearby endpoints/midpoints
    const snapResult = findSnapPoint(point, this.elements, SNAP_THRESHOLD);
    const startPoint = snapResult ? snapResult.point : point;
    this.snapTarget = snapResult ? snapResult.point : null;
    this.lastSnapResult = snapResult;

    this.isDrawing = true;
    this.currentElement = {
      id: `${tool}-${crypto.randomUUID().split("-")[0]}`,
      type: tool as "line" | "arrow",
      layer,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      dash_length: dashLength,
      dash_gap: dashGap,
      fill_color: "",
      opacity,
      created_at: Date.now(),
      rotation: 0,
      points: [startPoint, startPoint],
      start_arrowhead: startArrowhead,
      end_arrowhead: endArrowhead,
      // Store start binding if snapped to a shape
      startBinding: snapResult?.elementId ? { elementId: snapResult.elementId, anchor: snapResult.anchor! } : undefined,
    } as LineElement;

    this.callbacks.onStateChange({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  private startShapeTool(point: Point): void {
    const tool = this.callbacks.getState("tool");
    const strokeColor = this.callbacks.getState("stroke_color");
    const strokeWidth = this.callbacks.getState("stroke_width");
    const dashLength = this.callbacks.getState("dash_length") || 0;
    const dashGap = this.callbacks.getState("dash_gap") || 0;
    const fillColor = this.callbacks.getState("fill_color");
    const fillEnabled = this.callbacks.getState("fill_enabled");
    const opacity = this.callbacks.getState("opacity");
    const layer = this.callbacks.getState("active_layer");

    this.isDrawing = true;
    this.anchorPoint = point;

    this.currentElement = {
      id: `${tool}-${crypto.randomUUID().split("-")[0]}`,
      type: tool as "rect" | "ellipse" | "diamond",
      layer,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      dash_length: dashLength,
      dash_gap: dashGap,
      fill_color: fillEnabled ? fillColor : "",
      opacity,
      created_at: Date.now(),
      rotation: 0,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    } as ShapeElement;

    this.callbacks.onStateChange({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  private handlePointerMove(e: PointerEvent): void {
    const point = this.pointerToSvgCoords(e);

    // Handle dragging selected elements
    if (this.isDragging) {
      this.moveDragging(point);
      return;
    }

    // Handle drawing
    if (this.isDrawing) {
      this.moveDrawing(point);
      return;
    }

    // Handle continuous erasing
    if (this.isErasing) {
      this.eraseAtPoint(e.clientX, e.clientY);
      return;
    }

    // Handle rotation (single element or group)
    if (this.activeHandle === "rotation") {
      if (this.groupRotationStart) {
        // Group rotation
        const center = this.groupRotationStart.center;
        let currentAngle = getAngleFromPoint(point, center);

        // Shift key snaps to 15 degree increments
        if (e.shiftKey) {
          const deltaAngle = currentAngle - this.groupRotationStart.startAngle;
          const snappedDelta = Math.round(deltaAngle / 15) * 15;
          currentAngle = this.groupRotationStart.startAngle + snappedDelta;
        }

        applyGroupRotation(currentAngle, this.groupRotationStart, this.elements);
        const groupRotIds = new Set(this.groupRotationStart.elements.map(item => item.id));
        this.updateBoundArrows(groupRotIds);
        this.rerenderElements();
        this.doRenderHandles();
      } else if (this.rotationElementId) {
        // Single element rotation
        const element = this.elements.get(this.rotationElementId);
        if (element) {
          const center = getElementCenter(element);
          const currentAngle = getAngleFromPoint(point, center);
          let newRotation = this.elementStartRotation + (currentAngle - this.rotationStartAngle);

          // Shift key snaps to 15 degree increments
          if (e.shiftKey) {
            newRotation = Math.round(newRotation / 15) * 15;
          }

          element.rotation = newRotation;
          this.updateBoundArrows(new Set([this.rotationElementId]));
          this.rerenderElements();
          this.doRenderHandles();
        }
      }
      return;
    }

    // Handle line endpoint manipulation (start/end/midpoint handles)
    if (
      (this.activeHandle === "start" ||
        this.activeHandle === "end" ||
        this.activeHandle === "midpoint") &&
      this.resizeElementId &&
      this.resizeStartPoint
    ) {
      const element = this.elements.get(this.resizeElementId);
      if (element && isLine(element)) {
        const line = element;
        const dx = point.x - this.resizeStartPoint.x;
        const dy = point.y - this.resizeStartPoint.y;
        const origLine = this.resizeOriginalElement as LineElement;

        if (this.activeHandle === "start") {
          const rawPoint = { x: origLine.points[0].x + dx, y: origLine.points[0].y + dy };
          const snapResult = findSnapPoint(rawPoint, this.elements, SNAP_THRESHOLD, this.resizeElementId!);
          this.snapTarget = snapResult ? snapResult.point : null;
          this.lastSnapResult = snapResult;
          line.points[0] = snapResult ? snapResult.point : rawPoint;
          // Update binding
          line.startBinding = snapResult?.elementId
            ? { elementId: snapResult.elementId, anchor: snapResult.anchor! }
            : undefined;
        } else if (this.activeHandle === "end") {
          const rawPoint = { x: origLine.points[1].x + dx, y: origLine.points[1].y + dy };
          const snapResult = findSnapPoint(rawPoint, this.elements, SNAP_THRESHOLD, this.resizeElementId!);
          this.snapTarget = snapResult ? snapResult.point : null;
          this.lastSnapResult = snapResult;
          line.points[1] = snapResult ? snapResult.point : rawPoint;
          // Update binding
          line.endBinding = snapResult?.elementId
            ? { elementId: snapResult.elementId, anchor: snapResult.anchor! }
            : undefined;
        } else if (this.activeHandle === "midpoint") {
          // Move midpoint (creates or updates curve control point)
          // Calculate where the handle started from (using same logic as getHandlePositions)
          const centerX = (origLine.points[0].x + origLine.points[1].x) / 2;
          const centerY = (origLine.points[0].y + origLine.points[1].y) / 2;

          let handleStartX: number, handleStartY: number;
          if (origLine.midpoint) {
            // Curved line - handle started at the existing control point
            handleStartX = origLine.midpoint.x;
            handleStartY = origLine.midpoint.y;
          } else {
            // Straight line - handle started at perpendicular offset
            const lineDx = origLine.points[1].x - origLine.points[0].x;
            const lineDy = origLine.points[1].y - origLine.points[0].y;
            const length = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
            if (length > 0.1) {
              const perpX = -lineDy / length;
              const perpY = lineDx / length;
              const offset = 2;
              handleStartX = centerX + perpX * offset;
              handleStartY = centerY + perpY * offset;
            } else {
              handleStartX = centerX;
              handleStartY = centerY;
            }
          }

          // New midpoint is handle start position plus drag delta
          line.midpoint = {
            x: handleStartX + dx,
            y: handleStartY + dy,
          };
        }
        this.rerenderElements();
        this.doRenderHandles();
      }
      return;
    }

    // Handle resizing (single element or group)
    if (this.activeHandle && this.resizeStartBounds && this.resizeStartPoint) {
      // Determine element rotation (0 for groups)
      const rotation = this.resizeElementId
        ? (this.elements.get(this.resizeElementId)?.rotation ?? 0)
        : 0;

      const dx = point.x - this.resizeStartPoint.x;
      const dy = point.y - this.resizeStartPoint.y;

      // Text always maintains aspect ratio (font scaling is proportional)
      const isTextElement = this.resizeElementId
        ? this.elements.get(this.resizeElementId)?.type === "text"
        : false;

      const newBounds = calculateResizeBounds({
        handleType: this.activeHandle as ResizeHandleType,
        startBounds: this.resizeStartBounds,
        dx, dy,
        rotation,
        maintainAspectRatio: e.shiftKey || isTextElement,
        resizeFromCenter: e.altKey,
      });

      if (this.groupResizeStart) {
        applyGroupResize(newBounds, this.groupResizeStart, this.elements);
        const resIds = new Set(this.groupResizeStart.elements.map(item => item.id));
        this.updateBoundArrows(resIds);
      } else if (this.resizeElementId) {
        const element = this.elements.get(this.resizeElementId);
        if (element) {
          // Capture original font size on first resize call (prevents drift)
          if (isTextElement && this.resizeOriginalFontSize === null) {
            this.resizeOriginalFontSize = (element as TextElement).font_size;
          }
          applyResize(element, newBounds, this.resizeStartBounds, this.resizeOriginalElement, this.resizeOriginalFontSize);
        }
        this.updateBoundArrows(new Set([this.resizeElementId]));
      }
      this.rerenderElements();
      // Skip handle re-render during text resize to avoid jitter from approximate bounding box.
      // Handles update on pointer release. Shapes have exact bounds so they can update continuously.
      if (!isTextElement) this.doRenderHandles();
      return;
    }

    // Update cursor based on hover state when using select tool
    const tool = this.callbacks.getState("tool");
    if (tool === "select" && this.svg) {
      const target = document.elementFromPoint(e.clientX, e.clientY) as SVGElement | null;
      const hoveredId = this.resolveElementId(target);

      if (hoveredId && this.selectedIds.has(hoveredId)) {
        this.svg.style.cursor = "move";
      } else if (hoveredId) {
        this.svg.style.cursor = "pointer";
      } else {
        this.svg.style.cursor = "default";
      }
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    this.svg?.releasePointerCapture(e.pointerId);

    // Handle erasing
    if (this.isErasing) {
      this.isErasing = false;
      return;
    }

    // Handle rotation
    if (this.activeHandle === "rotation") {
      this.commitRotation();
      return;
    }

    // Handle resizing
    if (this.activeHandle) {
      this.commitResize();
      return;
    }

    // Handle dragging
    if (this.isDragging) {
      this.commitDragging();
      return;
    }

    // Handle drawing
    if (!this.isDrawing) return;
    this.commitDrawing();
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.svg?.releasePointerCapture(e.pointerId);

    // Handle erasing
    if (this.isErasing) {
      this.isErasing = false;
      return;
    }

    // Handle rotation
    if (this.activeHandle === "rotation") {
      this.cancelRotation();
      return;
    }

    // Handle resizing
    if (this.activeHandle) {
      this.cancelResize();
      return;
    }

    // Handle dragging
    if (this.isDragging) {
      this.cancelDragging();
      return;
    }

    // Handle drawing
    if (!this.isDrawing) return;
    this.cancelDrawing();
  }

  private pointerToSvgCoords(e: PointerEvent): Point {
    // Use cached rect for performance (avoids layout thrashing on every mouse move)
    const rect = this.svgRect;
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  /** Convert SVG viewBox coordinates to container-relative pixel coordinates */
  private svgToContainerPx(svgX: number, svgY: number): { left: number; top: number } {
    const rect = this.svgRect;
    if (!rect) return { left: 0, top: 0 };
    return { left: (svgX / 100) * rect.width, top: (svgY / 100) * rect.height };
  }

  /** Convert SVG viewBox units to screen pixels along a given axis */
  private svgUnitsToPx(units: number, axis: "x" | "y"): number {
    const rect = this.svgRect;
    if (!rect) return 0;
    return axis === "x" ? (units / 100) * rect.width : (units / 100) * rect.height;
  }

  // Preview rendering
  private updatePreview(): void {
    if (!this.previewGroup || !this.currentElement) return;

    // Clear existing preview
    this.previewGroup.innerHTML = "";

    // Render current element as preview
    const preview = this.renderElement(this.currentElement);
    if (preview) {
      preview.setAttribute("opacity", "0.6");
      preview.style.pointerEvents = "none";
      this.previewGroup.appendChild(preview);
    }

    // Render snap indicator
    if (this.snapTarget) {
      this.previewGroup.appendChild(createSnapIndicator(this.snapTarget));
    }
  }


  private clearPreview(): void {
    if (this.previewGroup) {
      this.previewGroup.innerHTML = "";
    }
  }

  private requestPreviewUpdate(): void {
    if (this.pendingRender) return;
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.updatePreview();
    });
  }

  // Element rendering
  private renderElement(el: DrawingElement): SVGElement | null {
    const result = renderElementPure(el);
    return result?.element ?? null;
  }

  private doRenderHandles(): void {
    this.handlesGroup = ensureHandlesGroup(this.handlesGroup, this.svg);
    const selectedIds = this.callbacks.getState("selected_ids");
    const selectedElements: DrawingElement[] = [];
    for (const id of selectedIds) {
      const el = this.elements.get(id);
      if (el) selectedElements.push(el);
    }
    renderHandles(this.handlesGroup, selectedElements, {
      snapTarget: this.snapTarget,
      activeHandle: this.activeHandle,
    });
  }

  private commitResize(): void {
    // Collect IDs for bound-arrow update BEFORE nulling state
    const resizedIds = new Set<string>();
    if (this.groupResizeStart) {
      for (const item of this.groupResizeStart.elements) resizedIds.add(item.id);
    } else if (this.resizeElementId) {
      resizedIds.add(this.resizeElementId);
    }

    // Push to undo stack
    if (this.groupResizeStart) {
      const undoItems: Array<{ id: string; before: DrawingElement; after: DrawingElement }> = [];
      for (const item of this.groupResizeStart.elements) {
        const el = this.elements.get(item.id);
        if (el) {
          undoItems.push({
            id: item.id,
            before: item.originalElement,
            after: cloneElement(el),
          });
        }
      }
      if (undoItems.length > 0) {
        this.undoStack.push({ action: "group-resize", data: undoItems });
        this.redoStack = [];
        this.callbacks.onStateChange({ can_undo: true, can_redo: false });
      }
    } else if (this.resizeElementId && this.resizeOriginalElement) {
      const element = this.elements.get(this.resizeElementId);
      if (element) {
        this.undoStack.push({
          action: "resize",
          data: {
            id: this.resizeElementId,
            before: this.resizeOriginalElement,
            after: cloneElement(element),
          },
        });
        this.redoStack = [];
        this.callbacks.onStateChange({ can_undo: true, can_redo: false });
      }
    }

    if (resizedIds.size > 0) this.updateBoundArrows(resizedIds);

    // Reset resize state
    this.activeHandle = null;
    this.resizeStartBounds = null;
    this.resizeStartPoint = null;
    this.resizeElementId = null;
    this.resizeOriginalFontSize = null;
    this.resizeOriginalElement = null;
    this.groupResizeStart = null;
    this.snapTarget = null;
  }

  // Cancel resize operation - restore original bounds
  private cancelResize(): void {
    // Handle group resize cancel
    if (this.groupResizeStart) {
      for (const item of this.groupResizeStart.elements) {
        this.elements.set(item.id, item.originalElement);
      }
      this.rerenderElements();
      this.doRenderHandles();
      this.groupResizeStart = null;
    } else if (this.resizeElementId && this.resizeOriginalElement) {
      // Handle single element resize cancel
      this.elements.set(this.resizeElementId, this.resizeOriginalElement);
      this.rerenderElements();
      this.doRenderHandles();
    }

    // Reset resize state
    this.activeHandle = null;
    this.resizeStartBounds = null;
    this.resizeStartPoint = null;
    this.resizeElementId = null;
    this.resizeOriginalFontSize = null;
    this.resizeOriginalElement = null;
    this.snapTarget = null;
  }

  private commitRotation(): void {
    // Collect IDs for bound-arrow update BEFORE nulling state
    const rotatedIds = new Set<string>();
    if (this.groupRotationStart) {
      for (const item of this.groupRotationStart.elements) rotatedIds.add(item.id);
    } else if (this.rotationElementId) {
      rotatedIds.add(this.rotationElementId);
    }

    // Push to undo stack
    if (this.groupRotationStart) {
      const undoItems: Array<{ id: string; before: DrawingElement; after: DrawingElement }> = [];
      for (const item of this.groupRotationStart.elements) {
        const el = this.elements.get(item.id);
        if (el) {
          undoItems.push({
            id: item.id,
            before: item.originalElement,
            after: cloneElement(el),
          });
        }
      }
      if (undoItems.length > 0) {
        this.undoStack.push({ action: "group-rotate", data: undoItems });
        this.redoStack = [];
        this.callbacks.onStateChange({ can_undo: true, can_redo: false });
      }
    } else if (this.rotationElementId && this.rotationOriginalElement) {
      const element = this.elements.get(this.rotationElementId);
      if (element) {
        this.undoStack.push({
          action: "rotate",
          data: {
            id: this.rotationElementId,
            before: this.rotationOriginalElement,
            after: cloneElement(element),
          },
        });
        this.redoStack = [];
        this.callbacks.onStateChange({ can_undo: true, can_redo: false });
      }
    }

    if (rotatedIds.size > 0) this.updateBoundArrows(rotatedIds);

    // Reset rotation state
    this.activeHandle = null;
    this.rotationStartAngle = 0;
    this.elementStartRotation = 0;
    this.rotationElementId = null;
    this.rotationOriginalElement = null;
    this.groupRotationStart = null;
  }

  // Cancel rotation operation - restore original element
  private cancelRotation(): void {
    // Handle group rotation cancel
    if (this.groupRotationStart) {
      for (const item of this.groupRotationStart.elements) {
        this.elements.set(item.id, item.originalElement);
      }
      this.rerenderElements();
      this.doRenderHandles();
      this.groupRotationStart = null;
    } else if (this.rotationElementId && this.rotationOriginalElement) {
      // Handle single element rotation cancel
      this.elements.set(this.rotationElementId, this.rotationOriginalElement);
      this.rerenderElements();
      this.doRenderHandles();
    }

    // Reset rotation state
    this.activeHandle = null;
    this.rotationStartAngle = 0;
    this.elementStartRotation = 0;
    this.rotationElementId = null;
    this.rotationOriginalElement = null;
  }


  /**
   * Update positions of arrows/lines that are bound to any of the given element IDs.
   * Called after moving, resizing, or rotating shapes.
   */
  private updateBoundArrows(movedIds: Set<string>): void {
    for (const [id, el] of this.elements) {
      if (movedIds.has(id)) continue;
      if (!isLine(el)) continue;
      const line = el;
      let changed = false;

      if (line.startBinding && movedIds.has(line.startBinding.elementId)) {
        const resolved = resolveBindingPoint(line.startBinding, this.elements);
        if (resolved) {
          line.points[0] = resolved;
          changed = true;
        }
      }
      if (line.endBinding && movedIds.has(line.endBinding.elementId)) {
        const resolved = resolveBindingPoint(line.endBinding, this.elements);
        if (resolved) {
          line.points[1] = resolved;
          changed = true;
        }
      }

      if (changed) {
        // Re-render this element
        const svgEl = this.elementsGroup?.querySelector(`#${id}`);
        if (svgEl) {
          const newEl = this.renderElement(line);
          if (newEl) svgEl.replaceWith(newEl);
        }
      }
    }
  }

  destroy(): void {
    // Clean up text overlay
    if (this.textOverlay) {
      this.textOverlay.remove();
      this.textOverlay = null;
    }
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.svgRect = null;

    if (this.svg) {
      if (this.boundPointerDown) this.svg.removeEventListener("pointerdown", this.boundPointerDown);
      if (this.boundPointerMove) this.svg.removeEventListener("pointermove", this.boundPointerMove);
      if (this.boundPointerUp) this.svg.removeEventListener("pointerup", this.boundPointerUp);
      if (this.boundPointerCancel)
        this.svg.removeEventListener("pointercancel", this.boundPointerCancel);
      this.svg.remove();
      this.svg = null;
    }
    if (this.boundKeyDown) document.removeEventListener("keydown", this.boundKeyDown);
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
    this.boundKeyDown = null;
    this.elementsGroup = null;
    this.previewGroup = null;
    this.elements.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selectedIds.clear();
  }

  // Public methods

  // Set a text property (font_family, font_size, text_align) and apply to selected text elements
  setTextProperty(property: "font_family" | "font_size" | "text_align", value: string): void {
    // Update signal
    this.callbacks.onStateChange({ [property]: value });

    // Apply to all selected text elements
    const changed: TextElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (el && isText(el)) {
        if (property === "font_family") {
          el.font_family = value as TextElement["font_family"];
        } else if (property === "font_size") {
          el.font_size = fontSizeMap[value] ?? (Number(value) || 4);
        } else if (property === "text_align") {
          const newAlign = value as TextElement["text_align"];
          const oldAlign = el.text_align;
          if (newAlign !== oldAlign) {
            // Adjust el.x so text stays visually in the same position.
            // getBoundingBox computes visual left edge accounting for current alignment.
            const bbox = getBoundingBox(el);
            const visualCenterX = bbox.x + bbox.width / 2;
            // Set x to the anchor point for the new alignment:
            //   left (start) → x = visual left edge
            //   center (middle) → x = visual center
            //   right (end) → x = visual right edge
            if (newAlign === "left") el.x = bbox.x;
            else if (newAlign === "center") el.x = visualCenterX;
            else if (newAlign === "right") el.x = bbox.x + bbox.width;
          }
          el.text_align = newAlign;
        }
        changed.push(el);
      }
    }
    if (changed.length > 0) {
      this.rerenderElements();
      this.doRenderHandles();

      // If textarea overlay is open for one of the changed elements, update it
      if (this.textOverlay && this.editingTextId) {
        const editedEl = changed.find(t => t.id === this.editingTextId);
        if (editedEl) this.updateTextOverlay(editedEl);
      }
    }
  }

  /** Set a visual style property and apply to all selected elements */
  setStyleProperty(property: string, value: string | number): void {
    // Coerce numeric properties so signals store numbers (not strings from input events)
    const numericProps = new Set(["stroke_width", "opacity", "dash_length", "dash_gap"]);
    const signalValue = numericProps.has(property) && typeof value === "string" ? Number(value) : value;
    // Update signal
    this.callbacks.onStateChange({ [property]: signalValue });

    // Apply to selected elements (respecting property-type applicability)
    const changed: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el) continue;

      // fill_color only applies to shapes
      if (property === "fill_color" && !["rect", "ellipse", "diamond"].includes(el.type)) continue;
      // stroke_width doesn't apply to text
      if (property === "stroke_width" && el.type === "text") continue;

      // Arrowhead properties only apply to line/arrow elements
      if ((property === "start_arrowhead" || property === "end_arrowhead") &&
          el.type !== "line" && el.type !== "arrow") continue;
      // dash_length and dash_gap apply to all elements except text
      if (property === "dash_length" && el.type === "text") continue;
      if (property === "dash_gap" && el.type === "text") continue;

      // Apply the value
      if (property === "stroke_color") {
        el.stroke_color = value as string;
      } else if (property === "fill_color" && isShape(el)) {
        el.fill_color = value as string;
      } else if (property === "stroke_width") {
        el.stroke_width = typeof value === "number" ? value : Number(value);
      } else if (property === "opacity") {
        el.opacity = typeof value === "number" ? value : Number(value);
      } else if (property === "dash_length") {
        el.dash_length = typeof value === "number" ? value : Number(value);
      } else if (property === "dash_gap") {
        el.dash_gap = typeof value === "number" ? value : Number(value);
      } else if (property === "start_arrowhead" && isLine(el)) {
        el.start_arrowhead = value as ArrowheadStyle;
      } else if (property === "end_arrowhead" && isLine(el)) {
        el.end_arrowhead = value as ArrowheadStyle;
      } else {
        continue; // Unknown property
      }
      changed.push(el);
    }

    if (changed.length > 0) {
      this.rerenderElements();
      this.doRenderHandles();

      // Update textarea overlay if editing text and color changed
      if (this.textOverlay && this.editingTextId && property === "stroke_color") {
        const editedEl = changed.find(e => e.id === this.editingTextId);
        if (editedEl && isText(editedEl)) this.updateTextOverlay(editedEl);
      }
    }
  }

  /** Set a dash preset (solid/dashed/dotted) — updates both dash_length and dash_gap signals + selected elements */
  setDashPreset(preset: string): void {
    const values = DASH_PRESETS[preset];
    if (!values) return;
    this.setStyleProperty("dash_length", values.dash_length);
    this.setStyleProperty("dash_gap", values.dash_gap);
  }

  // Switch to a new tool, saving current tool's settings and loading new tool's settings
  switchTool(newTool: Tool): void {
    if (newTool === this.currentTool) return;

    // Save current tool's settings
    this.saveCurrentToolSettings();

    // Load new tool's settings
    const settings = this.toolSettings.get(newTool) ?? TOOL_DEFAULTS[newTool];
    this.loadToolSettings(settings);

    // Update tool signal and internal state
    this.currentTool = newTool;
    this.callbacks.onStateChange({ tool: newTool });

    // Update cursor
    this.updateCursor();
  }

  private saveCurrentToolSettings(): void {
    const tool = this.currentTool;
    const defaults: ToolSettings = TOOL_DEFAULTS[tool];
    const settings: ToolSettings = {};

    if (defaults.stroke_width !== undefined) {
      settings.stroke_width = this.callbacks.getState("stroke_width");
    }
    if (defaults.opacity !== undefined) {
      settings.opacity = this.callbacks.getState("opacity");
    }
    if (defaults.dash_length !== undefined) {
      settings.dash_length = this.callbacks.getState("dash_length") as number;
    }
    if (defaults.dash_gap !== undefined) {
      settings.dash_gap = this.callbacks.getState("dash_gap") as number;
    }
    if (defaults.start_arrowhead !== undefined) {
      settings.start_arrowhead = this.callbacks.getState("start_arrowhead") as ArrowheadStyle;
    }
    if (defaults.end_arrowhead !== undefined) {
      settings.end_arrowhead = this.callbacks.getState("end_arrowhead") as ArrowheadStyle;
    }

    this.toolSettings.set(tool, settings);
  }

  private loadToolSettings(settings: ToolSettings): void {
    const patch: Partial<DrawingState> = {};

    if (settings.stroke_width !== undefined) {
      patch.stroke_width = settings.stroke_width;
    }
    if (settings.opacity !== undefined) {
      patch.opacity = settings.opacity;
    }
    if (settings.dash_length !== undefined) {
      patch.dash_length = settings.dash_length;
    }
    if (settings.dash_gap !== undefined) {
      patch.dash_gap = settings.dash_gap;
    }
    if (settings.start_arrowhead !== undefined) {
      patch.start_arrowhead = settings.start_arrowhead;
    }
    if (settings.end_arrowhead !== undefined) {
      patch.end_arrowhead = settings.end_arrowhead;
    }

    if (Object.keys(patch).length > 0) {
      this.callbacks.onStateChange(patch);
    }
  }

  addElement(el: DrawingElement): string {
    this.elements.set(el.id, el);
    const svgEl = this.renderElement(el);
    if (svgEl && this.elementsGroup) {
      this.elementsGroup.appendChild(svgEl);
    }
    this.undoStack.push({ action: "add", data: el });
    this.redoStack = [];
    this.callbacks.onStateChange({
      can_undo: true,
      can_redo: false,
    });
    return el.id;
  }

  getElements(layer?: Layer): DrawingElement[] {
    const result: DrawingElement[] = [];
    for (const el of this.elements.values()) {
      if (!layer || el.layer === layer) {
        result.push(el);
      }
    }
    return result;
  }

  setElements(els: DrawingElement[]): void {
    this.elements.clear();
    for (const el of els) {
      this.elements.set(el.id, el);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.rerenderElements();
    this.callbacks.onStateChange({
      can_undo: false,
      can_redo: false,
    });
  }

  getElementById(id: string): DrawingElement | undefined {
    return this.elements.get(id);
  }

  updateElement(id: string, updates: Partial<DrawingElement>): void {
    const el = this.elements.get(id);
    if (!el) return;
    Object.assign(el, updates);
    this.rerenderElements();
  }

  removeElement(id: string): void {
    const el = this.elements.get(id);
    if (!el) return;
    this.elements.delete(id);
    this.undoStack.push({ action: "remove", data: el });
    this.redoStack = [];
    this.rerenderElements();
    this.callbacks.onStateChange({
      can_undo: true,
      can_redo: false,
    });
  }

  exportSvg(): string {
    if (!this.svg) return "";

    // Create a clean SVG for export (without preview group)
    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    const preview = clone.querySelector(".preview");
    const selectionOutlines = clone.querySelectorAll(".selection-outline");
    preview?.remove();
    for (const el of selectionOutlines) el.remove();

    return clone.outerHTML;
  }

  importSvg(svg: string): void {
    // Parse SVG string
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");

    // Check for parse errors (DOMParser returns parsererror element for invalid XML)
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      console.error("Failed to parse SVG:", parseError.textContent);
      return;
    }

    const svgEl = doc.querySelector("svg");
    if (!svgEl) return;

    // Clear current elements
    this.elements.clear();
    this.selectedIds.clear();
    this.undoStack = [];
    this.redoStack = [];

    // Import elements from the SVG (basic support for paths and shapes)
    const elementsGroup = svgEl.querySelector(".elements") || svgEl;
    for (const el of elementsGroup.querySelectorAll("path, line, rect, ellipse, polygon, text")) {
      const id = el.getAttribute("id") || `imported-${crypto.randomUUID().split("-")[0]}`;
      const tagName = el.tagName.toLowerCase();

      // Build a basic element based on tag type
      const baseElement = {
        id,
        layer: "default" as Layer,
        stroke_color: el.getAttribute("stroke") || "#000000",
        stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "2"),
        dash_length: 0,
        dash_gap: 0,
        fill_color: el.getAttribute("fill") || "",
        opacity: Number.parseFloat(el.getAttribute("opacity") || "1"),
        created_at: Date.now(),
        rotation: 0,
      };

      if (tagName === "path") {
        this.elements.set(id, {
          ...baseElement,
          type: "pen",
          points: [], // Path parsing would be complex, leave empty for now
        } as PathElement);
      } else if (tagName === "line") {
        this.elements.set(id, {
          ...baseElement,
          type: "line",
          points: [
            {
              x: Number.parseFloat(el.getAttribute("x1") || "0"),
              y: Number.parseFloat(el.getAttribute("y1") || "0"),
            },
            {
              x: Number.parseFloat(el.getAttribute("x2") || "0"),
              y: Number.parseFloat(el.getAttribute("y2") || "0"),
            },
          ],
          start_arrowhead: "none",
          end_arrowhead: "none",
        } as LineElement);
      } else if (tagName === "rect") {
        this.elements.set(id, {
          ...baseElement,
          type: "rect",
          x: Number.parseFloat(el.getAttribute("x") || "0"),
          y: Number.parseFloat(el.getAttribute("y") || "0"),
          width: Number.parseFloat(el.getAttribute("width") || "0"),
          height: Number.parseFloat(el.getAttribute("height") || "0"),
        } as ShapeElement);
      } else if (tagName === "ellipse") {
        const cx = Number.parseFloat(el.getAttribute("cx") || "0");
        const cy = Number.parseFloat(el.getAttribute("cy") || "0");
        const rx = Number.parseFloat(el.getAttribute("rx") || "0");
        const ry = Number.parseFloat(el.getAttribute("ry") || "0");
        this.elements.set(id, {
          ...baseElement,
          type: "ellipse",
          x: cx - rx,
          y: cy - ry,
          width: rx * 2,
          height: ry * 2,
        } as ShapeElement);
      } else if (tagName === "text") {
        this.elements.set(id, {
          ...baseElement,
          type: "text",
          x: Number.parseFloat(el.getAttribute("x") || "0"),
          y: Number.parseFloat(el.getAttribute("y") || "0"),
          text: el.textContent || "",
          font_size: Number.parseFloat(el.getAttribute("font-size") || "4"),
          font_family: "normal",
          text_align: "left",
        } as TextElement);
      }
    }

    this.rerenderElements();
    this.callbacks.onStateChange({
      can_undo: false,
      can_redo: false,
      selected_ids: [],
    });
  }

  clear(layer?: Layer): void {
    const toRemove: DrawingElement[] = [];
    for (const el of this.elements.values()) {
      if (!layer || el.layer === layer) {
        toRemove.push(el);
      }
    }
    for (const el of toRemove) {
      this.elements.delete(el.id);
      this.undoStack.push({ action: "remove", data: el });
    }
    this.redoStack = [];
    this.selectedIds.clear();
    this.rerenderElements();
    this.callbacks.onStateChange({
      can_undo: toRemove.length > 0,
      can_redo: false,
      selected_ids: [],
    });
  }

  // Action methods
  startDrawing(point: Point): void {
    const tool = this.callbacks.getState("tool");
    const strokeColor = this.callbacks.getState("stroke_color");
    const strokeWidth = this.callbacks.getState("stroke_width");
    const opacity = this.callbacks.getState("opacity");
    const layer =
      tool === "highlighter" ? "background" : (this.callbacks.getState("active_layer"));

    this.isDrawing = true;
    this.currentPoints = [point];

    // Pen/highlighter always use solid strokes (dashed/dotted looks bad on freehand)
    this.currentElement = {
      id: `${tool}-${crypto.randomUUID().split("-")[0]}`,
      type: tool as "pen" | "highlighter",
      layer,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      dash_length: 0,
      dash_gap: 0,
      fill_color: "",
      opacity,
      created_at: Date.now(),
      rotation: 0,
      points: this.currentPoints,
    } as PathElement;

    this.callbacks.onStateChange({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  moveDrawing(point: Point): void {
    if (!this.isDrawing || !this.currentElement) return;

    // Handle line/arrow - update end point with snap
    if (isLine(this.currentElement)) {
      const snapResult = findSnapPoint(point, this.elements, SNAP_THRESHOLD, this.currentElement.id);
      this.snapTarget = snapResult ? snapResult.point : null;
      this.lastSnapResult = snapResult;
      this.currentElement.points[1] = snapResult ? snapResult.point : point;
      this.requestPreviewUpdate();
      return;
    }

    // Handle shape tools - update bounds from anchor
    if (this.anchorPoint && isShape(this.currentElement)) {
      this.currentElement.x = Math.min(this.anchorPoint.x, point.x);
      this.currentElement.y = Math.min(this.anchorPoint.y, point.y);
      this.currentElement.width = Math.abs(point.x - this.anchorPoint.x);
      this.currentElement.height = Math.abs(point.y - this.anchorPoint.y);
      this.requestPreviewUpdate();
      return;
    }

    // Handle pen/highlighter - add points with min distance threshold
    const last = this.currentPoints[this.currentPoints.length - 1];
    const dist = Math.sqrt((point.x - last.x) ** 2 + (point.y - last.y) ** 2);
    if (dist < 0.5) return;

    this.currentPoints.push(point);
    if (isPath(this.currentElement)) {
      this.currentElement.points = this.currentPoints;
    }
    this.requestPreviewUpdate();
  }

  commitDrawing(): void {
    if (!this.currentElement || !this.elementsGroup) return;

    // Store end binding for line/arrow elements if snapped to a shape
    if (isLine(this.currentElement) && this.lastSnapResult?.elementId) {
      this.currentElement.endBinding = {
        elementId: this.lastSnapResult.elementId,
        anchor: this.lastSnapResult.anchor!,
      };
    }

    // Add to elements
    this.elements.set(this.currentElement.id, this.currentElement);

    // Render to DOM
    const svgEl = this.renderElement(this.currentElement);
    if (svgEl) this.elementsGroup.appendChild(svgEl);

    // Push to undo stack
    this.undoStack.push({ action: "add", data: this.currentElement });
    this.redoStack = [];
    this.callbacks.onStateChange({
      can_undo: true,
      can_redo: false,
      is_drawing: false,
    });

    // Cleanup
    this.clearPreview();
    this.currentElement = null;
    this.currentPoints = [];
    this.anchorPoint = null;
    this.isDrawing = false;
    this.snapTarget = null;
    this.lastSnapResult = null;
  }

  cancelDrawing(): void {
    this.clearPreview();
    this.currentElement = null;
    this.currentPoints = [];
    this.anchorPoint = null;
    this.isDrawing = false;
    this.snapTarget = null;
    this.lastSnapResult = null;
    this.callbacks.onStateChange({ is_drawing: false });
  }
  selectElement(id: string, additive?: boolean): void {
    if (!this.elements.has(id)) return;

    if (additive) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(id);
    }

    // Update signal store BEFORE rendering handles (renderHandles reads from store)
    const patch: Partial<DrawingState> = {
      selected_ids: Array.from(this.selectedIds),
    };

    // Track selected element types for contextual toolbar controls
    let hasLine = false;
    let hasText = false;
    for (const sid of this.selectedIds) {
      const sel = this.elements.get(sid);
      if (sel && (sel.type === "line" || sel.type === "arrow")) hasLine = true;
      if (sel && sel.type === "text") hasText = true;
    }
    patch.selected_is_line = hasLine;
    patch.selected_is_text = hasText;

    // Sync selected element's properties to toolbar signals
    if (this.selectedIds.size === 1) {
      const el = this.elements.get(Array.from(this.selectedIds)[0]);
      if (el) {
        patch.stroke_color = el.stroke_color;
        patch.opacity = el.opacity;
        if (el.type !== "text") {
          patch.stroke_width = el.stroke_width;
        }
        if (typeof el.dash_length === "number") {
          patch.dash_length = el.dash_length;
        }
        if (typeof el.dash_gap === "number") {
          patch.dash_gap = el.dash_gap;
        }
        if (isShape(el)) {
          if (el.fill_color) {
            patch.fill_color = el.fill_color;
          }
        }
        if (isLine(el)) {
          patch.start_arrowhead = el.start_arrowhead || "none";
          patch.end_arrowhead = el.end_arrowhead || "none";
        }
        if (isText(el)) {
          patch.font_family = el.font_family;
          patch.font_size = reverseFontSizeMap[el.font_size] ?? el.font_size;
          patch.text_align = el.text_align;
        }
      }
    }

    this.callbacks.onStateChange(patch);
    this.updateSelectionVisual();
  }

  private updateSelectionVisual(): void {
    // Remove any legacy selection outlines (selection is shown through handles only)
    const outlines = this.elementsGroup?.querySelectorAll(".selection-outline");
    if (outlines) {
      for (const el of outlines) el.remove();
    }
    // Render selection handles (no separate dashed outline to avoid sync issues)
    this.doRenderHandles();
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;

    // Process the undo action using pure function
    const result = processUndo(action as UndoAction, this.elements);

    // Apply mutations
    for (const id of result.elementsToDelete) {
      this.elements.delete(id);
    }
    for (const [id, el] of result.elementsToSet) {
      this.elements.set(id, el);
    }

    // Push to redo stack
    this.redoStack.push(action);

    this.rerenderElements();
    this.doRenderHandles();
    this.callbacks.onStateChange({
      can_undo: this.undoStack.length > 0,
      can_redo: this.redoStack.length > 0,
    });
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;

    // Process the redo action using pure function
    const result = processRedo(action as UndoAction, this.elements);

    // Apply mutations
    for (const id of result.elementsToDelete) {
      this.elements.delete(id);
    }
    for (const [id, el] of result.elementsToSet) {
      this.elements.set(id, el);
    }

    // Push to undo stack
    this.undoStack.push(action);

    this.rerenderElements();
    this.doRenderHandles();
    this.callbacks.onStateChange({
      can_undo: this.undoStack.length > 0,
      can_redo: this.redoStack.length > 0,
    });
  }

  private rerenderElements(): void {
    if (!this.elementsGroup) return;
    this.elementsGroup.innerHTML = "";
    for (const el of this.elements.values()) {
      const svgEl = this.renderElement(el);
      if (svgEl) this.elementsGroup.appendChild(svgEl);
    }

    // Filter selection to only elements that still exist
    for (const id of this.selectedIds) {
      if (!this.elements.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    this.updateSelectionVisual();
    // Recompute selected_is_line / selected_is_text after filtering
    let hasLine = false;
    let hasText = false;
    for (const sid of this.selectedIds) {
      const sel = this.elements.get(sid);
      if (sel && (sel.type === "line" || sel.type === "arrow")) hasLine = true;
      if (sel && sel.type === "text") hasText = true;
    }
    this.callbacks.onStateChange({ selected_ids: Array.from(this.selectedIds), selected_is_line: hasLine, selected_is_text: hasText });
  }
  selectAll(): void {
    this.selectedIds.clear();
    let hasLine = false;
    let hasText = false;
    for (const [id, el] of this.elements) {
      this.selectedIds.add(id);
      if (el.type === "line" || el.type === "arrow") hasLine = true;
      if (el.type === "text") hasText = true;
    }
    // Update signal store BEFORE rendering handles (renderHandles reads from store)
    this.callbacks.onStateChange({ selected_ids: Array.from(this.selectedIds), selected_is_line: hasLine, selected_is_text: hasText });
    this.updateSelectionVisual();
  }

  deselectAll(): void {
    this.selectedIds.clear();
    // Update signal store BEFORE rendering handles (renderHandles reads from store)
    this.callbacks.onStateChange({ selected_ids: [], selected_is_line: false, selected_is_text: false });
    this.updateSelectionVisual();
  }

  deleteSelected(): void {
    if (this.selectedIds.size === 0) return;

    const deletedElements: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (el) {
        deletedElements.push(el);
        this.elements.delete(id);
      }
    }

    // Clear bindings referencing deleted element IDs
    for (const [, el] of this.elements) {
      if (isLine(el)) {
        if (el.startBinding && this.selectedIds.has(el.startBinding.elementId)) {
          el.startBinding = undefined;
        }
        if (el.endBinding && this.selectedIds.has(el.endBinding.elementId)) {
          el.endBinding = undefined;
        }
      }
    }

    this.selectedIds.clear();
    this.rerenderElements();

    // Push as batch action
    for (const el of deletedElements) {
      this.undoStack.push({ action: "remove", data: el });
    }
    this.redoStack = [];

    this.callbacks.onStateChange({
      selected_ids: [],
      can_undo: true,
      can_redo: false,
    });
  }

  duplicateSelected(): void {
    if (this.selectedIds.size === 0) return;

    const newIds: string[] = [];
    for (const id of this.selectedIds) {
      const original = this.elements.get(id);
      if (!original) continue;

      const newId = `${original.type}-${crypto.randomUUID().split("-")[0]}`;
      const duplicate = { ...original, id: newId, created_at: Date.now() };

      // Offset position
      if ("x" in duplicate) {
        (duplicate as any).x += 2;
        (duplicate as any).y += 2;
      } else if ("points" in duplicate) {
        (duplicate as any).points = (duplicate as any).points.map((p: Point) => ({
          x: p.x + 2,
          y: p.y + 2,
        }));
      }

      this.elements.set(newId, duplicate as DrawingElement);
      this.undoStack.push({ action: "add", data: duplicate });
      newIds.push(newId);
    }

    this.redoStack = [];
    this.rerenderElements();

    // Select the duplicates
    this.selectedIds.clear();
    for (const id of newIds) this.selectedIds.add(id);

    // Update signal store BEFORE rendering handles (renderHandles reads from store)
    this.callbacks.onStateChange({
      selected_ids: newIds,
      can_undo: true,
      can_redo: false,
    });
    this.updateSelectionVisual();
  }

  bringToFront(): void {
    if (this.selectedIds.size === 0) return;

    // Move selected elements to end (rendered last = on top)
    const selected: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (el) {
        selected.push(el);
        this.elements.delete(id);
      }
    }
    for (const el of selected) {
      this.elements.set(el.id, el);
    }

    this.rerenderElements();
  }

  sendToBack(): void {
    if (this.selectedIds.size === 0) return;

    // Move selected elements to beginning (rendered first = behind)
    const newMap = new Map<string, DrawingElement>();
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (el) newMap.set(id, el);
    }
    for (const [id, el] of this.elements) {
      if (!this.selectedIds.has(id)) {
        newMap.set(id, el);
      }
    }
    this.elements = newMap;

    this.rerenderElements();
  }
}

export { DrawingController };
