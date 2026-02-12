"""star-drawing: SVG drawing canvas as a starelements component.

Provides <drawing-canvas> via @element() and toolbar helpers.
Register with: app.register(DrawingCanvas)
"""

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
    "COLOR_PALETTE",
    "FILL_PALETTE",
    "HIGHLIGHTER_COLORS",
    "TOOL_GROUPS",
    "ARROWHEAD_OPTIONS",
]

STATIC_DIR = Path(__file__).parent / "static"

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

TOOL_GROUPS = [
    [("select", "Select")],
    [("pen", "Pen"), ("line", "Line"), ("arrow", "Arrow")],
    [("rect", "Rectangle"), ("ellipse", "Ellipse"), ("diamond", "Diamond")],
    [("text", "Text"), ("highlighter", "Highlighter"), ("eraser", "Eraser")],
]

COLOR_PALETTE = [
    ("#1a1a2e", "Ink"),
    ("#5c5f6e", "Graphite"),
    ("#d94040", "Vermillion"),
    ("#e8772a", "Tangerine"),
    ("#c49b1a", "Goldenrod"),
    ("#2d9e5e", "Forest"),
    ("#3568d4", "Cobalt"),
    ("#7c4dca", "Iris"),
    ("#d4507a", "Rose"),
    ("#a0603a", "Sienna"),
]

FILL_PALETTE = [
    ("#ffffff", "White"),
    ("#e8e3db", "Warm Linen"),
    ("#fecdd3", "Rose Mist"),
    ("#fed7aa", "Peach Cream"),
    ("#fef3c7", "Butter"),
    ("#bbf7d0", "Mint"),
    ("#bfdbfe", "Sky"),
    ("#ddd6fe", "Lavender"),
    ("#fce7f3", "Blush"),
    ("#e8d5c4", "Tan"),
]

HIGHLIGHTER_COLORS = [
    ("#FFFF00", "Yellow"),
    ("#FF69B4", "Pink"),
    ("#87CEEB", "Blue"),
    ("#90EE90", "Green"),
    ("#FFA500", "Orange"),
]

ARROWHEAD_OPTIONS = [("None", "none"), ("Arrow", "arrow"), ("Circle", "circle"), ("Bar", "bar"), ("Diamond", "diamond")]

