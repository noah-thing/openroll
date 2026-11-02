import { fontStack, safeFont, snapWeight } from "../core/fonts";
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
/** Past this a canvas silently draws nothing, and a texture will not upload. */
const MAX_SIDE = 8192;

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const STRONG = /\p{L}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A paragraph reads right to left when its first letter does. */
export function isRtl(paragraph: string): boolean {
  const first = paragraph.match(STRONG)?.[0];
  return !!first && RTL.test(first);
}

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

  const out = { ...layout(style, text, highlight, highlightColor, maxWidth, Math.max(0.1, scale)), key };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return out;
}

function layout(style: TextStyle, text: string, highlight: number, highlightColor: string | undefined, maxWidth: number, s: number, shrunk = false): RasterText {
  const family = safeFont(style.font);
  const font = `${snapWeight(family, style.weight)} ${style.size * s}px ${fontStack(family)}`;
  const probe = new OffscreenCanvas(1, 1).getContext("2d")!;
  probe.font = font;
  if ("letterSpacing" in probe) probe.letterSpacing = `${style.letterSpacing * s}px`;

  const words = text.split(/(\s+)/);
  const lines = wrap(probe, words, maxWidth * s, text.split("\n").map(isRtl));
  const lineH = style.size * style.lineHeight * s;
  const pad = (style.background?.padding ?? 0) * s + (style.stroke?.width ?? 0) * s + (style.shadow ? (style.shadow.blur + Math.abs(style.shadow.x) + Math.abs(style.shadow.y)) * s : 0);
  const textW = Math.max(1, ...lines.map(l => l.width));
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(lines.length * lineH + pad * 2);

  // Hostile or careless sizes: draw smaller, and report the project size it still stands for.
  const over = Math.max(w, h);
  if (over > MAX_SIDE && !shrunk) return layout(style, text, highlight, highlightColor, maxWidth, (s * MAX_SIDE) / over, true);

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

  lines.forEach((line, li) => {
    const y = pad + li * lineH + lineH / 2;
    let x = style.align === "left" ? pad : style.align === "right" ? w - pad - line.width : (w - line.width) / 2;
    // Words of a right to left line sit from the right edge, so they are laid out in reverse.
    for (const piece of line.rtl ? [...line.pieces].reverse() : line.pieces) {
      const pw = g.measureText(piece.text).width;
      if (piece.word >= 0) {
        const hot = piece.word === highlight;
        if (style.shadow) {
          g.shadowColor = style.shadow.color;
          g.shadowBlur = style.shadow.blur * s;
          g.shadowOffsetX = style.shadow.x * s;
          g.shadowOffsetY = style.shadow.y * s;
        }
        if (style.stroke && style.stroke.width > 0) {
          g.strokeStyle = style.stroke.color;
          g.lineWidth = style.stroke.width * 2 * s;
          g.strokeText(piece.text, x, y);
          g.shadowColor = "transparent";
        }
        g.fillStyle = hot && highlightColor ? highlightColor : style.color;
        g.fillText(piece.text, x, y);
        g.shadowColor = "transparent";
      }
      x += pw;
    }
  });

  return { canvas, width: w / s, height: h / s, key: "" };
}

interface Piece {
  text: string;
  /** Position among the spoken words, so a long word cut over lines keeps one highlight. -1 for a space. */
  word: number;
}

interface Line {
  pieces: Piece[];
  width: number;
  rtl: boolean;
}

export function wrap(g: OffscreenCanvasRenderingContext2D, tokens: string[], max: number, rtl: boolean[]): Line[] {
  const lines: Line[] = [];
  let paragraph = 0;
  let word = 0;
  let cur: Line = { pieces: [], width: 0, rtl: rtl[0] };
  const flush = () => {
    lines.push(trimLine(g, cur));
    cur = { pieces: [], width: 0, rtl: rtl[paragraph] ?? false };
  };
  for (const token of tokens) {
    const space = /^\s+$/.test(token);
    if (token.includes("\n")) {
      paragraph += token.split("\n").length - 1;
      flush();
      continue;
    }
    const w = g.measureText(token).width;
    if (space) {
      if (cur.pieces.length) {
        cur.pieces.push({ text: token, word: -1 });
        cur.width += w;
      }
      continue;
    }
    const index = word++;
    if (cur.width + w > max && cur.pieces.length) flush();
    if (w <= max) {
      cur.pieces.push({ text: token, word: index });
      cur.width += w;
      continue;
    }
    // A run with no spaces that is wider than the frame, such as Chinese or one very long word, breaks between characters.
    for (const { segment } of graphemes.segment(token)) {
      const sw = g.measureText(segment).width;
      if (cur.width + sw > max && cur.pieces.length) flush();
      cur.pieces.push({ text: segment, word: index });
      cur.width += sw;
    }
  }
  lines.push(trimLine(g, cur));
  return lines;
}

function trimLine(g: OffscreenCanvasRenderingContext2D, line: Line): Line {
  while (line.pieces.length && line.pieces.at(-1)!.word < 0) line.width -= g.measureText(line.pieces.pop()!.text).width;
  return line;
}

function roundRect(g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
