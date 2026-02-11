"""star-drawing: SVG drawing canvas as a starelements component.

Provides <drawing-canvas> via @element() and toolbar helpers.
Register with: app.register(DrawingCanvas)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from starelements import Local, element
from starhtml import Button, Div, Icon, Input, Span
from starhtml.datastar import evt, js

__all__ = [
    "DrawingCanvas",
    "drawing_toolbar",
    "annotation_toolbar",
    "diagram_toolbar",
    "STATIC_DIR",
]

STATIC_DIR = Path(__file__).parent / "static"

# Tool icons (Lucide via Iconify)
TOOL_ICONS = {
    "select": "lucide:mouse-pointer-2",
    "pen": "lucide:pencil",
    "line": "lucide:minus",
    "arrow": "lucide:move-up-right",
    "rect": "lucide:square",
    "ellipse": "lucide:circle",
    "diamond": "lucide:diamond",
    "text": "lucide:type",
    "highlighter": "lucide:highlighter",
    "eraser": "lucide:eraser",
}

# Logical tool groups for toolbar layout with dividers
TOOL_GROUPS = [
    [("select", "Select")],
    [("pen", "Pen"), ("line", "Line"), ("arrow", "Arrow")],
    [("rect", "Rectangle"), ("ellipse", "Ellipse"), ("diamond", "Diamond")],
    [("text", "Text"), ("highlighter", "Highlighter"), ("eraser", "Eraser")],
]

# Curated color palette (TLDraw/Excalidraw style)
COLOR_PALETTE = [
    ("#1e1e1e", "Black"),
    ("#6b7280", "Gray"),
    ("#ef4444", "Red"),
    ("#f97316", "Orange"),
    ("#eab308", "Yellow"),
    ("#22c55e", "Green"),
    ("#06b6d4", "Cyan"),
    ("#3b82f6", "Blue"),
    ("#8b5cf6", "Violet"),
    ("#ec4899", "Pink"),
]

HIGHLIGHTER_COLORS = [
    ("#FFFF00", "Yellow"),
    ("#FF69B4", "Pink"),
    ("#87CEEB", "Blue"),
    ("#90EE90", "Green"),
    ("#FFA500", "Orange"),
]

ARROWHEAD_OPTIONS = [("None", "none"), ("Arrow", "arrow"), ("Circle", "circle"), ("Bar", "bar"), ("Diamond", "diamond")]


def _divider(**kw):
    return Div(cls="toolbar-divider", **kw)


# ---------------------------------------------------------------------------
# Component signal & method schema (single source of truth)
# ---------------------------------------------------------------------------

_SIGNALS = {
    "tool": ("pen", str),
    "is_drawing": (False, bool),
    "can_undo": (False, bool),
    "can_redo": (False, bool),
    "text_editing": (False, bool),
    "stroke_color": ("#1e1e1e", str),
    "fill_color": ("#ffffff", str),
    "fill_enabled": (False, bool),
    "stroke_width": (2, int),
    "dash_length": (0, int),
    "dash_gap": (0, int),
    "opacity": (1.0, float),
    "selected_ids": ("[]", str),
    "active_layer": ("default", str),
    "font_family": ("hand-drawn", str),
    "font_size": ("medium", str),
    "text_align": ("left", str),
    "start_arrowhead": ("none", str),
    "end_arrowhead": ("none", str),
    "selected_is_line": (False, bool),
    "selected_is_text": (False, bool),
}

_METHODS = (
    "switch_tool", "undo", "redo", "delete_selected", "select_all",
    "deselect_all", "duplicate_selected", "bring_to_front", "send_to_back",
    "set_text_property", "set_style_property", "set_dash_preset",
    "export_svg", "import_svg", "clear",
)

# ---------------------------------------------------------------------------
# Component
# ---------------------------------------------------------------------------


@element(
    "drawing-canvas",
    package="star-drawing",
    static_path=STATIC_DIR,
    height="500px",
    skeleton=True,
    imports={"drawing": "/_pkg/star-drawing/drawing-canvas.js"},
    signals=_SIGNALS,
    methods=_METHODS,
)
def DrawingCanvas():
    from starhtml import Div, Script

    return Div(
        *[Local(name, initial, type_=type_) for name, (initial, type_) in _SIGNALS.items()],
        Script("""
            const { DrawingController } = drawing;

            // Inject critical CSS (once per document)
            if (!document.getElementById('drawing-canvas-styles')) {
                const s = document.createElement('style');
                s.id = 'drawing-canvas-styles';
                s.textContent =
                    'drawing-canvas{position:relative;display:block;touch-action:none}' +
                    '.drawing-svg{position:absolute;inset:0;width:100%;height:100%}' +
                    '.drawing-text-input{position:absolute;background:transparent;border:0;outline:none;z-index:10;box-sizing:border-box;padding:2px;margin:0;overflow:visible;resize:none;white-space:pre;line-height:1.2}';
                document.head.appendChild(s);
            }

            const signalPrefix = el.getAttribute('signal') || 'drawing';

            const config = {
                defaultTool: el.getAttribute('default-tool') || 'pen',
                defaultStrokeColor: el.getAttribute('default-stroke-color') || '#1e1e1e',
                defaultFillColor: el.getAttribute('default-fill-color') || '#ffffff',
                defaultStrokeWidth: Number(el.getAttribute('default-stroke-width')) || 2,
                defaultOpacity: Number(el.getAttribute('default-opacity')) || 1,
                defaultLayer: el.getAttribute('default-layer') || 'default',
                throttleMs: Number(el.getAttribute('throttle-ms')) || 16,
                signal: signalPrefix,
            };

            const controller = new DrawingController(el, config, {
                onStateChange: (patch) => {
                    for (const [key, value] of Object.entries(patch)) {
                        try { sp['$$' + key] = value; } catch(e) {}
                    }
                    const globalPatch = {};
                    for (const [key, value] of Object.entries(patch)) {
                        globalPatch[signalPrefix + '_' + key] = value;
                    }
                    datastar.mergePatch(globalPatch);
                },
            });

            const methods = {
                switchTool: (t) => controller.switchTool(t),
                undo: () => controller.undo(),
                redo: () => controller.redo(),
                deleteSelected: () => controller.deleteSelected(),
                selectAll: () => controller.selectAll(),
                deselectAll: () => controller.deselectAll(),
                duplicateSelected: () => controller.duplicateSelected(),
                bringToFront: () => controller.bringToFront(),
                sendToBack: () => controller.sendToBack(),
                setTextProperty: (p, v) => controller.setTextProperty(p, v),
                setStyleProperty: (p, v) => controller.setStyleProperty(p, v),
                setDashPreset: (p) => controller.setDashPreset(p),
                exportSvg: () => controller.exportSvg(),
                importSvg: (svg) => controller.importSvg(svg),
                clear: (layer) => controller.clear(layer),
            };
            Object.assign(el, methods);

            onCleanup(() => {
                controller.destroy();
            });
        """),
    )


# ---------------------------------------------------------------------------
# Toolbars
# ---------------------------------------------------------------------------


def _popover(trigger, *children, panel_id: str, show_expr, **panel_kw):
    """Wrap a trigger button and panel in a popover container."""
    return Div(
        trigger,
        Div(
            *children,
            id=panel_id,
            data_show=show_expr,
            cls="toolbar-popover",
            **panel_kw,
        ),
        cls="popover-anchor",
    )


def drawing_toolbar(
    canvas,
    *,
    tools: tuple[str, ...] = (
        "select",
        "pen",
        "highlighter",
        "line",
        "arrow",
        "rect",
        "ellipse",
        "diamond",
        "text",
        "eraser",
    ),
    show_colors: bool = True,
    show_undo: bool = True,
    show_styles: bool = True,
) -> Any:
    """Generate a compact toolbar with popover panels for a drawing canvas.

    Args:
        canvas: DrawingCanvas instance created with name= (provides signal/method refs)

    Produces a single-row tool bar with style/color controls in floating popovers.
    Follows the Excalidraw "Island" pattern for a modern, professional look.
    Style panel auto-opens for tools that need configuration (text, arrow).
    Sections are context-filtered: text tools hide width/stroke, shape tools hide font controls.
    """
    # Signal refs — directly from component
    tool = canvas.tool
    can_undo = canvas.can_undo
    can_redo = canvas.can_redo
    text_editing = canvas.text_editing
    stroke_color = canvas.stroke_color
    fill_color = canvas.fill_color
    fill_enabled = canvas.fill_enabled
    stroke_width = canvas.stroke_width
    dash_length = canvas.dash_length
    dash_gap = canvas.dash_gap
    opacity = canvas.opacity
    font_family = canvas.font_family
    font_size = canvas.font_size
    text_align = canvas.text_align
    start_arrowhead = canvas.start_arrowhead
    end_arrowhead = canvas.end_arrowhead
    selected_is_line = canvas.selected_is_line
    selected_is_text = canvas.selected_is_text

    # Toolbar-local toggle signals (namespaced under component)
    style_open = canvas.signal("style_open", False, type_=bool)
    color_open = canvas.signal("color_open", False, type_=bool)

    # Context predicates for section visibility
    is_text_ctx = (tool == "text") | text_editing | selected_is_text
    not_freehand = (tool != "pen") & (tool != "highlighter")
    show_width = ~is_text_ctx
    show_stroke = not_freehand & ~is_text_ctx

    # Style panel auto-opens for text/arrow, or when manually toggled
    style_panel_show = style_open | (tool == "text") | (tool == "arrow")

    # --- Primary bar: tool buttons ---
    tool_set = set(tools)
    tool_buttons: list[Any] = []
    for group in TOOL_GROUPS:
        btns = [
            Button(
                Icon(TOOL_ICONS[tid], size=20),
                data_on_click=[
                    canvas.switch_tool(tid),
                    style_open.set(False),
                    color_open.set(False),
                ],
                data_class_selected=tool == tid,
                cls="tool-btn",
                title=tip,
            )
            for tid, tip in group
            if tid in tool_set
        ]
        if btns:
            if tool_buttons:
                tool_buttons.append(_divider())
            tool_buttons.extend(btns)

    bar_items: list[Any] = list(tool_buttons)

    # --- Undo / Redo / Clear ---
    if show_undo:
        bar_items.extend([
            _divider(),
            Button(
                Icon("lucide:undo-2", size=18),
                data_on_click=canvas.undo(),
                data_attr_disabled=~can_undo,
                cls="action-btn",
                title="Undo",
            ),
            Button(
                Icon("lucide:redo-2", size=18),
                data_on_click=canvas.redo(),
                data_attr_disabled=~can_redo,
                cls="action-btn",
                title="Redo",
            ),
            Button(
                Icon("lucide:trash-2", size=18),
                data_on_click=canvas.clear(),
                cls="action-btn danger",
                title="Clear canvas",
            ),
        ])

    # --- Color popover trigger + panel ---
    if show_colors:
        color_trigger = Div(
            Div(
                cls="color-trigger-fill",
                data_attr_style=fill_enabled.if_(
                    "background-color:" + fill_color,
                    "display:none",
                ),
            ),
            cls="color-trigger",
            data_on_click=[color_open.toggle(), style_open.set(False)],
            data_attr_style="background-color:" + stroke_color,
            title="Colors",
            role="button",
            tabindex="0",
            aria_label="Stroke and fill colors",
        )

        color_panel_children = [
            # Stroke color palette
            Div(
                Span("Stroke", cls="panel-label"),
                Div(
                    *[
                        Button(
                            data_on_click=canvas.set_style_property("stroke_color", c),
                            data_class_selected=stroke_color == c,
                            style=f"background-color: {c}",
                            cls="color-swatch",
                            title=n,
                        )
                        for c, n in COLOR_PALETTE
                    ],
                    Input(
                        type="color",
                        data_bind=stroke_color,
                        data_on_input=canvas.set_style_property("stroke_color", evt.target.value),
                        cls="color-picker",
                        title="Custom stroke color",
                        aria_label="Custom stroke color",
                    ),
                    cls="swatch-grid",
                ),
                cls="panel-section",
            ),
            # Fill controls — "No fill" swatch first, then colors (Excalidraw pattern)
            Div(
                Span("Fill", cls="panel-label"),
                Div(
                    Button(
                        Div(cls="no-fill-swatch"),
                        data_on_click=[
                            canvas.set_style_property("fill_enabled", False),
                            canvas.set_style_property("fill_color", ""),
                        ],
                        data_class_selected=~fill_enabled,
                        cls="color-swatch",
                        title="No fill",
                    ),
                    *[
                        Button(
                            data_on_click=[
                                canvas.set_style_property("fill_color", c),
                                canvas.set_style_property("fill_enabled", True),
                            ],
                            data_class_selected=(fill_color == c) & fill_enabled,
                            style=f"background-color: {c}",
                            cls="color-swatch",
                            title=n,
                        )
                        for c, n in [("#ffffff", "White"), ("#f3f4f6", "Light gray")] + list(COLOR_PALETTE)
                    ],
                    Input(
                        type="color",
                        data_bind=fill_color,
                        data_on_input=[
                            canvas.set_style_property("fill_color", evt.target.value),
                            canvas.set_style_property("fill_enabled", True),
                        ],
                        cls="color-picker",
                        title="Custom fill color",
                        aria_label="Custom fill color",
                    ),
                    cls="swatch-grid",
                ),
                cls="panel-section",
            ),
            # Highlighter presets (contextual)
            Div(
                Span("Highlighter", cls="panel-label"),
                Div(
                    *[
                        Button(
                            data_on_click=canvas.set_style_property("stroke_color", c),
                            data_class_selected=stroke_color == c,
                            style=f"background-color: {c}",
                            cls="color-swatch",
                            title=n,
                        )
                        for c, n in HIGHLIGHTER_COLORS
                    ],
                    cls="swatch-grid",
                ),
                data_show=tool == "highlighter",
                cls="panel-section",
            ),
        ]

        color_popover = _popover(
            color_trigger,
            *color_panel_children,
            panel_id=f"{canvas._name}-color-panel",
            show_expr=color_open,
        )

        bar_items.extend([_divider(), color_popover])

    # --- Style popover trigger + panel ---
    if show_styles:
        style_trigger = Button(
            Icon("lucide:sliders-horizontal", size=20),
            data_on_click=[style_open.toggle(), color_open.set(False)],
            data_class_selected=style_panel_show,
            cls="tool-btn",
            title="Style options",
        )

        style_panel_children = [
            # Width presets (hidden for text context)
            Div(
                Span("Width", cls="panel-label"),
                Div(
                    *[
                        Button(
                            Div(
                                cls="width-dot",
                                style=f"width:{min(sz * 2, 14)}px;height:{min(sz * 2, 14)}px",
                            ),
                            data_on_click=canvas.set_style_property("stroke_width", sz),
                            data_class_selected=stroke_width == sz,
                            cls="style-btn width-btn",
                            title=f"{sz}px",
                        )
                        for sz in (1, 2, 4, 8, 16)
                    ],
                    cls="btn-row",
                ),
                data_show=show_width,
                cls="panel-section",
            ),
            # Dash style presets (hidden for freehand and text)
            Div(
                Span("Stroke", cls="panel-label"),
                Div(
                    Button(
                        Div(cls="dash-preview solid"),
                        data_on_click=canvas.set_dash_preset("solid"),
                        data_class_selected=(dash_length == 0) & (dash_gap == 0),
                        cls="style-btn",
                        title="Solid",
                    ),
                    Button(
                        Div(cls="dash-preview dashed"),
                        data_on_click=canvas.set_dash_preset("dashed"),
                        data_class_selected=dash_length >= 1,
                        cls="style-btn",
                        title="Dashed",
                    ),
                    Button(
                        Div(cls="dash-preview dotted"),
                        data_on_click=canvas.set_dash_preset("dotted"),
                        data_class_selected=(dash_length < 1) & (dash_gap > 0),
                        cls="style-btn",
                        title="Dotted",
                    ),
                    cls="btn-row",
                ),
                data_show=show_stroke,
                cls="panel-section",
            ),
            # Dash fine-tuning sliders (progressive disclosure: shown after selecting dashed/dotted)
            Div(
                Div(
                    Span("Dash size", cls="panel-label"),
                    Span(data_text=dash_length, cls="panel-value"),
                    cls="panel-section-header",
                ),
                Input(
                    type="range",
                    min="2",
                    max="12",
                    step="1",
                    data_bind=dash_length,
                    data_on_input=canvas.set_style_property("dash_length", js("Number(evt.target.value)")),
                    cls="styled-slider full-width",
                    aria_label="Dash length",
                ),
                data_show=show_stroke & (dash_length >= 1),
                cls="panel-section",
            ),
            Div(
                Div(
                    Span("Dot spacing", cls="panel-label"),
                    Span(data_text=dash_gap, cls="panel-value"),
                    cls="panel-section-header",
                ),
                Input(
                    type="range",
                    min="2",
                    max="12",
                    step="0.5",
                    data_bind=dash_gap,
                    data_on_input=canvas.set_style_property("dash_gap", js("Number(evt.target.value)")),
                    cls="styled-slider full-width",
                    aria_label="Dot spacing",
                ),
                data_show=show_stroke & (dash_length < 1) & (dash_gap > 0),
                cls="panel-section",
            ),
            # Opacity
            Div(
                Div(
                    Span("Opacity", cls="panel-label"),
                    Span(data_text=opacity, cls="panel-value"),
                    cls="panel-section-header",
                ),
                Input(
                    type="range",
                    min="0",
                    max="1",
                    step="0.1",
                    data_bind=opacity,
                    data_on_input=canvas.set_style_property("opacity", evt.target.value),
                    cls="styled-slider full-width",
                    aria_label="Opacity",
                ),
                cls="panel-section",
            ),
            # Arrowhead controls (contextual for arrow tool / selected lines)
            Div(
                Div(
                    Span("Start", cls="panel-label"),
                    Div(
                        *[
                            Button(
                                name,
                                data_on_click=canvas.set_style_property("start_arrowhead", val),
                                data_class_selected=start_arrowhead == val,
                                cls="style-btn",
                            )
                            for name, val in ARROWHEAD_OPTIONS
                        ],
                        cls="btn-row",
                    ),
                    cls="panel-section",
                ),
                Div(
                    Span("End", cls="panel-label"),
                    Div(
                        *[
                            Button(
                                name,
                                data_on_click=canvas.set_style_property("end_arrowhead", val),
                                data_class_selected=end_arrowhead == val,
                                cls="style-btn",
                            )
                            for name, val in ARROWHEAD_OPTIONS
                        ],
                        cls="btn-row",
                    ),
                    cls="panel-section",
                ),
                data_show=(tool == "arrow") | selected_is_line,
            ),
            # Text controls (contextual for text tool / text editing / selected text)
            Div(
                Div(
                    Span("Font", cls="panel-label"),
                    Div(
                        *[
                            Button(
                                n,
                                data_on_click=canvas.set_text_property("font_family", v),
                                data_class_selected=font_family == v,
                                cls="style-btn",
                            )
                            for n, v in [("Hand", "hand-drawn"), ("Sans", "normal"), ("Mono", "monospace")]
                        ],
                        cls="btn-row",
                    ),
                    cls="panel-section",
                ),
                Div(
                    Span("Size", cls="panel-label"),
                    Div(
                        *[
                            Button(
                                n,
                                data_on_click=canvas.set_text_property("font_size", v),
                                data_class_selected=font_size == v,
                                cls="style-btn",
                            )
                            for n, v in [("S", "small"), ("M", "medium"), ("L", "large")]
                        ],
                        cls="btn-row",
                    ),
                    cls="panel-section",
                ),
                Div(
                    Span("Align", cls="panel-label"),
                    Div(
                        *[
                            Button(
                                Icon(ico, size=14),
                                data_on_click=canvas.set_text_property("text_align", v),
                                data_class_selected=text_align == v,
                                cls="style-btn",
                                title=v.capitalize(),
                            )
                            for ico, v in [
                                ("lucide:align-left", "left"),
                                ("lucide:align-center", "center"),
                                ("lucide:align-right", "right"),
                            ]
                        ],
                        cls="btn-row",
                    ),
                    cls="panel-section",
                ),
                data_show=is_text_ctx,
            ),
        ]

        style_popover = _popover(
            style_trigger,
            *style_panel_children,
            panel_id=f"{canvas._name}-style-panel",
            show_expr=style_panel_show,
        )

        bar_items.extend([style_popover])

    # Pre-seed signals so data-bind on color inputs and popover toggles
    # don't evaluate to undefined before the canvas component initializes.
    n = canvas._name
    preseed = {
        f"{n}_stroke_color": "#1e1e1e",
        f"{n}_fill_color": "#ffffff",
        f"{n}_fill_enabled": False,
        f"{n}_color_open": False,
        f"{n}_style_open": False,
    }

    return Div(
        Div(*bar_items, cls="toolbar-bar"),
        cls="toolbar-island",
        data_signals=preseed,
        data_on_click__outside=[color_open.set(False), style_open.set(False)],
    )


def annotation_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for annotation use cases."""
    return drawing_toolbar(canvas, tools=("pen", "highlighter", "eraser"), **kw)


def diagram_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for diagramming use cases."""
    return drawing_toolbar(canvas, tools=("select", "line", "arrow", "rect", "ellipse", "diamond", "text"), **kw)
