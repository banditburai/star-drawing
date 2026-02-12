"""Tests for DrawingCanvas component and toolbar generation."""

from star_drawing import (
    ARROWHEAD_OPTIONS,
    COLOR_PALETTE,
    FILL_PALETTE,
    HIGHLIGHTER_COLORS,
    STATIC_DIR,
    TOOL_GROUPS,
    DrawingCanvas,
    annotation_toolbar,
    diagram_toolbar,
    drawing_toolbar,
)


# ---------------------------------------------------------------------------
# Palettes and data
# ---------------------------------------------------------------------------


def test_color_palette_entries_have_hex_and_name():
    for color, name in COLOR_PALETTE:
        assert color.startswith("#"), f"{name} color should be hex"
        assert len(name) > 0


def test_fill_palette_entries_have_hex_and_name():
    for color, name in FILL_PALETTE:
        assert color.startswith("#"), f"{name} color should be hex"
        assert len(name) > 0


def test_no_duplicate_colors_in_palettes():
    stroke_colors = [c for c, _ in COLOR_PALETTE]
    assert len(stroke_colors) == len(set(stroke_colors)), "Duplicate stroke colors"

    fill_colors = [c for c, _ in FILL_PALETTE]
    assert len(fill_colors) == len(set(fill_colors)), "Duplicate fill colors"


def test_highlighter_colors_exist():
    assert len(HIGHLIGHTER_COLORS) >= 3
    for color, name in HIGHLIGHTER_COLORS:
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


def test_drawing_toolbar_color_panel():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_colors=True, show_styles=False)
    html = str(toolbar)
    assert "color-trigger" in html
    assert "color-swatch" in html


def test_drawing_toolbar_custom_palette():
    canvas = DrawingCanvas(name="t")
    custom = [("#ff0000", "Red"), ("#00ff00", "Green")]
    toolbar = drawing_toolbar(canvas, color_palette=custom, show_styles=False)
    html = str(toolbar)
    assert "#ff0000" in html
    assert "#00ff00" in html


def test_drawing_toolbar_style_panel():
    canvas = DrawingCanvas(name="t")
    toolbar = drawing_toolbar(canvas, show_styles=True, show_colors=False)
    html = str(toolbar)
    assert "lucide:sliders-horizontal" in html
    assert "style-btn" in html


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
