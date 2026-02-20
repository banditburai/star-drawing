"""star-drawing: SVG drawing canvas as a starelements component.

Provides <drawing-canvas> via @element() and toolbar helpers.
Register with: app.register(DrawingCanvas)
"""

import json
from pathlib import Path
from typing import Any

from starelements import Local, element
from starhtml import Button, Div, Icon, Input, Label, Span
from starhtml.datastar import evt, js

__all__ = [
    "DrawingCanvas",
    "drawing_toolbar",
    "annotation_toolbar",
    "diagram_toolbar",
    "STATIC_DIR",
    "DEFAULT_PALETTE",
    "palette_json",
    "HIGHLIGHTER_COLORS",
    "TOOL_GROUPS",
    "ARROWHEAD_OPTIONS",
]

STATIC_DIR = Path(__file__).parent / "static"

_TOOL_ICONS = {
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

DEFAULT_PALETTE: dict[str, dict[str, list[tuple[str, str]]]] = {
    "stroke": {
        "light": [
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
        ],
        "dark": [
            ("#e4e4e7", "Silver"),
            ("#a1a1aa", "Zinc"),
            ("#f87171", "Coral"),
            ("#fb923c", "Amber"),
            ("#facc15", "Gold"),
            ("#4ade80", "Mint"),
            ("#60a5fa", "Sky"),
            ("#a78bfa", "Violet"),
            ("#f472b6", "Pink"),
            ("#d4a574", "Caramel"),
        ],
    },
    "fill": {
        "light": [
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
        ],
        "dark": [
            ("#2a2a3e", "Dark Slate"),
            ("#3a3a4e", "Charcoal"),
            ("#4c1d1d", "Deep Rose"),
            ("#4c3319", "Deep Amber"),
            ("#4c4419", "Deep Gold"),
            ("#1a3d2e", "Deep Mint"),
            ("#1a2d4c", "Deep Sky"),
            ("#2d1a4c", "Deep Violet"),
            ("#4c1a3a", "Deep Pink"),
            ("#3d2d1a", "Deep Caramel"),
        ],
    },
}

HIGHLIGHTER_COLORS = [
    ("#ffff00", "Yellow"),
    ("#ff69b4", "Pink"),
    ("#87ceeb", "Blue"),
    ("#90ee90", "Green"),
    ("#ffa500", "Orange"),
]


def palette_json(palette: dict[str, dict[str, list[tuple[str, str]]]]) -> str:
    """Strip display names and serialize palette as JSON for the HTML attribute."""
    return json.dumps(
        {
            kind: {theme: [c for c, _ in swatches] for theme, swatches in themes.items()}
            for kind, themes in palette.items()
        }
    )


ARROWHEAD_OPTIONS = [("None", "none"), ("Arrow", "arrow"), ("Circle", "circle"), ("Bar", "bar"), ("Diamond", "diamond")]

_SIGNALS = {
    "tool": ("pen", str),
    "is_drawing": (False, bool),
    "can_undo": (False, bool),
    "can_redo": (False, bool),
    "text_editing": (False, bool),
    "stroke_color": ("palette-stroke-0", str),
    "stroke_color_css": ("#1a1a2e", str),
    "fill_color": ("", str),
    "fill_color_css": ("", str),
    "fill_enabled": (False, bool),
    "stroke_width": (2, float),
    "dash_length": (0, float),
    "dash_gap": (0, float),
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
    "selected_is_highlighter": (False, bool),
    "theme": ("light", str),
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
    "set_theme",
    "prefetch_fonts",
)


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
    from starhtml import Script

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

            const signalPrefix = el.getAttribute('signal') ?? 'drawing';

            const isReadonly = el.hasAttribute('readonly');
            const theme = el.getAttribute('theme') ?? 'light';
            const fontEmbedUrlsRaw = el.getAttribute('font-embed-urls');
            const fontEmbedUrls = fontEmbedUrlsRaw ? JSON.parse(fontEmbedUrlsRaw) : undefined;
            const paletteRaw = el.getAttribute('palette');
            const palette = paletteRaw ? JSON.parse(paletteRaw) : undefined;
            const _num = (a, fb) => { if (!el.hasAttribute(a)) return fb; const v = +el.getAttribute(a); return Number.isFinite(v) ? v : fb; };
            const config = {
                defaultTool: el.getAttribute('default-tool') ?? 'pen',
                defaultStrokeColor: el.getAttribute('default-stroke-color') ?? 'palette-stroke-0',
                defaultFillColor: el.getAttribute('default-fill-color') ?? '',
                defaultStrokeWidth: _num('default-stroke-width', 2),
                defaultOpacity: _num('default-opacity', 1),
                defaultLayer: el.getAttribute('default-layer') ?? 'default',
                throttleMs: _num('throttle-ms', 16),
                viewBoxWidth: _num('viewbox-width', 100),
                viewBoxHeight: _num('viewbox-height', 100),
                signal: signalPrefix,
                readonly: isReadonly,
                theme,
                fontEmbedUrls,
                palette,
            };

            const { resolveColor: _rc } = drawing;

            const controller = new DrawingController(el, config, {
                onStateChange: (patch) => {
                    const globalPatch = {};
                    for (const [key, value] of Object.entries(patch)) {
                        try { sp['$$' + key] = value; } catch(e) {}
                        globalPatch[signalPrefix + '_' + key] = value;
                    }
                    // Tokens aren't valid CSS — resolve to hex for data-bind inputs
                    const th = patch.theme ?? sp['$$theme'] ?? 'light';
                    if ('stroke_color' in patch) {
                        const css = _rc(String(patch.stroke_color), th);
                        globalPatch[signalPrefix + '_stroke_color_css'] = css;
                        try { sp['$$stroke_color_css'] = css; } catch(e) {}
                    }
                    if ('fill_color' in patch) {
                        const css = patch.fill_color ? _rc(String(patch.fill_color), th) : '';
                        globalPatch[signalPrefix + '_fill_color_css'] = css;
                        try { sp['$$fill_color_css'] = css; } catch(e) {}
                    }
                    if ('theme' in patch) {
                        const sc = patch.stroke_color ?? sp['$$stroke_color'] ?? '';
                        const fc = patch.fill_color ?? sp['$$fill_color'] ?? '';
                        globalPatch[signalPrefix + '_stroke_color_css'] = _rc(String(sc), th);
                        globalPatch[signalPrefix + '_fill_color_css'] = fc ? _rc(String(fc), th) : '';
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
                setTheme: (t) => controller.setTheme(t),
                prefetchFonts: () => controller.prefetchFonts(),
            };
            Object.assign(el, methods);

            onCleanup(() => {
                controller.destroy();
            });
        """),
    )


def _divider(**kw):
    return Div(cls="toolbar-divider", **kw)


def _popover(trigger, *children, panel_id: str, show_expr, **panel_kw):
    return Div(
        trigger,
        Div(*children, id=panel_id, data_show=show_expr, cls="toolbar-popover", **panel_kw),
        cls="popover-anchor",
    )


def _swatch_grid(swatches, *, on_click, selected, picker=None, prefix=None, token_prefix=None):
    items: list[Any] = list(prefix) if prefix else []
    for i, (c, n) in enumerate(swatches):
        value = f"{token_prefix}{i}" if token_prefix else c
        items.append(
            Button(
                data_on_click=on_click(value),
                data_class_selected=selected(value),
                style=f"background-color: {c}",
                cls="color-swatch",
                title=n,
            )
        )
    if picker:
        items.append(picker)
    return Div(*items, cls="swatch-grid")


def _btn_row(options, *, on_click, selected, label=None):
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
    kw = {"data_show": show} if show is not None else {}
    return Div(
        Span(label, cls="panel-label"),
        content,
        cls="panel-section",
        **kw,
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
    show_file_actions: bool = True,
    show_styles: bool = True,
    palette: dict[str, dict[str, list[tuple[str, str]]]] | None = None,
    highlighter_colors: list[tuple[str, str]] | None = None,
    width_presets: tuple[int, ...] | None = None,
    tool_groups: list[list[tuple[str, str]]] | None = None,
    font_options: list[tuple[str, str]] | None = None,
    font_sizes: list[tuple[str, str]] | None = None,
    arrowhead_options: list[tuple[str, str]] | None = None,
) -> Any:
    """Compact toolbar with popover panels for a drawing canvas."""
    pal = palette or DEFAULT_PALETTE
    colors = pal["stroke"]["light"]
    dark_colors = pal["stroke"]["dark"]
    fills = pal["fill"]["light"]
    dark_fills = pal["fill"]["dark"]
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
    selected_is_highlighter = canvas.selected_is_highlighter

    style_open = canvas.signal("style_open", False, type_=bool)
    color_open = canvas.signal("color_open", False, type_=bool)
    file_open = canvas.signal("file_open", False, type_=bool)
    text_seen = canvas.signal("text_seen", False, type_=bool)
    arrow_seen = canvas.signal("arrow_seen", False, type_=bool)

    is_text_ctx = (tool == "text") | text_editing | selected_is_text
    is_shape_ctx = (tool == "rect") | (tool == "ellipse") | (tool == "diamond")
    has_stroke_style = (tool != "pen") & (tool != "highlighter") & (tool != "eraser")
    show_width = ~is_text_ctx
    show_stroke = has_stroke_style & ~is_text_ctx
    tool_set = set(tools)
    bar_items: list[Any] = []

    # File menu goes first (far left), matching Excalidraw/tldraw convention
    if show_file_actions:
        file_input_id = f"{canvas._name}-svg-import"
        file_trigger = Button(
            Icon("lucide:ellipsis-vertical", size=20),
            data_on_click=[file_open.toggle(), color_open.set(False), style_open.set(False)],
            cls="tool-btn",
            title="File menu",
        )
        file_panel = Div(
            Input(
                type="file",
                accept=".svg,image/svg+xml",
                id=file_input_id,
                style="display:none",
                data_on_change=js(
                    "const file = evt.target.files[0];"
                    "if (!file) return;"
                    f"file.text().then(text => {{ {canvas.import_svg(js('text'))}; evt.target.value = '' }})"
                ),
            ),
            Label(
                Icon("lucide:folder-open", size=16),
                Span("Open SVG", cls="file-menu-label"),
                fr=file_input_id,
                data_on_click=file_open.set(False),
                cls="file-menu-btn",
            ),
            Button(
                Icon("lucide:download", size=16),
                Span("Save SVG", cls="file-menu-label"),
                data_on_click=[
                    js(
                        f"{canvas.export_svg()}.then(svg => {{"
                        "if (!svg) return;"
                        "const blob = new Blob([svg], {type: 'image/svg+xml'});"
                        "const url = URL.createObjectURL(blob);"
                        "const a = Object.assign(document.createElement('a'),"
                        " {href: url, download: 'drawing.svg'});"
                        "a.click();"
                        "URL.revokeObjectURL(url)"
                        "})"
                    ),
                    file_open.set(False),
                ],
                cls="file-menu-btn",
            ),
            cls="file-menu",
        )
        bar_items.append(
            _popover(file_trigger, file_panel, panel_id=f"{canvas._name}-file-panel", show_expr=file_open),
        )

    for group in groups:
        btns = []
        for tid, tip in group:
            if tid not in tool_set:
                continue
            if tid == "arrow":
                style_actions = [style_open.set(~arrow_seen), arrow_seen.set(True)]
            elif tid == "text":
                style_actions = [style_open.set(~text_seen), text_seen.set(True)]
            else:
                style_actions = [style_open.set(False)]
            btns.append(
                Button(
                    Icon(_TOOL_ICONS[tid], size=20),
                    data_on_click=[canvas.switch_tool(tid), *style_actions, color_open.set(False)],
                    data_class_selected=tool == tid,
                    cls="tool-btn",
                    title=tip,
                )
            )
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
        stroke_color_css = canvas.stroke_color_css
        fill_color_css = canvas.fill_color_css
        color_trigger = Div(
            Div(
                cls="color-trigger-fill",
                data_attr_style=fill_enabled.if_("background-color:" + fill_color_css, "display:none"),
            ),
            cls="color-trigger",
            data_on_click=[color_open.toggle(), style_open.set(False), file_open.set(False)],
            data_attr_style="background-color:" + stroke_color_css,
            title="Colors",
            role="button",
            tabindex="0",
            aria_label="Stroke and fill colors",
        )

        theme = canvas.theme

        def stroke_click(c):
            return canvas.set_style_property("stroke_color", c)

        def stroke_sel(c):
            return stroke_color == c

        def fill_click(c):
            return [
                canvas.set_style_property("fill_color", c),
                canvas.set_style_property("fill_enabled", True),
            ]

        def fill_sel(c):
            return (fill_color == c) & fill_enabled

        # Factories — each theme needs its own DOM nodes
        def _stroke_picker():
            return Input(
                type="color",
                data_bind=stroke_color_css,
                data_on_input=canvas.set_style_property("stroke_color", evt.target.value),
                cls="color-picker",
                title="Custom stroke color",
                aria_label="Custom stroke color",
            )

        def _fill_picker():
            return Input(
                type="color",
                data_bind=fill_color_css,
                data_on_input=[
                    canvas.set_style_property("fill_color", evt.target.value),
                    canvas.set_style_property("fill_enabled", True),
                ],
                cls="color-picker",
                title="Custom fill color",
                aria_label="Custom fill color",
            )

        def _no_fill():
            return Button(
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
                Div(
                    Div(
                        _swatch_grid(
                            colors,
                            on_click=stroke_click,
                            selected=stroke_sel,
                            picker=_stroke_picker(),
                            token_prefix="palette-stroke-",
                        ),
                        data_show=theme == "light",
                    ),
                    Div(
                        _swatch_grid(
                            dark_colors,
                            on_click=stroke_click,
                            selected=stroke_sel,
                            picker=_stroke_picker(),
                            token_prefix="palette-stroke-",
                        ),
                        data_show=theme == "dark",
                    ),
                ),
            ),
            _panel_section(
                "Fill",
                Div(
                    Div(
                        _swatch_grid(
                            fills,
                            on_click=fill_click,
                            selected=fill_sel,
                            picker=_fill_picker(),
                            prefix=[_no_fill()],
                            token_prefix="palette-fill-",
                        ),
                        data_show=theme == "light",
                    ),
                    Div(
                        _swatch_grid(
                            dark_fills,
                            on_click=fill_click,
                            selected=fill_sel,
                            picker=_fill_picker(),
                            prefix=[_no_fill()],
                            token_prefix="palette-fill-",
                        ),
                        data_show=theme == "dark",
                    ),
                ),
                show=is_shape_ctx | ((tool == "select") & ~selected_is_text),
            ),
            _panel_section(
                "Highlighter",
                _swatch_grid(
                    highlighters,
                    on_click=lambda c: canvas.set_style_property("stroke_color", c),
                    selected=lambda c: stroke_color == c,
                ),
                show=(tool == "highlighter") | selected_is_highlighter,
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
            data_on_click=[style_open.toggle(), color_open.set(False), file_open.set(False)],
            data_class_selected=style_open,
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
                on_input=canvas.set_style_property("dash_length", evt.target.value),
                min="2",
                max="12",
                step="1",
                show=show_stroke & (dash_length >= 1),
            ),
            _labeled_slider(
                "Dot spacing",
                signal=dash_gap,
                on_input=canvas.set_style_property("dash_gap", evt.target.value),
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
            _popover(style_trigger, *style_panel, panel_id=f"{canvas._name}-style-panel", show_expr=style_open),
        )

    # Preseed so data-bind inputs don't evaluate to undefined before component init
    preseed_sigs = [stroke_color, fill_color, fill_enabled, color_open, style_open, file_open, text_seen, arrow_seen]
    if show_colors:
        preseed_sigs.extend([stroke_color_css, fill_color_css])
    preseed = {sig._id: sig._initial for sig in preseed_sigs}

    return Div(
        Div(*bar_items, cls="toolbar-bar"),
        cls="toolbar-island",
        data_signals=preseed,
        data_on_click=([color_open.set(False), style_open.set(False), file_open.set(False)], {"outside": True}),
    )


def annotation_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for annotation use cases."""
    return drawing_toolbar(canvas, tools=("pen", "highlighter", "eraser"), **kw)


def diagram_toolbar(canvas, **kw: Any) -> Any:
    """Toolbar preset for diagramming use cases."""
    return drawing_toolbar(canvas, tools=("select", "line", "arrow", "rect", "ellipse", "diamond", "text"), **kw)
