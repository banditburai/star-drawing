"""Tests for DrawingCanvas component and toolbar generation."""

import json

from star_drawing import (
    ARROWHEAD_OPTIONS,
    DEFAULT_PALETTE,
    HIGHLIGHTER_COLORS,
    STATIC_DIR,
    TOOL_GROUPS,
    DrawingCanvas,
    annotation_toolbar,
    diagram_toolbar,
    drawing_toolbar,
    palette_json,
)

# ---------------------------------------------------------------------------
# Palettes and data
# ---------------------------------------------------------------------------


def test_default_palette_structure():
    assert "stroke" in DEFAULT_PALETTE
    assert "fill" in DEFAULT_PALETTE
    for kind in ("stroke", "fill"):
        for theme in ("light", "dark"):
            entries = DEFAULT_PALETTE[kind][theme]
            assert len(entries) >= 5, f"{kind}/{theme} palette should have at least 5 entries"
            for color, name in entries:
                assert color.startswith("#"), f"{kind}/{theme}: {name} color should be hex"
                assert len(name) > 0


def test_no_duplicate_colors_in_default_palette():
    for kind in ("stroke", "fill"):
        for theme in ("light", "dark"):
            colors = [c for c, _ in DEFAULT_PALETTE[kind][theme]]
            assert len(colors) == len(set(colors)), f"Duplicate colors in {kind}/{theme}"


def test_palette_light_dark_same_length():
    for kind in ("stroke", "fill"):
        light = DEFAULT_PALETTE[kind]["light"]
        dark = DEFAULT_PALETTE[kind]["dark"]
        assert len(light) == len(dark), f"{kind} palette light/dark length mismatch"


def test_palette_json_strips_names():
    result = json.loads(palette_json(DEFAULT_PALETTE))
    for kind in ("stroke", "fill"):
        for theme in ("light", "dark"):
            for color in result[kind][theme]:
                assert isinstance(color, str)
                assert color.startswith("#")


def test_palette_json_custom():
    custom = {
        "stroke": {"light": [("#aaa", "A")], "dark": [("#bbb", "B")]},
        "fill": {"light": [("#ccc", "C")], "dark": [("#ddd", "D")]},
    }
    result = json.loads(palette_json(custom))
    assert result["stroke"]["light"] == ["#aaa"]
    assert result["stroke"]["dark"] == ["#bbb"]
    assert result["fill"]["light"] == ["#ccc"]
    assert result["fill"]["dark"] == ["#ddd"]
    # Verify defaults aren't leaking in
    default_stroke = DEFAULT_PALETTE["stroke"]["light"][0][0]
    assert default_stroke not in result["stroke"]["light"]


def test_highlighter_colors_exist():
    assert len(HIGHLIGHTER_COLORS) >= 3
    for color, _name in HIGHLIGHTER_COLORS:
        assert color.startswith("#")


def test_arrowhead_options_include_none():
    values = [v for _, v in ARROWHEAD_OPTIONS]
    assert "none" in values


def test_tool_groups_cover_all_standard_tools():
    all_tools = {tid for group in TOOL_GROUPS for tid, _ in group}
    expected = {"select", "pen", "line", "arrow", "rect", "ellipse", "diamond", "text", "highlighter", "eraser"}
    assert all_tools == expected


def test_static_dir_points_to_package_static():
    assert STATIC_DIR.name == "static"
    assert STATIC_DIR.parent.name == "star_drawing"


# ---------------------------------------------------------------------------
# Component
# ---------------------------------------------------------------------------


def test_drawing_canvas_creates_element():
    canvas = DrawingCanvas(name="test_canvas")
    assert canvas is not None
    assert canvas._name == "test_canvas"


def test_drawing_canvas_default_name():
    canvas = DrawingCanvas(name="drawing")
    assert canvas._name == "drawing"


def test_drawing_canvas_exposes_signals():
    canvas = DrawingCanvas(name="c")
    assert canvas.tool is not None
    assert canvas.stroke_color is not None
    assert canvas.can_undo is not None
    assert canvas.opacity is not None


def test_drawing_canvas_exposes_methods():
    canvas = DrawingCanvas(name="c")
    assert canvas.switch_tool is not None
    assert canvas.undo is not None
    assert canvas.redo is not None
    assert canvas.clear is not None
    assert canvas.export_svg is not None
    assert canvas.set_theme is not None
    assert canvas.prefetch_fonts is not None


def test_drawing_canvas_exposes_theme_signal():
    canvas = DrawingCanvas(name="c")
    assert canvas.theme is not None


# ---------------------------------------------------------------------------
# Toolbar generation
# ---------------------------------------------------------------------------


def test_drawing_toolbar_returns_toolbar_island():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas)
    html = str(toolbar)
    assert "toolbar-island" in html
    assert "toolbar-bar" in html


