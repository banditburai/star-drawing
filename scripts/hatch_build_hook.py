"""Hatch build hook: compiles TypeScript to JavaScript before wheel creation."""

import shutil
import subprocess
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

BUILD_TIMEOUT = 30


class JavaScriptBuildError(Exception): ...


class CustomBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        root = Path(self.root)
        js_output = root / "src" / "star_drawing" / "static" / "drawing-canvas.js"

        if not (root / "typescript").exists():
            print("No typescript directory found, skipping JS build")
            return

        if not (root / "package.json").exists():
            print("No package.json found, skipping JS build")
            return

        if not shutil.which("bun"):
            print("bun not available, skipping JS build (expected in CI where JS is pre-built)")
            return

        print("Building JavaScript from TypeScript...")
        self._run_bun(root)
        self._verify_output(js_output)

        size = js_output.stat().st_size
        print(f"  Compiled drawing-canvas.js: {size:,} bytes")

        artifacts = build_data.setdefault("artifacts", [])
        rel = str(js_output.relative_to(root))
        if rel not in artifacts:
            artifacts.append(rel)

    @staticmethod
    def _run_bun(cwd: Path) -> None:
        result = subprocess.run(
            ["bun", "run", "build"],
            cwd=cwd, capture_output=True, text=True, timeout=BUILD_TIMEOUT, check=False,
        )
        if result.returncode != 0:
            raise JavaScriptBuildError(f"bun run build failed:\n{result.stderr}")

    @staticmethod
    def _verify_output(path: Path) -> None:
        if not path.exists() or path.stat().st_size == 0:
            raise JavaScriptBuildError(f"Output missing or empty: {path}")
