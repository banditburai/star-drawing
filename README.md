# star-drawing

SVG drawing canvas web component for [StarHTML](https://github.com/banditburai/starhtml) and [Datastar](https://data-star.dev/).

One `app.register()` call gives you a `<drawing-canvas>` custom element with drawing, shape, text, and annotation tools — plus a reactive toolbar wired to the canvas state. Built on [starelements](https://github.com/banditburai/starelements), so each canvas instance gets its own scoped signal namespace.

## Why?

Adding a drawing surface to a web app typically means choosing a JS canvas library, wiring up toolbars, managing undo state, and handling pointer events yourself. `star-drawing` wraps all of that into a single starelements component — import it, register it, and you have a working canvas with 10 tools, undo/redo, keyboard shortcuts, and collaboration hooks.

## Features

- **Full drawing toolkit** — pen, highlighter, line, arrow, rectangle, ellipse, diamond, text, and eraser tools out of the box.
- **WYSIWYG text editing** — click to place text, edit inline with font family, size, and alignment options.
- **Toolbar presets** — `drawing_toolbar()` for the full suite, `annotation_toolbar()` for markup, `diagram_toolbar()` for shapes and connectors.
- **Undo/redo and keyboard shortcuts** — Ctrl+Z, Ctrl+Y, Delete, Ctrl+A, Ctrl+D, and arrow-key nudging all wired up.
- **SVG export/import** — `export_svg()` and `import_svg()` for serialization and persistence.
- **Scoped signals** — built on starelements, so each canvas instance has its own signal namespace. No cross-instance interference.
- **Collaboration-ready** — `onElementChange` callback and `applyRemoteChanges` method for syncing state across clients.
- **Configurable palettes** — stroke colors, fill colors, highlighter colors, width presets, font options, and arrowhead styles are all customizable.
- **Readonly mode** — set the `readonly` attribute for view-only canvases.
- **Skeleton loading** — shimmer placeholder shown until the component initializes, preventing layout shift.

## Installation

Requires Python 3.12+ and [StarHTML](https://github.com/banditburai/starhtml).

```
pip install star-drawing
```

## Quick Start

```python
from starhtml import *
from star_drawing import DrawingCanvas, drawing_toolbar

app, rt = star_app()
app.register(DrawingCanvas)

@rt("/")
def index():
    canvas = DrawingCanvas(cls="drawing-container")
    return Div(
        drawing_toolbar(canvas),
        canvas,
    )

serve()
```

This gives you a full-featured drawing canvas with all tools, color palettes, style options, and undo/redo.

## Toolbar Presets

For focused use cases, use a preset instead of the full toolbar:

```python
# Annotation — pen, highlighter, eraser only
annotation_toolbar(canvas)

# Diagramming — select, shapes, lines, arrows, text
diagram_toolbar(canvas)
```

Both presets accept the same keyword arguments as `drawing_toolbar()` for further customization.

## Configuration

Attributes on `<drawing-canvas>` control defaults:

| Attribute | Default | Description |
|---|---|---|
| `default-tool` | `"pen"` | Initial active tool |
| `default-stroke-color` | `"#1a1a2e"` | Initial stroke color |
| `default-fill-color` | `"#ffffff"` | Initial fill color |
| `default-stroke-width` | `2` | Initial stroke width in px |
| `default-opacity` | `1` | Initial element opacity |
| `default-layer` | `"default"` | Initial active layer |
| `throttle-ms` | `16` | Input throttle interval |
| `readonly` | — | Disables all drawing interaction |

Set these as element attributes in Python:

```python
DrawingCanvas(
    default_tool="select",
    default_stroke_color="#3568d4",
    default_stroke_width=4,
    readonly=True,
)
```

## Toolbar Customization

`drawing_toolbar()` accepts keyword arguments to override defaults:

```python
drawing_toolbar(
    canvas,
    tools=("pen", "line", "rect", "text"),        # subset of tools to show
    show_colors=True,                               # color palette panel
    show_styles=True,                               # style options panel
    show_undo=True,                                 # undo/redo/clear buttons
    color_palette=[("#000", "Black"), ("#fff", "White")],
    width_presets=(1, 2, 4, 8),
)
```

## Development

TypeScript sources live in `typescript/` and are bundled with bun:

```
bun run build                          # build drawing-canvas.js
bun run dev                            # watch mode

uv run ruff check src/ tests/          # lint Python
uv run ruff format --check src/        # check formatting
npx tsc --noEmit                       # type-check TypeScript
```

The hatch build hook runs `bun run build` automatically during `pip install` / `uv build`, so the generated JS is never checked into git.

## License

[Apache 2.0](LICENSE)