def test_drawing_toolbar_contains_tool_buttons():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, tools=("pen", "line", "rect"))
    html = str(toolbar)
    assert "lucide:pencil" in html
    assert "lucide:minus" in html
    assert "lucide:square" in html


def test_drawing_toolbar_excludes_unselected_tools():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, tools=("pen",))
    html = str(toolbar)
    assert "lucide:pencil" in html
    assert "lucide:eraser" not in html
    assert "lucide:square" not in html


def test_drawing_toolbar_undo_redo_buttons():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_undo=True, show_colors=False, show_styles=False)
    html = str(toolbar)
    assert "lucide:undo-2" in html
    assert "lucide:redo-2" in html
    assert "lucide:trash-2" in html


def test_drawing_toolbar_hide_undo():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_undo=False, show_colors=False, show_styles=False)
    html = str(toolbar)
    assert "lucide:undo-2" not in html


def test_drawing_toolbar_file_menu():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_file_actions=True, show_undo=False, show_colors=False, show_styles=False)
    html = str(toolbar)
    assert "lucide:ellipsis-vertical" in html
    assert "lucide:folder-open" in html
    assert "lucide:download" in html
    assert "Open SVG" in html  # no ellipsis — modern style
    assert "Save SVG" in html
    assert "t-svg-import" in html  # hidden file input ID
    assert "t-file-panel" in html  # popover panel ID


def test_drawing_toolbar_file_menu_default_on():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas)
    html = str(toolbar)
    assert "lucide:ellipsis-vertical" in html
    assert "file-menu" in html


def test_drawing_toolbar_hide_file_actions():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_file_actions=False)
    html = str(toolbar)
    assert "lucide:ellipsis-vertical" not in html
    assert "file-menu" not in html


def test_drawing_toolbar_file_menu_export_js():
    canvas = DrawingCanvas(name="demo")
    toolbar = drawing_toolbar(canvas, show_file_actions=True, show_undo=False, show_colors=False, show_styles=False)
    html = str(toolbar)
    assert "$demo.exportSvg()" in html
    assert ".then(svg" in html  # async via .then() (Datastar doesn't support await)
    assert "drawing.svg" in html  # download filename


def test_drawing_toolbar_file_menu_import_js():
    canvas = DrawingCanvas(name="demo")
    toolbar = drawing_toolbar(canvas, show_file_actions=True, show_undo=False, show_colors=False, show_styles=False)
    html = str(toolbar)
    assert "$demo.importSvg(text)" in html
    assert ".svg,image/svg+xml" in html  # file accept filter


def test_drawing_toolbar_color_panel():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_colors=True, show_styles=False)
    html = str(toolbar)
    assert "color-trigger" in html
    assert "color-swatch" in html


def test_drawing_toolbar_custom_palette():
    canvas = DrawingCanvas(name="t")
    custom = {
        "stroke": {
            "light": [("#ff0000", "Red"), ("#00ff00", "Green")],
            "dark": [("#ff6666", "Light Red"), ("#66ff66", "Light Green")],
        },
        "fill": {
            "light": [("#ffffff", "White")],
            "dark": [("#333333", "Dark")],
        },
    }
    toolbar = drawing_toolbar(canvas, palette=custom, show_styles=False)
    html = str(toolbar)
    assert "#ff0000" in html
    assert "#00ff00" in html


def test_drawing_toolbar_style_panel():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_styles=True, show_colors=False)
    html = str(toolbar)
    assert "lucide:sliders-horizontal" in html
    assert "style-btn" in html


def test_drawing_toolbar_uses_palette_tokens():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_styles=False)
    html = str(toolbar)
    assert "palette-stroke-0" in html
    assert "palette-fill-0" in html


# ---------------------------------------------------------------------------
# Toolbar presets
# ---------------------------------------------------------------------------


def test_annotation_toolbar_has_pen_highlighter_eraser():
    canvas = DrawingCanvas(name="a")
    toolbar = annotation_toolbar(canvas)
    html = str(toolbar)
    assert "lucide:pencil" in html
    assert "lucide:highlighter" in html
    assert "lucide:eraser" in html
    assert "lucide:square" not in html
    assert "lucide:type" not in html


def test_diagram_toolbar_has_shapes_and_text():
    canvas = DrawingCanvas(name="d")
    toolbar = diagram_toolbar(canvas)
    html = str(toolbar)
    assert "lucide:mouse-pointer-2" in html  # select
    assert "lucide:square" in html  # rect
    assert "lucide:circle" in html  # ellipse
    assert "lucide:type" in html  # text
    assert "lucide:pencil" not in html  # no pen
    assert "lucide:eraser" not in html  # no eraser
