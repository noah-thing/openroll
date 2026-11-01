// What should be on screen at time t. Pure: given a project and a time it returns the
// visuals bottom to top, plus which source frames they need. The preview and the
// exporter both draw from this, so they cannot disagree about a frame.

import { sample, valueAt } from "./animate";
import type { BlendMode, CaptionItem, ChromaKey, ColorItem, Crop, Curves, Fill, Hsl, Item, Mask, MediaItem, MediaRef, Micros, Project, TextItem, Track } from "./project";
import { itemEnd } from "./project";

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Extra scale from in/out animations, applied around the centre. */
  animScale: number;
  crop?: Crop;
  blend?: BlendMode;
  adjust?: Record<string, number>;
  filter?: { id: string; amount: number };
  curves?: Curves;
  hsl?: Hsl;
  effects?: PlacedEffect[];
  mask?: Mask;
  chroma?: ChromaKey;
  fill?: Fill;
  /** Seconds into the item, for effects that move. */
  time: number;
}

export interface PlacedEffect {
  id: string;
  kind: string;
  amount: number;
  speed: number;
  style: number;
}

export type Visual =
  | { kind: "media"; item: MediaItem; media: MediaRef; sourceTime: Micros; place: Placement }
  | { kind: "text"; item: TextItem | CaptionItem; place: Placement; text: string; highlight: number }
  | { kind: "color"; item: ColorItem; place: Placement };

export type SceneNode =
  | { kind: "visual"; visual: Visual }
  | { kind: "transition"; a: Visual; b: Visual; transition: string; progress: number };

export function buildScene(p: Project, t: Micros): SceneNode[] {
  const nodes: SceneNode[] = [];
  // Tracks are listed top to bottom as on screen; paint from the bottom up.
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.hidden || track.kind === "audio") continue;
    const node = trackNode(p, track, t);
    if (node) nodes.push(node);
  }
  return nodes;
}

function trackNode(p: Project, track: Track, t: Micros): SceneNode | null {
  const items = track.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = items[i + 1];
    // Inside the second half of a transition window that belongs to the next item?
    if (next?.transitionIn && itemEnd(item) === next.start) {
      const half = next.transitionIn.duration / 2;
      if (t >= next.start - half && t < next.start + half) {
        const a = visualFor(p, item, t, true);
        const b = visualFor(p, next, t, true);
        if (a && b) return { kind: "transition", a, b, transition: next.transitionIn.kind, progress: (t - (next.start - half)) / next.transitionIn.duration };
      }
    }
    if (t >= item.start && t < itemEnd(item)) {
      const v = visualFor(p, item, t, false);
      return v ? { kind: "visual", visual: v } : null;
    }
  }
  return null;
}

function visualFor(p: Project, item: Item, t: Micros, overrun: boolean): Visual | null {
  const local = t - item.start;
  if (item.type === "media") {
    const media = p.media[item.mediaId];
    if (!media || media.kind === "audio") return null;
    const place = placement(p, item, local, media);
    return { kind: "media", item, media, sourceTime: sourceAt(item, media, local, overrun), place };
  }
  if (item.type === "color") return { kind: "color", item, place: placement(p, item, local) };
  if (item.type === "text") return { kind: "text", item, place: placement(p, item, local), text: item.style.text, highlight: -1 };
  const words = item.words;
  const highlight = words.findIndex(w => local >= w.start && local < w.end);
  return { kind: "text", item, place: placement(p, item, local), text: words.length ? words.map(w => w.text).join(" ") : item.style.text, highlight };
}

/** Source time for a media item, letting it run past its edges during a transition. */
function sourceAt(item: MediaItem, media: MediaRef, local: Micros, overrun: boolean): Micros {
  if (media.kind === "image" || item.freeze) return item.in;
  const l = overrun ? local : Math.max(0, Math.min(item.duration - 1, local));
  const offset = Math.round(l * item.speed);
  const s = item.reversed ? item.in + Math.round(item.duration * item.speed) - offset : item.in + offset;
  return Math.max(0, Math.min(media.duration - 1, s));
}

/** Size of a source when fitted inside the frame, the way it lands when first dropped in. */
export function fitSize(p: Project, media: MediaRef): { width: number; height: number } {
  let w = media.width ?? p.settings.width;
  let h = media.height ?? p.settings.height;
  if (media.rotation === 90 || media.rotation === 270) [w, h] = [h, w];
  const k = Math.min(p.settings.width / w, p.settings.height / h);
  return { width: w * k, height: h * k };
}

