/** Semantic color tokens for theme-aware palettes.
 *
 * Elements store tokens like "palette-stroke-0" instead of literal colors.
 * Renderers resolve tokens to CSS colors per theme at render time.
 */

import type { PaletteData, Theme } from "./types.js";

const STROKE_PREFIX = "palette-stroke-";
const FILL_PREFIX = "palette-fill-";

export const DEFAULT_STROKE_TOKEN = `${STROKE_PREFIX}0`;

export const DEFAULT_PALETTE: PaletteData = {
  stroke: {
    light: ["#1a1a2e", "#5c5f6e", "#d94040", "#e8772a", "#c49b1a", "#2d9e5e", "#3568d4", "#7c4dca", "#d4507a", "#a0603a"],
    dark:  ["#e4e4e7", "#a1a1aa", "#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa", "#a78bfa", "#f472b6", "#d4a574"],
  },
  fill: {
    light: ["#ffffff", "#e8e3db", "#fecdd3", "#fed7aa", "#fef3c7", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fce7f3", "#e8d5c4"],
    dark:  ["#2a2a3e", "#3a3a4e", "#4c1d1d", "#4c3319", "#4c4419", "#1a3d2e", "#1a2d4c", "#2d1a4c", "#4c1a3a", "#3d2d1a"],
  },
};

let currentPalette: PaletteData = DEFAULT_PALETTE;

let reverseLookups: Record<Theme, Map<string, string>> = {
  light: new Map(),
  dark: new Map(),
};

function rebuildReverseLookups(): void {
  for (const theme of ["light", "dark"] as Theme[]) {
    const map = new Map<string, string>();
    const strokes = currentPalette.stroke[theme];
    for (let i = 0; i < strokes.length; i++) {
      map.set(strokes[i].toLowerCase(), `${STROKE_PREFIX}${i}`);
    }
    const fills = currentPalette.fill[theme];
    for (let i = 0; i < fills.length; i++) {
      map.set(fills[i].toLowerCase(), `${FILL_PREFIX}${i}`);
    }
    reverseLookups[theme] = map;
  }
}

rebuildReverseLookups();

export function setPalette(palette: PaletteData): void {
  currentPalette = palette;
  rebuildReverseLookups();
}

export function isToken(color: string): boolean {
  return color.startsWith(STROKE_PREFIX) || color.startsWith(FILL_PREFIX);
}

export function resolveColor(color: string, theme: Theme): string {
  if (color.startsWith(STROKE_PREFIX)) {
    const idx = parseInt(color.slice(STROKE_PREFIX.length), 10);
    const colors = currentPalette.stroke[theme];
    return colors[idx] ?? colors[0] ?? color;
  }
  if (color.startsWith(FILL_PREFIX)) {
    const idx = parseInt(color.slice(FILL_PREFIX.length), 10);
    const colors = currentPalette.fill[theme];
    return colors[idx] ?? colors[0] ?? color;
  }
  return color;
}

export function hexToToken(hex: string, theme: Theme): string {
  if (!hex || isToken(hex)) return hex;
  return reverseLookups[theme].get(hex.toLowerCase()) ?? hex;
}
