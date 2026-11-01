// One click layouts for a clip: a small picture in a corner, or one half of a split
// screen. Pure geometry; applying one rewrites the clip's transform and crop.

import { draft } from "./edit";
import { findItem, itemEnd, type Crop, type MediaItem, type MediaRef, type Project, type Transform } from "./project";
import { fitSize } from "./scene";

export type Layout = "full" | "pip-tl" | "pip-tr" | "pip-bl" | "pip-br" | "top" | "bottom" | "left" | "right";

export const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "full", label: "Full frame" },
  { id: "pip-tl", label: "Picture in picture, top left" },
  { id: "pip-tr", label: "Picture in picture, top right" },
  { id: "pip-bl", label: "Picture in picture, bottom left" },
  { id: "pip-br", label: "Picture in picture, bottom right" },
  { id: "top", label: "Split, top half" },
  { id: "bottom", label: "Split, bottom half" },
  { id: "left", label: "Split, left half" },
  { id: "right", label: "Split, right half" },
];

const PARTNER: Partial<Record<Layout, Layout>> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Share of the frame width a corner picture takes. */
export const PIP_WIDTH = 0.32;
const MARGIN = 0.04;

export interface Placed {
  x: number;
  y: number;
  scale: number;
  crop?: Crop;
}

/** Where a clip with this source goes, as a transform and the crop that fits it to its region. */
export function placeIn(p: Project, media: MediaRef, layout: Layout): Placed {
  const W = p.settings.width, H = p.settings.height;
  const fit = fitSize(p, media);
  if (layout === "full") return { x: 0, y: 0, scale: 1 };

  if (layout.startsWith("pip")) {
    const scale = (W * PIP_WIDTH) / fit.width;
    const w = fit.width * scale, h = fit.height * scale;
    const m = MARGIN * Math.min(W, H);
    const sx = layout.endsWith("l") ? -1 : 1;
    const sy = layout.includes("t") ? -1 : 1;
    return { x: Math.round(sx * (W / 2 - m - w / 2)), y: Math.round(sy * (H / 2 - m - h / 2)), scale };
  }

  const vertical = layout === "top" || layout === "bottom";
  const rw = vertical ? W : W / 2, rh = vertical ? H / 2 : H;
  const cx = layout === "left" ? -W / 4 : layout === "right" ? W / 4 : 0;
  const cy = layout === "top" ? -H / 4 : layout === "bottom" ? H / 4 : 0;
  // Cover the region, then trim what spills over so the neighbour is not drawn on.
  const scale = Math.max(rw / fit.width, rh / fit.height);
  const visW = Math.min(1, rw / (fit.width * scale)), visH = Math.min(1, rh / (fit.height * scale));
  const crop: Crop = { left: (1 - visW) / 2, right: (1 - visW) / 2, top: (1 - visH) / 2, bottom: (1 - visH) / 2 };
  return { x: Math.round(cx), y: Math.round(cy), scale, crop };
}

function put(item: MediaItem, at: Placed): void {
  const t: Transform = { ...item.transform, x: at.x, y: at.y, scale: at.scale, rotation: 0 };
  item.transform = t;
  if (at.crop) item.crop = at.crop;
  else delete item.crop;
  if (item.keyframes) {
    for (const k of Object.keys(item.keyframes)) if (k.startsWith("transform.")) delete item.keyframes[k];
    if (!Object.keys(item.keyframes).length) delete item.keyframes;
  }
}

/** A different clip on screen at the same moment, the natural other half of a split. */
export function partnerOf(p: Project, id: string): MediaItem | null {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media") return null;
  const mid = found.item.start + found.item.duration / 2;
  for (const track of p.tracks) {
    if (track.id === found.track.id || track.kind !== "video" || track.hidden) continue;
    for (const i of track.items) {
      if (i.type !== "media" || p.media[i.mediaId]?.kind === "audio") continue;
      if (i.start <= mid && itemEnd(i) > mid) return i;
    }
  }
  return null;
}

export function applyLayout(p: Project, id: string, layout: Layout): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media") return p;
  const media = p.media[found.item.mediaId];
  if (!media || media.kind === "audio") return p;
  const next = draft(p);
  put(findItem(next, id)!.item as MediaItem, placeIn(next, media, layout));
  // A split puts the clip underneath in the other half so one click makes the whole screen.
  const other = PARTNER[layout];
  const partner = other && partnerOf(next, id);
  if (partner) {
    const ref = next.media[partner.mediaId];
    put(findItem(next, partner.id)!.item as MediaItem, placeIn(next, ref, other));
  }
  return next;
}
