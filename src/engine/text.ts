import type { TextStyle } from "../core/project";

export interface RasterText {
  canvas: OffscreenCanvas;
  /** Size in project pixels; the canvas itself is `scale` times larger. */
  width: number;
  height: number;
  key: string;
}

const cache = new Map<string, RasterText>();
const MAX_CACHE = 64;

/**
 * Lay out and draw text into a canvas. `maxWidth` is in project pixels; `scale` is how
 * many canvas pixels to spend per project pixel, so the preview can rasterise small and
 * the export at full size.
 */
export function rasterText(style: TextStyle, text: string, highlight: number, highlightColor: string | undefined, maxWidth: number, scale: number): RasterText {
  const key = JSON.stringify([style, text, highlight, highlightColor, Math.round(maxWidth), Math.round(scale * 100)]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const s = Math.max(0.1, scale);
  const font = `${style.weight} ${style.size * s}px ${quoteFamily(style.font)}`;
  const probe = new OffscreenCanvas(1, 1).getContext("2d")!;
  probe.font = font;
  if ("letterSpacing" in probe) probe.letterSpacing = `${style.letterSpacing * s}px`;

  const words = text.split(/(\s+)/);
  const lines = wrap(probe, words, maxWidth * s);
  const lineH = style.size * style.lineHeight * s;
  const pad = (style.background?.padding ?? 0) * s + (style.stroke?.width ?? 0) * s + (style.shadow ? (style.shadow.blur + Math.abs(style.shadow.x) + Math.abs(style.shadow.y)) * s : 0);
  const textW = Math.max(1, ...lines.map(l => l.width));
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(lines.length * lineH + pad * 2);

  const canvas = new OffscreenCanvas(Math.max(2, w), Math.max(2, h));
  const g = canvas.getContext("2d")!;
  g.font = font;
  if ("letterSpacing" in g) g.letterSpacing = `${style.letterSpacing * s}px`;
  g.textBaseline = "middle";
  g.lineJoin = "round";

  if (style.background) {
    g.fillStyle = style.background.color;
    roundRect(g, 0, 0, w, h, style.background.radius * s);
    g.fill();
  }

  let wordIndex = 0;
  lines.forEach((line, li) => {
    const y = pad + li * lineH + lineH / 2;
    let x = style.align === "left" ? pad : style.align === "right" ? w - pad - line.width : (w - line.width) / 2;
    for (const piece of line.pieces) {
      const isSpace = /^\s+$/.test(piece);
      const pw = g.measureText(piece).width;
      if (!isSpace) {
        const hot = wordIndex === highlight;
        if (style.shadow) {
          g.shadowColor = style.shadow.color;
          g.shadowBlur = style.shadow.blur * s;
          g.shadowOffsetX = style.shadow.x * s;
          g.shadowOffsetY = style.shadow.y * s;
        }
        if (style.stroke && style.stroke.width > 0) {
          g.strokeStyle = style.stroke.color;
          g.lineWidth = style.stroke.width * 2 * s;
          g.strokeText(piece, x, y);
          g.shadowColor = "transparent";
        }
        g.fillStyle = hot && highlightColor ? highlightColor : style.color;
        g.fillText(piece, x, y);
        g.shadowColor = "transparent";
        wordIndex++;
      }
      x += pw;
    }
  });

  const out: RasterText = { canvas, width: w / s, height: h / s, key };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return out;
}

interface Line {
  pieces: string[];
  width: number;
}

function wrap(g: OffscreenCanvasRenderingContext2D, pieces: string[], max: number): Line[] {
  const lines: Line[] = [];
  let cur: Line = { pieces: [], width: 0 };
  for (const piece of pieces) {
    if (piece.includes("\n")) {
      lines.push(trimLine(g, cur));
      cur = { pieces: [], width: 0 };
      continue;
    }
    const w = g.measureText(piece).width;
    if (cur.width + w > max && cur.pieces.length && !/^\s+$/.test(piece)) {
      lines.push(trimLine(g, cur));
      cur = { pieces: [], width: 0 };
    }
    if (!cur.pieces.length && /^\s+$/.test(piece)) continue;
    cur.pieces.push(piece);
    cur.width += w;
  }
  lines.push(trimLine(g, cur));
  return lines;
}

function trimLine(g: OffscreenCanvasRenderingContext2D, line: Line): Line {
  while (line.pieces.length && /^\s+$/.test(line.pieces.at(-1)!)) line.width -= g.measureText(line.pieces.pop()!).width;
  return line;
}

function roundRect(g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function quoteFamily(f: string): string {
  return f.split(",").map(part => {
    const p = part.trim();
    return /^(serif|sans-serif|monospace|system-ui|cursive)$/.test(p) || p.startsWith('"') ? p : `"${p}"`;
  }).join(", ");
}
