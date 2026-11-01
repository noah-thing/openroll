// Defaults for new shapes and stickers. The drawing itself lives in the engine.

import { draft, freeTrack, sortTrack } from "./edit";
import { IDENTITY, itemEnd, newId, type Micros, type Project, type ShapeItem, type ShapeKind, type ShapeStyle } from "./project";
import { stickerById } from "./stickers";

export const SHAPE_DEFAULT_DURATION: Micros = 4_000_000;

export function shapeSize(kind: ShapeKind, p: Project): { width: number; height: number } {
  const side = Math.min(p.settings.width, p.settings.height);
  switch (kind) {
    case "rect":
      return { width: Math.round(side * 0.5), height: Math.round(side * 0.32) };
    case "ellipse":
      return { width: Math.round(side * 0.4), height: Math.round(side * 0.4) };
    case "line":
      return { width: Math.round(side * 0.5), height: 40 };
    case "sticker":
      return { width: Math.round(side * 0.3), height: Math.round(side * 0.3) };
  }
}

/** Put an item on a free overlay lane above the main track, never inside the main sequence. */
export function placeOverlay(p: Project, item: ShapeItem): Project {
  const next = draft(p);
  const track = freeTrack(next, "video", item.start, itemEnd(item));
  track.items.push(item);
  sortTrack(track);
  return next;
}

const NAMES ={ rect: "Rectangle", ellipse: "Ellipse", line: "Line" } as const;

export function newShape(p: Project, start: Micros, style: Partial<ShapeStyle> & { kind: ShapeKind }): ShapeItem {
  const sticker = style.kind === "sticker" ? stickerById(style.sticker) : undefined;
  const shape: ShapeStyle = { ...style, color: style.color ?? sticker?.color ?? (style.kind === "line" ? "#ffffff" : "#f2c23a") };
  if (style.kind === "line") shape.thickness ??= 10;
  if (style.kind === "rect") shape.radius ??= 24;
  return {
    id: newId("i"),
    type: "shape",
    name: sticker?.name ?? (style.kind === "sticker" ? "Sticker" : NAMES[style.kind]),
    start,
    duration: SHAPE_DEFAULT_DURATION,
    transform: { ...IDENTITY },
    shape,
    ...shapeSize(style.kind, p),
  };
}
