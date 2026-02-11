import { DASH_PRESETS, DEFAULT_CONFIG, SNAP_THRESHOLD, TOOL_DEFAULTS, fontFamilyMap, fontSizeMap, reverseFontSizeMap, toolCursorMap } from "./constants.js";
import {
  cloneElement,
  findSnapPoint,
  getAngleFromPoint,
  getBoundingBox,
  getElementCenter,
  getElementsAtPoint,
  getGroupBoundingBox,
  getTopmostElementAtPoint,
  hitTestElement,
  resolveBindingPoint,
  wrapTextToLines,
} from "./geometry.js";
import type { SnapResult } from "./geometry.js";
import {
  createSnapIndicator,
  ensureHandlesGroup,
  getLineMidpointPosition,
  hitTestHandle,
  renderHandles,
} from "./handles.js";
import { processHistory } from "./history.js";
import {
  applyGroupResize,
  applyGroupRotation,
  applyResize,
  applyTextReflow,
  calculateResizeBounds,
} from "./transforms.js";
import { renderElement as renderElementPure } from "./renderers.js";
import type {
  ArrowheadStyle,
  BoundingBox,
  DrawingConfig,
  DrawingElement,
  DrawingState,
  GroupResizeState,
  GroupRotationState,
  HandleType,
  Layer,
  LineElement,
  MovePosition,
  PathElement,
  Point,
  ResizeHandleType,
  ShapeElement,
  StyleProperty,
  TextBoundsMap,
  TextElement,
  Tool,
  ToolSettings,
  UndoAction,
} from "./types.js";
import { isLine, isShape, isPath, isText } from "./types.js";

interface TextEditState {
  overlay: HTMLTextAreaElement;
  editingId: string | null;
  svgPoint: Point;
  maxWidthVB: number;
  commitFn: (() => void) | null;
  blurTimeout: ReturnType<typeof setTimeout> | null;
  committed: boolean;
}

interface DrawingSession {
  element: DrawingElement;
  points: Point[];
  anchor: Point | null;
}

interface ResizeSession {
  startBounds: BoundingBox;
  startPoint: Point;
  elementId: string | null;
  originalElement: DrawingElement | null;
  originalFontSize: number | null;
  group: GroupResizeState | null;
}

interface RotationSession {
  startAngle: number;
  elementId: string | null;
  elementStartRotation: number;
  originalElement: DrawingElement | null;
  group: GroupRotationState | null;
}

export interface DrawingCallbacks {
  onStateChange(patch: Partial<DrawingState>): void;
}

const HIT_TOLERANCE_PX = 8;

class DrawingController {
  private container: HTMLElement;
  private config: DrawingConfig;
  private callbacks: DrawingCallbacks;
  private state: DrawingState;

  private elements: Map<string, DrawingElement> = new Map();
  private textBoundsCache: Map<string, BoundingBox> = new Map();
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private selectedIds: Set<string> = new Set();

  private drawing: DrawingSession | null = null;

  private isDragging = false;
  private dragStartPoint: Point | null = null;
  private dragStartPositions: Map<string, { x: number; y: number; points?: Point[]; midpoint?: Point | undefined }> = new Map();

  private snapTarget: Point | null = null;
  private lastSnapResult: SnapResult | null = null;

  private isErasing = false;

  private textEdit: TextEditState | null = null;
  private lastClickTime = 0;
  private lastClickId: string | null = null;

  private activeHandle: HandleType | null = null;
  private resizing: ResizeSession | null = null;
  private rotating: RotationSession | null = null;

  private toolSettings: Map<Tool, ToolSettings> = new Map();
  private currentTool: Tool = "select";

  private cycleStack: DrawingElement[] = [];
  private cycleIndex = 0;
  private lastCyclePoint: Point | null = null;

  private svg: SVGSVGElement | null = null;
  private elementsGroup: SVGGElement | null = null;
  private previewGroup: SVGGElement | null = null;
  private handlesGroup: SVGGElement | null = null;

  private eventAbort = new AbortController();

  private pendingRender = false;

