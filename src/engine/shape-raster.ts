import type { ShapeStyle } from "../core/project";
import { INK, LINE, RED, stickerById } from "../core/stickers";

export interface RasterShape {
  canvas: OffscreenCanvas;
  key: string;
}

const cache = new Map<string, RasterShape>();
const MAX_CACHE = 48;
const MAX_SIDE = 4096;

/**
 * Draw a shape or sticker at the pixel size it will be shown at. Sizes are rounded up to
 * a multiple of 16 so a slow scale animation does not rasterise on every frame.
 */
export function rasterShape(shape: ShapeStyle, boxW: number, boxH: number, pxW: number, pxH: number): RasterShape {
  const w = Math.min(MAX_SIDE, Math.max(4, Math.ceil(pxW / 16) * 16));
  const h = Math.min(MAX_SIDE, Math.max(4, Math.ceil(pxH / 16) * 16));
  const key = JSON.stringify([shape, Math.round(boxW), Math.round(boxH), w, h]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d")!;
  // Work in project pixels so line widths and radii mean what the inspector says.
  g.scale(w / boxW, h / boxH);
  draw(g, shape, boxW, boxH);
  const out = { canvas, key };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return out;
}

function draw(g: OffscreenCanvasRenderingContext2D, s: ShapeStyle, w: number, h: number): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  if (s.kind === "line") {
    const t = s.thickness ?? 10;
    g.strokeStyle = s.color;
    g.lineWidth = t;
    g.beginPath();
    g.moveTo(t / 2, h / 2);
    g.lineTo(w - t / 2, h / 2);
    g.stroke();
    return;
  }
  if (s.kind === "rect" || s.kind === "ellipse") {
    const inset = (s.stroke?.width ?? 0) / 2;
    g.beginPath();
    if (s.kind === "rect") g.roundRect(inset, inset, w - inset * 2, h - inset * 2, Math.min(s.radius ?? 0, (w - inset * 2) / 2, (h - inset * 2) / 2));
    else g.ellipse(w / 2, h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2);
    if (!s.noFill) {
      g.fillStyle = s.color;
      g.fill();
    }
    if (s.stroke && s.stroke.width > 0) {
      g.strokeStyle = s.stroke.color;
      g.lineWidth = s.stroke.width;
      g.stroke();
    }
    return;
  }
  const sticker = stickerById(s.sticker);
  if (!sticker) return;
  // The 100 grid is fitted inside the box, centred.
  const u = Math.min(w, h) / 100;
  g.translate((w - u * 100) / 2, (h - u * 100) / 2);
  g.scale(u, u);
  const weight = LINE * (s.weight ?? 1);
  for (const p of sticker.paths) {
    const path = new Path2D(p.d);
    g.lineWidth = weight;
    switch (p.paint) {
      case "stroke":
        g.strokeStyle = s.color;
        g.stroke(path);
        break;
      case "fill":
        g.fillStyle = g.strokeStyle = s.color;
        g.lineWidth = 2;
        g.fill(path);
        g.stroke(path);
        break;
      case "soft":
        g.globalAlpha = 0.32;
        g.fillStyle = s.color;
        g.fill(path);
        g.globalAlpha = 1;
        break;
      case "ink":
        g.strokeStyle = INK;
        g.stroke(path);
        break;
      case "inkfill":
        g.fillStyle = g.strokeStyle = INK;
        g.lineWidth = 2;
        g.fill(path);
        g.stroke(path);
        break;
      case "red":
        g.fillStyle = RED;
        g.fill(path);
        break;
    }
  }
}