/** Keyframe path for one numeric field of an effect. Effects are found by id, not by position. */
export function effectKey(id: string, field: "amount"): string {
  return `fx:${id}:${field}`;
}

function placement(p: Project, item: Item, local: Micros, media?: MediaRef): Placement {
  const base = media ? fitSize(p, media) : { width: p.settings.width, height: p.settings.height };
  const s = valueAt(item, "transform.scale", local);
  const place: Placement = {
    x: valueAt(item, "transform.x", local),
    y: valueAt(item, "transform.y", local),
    width: base.width * s,
    height: base.height * s,
    rotation: valueAt(item, "transform.rotation", local),
    opacity: valueAt(item, "transform.opacity", local),
    animScale: 1,
    time: local / 1e6,
  };
  if (item.type === "media") {
    place.crop = item.crop;
    place.blend = item.blend;
    const names = new Set(Object.keys(item.adjust ?? {}));
    for (const path of Object.keys(item.keyframes ?? {})) if (path.startsWith("adjust.")) names.add(path.slice(7));
    if (names.size) {
      const adjust: Record<string, number> = {};
      for (const k of names) adjust[k] = valueAt(item, "adjust." + k, local);
      place.adjust = adjust;
    }
    if (item.filter) place.filter = { id: item.filter.id, amount: valueAt(item, "filter.amount", local) };
    place.curves = item.curves;
    place.hsl = item.hsl;
    place.mask = item.mask;
    place.chroma = item.chroma;
    place.fill = item.fill;
    if (item.effects?.length) {
      place.effects = item.effects
        .filter(e => !e.off)
        .map(e => {
          const keys = item.keyframes?.[effectKey(e.id, "amount")];
          return { id: e.id, kind: e.kind, amount: keys?.length ? sample(keys, local) : e.amount, speed: e.params?.speed ?? 1, style: e.params?.style ?? 0 };
        });
    }
  }
  applyAnimation(place, item, local, p);
  return place;
}

function applyAnimation(place: Placement, item: Item, local: Micros, p: Project): void {
  const inA = item.animationIn, outA = item.animationOut;
  if (inA && local < inA.duration) motion(place, inA.kind, 1 - easeOut(local / inA.duration), p);
  const fromEnd = item.duration - local;
  if (outA && fromEnd < outA.duration) motion(place, outA.kind, 1 - easeOut(fromEnd / outA.duration), p);
}

/** `k` runs from 1 (fully off) to 0 (resting). */
function motion(place: Placement, kind: string, k: number, p: Project): void {
  switch (kind) {
    case "fade":
      place.opacity *= 1 - k;
      break;
    case "slide-up":
      place.y += k * p.settings.height * 0.25;
      place.opacity *= 1 - k;
      break;
    case "slide-down":
      place.y -= k * p.settings.height * 0.25;
      place.opacity *= 1 - k;
      break;
    case "slide-left":
      place.x += k * p.settings.width * 0.25;
      place.opacity *= 1 - k;
      break;
    case "slide-right":
      place.x -= k * p.settings.width * 0.25;
      place.opacity *= 1 - k;
      break;
    case "zoom-in":
      place.animScale *= 1 - 0.3 * k;
      place.opacity *= 1 - k;
      break;
    case "zoom-out":
      place.animScale *= 1 + 0.3 * k;
      place.opacity *= 1 - k;
      break;
    case "pop": {
      // overshoots a little on the way in
      const s = 1 - k;
      place.animScale *= s < 1 ? 0.6 + 0.4 * s + Math.sin(s * Math.PI) * 0.12 : 1;
      place.opacity *= Math.min(1, s * 2);
      break;
    }
    case "spin":
      place.rotation += k * 90;
      place.animScale *= 1 - 0.4 * k;
      place.opacity *= 1 - k;
      break;
  }
}

function easeOut(x: number): number {
  return 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
}

/** The source frames a scene needs, keyed by item id. */
export function frameNeeds(nodes: SceneNode[]): Map<string, { media: MediaRef; sourceTime: Micros }> {
  const out = new Map<string, { media: MediaRef; sourceTime: Micros }>();
  const add = (v: Visual) => {
    if (v.kind === "media") out.set(v.item.id, { media: v.media, sourceTime: v.sourceTime });
  };
  for (const n of nodes) {
    if (n.kind === "visual") add(n.visual);
    else {
      add(n.a);
      add(n.b);
    }
  }
  return out;
}