_SIGNALS = {
    "tool": ("pen", str),
    "is_drawing": (False, bool),
    "can_undo": (False, bool),
    "can_redo": (False, bool),
    "text_editing": (False, bool),
    "stroke_color": ("#1a1a2e", str),
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
    "switch_tool",
    "undo",
    "redo",
    "delete_selected",
    "select_all",
    "deselect_all",
    "duplicate_selected",
    "bring_to_front",
    "send_to_back",
    "set_text_property",
    "set_style_property",
    "set_dash_preset",
    "export_svg",
    "import_svg",
    "clear",
    "apply_remote_changes",
    "get_snapshot",
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
                    '.drawing-text-input{position:absolute;background:transparent;border:0;outline:none;z-index:10;box-sizing:border-box;padding:0;margin:0;overflow:visible;resize:none;white-space:pre;line-height:1.2}';
                document.head.appendChild(s);
            }

            const signalPrefix = el.getAttribute('signal') || 'drawing';

            const isReadonly = el.hasAttribute('readonly');
            const config = {
                defaultTool: el.getAttribute('default-tool') || 'pen',
                defaultStrokeColor: el.getAttribute('default-stroke-color') || '#1a1a2e',
                defaultFillColor: el.getAttribute('default-fill-color') || '#ffffff',
                defaultStrokeWidth: Number(el.getAttribute('default-stroke-width')) || 2,
                defaultOpacity: Number(el.getAttribute('default-opacity')) || 1,
                defaultLayer: el.getAttribute('default-layer') || 'default',
                throttleMs: Number(el.getAttribute('throttle-ms')) || 16,
                signal: signalPrefix,
                readonly: isReadonly,
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
                onElementChange: (changes) => {
                    el.dispatchEvent(new CustomEvent('element-change', { detail: changes, bubbles: true }));
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
                applyRemoteChanges: (changes) => controller.applyRemoteChanges(changes),
                getSnapshot: () => controller.getSnapshot(),
            };
            Object.assign(el, methods);

            onCleanup(() => {
                controller.destroy();
            });
        """),
    )


# ---------------------------------------------------------------------------
# Toolbar helpers
# ---------------------------------------------------------------------------


def _divider(**kw):
    return Div(cls="toolbar-divider", **kw)


def _popover(trigger, *children, panel_id: str, show_expr, **panel_kw):
    return Div(
        trigger,
        Div(*children, id=panel_id, data_show=show_expr, cls="toolbar-popover", **panel_kw),
        cls="popover-anchor",
    )


def _swatch_grid(swatches, *, on_click, selected, picker=None, prefix=None):
    """Color swatch grid with optional custom color picker and prefix buttons."""
    items: list[Any] = list(prefix) if prefix else []
    items.extend(
        Button(
            data_on_click=on_click(c),
            data_class_selected=selected(c),
            style=f"background-color: {c}",
            cls="color-swatch",
            title=n,
        )
        for c, n in swatches
    )
    if picker:
        items.append(picker)
    return Div(*items, cls="swatch-grid")


def _btn_row(options, *, on_click, selected, label=None):
    """Row of style buttons from (label, value) pairs."""
    return Div(
        *[
            Button(
                label(n, v) if label else n,
                data_on_click=on_click(v),
                data_class_selected=selected(v),
                cls="style-btn",
            )
            for n, v in options
        ],
        cls="btn-row",
    )


def _labeled_slider(label, *, signal, on_input, min, max, step, show=None):
    """Panel section with a labeled range slider."""
    kw = {"data_show": show} if show is not None else {}
    return Div(
        Div(
            Span(label, cls="panel-label"),
            Span(data_text=signal, cls="panel-value"),
            cls="panel-section-header",
        ),
        Input(
            type="range",
            min=min,
            max=max,
            step=step,
            data_bind=signal,
            data_on_input=on_input,
            cls="styled-slider full-width",
            aria_label=label,
        ),
        cls="panel-section",
        **kw,
    )


def _panel_section(label, content, *, show=None):
    """Labeled panel section with optional visibility."""
    kw = {"data_show": show} if show is not None else {}
    return Div(
        Span(label, cls="panel-label"),
        content,
        cls="panel-section",
        **kw,
    )


# ---------------------------------------------------------------------------
# Toolbars
# ---------------------------------------------------------------------------


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
    color_palette: list[tuple[str, str]] | None = None,
    fill_palette: list[tuple[str, str]] | None = None,
    highlighter_colors: list[tuple[str, str]] | None = None,
    width_presets: tuple[int, ...] | None = None,
    tool_groups: list[list[tuple[str, str]]] | None = None,
    font_options: list[tuple[str, str]] | None = None,
    font_sizes: list[tuple[str, str]] | None = None,
    arrowhead_options: list[tuple[str, str]] | None = None,
) -> Any:
    """Compact toolbar with popover panels for a drawing canvas.

    Style panel auto-opens for text/arrow tools.
    Sections are context-filtered by active tool.
    """
    colors = color_palette or COLOR_PALETTE
    fills = fill_palette or FILL_PALETTE
    highlighters = highlighter_colors or HIGHLIGHTER_COLORS
    widths = width_presets or (1, 2, 4, 8, 16)
    groups = tool_groups or TOOL_GROUPS
    fonts = font_options or [("Hand", "hand-drawn"), ("Sans", "normal"), ("Mono", "monospace")]
    sizes = font_sizes or [("S", "small"), ("M", "medium"), ("L", "large")]
    arrows = arrowhead_options or ARROWHEAD_OPTIONS

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

    style_open = canvas.signal("style_open", False, type_=bool)
    color_open = canvas.signal("color_open", False, type_=bool)

    is_text_ctx = (tool == "text") | text_editing | selected_is_text
    not_freehand = (tool != "pen") & (tool != "highlighter")
    show_width = ~is_text_ctx
    show_stroke = not_freehand & ~is_text_ctx
    style_panel_show = style_open | (tool == "text") | (tool == "arrow")

    tool_set = set(tools)
    bar_items: list[Any] = []
    for group in groups:
        btns = [
            Button(
                Icon(TOOL_ICONS[tid], size=20),
                data_on_click=[canvas.switch_tool(tid), style_open.set(False), color_open.set(False)],
                data_class_selected=tool == tid,
                cls="tool-btn",
                title=tip,
            )
            for tid, tip in group
            if tid in tool_set
        ]
        if btns:
            if bar_items:
                bar_items.append(_divider())
            bar_items.extend(btns)

    if show_undo:
        bar_items.extend(
            [
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
            ]
        )

    if show_colors:
        color_trigger = Div(
            Div(
                cls="color-trigger-fill",
                data_attr_style=fill_enabled.if_("background-color:" + fill_color, "display:none"),
            ),
            cls="color-trigger",
            data_on_click=[color_open.toggle(), style_open.set(False)],
            data_attr_style="background-color:" + stroke_color,
            title="Colors",
            role="button",
            tabindex="0",
            aria_label="Stroke and fill colors",
        )

        stroke_picker = Input(
            type="color",
            data_bind=stroke_color,
            data_on_input=canvas.set_style_property("stroke_color", evt.target.value),
            cls="color-picker",
            title="Custom stroke color",
            aria_label="Custom stroke color",
        )
        fill_picker = Input(
            type="color",
            data_bind=fill_color,
            data_on_input=[
                canvas.set_style_property("fill_color", evt.target.value),
                canvas.set_style_property("fill_enabled", True),
            ],
            cls="color-picker",
            title="Custom fill color",
            aria_label="Custom fill color",
        )
        no_fill_btn = Button(
            Div(cls="no-fill-swatch"),
            data_on_click=[
                canvas.set_style_property("fill_enabled", False),
                canvas.set_style_property("fill_color", ""),
            ],
            data_class_selected=~fill_enabled,
            cls="color-swatch",
            title="No fill",
        )

        color_panel = [
            _panel_section(
                "Stroke",
                _swatch_grid(
                    colors,
                    on_click=lambda c: canvas.set_style_property("stroke_color", c),
                    selected=lambda c: stroke_color == c,
                    picker=stroke_picker,
                ),
            ),
            _panel_section(
                "Fill",
                _swatch_grid(
                    fills,
                    on_click=lambda c: [
                        canvas.set_style_property("fill_color", c),
                        canvas.set_style_property("fill_enabled", True),
                    ],
                    selected=lambda c: (fill_color == c) & fill_enabled,
                    picker=fill_picker,
                    prefix=[no_fill_btn],
                ),
            ),
            _panel_section(
                "Highlighter",
                _swatch_grid(
                    highlighters,
                    on_click=lambda c: canvas.set_style_property("stroke_color", c),
                    selected=lambda c: stroke_color == c,
                ),
                show=tool == "highlighter",
            ),
        ]

        bar_items.extend(
            [
                _divider(),
                _popover(color_trigger, *color_panel, panel_id=f"{canvas._name}-color-panel", show_expr=color_open),
            ]
        )

    if show_styles:
        style_trigger = Button(
            Icon("lucide:sliders-horizontal", size=20),
            data_on_click=[style_open.toggle(), color_open.set(False)],
            data_class_selected=style_panel_show,
            cls="tool-btn",
            title="Style options",
        )

        style_panel = [
            _panel_section(
                "Width",
                Div(
                    *[
                        Button(
                            Div(cls="width-dot", style=f"width:{min(sz * 2, 14)}px;height:{min(sz * 2, 14)}px"),
                            data_on_click=canvas.set_style_property("stroke_width", sz),
                            data_class_selected=stroke_width == sz,
                            cls="style-btn width-btn",
                            title=f"{sz}px",
                        )
                        for sz in widths
                    ],
                    cls="btn-row",
                ),
                show=show_width,
            ),
            _panel_section(
                "Stroke",
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
                show=show_stroke,
            ),
            # Progressive disclosure: fine-tuning shown after selecting dashed/dotted
            _labeled_slider(
                "Dash size",
                signal=dash_length,
                on_input=canvas.set_style_property("dash_length", js("Number(evt.target.value)")),
                min="2",
                max="12",
                step="1",
                show=show_stroke & (dash_length >= 1),
            ),
            _labeled_slider(
                "Dot spacing",
                signal=dash_gap,
                on_input=canvas.set_style_property("dash_gap", js("Number(evt.target.value)")),
                min="2",
                max="12",
                step="0.5",
                show=show_stroke & (dash_length < 1) & (dash_gap > 0),
            ),
            _labeled_slider(
                "Opacity",
                signal=opacity,
                on_input=canvas.set_style_property("opacity", evt.target.value),
                min="0",
                max="1",
                step="0.1",
            ),
            Div(
                _panel_section(
                    "Start",
                    _btn_row(
                        arrows,
                        on_click=lambda v: canvas.set_style_property("start_arrowhead", v),
                        selected=lambda v: start_arrowhead == v,
                    ),
                ),
                _panel_section(
                    "End",
                    _btn_row(
                        arrows,
                        on_click=lambda v: canvas.set_style_property("end_arrowhead", v),
                        selected=lambda v: end_arrowhead == v,
                    ),
                ),
                data_show=(tool == "arrow") | selected_is_line,
            ),
            Div(
                _panel_section(
                    "Font",
                    _btn_row(
                        fonts,
                        on_click=lambda v: canvas.set_text_property("font_family", v),
                        selected=lambda v: font_family == v,
                    ),
                ),
                _panel_section(
                    "Size",
                    _btn_row(
                        sizes,
                        on_click=lambda v: canvas.set_text_property("font_size", v),
                        selected=lambda v: font_size == v,
                    ),
                ),
                _panel_section(
                    "Align",
                    _btn_row(
                        [
                            ("lucide:align-left", "left"),
                            ("lucide:align-center", "center"),
                            ("lucide:align-right", "right"),
                        ],
                        on_click=lambda v: canvas.set_text_property("text_align", v),
                        selected=lambda v: text_align == v,
                        label=lambda ico, _: Icon(ico, size=14),
                    ),
                ),
                data_show=is_text_ctx,
            ),
        ]

        bar_items.append(
            _popover(style_trigger, *style_panel, panel_id=f"{canvas._name}-style-panel", show_expr=style_panel_show),
        )

    # Preseed so data-bind inputs don't evaluate to undefined before component init
    preseed = {sig._id: sig._initial for sig in [stroke_color, fill_color, fill_enabled, color_open, style_open]}

    return Div(
        Div(*bar_items, cls="toolbar-bar"),
        cls="toolbar-island",
        data_signals=preseed,
        data_on_click=([color_open.set(False), style_open.set(False)], {"outside": True}),
    )


def annotation_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for annotation use cases."""
    return drawing_toolbar(canvas, tools=("pen", "highlighter", "eraser"), **kw)


def diagram_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for diagramming use cases."""
    return drawing_toolbar(canvas, tools=("select", "line", "arrow", "rect", "ellipse", "diamond", "text"), **kw)