  private svgRect: DOMRect | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, config: DrawingConfig, callbacks: DrawingCallbacks) {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;

    const defaultToolSettings: ToolSettings =
      TOOL_DEFAULTS[config.defaultTool];
    this.state = {
      tool: config.defaultTool,
      is_drawing: false,
      can_undo: false,
      can_redo: false,
      text_editing: false,
      stroke_color: defaultToolSettings.stroke_color ?? config.defaultStrokeColor,
      fill_color: defaultToolSettings.fill_color ?? config.defaultFillColor,
      fill_enabled: false,
      stroke_width: defaultToolSettings.stroke_width ?? config.defaultStrokeWidth,
      dash_length: defaultToolSettings.dash_length ?? 0,
      dash_gap: defaultToolSettings.dash_gap ?? 0,
      opacity: defaultToolSettings.opacity ?? config.defaultOpacity,
      selected_ids: [],
      active_layer: config.defaultLayer,
      font_family: "normal",
      font_size: "medium",
      text_align: "left",
      start_arrowhead: defaultToolSettings.start_arrowhead ?? "none",
      end_arrowhead: defaultToolSettings.end_arrowhead ?? "arrow",
      selected_is_line: false,
      selected_is_text: false,
    };

    this.init();
  }

  private setState(patch: Partial<DrawingState>): void {
    Object.assign(this.state, patch);
    this.callbacks.onStateChange(patch);
  }

  private init(): void {
    for (const [tool, defaults] of Object.entries(TOOL_DEFAULTS)) {
      this.toolSettings.set(tool as Tool, { ...defaults });
    }

    this.currentTool = this.config.defaultTool;
    this.callbacks.onStateChange(this.state);
    this.createSvgLayer();
    this.bindEvents();
  }

  private createSvgLayer(): void {
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

    this.container.appendChild(this.svg);

    this.updateSvgRect();
    this.resizeObserver = new ResizeObserver(() => this.updateSvgRect());
    this.resizeObserver.observe(this.svg);
  }

  private updateSvgRect(): void {
    this.svgRect = this.svg?.getBoundingClientRect() ?? null;
  }

  private bindEvents(): void {
    if (!this.svg) return;
    const o = { signal: this.eventAbort.signal };
    this.svg.addEventListener("pointerdown", (e) => this.handlePointerDown(e), o);
    this.svg.addEventListener("pointermove", (e) => this.handlePointerMove(e), o);
    this.svg.addEventListener("pointerup", (e) => this.handlePointerUp(e), o);
    this.svg.addEventListener("pointercancel", (e) => this.handlePointerCancel(e), o);
    document.addEventListener("keydown", (e) => this.handleKeyDown(e), o);

    this.updateCursor();
  }

  private updateCursor(): void {
    if (!this.svg) return;
    this.svg.style.cursor = toolCursorMap[this.currentTool] || "default";
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "Backspace" || e.key === "Delete") {
      if (this.selectedIds.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (this.selectedIds.size > 0) {
        this.deselectAll();
      } else if (this.currentTool !== "select") {
        this.switchTool("select");
      }
      return;
    }

    if (e.key.startsWith("Arrow") && this.selectedIds.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      this.nudgeSelected(dx, dy);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (key === "z" && e.shiftKey)  { e.preventDefault(); this.redo(); return; }
      if (key === "y")                { e.preventDefault(); this.redo(); return; }
      if (key === "a")                { e.preventDefault(); this.selectAll(); return; }
      if (key === "d")                { e.preventDefault(); this.duplicateSelected(); return; }
      if (key === "]")                { e.preventDefault(); this.bringToFront(); return; }
      if (key === "[")                { e.preventDefault(); this.sendToBack(); return; }
      return;
    }
    if (e.altKey) return;

    // Single-key tool shortcuts
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
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.switchTool(tool);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.textEdit && this.textEdit.commitFn) {
      this.textEdit.commitFn();
      return;
    }

    this.updateSvgRect();

    const tool = this.currentTool;
    const point = this.pointerToSvgCoords(e);

    if (tool !== "select") {
      this.updateCursor();
    }

    if (tool === "select" && this.selectedIds.size > 0) {
      const handle = hitTestHandle(e.clientX, e.clientY, this.selectedIds);
      if (handle) {
        e.preventDefault();
        this.svg?.setPointerCapture(e.pointerId);
        this.activeHandle = handle.type;

        if (this.selectedIds.size > 1) {
          const selectedElements = this.getSelectedElements();

          if (handle.type === "rotation") {
            const groupBounds = getGroupBoundingBox(selectedElements, this.textBoundsCache);
            const groupCenter: Point = {
              x: groupBounds.x + groupBounds.width / 2,
              y: groupBounds.y + groupBounds.height / 2,
            };
            const startAngle = getAngleFromPoint(point, groupCenter);
            this.rotating = {
              startAngle,
              elementId: null,
              elementStartRotation: 0,
              originalElement: null,
              group: {
                elements: selectedElements.map((el) => ({
                  id: el.id,
                  position: getElementCenter(el, this.textBoundsCache),
                  rotation: el.rotation,
                  originalElement: cloneElement(el),
                })),
                center: groupCenter,
                startAngle,
              },
            };
          } else {
            const groupBounds = getGroupBoundingBox(selectedElements, this.textBoundsCache);
            this.resizing = {
              startBounds: groupBounds,
              startPoint: point,
              elementId: null,
              originalElement: null,
              originalFontSize: null,
              group: {
                elements: selectedElements.map((el) => ({
                  id: el.id,
                  bounds: getBoundingBox(el, this.textBoundsCache),
                  rotation: el.rotation,
                  originalElement: cloneElement(el),
                })),
                groupBounds,
              },
            };
          }
        } else {
          const [selectedId] = this.selectedIds;
          const element = this.elements.get(selectedId);
          if (element) {
            if (handle.type === "rotation") {
              const center = getElementCenter(element, this.textBoundsCache);
              this.rotating = {
                startAngle: getAngleFromPoint(point, center),
                elementId: selectedId,
                elementStartRotation: element.rotation,
                originalElement: cloneElement(element),
                group: null,
              };
            } else {
              this.resizing = {
                startBounds: getBoundingBox(element, this.textBoundsCache),
                startPoint: point,
                elementId: selectedId,
                originalElement: cloneElement(element),
                originalFontSize: null,
                group: null,
              };
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
      this.eraseAtPoint(point);
      return;
    }

    if (tool === "select") {
      e.preventDefault();
      const tol = this.screenToViewBoxTolerance(HIT_TOLERANCE_PX);
      const now = Date.now();

      // Double-click to edit text: check BEFORE cycling. Uses hitTestElement on
      // lastClickId so it works on cycled-to text (not just topmost).
      if (this.lastClickId && now - this.lastClickTime < 400) {
        const el = this.elements.get(this.lastClickId);
        if (el && isText(el) && hitTestElement(point.x, point.y, el, tol, this.textBoundsCache)) {
          this.startTextEditing({ x: el.x, y: el.y }, el);
          this.lastClickTime = 0;
          this.lastClickId = null;
          return;
        }
      }

      const cycleEl = e.shiftKey ? null : this.getClickCycleElement(point);
      const clickedId = cycleEl?.id ?? getTopmostElementAtPoint(point.x, point.y, this.elements, tol, this.textBoundsCache);

      this.lastClickTime = now;
      this.lastClickId = clickedId;

      if (clickedId && this.selectedIds.has(clickedId)) {
        this.svg?.setPointerCapture(e.pointerId);
        this.startDragging(point);
        return;
      }

      if (clickedId) {
        this.selectElement(clickedId, e.shiftKey);
      } else {
        if (!e.shiftKey) this.deselectAll();
      }

      if (clickedId && this.selectedIds.has(clickedId)) {
        this.svg?.setPointerCapture(e.pointerId);
        this.startDragging(point);
      }
      return;
    }

    if (tool === "text") {
      e.preventDefault();
      this.startTextEditing(point);
      return;
    }
  }

  private startTextEditing(svgPoint: Point, existingElement?: TextElement): void {
    if (this.textEdit) return;

    const rect = this.svgRect;
    if (!rect) return;

    const isEditing = !!existingElement;
    const fm = isEditing ? existingElement.font_family : this.state.font_family;
    const rawFs = isEditing ? existingElement.font_size : this.state.font_size;
    const fs = this.resolveFontSize(rawFs);
    const ta = isEditing ? existingElement.text_align : this.state.text_align;
    const color = isEditing ? existingElement.stroke_color : this.state.stroke_color;

    const pos = this.svgToContainerPx(svgPoint.x, svgPoint.y);
    const fontSizePx = this.svgUnitsToPx(fs, "y");

    // Max-width for text wrapping. Uses "y" axis because the textarea has
    // scaleX(rect.width/rect.height) — its CSS px map to viewBox units via rect.height.
    const existingWidth = existingElement?.width;
    const availableVB = existingWidth ?? (
      ta === "center" ? 2 * Math.min(svgPoint.x, 100 - svgPoint.x) - 4
      : ta === "right" ? svgPoint.x - 2
      : 98 - svgPoint.x
    );
    const maxWidthVB = Math.max(10, availableVB);
    const maxWidthPx = this.svgUnitsToPx(maxWidthVB, "y");

    const textarea = this.createTextOverlay(pos, fontSizePx, rect.width / rect.height, fm, ta, color, existingElement?.text, maxWidthPx);

    const state: TextEditState = {
      overlay: textarea,
      editingId: existingElement?.id ?? null,
      svgPoint,
      maxWidthVB,
      commitFn: null,
      blurTimeout: null,
      committed: false,
    };
    this.textEdit = state;

    const commit = () => {
      if (state.committed) return;
      state.committed = true;
      const text = textarea.value.trim();
      if (text) {
        this.commitTextEdit(text);
      }
      this.closeTextOverlay();
    };
    state.commitFn = commit;

    textarea.addEventListener("input", () => this.autoResizeTextarea(textarea));
    textarea.addEventListener("blur", () => {
      state.blurTimeout = setTimeout(commit, 100);
    });
    textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        state.committed = true;
        this.closeTextOverlay();
        if (!isEditing) this.switchTool("select");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });

    if (isEditing && existingElement) {
      this.elementsGroup?.querySelector(`#${existingElement.id}`)?.setAttribute("display", "none");
    }

    this.container.appendChild(textarea);
    this.setState({ text_editing: true });

    requestAnimationFrame(() => {
      textarea.focus();
      if (isEditing) textarea.select();
      this.autoResizeTextarea(textarea);
    });
  }

  private textNeedsWrapping(text: string, maxWidthVB: number, fontSize: number, fontFamily: TextElement["font_family"]): boolean {
    const rawLines = text.split("\n").length;
    return wrapTextToLines(text, maxWidthVB, fontSize, fontFamily).length > rawLines;
  }

  private commitTextEdit(text: string): void {
    if (!this.textEdit) return;
    const svgPoint = this.textEdit.svgPoint;
    const maxWidthVB = this.textEdit.maxWidthVB;

    if (this.textEdit.editingId) {
      const el = this.elements.get(this.textEdit.editingId) as TextElement | undefined;
      if (el) {
        const before = cloneElement(el);
        el.text = text;
        el.width = this.textNeedsWrapping(text, maxWidthVB, el.font_size, el.font_family)
          ? maxWidthVB : undefined;
        if (el.text !== before.text || el.width !== before.width) {
          this.pushUndo({ action: "modify", data: [{ id: el.id, before, after: cloneElement(el) }] });
        }
        this.rerenderElements();
      }
    } else {
      const fm = this.state.font_family;
      const rawFs = this.state.font_size;
      const fs = this.resolveFontSize(rawFs);
      const ta = this.state.text_align;
      const color = this.state.stroke_color;
      const opacity = this.state.opacity;
      const layer = this.state.active_layer;
      const needsWrap = this.textNeedsWrapping(text, maxWidthVB, fs, fm);

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
        width: needsWrap ? maxWidthVB : undefined,
      };

      this.elements.set(textElement.id, textElement);
      const svgEl = this.renderElement(textElement);
      if (svgEl && this.elementsGroup) {
        this.elementsGroup.appendChild(svgEl);
      }

      this.pushUndo({ action: "add", data: textElement });

      this.switchTool("select");
      this.selectElement(textElement.id, false);
    }
  }

  private resolveFontSize(raw: string | number): number {
    return typeof raw === "string" ? (fontSizeMap[raw] ?? 4) : raw;
  }

  private computeTextTransform(textAlign: string, stretchX: number): string {
    const scaleXCss = `scaleX(${stretchX})`;
    if (textAlign === "center") return `${scaleXCss} translateX(-50%)`;
    if (textAlign === "right") return `${scaleXCss} translateX(-100%)`;
    return scaleXCss;
  }

  private createTextOverlay(
    pos: { left: number; top: number },
    fontSizePx: number,
    stretchX: number,
    fontFamily: TextElement["font_family"],
    textAlign: TextElement["text_align"],
    color: string,
    existingText?: string,
    maxWidthPx?: number,
  ): HTMLTextAreaElement {
    const textarea = document.createElement("textarea");
    textarea.className = "drawing-text-input";
    textarea.value = existingText ?? "";
    Object.assign(textarea.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      fontSize: `${fontSizePx}px`,
      fontFamily: fontFamilyMap[fontFamily] || fontFamilyMap.normal,
      textAlign,
      color,
      minWidth: "20px",
      minHeight: `${fontSizePx * 1.4}px`,
      transformOrigin: "0 0",
      transform: this.computeTextTransform(textAlign, stretchX),
    });
    if (maxWidthPx) {
      textarea.style.maxWidth = `${maxWidthPx}px`;
      textarea.style.whiteSpace = "pre-wrap";
      textarea.style.overflowWrap = "break-word";
    }
    return textarea;
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    const maxW = parseFloat(textarea.style.maxWidth) || Infinity;
    // Temporarily disable wrapping to measure natural content width,
    // avoiding the circular dependency where pre-wrap wraps at auto-width
    const savedWS = textarea.style.whiteSpace;
    textarea.style.whiteSpace = "nowrap";
    textarea.style.width = "auto";
    const naturalWidth = textarea.scrollWidth + 2;
    textarea.style.whiteSpace = savedWS;
    textarea.style.width = `${Math.min(Math.max(40, naturalWidth), maxW)}px`;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  private closeTextOverlay(): void {
    if (!this.textEdit) return;
    if (this.textEdit.blurTimeout) {
      clearTimeout(this.textEdit.blurTimeout);
      this.textEdit.blurTimeout = null;
    }
    this.textEdit.overlay.remove();
    this.textEdit.commitFn = null;
    if (this.textEdit.editingId) {
      this.elementsGroup?.querySelector(`#${this.textEdit.editingId}`)?.removeAttribute("display");
    }
    this.textEdit = null;
    this.setState({ text_editing: false });
  }

  private updateTextOverlay(el: TextElement): void {
    if (!this.textEdit) return;
    const rect = this.svgRect;
    if (!rect) return;

    const pos = this.svgToContainerPx(el.x, el.y);
    const fontSizePx = this.svgUnitsToPx(el.font_size, "y");
    const transformCss = this.computeTextTransform(el.text_align, rect.width / rect.height);

    Object.assign(this.textEdit.overlay.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      fontSize: `${fontSizePx}px`,
      fontFamily: fontFamilyMap[el.font_family] || fontFamilyMap.normal,
      textAlign: el.text_align,
      color: el.stroke_color,
      minHeight: `${fontSizePx * 1.4}px`,
      transform: transformCss,
    });
    this.textEdit.svgPoint = { x: el.x, y: el.y };

    // Cancel blur timeout and refocus (clicking toolbar button triggers blur)
    if (this.textEdit.blurTimeout) {
      clearTimeout(this.textEdit.blurTimeout);
      this.textEdit.blurTimeout = null;
    }
    this.textEdit.overlay.focus();
  }

  private startDragging(point: Point): void {
    if (this.selectedIds.size === 0) return;

    this.isDragging = true;
    this.dragStartPoint = point;
    this.dragStartPositions.clear();

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

    for (const [id, el] of this.elements) {
      if (this.selectedIds.has(id)) continue;
      if (!isLine(el)) continue;
      if ((el.startBinding && this.selectedIds.has(el.startBinding.elementId)) ||
          (el.endBinding && this.selectedIds.has(el.endBinding.elementId))) {
        this.dragStartPositions.set(id, {
          x: 0,
          y: 0,
          points: el.points.map(p => ({ ...p })),
          midpoint: el.midpoint ? { ...el.midpoint } : undefined,
        });
      }
    }

    if (this.svg) {
      this.svg.style.cursor = "grabbing";
    }
  }

  private moveDragging(point: Point): void {
    if (!this.isDragging || !this.dragStartPoint) return;

    const dx = point.x - this.dragStartPoint.x;
    const dy = point.y - this.dragStartPoint.y;

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

    this.updateBoundArrows(this.selectedIds);
    this.rerenderElementSet(this.selectedIds);
  }

  private commitDragging(): void {
    if (!this.isDragging) return;

    const moveData: Array<{ id: string; before: MovePosition; after: MovePosition }> = [];
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
      this.pushUndo({ action: "move", data: moveData });
    }

    this.isDragging = false;
    this.dragStartPoint = null;
    this.dragStartPositions.clear();
    this.updateCursor();
  }

  private cancelDragging(): void {
    if (!this.isDragging) return;

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

  private eraseAtPoint(svgPoint: Point): void {
    const tol = this.screenToViewBoxTolerance(HIT_TOLERANCE_PX);
    const id = getTopmostElementAtPoint(svgPoint.x, svgPoint.y, this.elements, tol, this.textBoundsCache);
    if (!id) return;

    const element = this.elements.get(id);
    if (!element) return;
    this.elements.delete(id);
    this.elementsGroup?.querySelector(`#${id}`)?.remove();

    for (const [, el] of this.elements) {
      if (isLine(el)) {
        if (el.startBinding?.elementId === id) el.startBinding = undefined;
        if (el.endBinding?.elementId === id) el.endBinding = undefined;
      }
    }

    if (this.selectedIds.delete(id)) {
      this.setState({ selected_ids: [...this.selectedIds] });
      this.updateSelectionVisual();
    }

    this.pushUndo({ action: "remove", data: element });
  }

  private startLineTool(point: Point): void {
    const tool = this.currentTool;
    const strokeColor = this.state.stroke_color;
    const strokeWidth = this.state.stroke_width;
    const dashLength = this.state.dash_length || 0;
    const dashGap = this.state.dash_gap || 0;
    const opacity = this.state.opacity;
    const layer = this.state.active_layer;
    const startArrowhead = this.state.start_arrowhead || "none";
    const endArrowhead = this.state.end_arrowhead || (tool === "arrow" ? "arrow" : "none");

    const snapResult = findSnapPoint(point, this.elements, SNAP_THRESHOLD);
    const startPoint = snapResult ? snapResult.point : point;
    this.snapTarget = snapResult ? snapResult.point : null;
    this.lastSnapResult = snapResult;

    const element: LineElement = {
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
      startBinding: snapResult?.elementId ? { elementId: snapResult.elementId, anchor: snapResult.anchor! } : undefined,
    };
    this.drawing = { element, points: [], anchor: null };

    this.setState({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  private startShapeTool(point: Point): void {
    const tool = this.currentTool;
    const strokeColor = this.state.stroke_color;
    const strokeWidth = this.state.stroke_width;
    const dashLength = this.state.dash_length || 0;
    const dashGap = this.state.dash_gap || 0;
    const fillColor = this.state.fill_color;
    const fillEnabled = this.state.fill_enabled;
    const opacity = this.state.opacity;
    const layer = this.state.active_layer;

    const element: ShapeElement = {
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
    };
    this.drawing = { element, points: [], anchor: point };

    this.setState({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  private handlePointerMove(e: PointerEvent): void {
    const point = this.pointerToSvgCoords(e);

    if (this.isDragging) {
      this.moveDragging(point);
      return;
    }

    if (this.drawing) {
      this.moveDrawing(point);
      return;
    }

    if (this.isErasing) {
      this.eraseAtPoint(point);
      return;
    }

    if (this.activeHandle === "rotation" && this.rotating) {
      if (this.rotating.group) {
        const group = this.rotating.group;
        const center = group.center;
        let currentAngle = getAngleFromPoint(point, center);

        if (e.shiftKey) {
          const deltaAngle = currentAngle - group.startAngle;
          const snappedDelta = Math.round(deltaAngle / 15) * 15;
          currentAngle = group.startAngle + snappedDelta;
        }

        applyGroupRotation(currentAngle, group, this.elements, this.textBoundsCache);
        const groupIds = new Set(group.elements.map(item => item.id));
        this.updateBoundArrows(groupIds);
        this.rerenderElementSet(groupIds);
      } else if (this.rotating.elementId) {
        const element = this.elements.get(this.rotating.elementId);
        if (element) {
          const center = getElementCenter(element, this.textBoundsCache);
          const currentAngle = getAngleFromPoint(point, center);
          let newRotation = this.rotating.elementStartRotation + (currentAngle - this.rotating.startAngle);

          if (e.shiftKey) {
            newRotation = Math.round(newRotation / 15) * 15;
          }

          element.rotation = newRotation;
          const ids = new Set([this.rotating.elementId]);
          this.updateBoundArrows(ids);
          this.rerenderElementSet(ids);
        }
      }
      return;
    }

    if (
      (this.activeHandle === "start" ||
        this.activeHandle === "end" ||
        this.activeHandle === "midpoint") &&
      this.resizing?.elementId
    ) {
      const element = this.elements.get(this.resizing.elementId);
      if (element && isLine(element)) {
        const dx = point.x - this.resizing.startPoint.x;
        const dy = point.y - this.resizing.startPoint.y;
        const origLine = this.resizing.originalElement as LineElement;

        if (this.activeHandle === "start") {
          const rawPoint = { x: origLine.points[0].x + dx, y: origLine.points[0].y + dy };
          const snapResult = findSnapPoint(rawPoint, this.elements, SNAP_THRESHOLD, this.resizing!.elementId!);
          this.snapTarget = snapResult ? snapResult.point : null;
          this.lastSnapResult = snapResult;
          element.points[0] = snapResult ? snapResult.point : rawPoint;
          element.startBinding = snapResult?.elementId
            ? { elementId: snapResult.elementId, anchor: snapResult.anchor! }
            : undefined;
        } else if (this.activeHandle === "end") {
          const rawPoint = { x: origLine.points[1].x + dx, y: origLine.points[1].y + dy };
          const snapResult = findSnapPoint(rawPoint, this.elements, SNAP_THRESHOLD, this.resizing!.elementId!);
          this.snapTarget = snapResult ? snapResult.point : null;
          this.lastSnapResult = snapResult;
          element.points[1] = snapResult ? snapResult.point : rawPoint;
          element.endBinding = snapResult?.elementId
            ? { elementId: snapResult.elementId, anchor: snapResult.anchor! }
            : undefined;
        } else if (this.activeHandle === "midpoint") {
          const handleStart = getLineMidpointPosition(origLine);
          element.midpoint = {
            x: handleStart.x + dx,
            y: handleStart.y + dy,
          };
        }
        this.rerenderElementSet([this.resizing.elementId]);
      }
      return;
    }

    if (this.activeHandle && this.resizing) {
      const rotation = this.resizing.elementId
        ? (this.elements.get(this.resizing.elementId)?.rotation ?? 0)
        : 0;

      const dx = point.x - this.resizing.startPoint.x;
      const dy = point.y - this.resizing.startPoint.y;
      const element = this.resizing.elementId ? this.elements.get(this.resizing.elementId) : undefined;
      const isTextEl = element ? isText(element) : false;

      const isTextReflow = isTextEl && (this.activeHandle === "e" || this.activeHandle === "w");

      const newBounds = calculateResizeBounds({
        handleType: this.activeHandle as ResizeHandleType,
        startBounds: this.resizing.startBounds,
        dx, dy,
        rotation,
        maintainAspectRatio: isTextReflow ? false : (e.shiftKey || isTextEl),
        resizeFromCenter: e.altKey,
      });

      if (this.resizing.group) {
        applyGroupResize(newBounds, this.resizing.group, this.elements);
        const groupIds = new Set(this.resizing.group.elements.map(item => item.id));
        this.updateBoundArrows(groupIds);
        this.rerenderElementSet(groupIds);
      } else if (element && this.resizing.originalElement) {
        if (isTextReflow) {
          applyTextReflow(element as TextElement, newBounds);
        } else {
          if (isText(element) && this.resizing.originalFontSize === null) {
            this.resizing.originalFontSize = element.font_size;
          }
          applyResize(element, newBounds, this.resizing.startBounds, this.resizing.originalElement, this.resizing.originalFontSize ?? undefined);
        }
        const ids = new Set([this.resizing.elementId!]);
        this.updateBoundArrows(ids);
        this.rerenderElementSet(ids);
      }
      return;
    }

    const tool = this.currentTool;
    if (tool === "select" && this.svg) {
      const tol = this.screenToViewBoxTolerance(HIT_TOLERANCE_PX);
      const hoveredId = getTopmostElementAtPoint(point.x, point.y, this.elements, tol, this.textBoundsCache);

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

    if (this.isErasing) { this.isErasing = false; return; }
    if (this.activeHandle === "rotation") { this.commitRotation(); return; }
    if (this.activeHandle) { this.commitResize(); return; }
    if (this.isDragging) { this.commitDragging(); return; }
    if (!this.drawing) return;
    this.commitDrawing();
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.svg?.releasePointerCapture(e.pointerId);

    if (this.isErasing) { this.isErasing = false; return; }
    if (this.activeHandle === "rotation") { this.cancelRotation(); return; }
    if (this.activeHandle) { this.cancelResize(); return; }
    if (this.isDragging) { this.cancelDragging(); return; }
    if (!this.drawing) return;
    this.cancelDrawing();
  }

  private pointerToSvgCoords(e: PointerEvent): Point {
    const rect = this.svgRect;
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  private svgToContainerPx(svgX: number, svgY: number): { left: number; top: number } {
    const rect = this.svgRect;
    if (!rect) return { left: 0, top: 0 };
    return { left: (svgX / 100) * rect.width, top: (svgY / 100) * rect.height };
  }

  private svgUnitsToPx(units: number, axis: "x" | "y"): number {
    const rect = this.svgRect;
    if (!rect) return 0;
    return axis === "x" ? (units / 100) * rect.width : (units / 100) * rect.height;
  }

  /** Convert screen pixels to viewBox units for hit-test tolerance. */
  private screenToViewBoxTolerance(px: number): number {
    const rect = this.svgRect;
    if (!rect) return 1;
    return (px / Math.min(rect.width, rect.height)) * 100;
  }

  private getClickCycleElement(svgPoint: Point): DrawingElement | null {
    const tol = this.screenToViewBoxTolerance(HIT_TOLERANCE_PX);
    const sameSpot = tol * 0.5;

    if (this.lastCyclePoint &&
        Math.abs(svgPoint.x - this.lastCyclePoint.x) < sameSpot &&
        Math.abs(svgPoint.y - this.lastCyclePoint.y) < sameSpot &&
        this.cycleStack.length > 0) {
      this.cycleIndex = (this.cycleIndex + 1) % this.cycleStack.length;
      return this.cycleStack[this.cycleIndex];
    }

    this.cycleStack = getElementsAtPoint(svgPoint.x, svgPoint.y, this.elements, tol, this.textBoundsCache);
    this.cycleIndex = 0;
    this.lastCyclePoint = svgPoint;
    return this.cycleStack[0] ?? null;
  }

  private resetCycleState(): void {
    this.cycleStack = [];
    this.cycleIndex = 0;
    this.lastCyclePoint = null;
    this.lastClickTime = 0;
    this.lastClickId = null;
  }

  private updatePreview(): void {
    if (!this.previewGroup || !this.drawing) return;
    this.previewGroup.innerHTML = "";

    const preview = this.renderElement(this.drawing.element);
    if (preview) {
      preview.setAttribute("opacity", "0.6");
      preview.style.pointerEvents = "none";
      this.previewGroup.appendChild(preview);
    }

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

  private pushUndo(action: UndoAction): void {
    this.undoStack.push(action);
    this.redoStack = [];
    this.setState({ can_undo: true, can_redo: false });
  }

  private renderElement(el: DrawingElement): SVGElement | null {
    return renderElementPure(el, this.textBoundsCache);
  }

  private getSelectedElements(): DrawingElement[] {
    const result: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (el) result.push(el);
    }
    return result;
  }

  /** Measure a rendered text element via SVG getBBox() and update the cache. */
  private measureTextElement(id: string): void {
    const el = this.elements.get(id);
    if (!el || el.type !== "text") return;
    const svgEl = this.elementsGroup?.querySelector(`#${id}`);
    if (!(svgEl instanceof SVGGraphicsElement)) return;
    try {
      const raw = svgEl.getBBox();
      this.textBoundsCache.set(id, { x: raw.x, y: raw.y, width: raw.width, height: raw.height });
    } catch { /* element not measurable yet */ }
  }

  private rebuildTextBoundsCache(): void {
    this.textBoundsCache.clear();
    for (const [id, el] of this.elements) {
      if (el.type === "text") this.measureTextElement(id);
    }
  }

  private doRenderHandles(): void {
    this.handlesGroup = ensureHandlesGroup(this.handlesGroup, this.svg);
    const selected = this.getSelectedElements();
    renderHandles(this.handlesGroup, selected, {
      snapTarget: this.snapTarget,
      activeHandle: this.activeHandle,
      bboxOverrides: this.textBoundsCache,
    });
  }

  /**
   * Shared commit logic for resize and rotation sessions.
   * Builds undo entry from original→current state, updates bound arrows, clears session.
   */
  private commitTransform(
    session: { elementId: string | null; originalElement: DrawingElement | null; group: { elements: Array<{ id: string; originalElement: DrawingElement }> } | null },
  ): void {
    const affectedIds = new Set<string>();
    if (session.group) {
      const undoItems: Array<{ id: string; before: DrawingElement; after: DrawingElement }> = [];
      for (const item of session.group.elements) {
        affectedIds.add(item.id);
        const el = this.elements.get(item.id);
        if (el) undoItems.push({ id: item.id, before: item.originalElement, after: cloneElement(el) });
      }
      if (undoItems.length > 0) this.pushUndo({ action: "modify", data: undoItems });
    } else if (session.elementId && session.originalElement) {
      affectedIds.add(session.elementId);
      const el = this.elements.get(session.elementId);
      if (el) {
        this.pushUndo({ action: "modify", data: [{ id: session.elementId, before: session.originalElement, after: cloneElement(el) }] });
      }
    }
    if (affectedIds.size > 0) this.updateBoundArrows(affectedIds);
  }

  /**
   * Shared cancel logic for resize and rotation sessions.
   * Restores original elements, re-renders.
   */
  private cancelTransform(
    session: { elementId: string | null; originalElement: DrawingElement | null; group: { elements: Array<{ id: string; originalElement: DrawingElement }> } | null },
  ): void {
    if (session.group) {
      for (const item of session.group.elements) this.elements.set(item.id, item.originalElement);
    } else if (session.elementId && session.originalElement) {
      this.elements.set(session.elementId, session.originalElement);
    }
    this.rerenderElements();
  }

  private commitResize(): void {
    if (!this.resizing) return;
    this.commitTransform(this.resizing);
    this.activeHandle = null;
    this.resizing = null;
    this.snapTarget = null;
  }

  private cancelResize(): void {
    if (!this.resizing) return;
    this.cancelTransform(this.resizing);
    this.activeHandle = null;
    this.resizing = null;
    this.snapTarget = null;
  }

  private commitRotation(): void {
    if (!this.rotating) return;
    this.commitTransform(this.rotating);
    this.activeHandle = null;
    this.rotating = null;
  }

  private cancelRotation(): void {
    if (!this.rotating) return;
    this.cancelTransform(this.rotating);
    this.activeHandle = null;
    this.rotating = null;
  }

  /**
   * Update positions of arrows/lines that are bound to any of the given element IDs.
   * Called after moving, resizing, or rotating shapes.
   */
  private updateBoundArrows(movedIds: Set<string>): void {
    for (const [id, el] of this.elements) {
      if (movedIds.has(id)) continue;
      if (!isLine(el)) continue;
      let changed = false;

      if (el.startBinding && movedIds.has(el.startBinding.elementId)) {
        const resolved = resolveBindingPoint(el.startBinding, this.elements, this.textBoundsCache);
        if (resolved) {
          el.points[0] = resolved;
          changed = true;
        }
      }
      if (el.endBinding && movedIds.has(el.endBinding.elementId)) {
        const resolved = resolveBindingPoint(el.endBinding, this.elements, this.textBoundsCache);
        if (resolved) {
          el.points[1] = resolved;
          changed = true;
        }
      }

      if (changed) {
        const svgEl = this.elementsGroup?.querySelector(`#${id}`);
        if (svgEl) {
          const newEl = this.renderElement(el);
          if (newEl) svgEl.replaceWith(newEl);
        }
      }
    }
  }

  destroy(): void {
    if (this.textEdit) {
      this.textEdit.overlay.remove();
      this.textEdit = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.svgRect = null;

    this.eventAbort.abort();
    if (this.svg) {
      this.svg.remove();
      this.svg = null;
    }
    this.elementsGroup = null;
    this.previewGroup = null;
    this.elements.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selectedIds.clear();
  }

  setTextProperty(property: "font_family" | "font_size" | "text_align", value: string): void {
    this.setState({ [property]: value });
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
            const bbox = getBoundingBox(el, this.textBoundsCache);
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

      if (this.textEdit && this.textEdit.editingId) {
        const editedEl = changed.find(t => t.id === this.textEdit!.editingId);
        if (editedEl) this.updateTextOverlay(editedEl);
      }
    }
  }

  setStyleProperty(property: StyleProperty, value: string | number): void {
    const numericProps: Set<StyleProperty> = new Set(["stroke_width", "opacity", "dash_length", "dash_gap"]);
    const signalValue = numericProps.has(property) && typeof value === "string" ? Number(value) : value;
    this.setState({ [property]: signalValue });
    const changed: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el) continue;

      switch (property) {
        case "fill_color":
          if (!isShape(el)) continue;
          el.fill_color = value as string;
          break;
        case "stroke_color":
          el.stroke_color = value as string;
          break;
        case "stroke_width":
          if (el.type === "text") continue;
          el.stroke_width = typeof value === "number" ? value : Number(value);
          break;
        case "opacity":
          el.opacity = typeof value === "number" ? value : Number(value);
          break;
        case "dash_length":
          if (el.type === "text") continue;
          el.dash_length = typeof value === "number" ? value : Number(value);
          break;
        case "dash_gap":
          if (el.type === "text") continue;
          el.dash_gap = typeof value === "number" ? value : Number(value);
          break;
        case "start_arrowhead":
          if (!isLine(el)) continue;
          el.start_arrowhead = value as ArrowheadStyle;
          break;
        case "end_arrowhead":
          if (!isLine(el)) continue;
          el.end_arrowhead = value as ArrowheadStyle;
          break;
      }
      changed.push(el);
    }

    if (changed.length > 0) {
      this.rerenderElements();

      if (this.textEdit && this.textEdit.editingId && property === "stroke_color") {
        const editedEl = changed.find(e => e.id === this.textEdit!.editingId);
        if (editedEl && isText(editedEl)) this.updateTextOverlay(editedEl);
      }
    }
  }

  setDashPreset(preset: string): void {
    const values = DASH_PRESETS[preset];
    if (!values) return;
    this.setState({ dash_length: values.dash_length, dash_gap: values.dash_gap });
    let changed = false;
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el || el.type === "text") continue;
      el.dash_length = values.dash_length;
      el.dash_gap = values.dash_gap;
      changed = true;
    }
    if (changed) this.rerenderElements();
  }

  switchTool(newTool: Tool): void {
    if (newTool === this.currentTool) return;
    this.resetCycleState();
    this.saveCurrentToolSettings();
    const settings = this.toolSettings.get(newTool) ?? TOOL_DEFAULTS[newTool];
    this.loadToolSettings(settings);

    this.currentTool = newTool;
    // Prevent toolbar signals (selected_is_text, selected_is_line) from persisting
    if (newTool !== "select") this.deselectAll();
    this.setState({ tool: newTool });
    this.updateCursor();
  }

  private saveCurrentToolSettings(): void {
    const defaults = TOOL_DEFAULTS[this.currentTool];
    const settings: ToolSettings = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (value !== undefined) {
        (settings as Record<string, unknown>)[key] = this.state[key as keyof DrawingState];
      }
    }
    this.toolSettings.set(this.currentTool, settings);
  }

  private loadToolSettings(settings: ToolSettings): void {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length > 0) {
      this.setState(patch as Partial<DrawingState>);
    }
  }

  addElement(el: DrawingElement): string {
    this.elements.set(el.id, el);
    const svgEl = this.renderElement(el);
    if (svgEl && this.elementsGroup) {
      this.elementsGroup.appendChild(svgEl);
    }
    this.pushUndo({ action: "add", data: el });
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
    this.setState({
      can_undo: false,
      can_redo: false,
    });
  }

  getElementById(id: string): Readonly<DrawingElement> | undefined {
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
    this.pushUndo({ action: "remove", data: el });
    this.rerenderElements();
  }

  exportSvg(): string {
    if (!this.svg) return "";


    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    const preview = clone.querySelector(".preview");
    const selectionOutlines = clone.querySelectorAll(".selection-outline");
    preview?.remove();
    for (const el of selectionOutlines) el.remove();

    return clone.outerHTML;
  }

  importSvg(svg: string): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      console.error("Failed to parse SVG:", parseError.textContent);
      return;
    }

    const svgEl = doc.querySelector("svg");
    if (!svgEl) return;


    this.elements.clear();
    this.selectedIds.clear();
    this.undoStack = [];
    this.redoStack = [];


    const elementsGroup = svgEl.querySelector(".elements") || svgEl;
    for (const el of elementsGroup.querySelectorAll("path, line, rect, ellipse, polygon, text")) {
      const id = el.getAttribute("id") || `imported-${crypto.randomUUID().split("-")[0]}`;
      const tagName = el.tagName.toLowerCase();


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
    this.setState({
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
      this.pushUndo({ action: "remove", data: el });
    }
    this.selectedIds.clear();
    this.rerenderElements();
    this.setState({ selected_ids: [] });
  }

  private startDrawing(point: Point): void {
    const tool = this.currentTool;
    const strokeColor = this.state.stroke_color;
    const strokeWidth = this.state.stroke_width;
    const opacity = this.state.opacity;
    const layer =
      tool === "highlighter" ? "background" : (this.state.active_layer);

    const points = [point];
    const element = {
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
      points,
    } as PathElement;
    this.drawing = { element, points, anchor: null };

    this.setState({ is_drawing: true });
    this.requestPreviewUpdate();
  }

  private moveDrawing(point: Point): void {
    if (!this.drawing) return;
    const { element, points, anchor } = this.drawing;

    if (isLine(element)) {
      const snapResult = findSnapPoint(point, this.elements, SNAP_THRESHOLD, element.id);
      this.snapTarget = snapResult ? snapResult.point : null;
      this.lastSnapResult = snapResult;
      element.points[1] = snapResult ? snapResult.point : point;
      this.requestPreviewUpdate();
      return;
    }

    if (anchor && isShape(element)) {
      element.x = Math.min(anchor.x, point.x);
      element.y = Math.min(anchor.y, point.y);
      element.width = Math.abs(point.x - anchor.x);
      element.height = Math.abs(point.y - anchor.y);
      this.requestPreviewUpdate();
      return;
    }

    const last = points[points.length - 1];
    const dist = Math.sqrt((point.x - last.x) ** 2 + (point.y - last.y) ** 2);
    if (dist < 0.5) return;

    points.push(point);
    if (isPath(element)) {
      element.points = points;
    }
    this.requestPreviewUpdate();
  }

  private commitDrawing(): void {
    if (!this.drawing || !this.elementsGroup) return;
    const { element } = this.drawing;

    if (isLine(element) && this.lastSnapResult?.elementId) {
      element.endBinding = {
        elementId: this.lastSnapResult.elementId,
        anchor: this.lastSnapResult.anchor!,
      };
    }

    this.elements.set(element.id, element);
    const svgEl = this.renderElement(element);
    if (svgEl) this.elementsGroup.appendChild(svgEl);

    this.pushUndo({ action: "add", data: element });
    this.clearPreview();
    this.drawing = null;
    this.snapTarget = null;
    this.lastSnapResult = null;
    this.setState({ is_drawing: false });
  }

  private cancelDrawing(): void {
    this.clearPreview();
    this.drawing = null;
    this.snapTarget = null;
    this.lastSnapResult = null;
    this.setState({ is_drawing: false });
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

    const { hasLine, hasText } = this.analyzeSelectionTypes();
    const patch: Partial<DrawingState> = {
      selected_ids: Array.from(this.selectedIds),
      selected_is_line: hasLine,
      selected_is_text: hasText,
    };

    if (this.selectedIds.size === 1) {
      const [firstId] = this.selectedIds;
      const el = this.elements.get(firstId);
      if (el) Object.assign(patch, this.buildSelectionPatch(el));
    }

    this.setState(patch);
    this.updateSelectionVisual();
  }

  private updateSelectionVisual(): void {
    const outlines = this.elementsGroup?.querySelectorAll(".selection-outline");
    if (outlines) {
      for (const el of outlines) el.remove();
    }
    this.doRenderHandles();
  }

  private applyHistory(direction: "undo" | "redo"): void {
    const fromStack = direction === "undo" ? this.undoStack : this.redoStack;
    const toStack = direction === "undo" ? this.redoStack : this.undoStack;
    const action = fromStack.pop();
    if (!action) return;

    const result = processHistory(action, this.elements, direction);
    for (const id of result.elementsToDelete) this.elements.delete(id);
    for (const [id, el] of result.elementsToSet) this.elements.set(id, el);
    toStack.push(action);

    this.rerenderElements();
    this.setState({
      can_undo: this.undoStack.length > 0,
      can_redo: this.redoStack.length > 0,
    });
  }

  undo(): void { this.applyHistory("undo"); }
  redo(): void { this.applyHistory("redo"); }

  /** Targeted re-render of a single element's SVG node via replaceWith. */
  private rerenderElement(id: string): void {
    const el = this.elements.get(id);
    if (!el || !this.elementsGroup) return;
    const existing = this.elementsGroup.querySelector(`#${id}`);
    if (existing) {
      const newEl = this.renderElement(el);
      if (newEl) {
        existing.replaceWith(newEl);
        this.measureTextElement(id);
      }
    }
  }

  /** Targeted re-render of a set of elements + handle update. For hot paths (drag/resize/rotate). */
  private rerenderElementSet(ids: Iterable<string>): void {
    for (const id of ids) {
      this.rerenderElement(id);
    }
    this.doRenderHandles();
  }

  /** Full DOM rebuild — clears and re-renders all elements. For cold paths (undo, delete, z-order, import). */
  private rerenderElements(): void {
    if (!this.elementsGroup) return;
    this.elementsGroup.innerHTML = "";
    for (const el of this.elements.values()) {
      const svgEl = this.renderElement(el);
      if (svgEl) this.elementsGroup.appendChild(svgEl);
    }
    this.rebuildTextBoundsCache();

    for (const id of this.selectedIds) {
      if (!this.elements.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    this.updateSelectionVisual();
    const { hasLine, hasText } = this.analyzeSelectionTypes();
    this.setState({ selected_ids: Array.from(this.selectedIds), selected_is_line: hasLine, selected_is_text: hasText });
  }
  selectAll(): void {
    this.selectedIds.clear();
    for (const id of this.elements.keys()) {
      this.selectedIds.add(id);
    }
    const { hasLine, hasText } = this.analyzeSelectionTypes();
    this.setState({ selected_ids: Array.from(this.selectedIds), selected_is_line: hasLine, selected_is_text: hasText });
    this.updateSelectionVisual();
  }

  deselectAll(): void {
    this.selectedIds.clear();
    this.resetCycleState();
    // Update signal store BEFORE rendering handles (renderHandles reads from store)
    this.setState({ selected_ids: [], selected_is_line: false, selected_is_text: false });
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

    if (deletedElements.length === 1) {
      this.pushUndo({ action: "remove", data: deletedElements[0] });
    } else if (deletedElements.length > 1) {
      this.pushUndo({ action: "remove_batch", data: deletedElements });
    }
    this.setState({ selected_ids: [] });
  }

  duplicateSelected(): void {
    if (this.selectedIds.size === 0) return;

    const duplicates = this.duplicateElements();
    const newIds: string[] = [];
    for (const dup of duplicates) {
      this.elements.set(dup.id, dup);
      this.pushUndo({ action: "add", data: dup });
      newIds.push(dup.id);
    }

    this.rerenderElements();

    this.selectedIds.clear();
    for (const id of newIds) this.selectedIds.add(id);

    this.setState({ selected_ids: newIds });
    this.updateSelectionVisual();
  }

  private nudgeSelected(dx: number, dy: number): void {
    if (this.selectedIds.size === 0) return;
    const moveData: Array<{ id: string; before: MovePosition; after: MovePosition }> = [];
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el) continue;
      if (isShape(el) || isText(el)) {
        const before = { x: el.x, y: el.y };
        el.x += dx;
        el.y += dy;
        moveData.push({ id, before, after: { x: el.x, y: el.y } });
      } else if (isLine(el)) {
        const before: MovePosition = {
          points: el.points.map(p => ({ ...p })),
          midpoint: el.midpoint ? { ...el.midpoint } : undefined,
        };
        el.points = el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [Point, Point];
        if (el.midpoint) el.midpoint = { x: el.midpoint.x + dx, y: el.midpoint.y + dy };
        moveData.push({ id, before, after: {
          points: el.points.map(p => ({ ...p })),
          midpoint: el.midpoint ? { ...el.midpoint } : undefined,
        }});
      } else if (isPath(el)) {
        const before: MovePosition = { points: el.points.map(p => ({ ...p })) };
        el.points = el.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        moveData.push({ id, before, after: { points: el.points.map(p => ({ ...p })) } });
      }
    }
    // Capture bound arrow positions before updateBoundArrows mutates them
    const ids = new Set(this.selectedIds);
    const boundArrowsBefore = new Map<string, MovePosition>();
    for (const [id, el] of this.elements) {
      if (ids.has(id) || !isLine(el)) continue;
      if ((el.startBinding && ids.has(el.startBinding.elementId)) ||
          (el.endBinding && ids.has(el.endBinding.elementId))) {
        boundArrowsBefore.set(id, {
          points: el.points.map(p => ({ ...p })),
          midpoint: el.midpoint ? { ...el.midpoint } : undefined,
        });
      }
    }
    this.updateBoundArrows(ids);
    for (const [id, before] of boundArrowsBefore) {
      const el = this.elements.get(id);
      if (!el || !isLine(el)) continue;
      moveData.push({ id, before, after: {
        points: el.points.map(p => ({ ...p })),
        midpoint: el.midpoint ? { ...el.midpoint } : undefined,
      }});
    }
    if (moveData.length > 0) this.pushUndo({ action: "move", data: moveData });
    this.rerenderElementSet(ids);
  }

  private analyzeSelectionTypes(): { hasLine: boolean; hasText: boolean } {
    let hasLine = false;
    let hasText = false;
    for (const id of this.selectedIds) {
      const el = this.elements.get(id);
      if (!el) continue;
      if (el.type === "line" || el.type === "arrow") hasLine = true;
      if (el.type === "text") hasText = true;
    }
    return { hasLine, hasText };
  }

  private buildSelectionPatch(el: DrawingElement): Partial<DrawingState> {
    const patch: Partial<DrawingState> = {
      stroke_color: el.stroke_color,
      opacity: el.opacity,
      dash_length: el.dash_length,
      dash_gap: el.dash_gap,
    };
    if (el.type !== "text") patch.stroke_width = el.stroke_width;
    if (isShape(el) && el.fill_color) patch.fill_color = el.fill_color;
    if (isLine(el)) {
      patch.start_arrowhead = el.start_arrowhead || "none";
      patch.end_arrowhead = el.end_arrowhead || "none";
    }
    if (isText(el)) {
      patch.font_family = el.font_family;
      patch.font_size = reverseFontSizeMap[el.font_size] ?? el.font_size;
      patch.text_align = el.text_align;
    }
    return patch;
  }

  private duplicateElements(): DrawingElement[] {
    const duplicates: DrawingElement[] = [];
    for (const id of this.selectedIds) {
      const original = this.elements.get(id);
      if (!original) continue;
      const dup = cloneElement(original);
      dup.id = `${original.type}-${crypto.randomUUID().split("-")[0]}`;
      dup.created_at = Date.now();
      if (isShape(dup) || isText(dup)) {
        dup.x += 2;
        dup.y += 2;
      } else if (isLine(dup) || isPath(dup)) {
        dup.points = dup.points.map((p) => ({ x: p.x + 2, y: p.y + 2 })) as typeof dup.points;
      }
      duplicates.push(dup);
    }
    return duplicates;
  }

  bringToFront(): void {
    if (this.selectedIds.size === 0) return;

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
