/** Font fetching, caching, and CSS generation for SVG export. */

const fontCache = new Map<string, string>();

const MAX_CONCURRENT = 3;

async function fetchAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked to avoid blowing the call stack with String.fromCharCode(...largeArray)
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

function parseFontFaceBlocks(css: string): string[] {
  return Array.from(css.matchAll(/@font-face\s*\{[^}]+\}/g), m => m[0]);
}

function extractWoff2Url(block: string): string | null {
  // Prefer format('woff2') declaration, fall back to .woff2 extension
  const m = block.match(/url\(([^)]+)\)\s*format\(['"]woff2['"]\)/);
  if (m) return m[1].replace(/['"]/g, "");
  const m2 = block.match(/url\(([^)]*\.woff2[^)]*)\)/);
  if (m2) return m2[1].replace(/['"]/g, "");
  return null;
}

/** Parse a CSS unicode-range value into an array of [start, end] codepoint pairs. */
function parseUnicodeRange(block: string): Array<[number, number]> {
  const m = block.match(/unicode-range:\s*([^;]+)/);
  if (!m) return [];
  return m[1].split(",").flatMap(part => {
    const range = part.trim().match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
    if (!range) return [];
    const start = parseInt(range[1], 16);
    const end = range[2] ? parseInt(range[2], 16) : start;
    return [[start, end] as [number, number]];
  });
}

/** Check if any codepoint in the set falls within this block's unicode-range. */
function subsetMatchesCodepoints(block: string, codepoints: Set<number>): boolean {
  const ranges = parseUnicodeRange(block);
  if (ranges.length === 0) return true; // No unicode-range = include by default
  for (const cp of codepoints) {
    for (const [start, end] of ranges) {
      if (cp >= start && cp <= end) return true;
    }
  }
  return false;
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  // Safe: JS is single-threaded so next++ completes before any await yields
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/** Results are cached per URL — safe to call repeatedly. */
export async function fetchFontCSS(cssUrl: string): Promise<string> {
  const cached = fontCache.get(cssUrl);
  if (cached !== undefined) return cached;

  const resp = await fetch(cssUrl);
  if (!resp.ok) throw new Error(`Failed to fetch font CSS from ${cssUrl}: ${resp.status}`);
  const cssText = await resp.text();

  const blocks = parseFontFaceBlocks(cssText);
  if (blocks.length === 0) {
    fontCache.set(cssUrl, "");
    return "";
  }

  const inlinedBlocks = await runWithConcurrency(
    blocks.map((block) => async () => {
      const woff2Url = extractWoff2Url(block);
      if (!woff2Url) return block;
      try {
        const b64 = await fetchAsBase64(woff2Url);
        return block.replace(woff2Url, `data:font/woff2;base64,${b64}`);
      } catch {
        return block; // Keep original URL on failure
      }
    }),
    MAX_CONCURRENT,
  );

  const result = inlinedBlocks.join("\n");
  fontCache.set(cssUrl, result);
  return result;
}

/** Build embedded @font-face CSS, filtered to only unicode-range subsets containing used characters. */
export async function buildFontStyleForExport(
  usedFamilies: Set<string>,
  embedUrls: Record<string, string>,
  usedCodepoints?: Set<number>,
): Promise<string> {
  const parts: string[] = [];

  for (const family of usedFamilies) {
    const url = embedUrls[family];
    if (!url) continue; // System font or no URL configured
    try {
      const css = await fetchFontCSS(url);
      if (!css) continue;
      if (usedCodepoints && usedCodepoints.size > 0) {
        // Filter to only subsets that contain characters actually used
        const blocks = parseFontFaceBlocks(css);
        for (const block of blocks) {
          if (subsetMatchesCodepoints(block, usedCodepoints)) parts.push(block);
        }
      } else {
        parts.push(css);
      }
    } catch {
      // Graceful degradation: export without this font
    }
  }

  return parts.join("\n");
}

export async function prefetchFonts(embedUrls: Record<string, string>): Promise<void> {
  const tasks = Object.values(embedUrls).map((url) => async () => {
    try {
      await fetchFontCSS(url);
    } catch {
      // Ignore failures during prefetch
    }
  });
  await runWithConcurrency(tasks, MAX_CONCURRENT);
}
