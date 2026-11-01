// Turns a clip's AI settings plus whatever has been analysed into compositor layer fields.
// The preview and export workers both call this, so what you see is what is written.

import { shiftAt } from "../../core/ai";
import { frameDuration, type MediaItem, type MediaRef, type Micros, type Project } from "../../core/project";
import { buildScene, type SceneNode, type Visual } from "../../core/scene";
import { layerFields } from "../layer-look";
import type { Layer, LayerSource } from "../compositor";
import type { TemporalMode } from "./gpu";
import type { AiStore } from "./store";

type MediaVisual = Extract<Visual, { kind: "media" }>;

/** Everything except in between frames, which need a second decoded picture and so a reader. */
export function aiLayerFields(store: AiStore, project: Project, v: MediaVisual, t: Micros): Partial<Layer> {
  const out: Partial<Layer> = {};
  const { item, media } = v;
  const srcSeconds = v.sourceTime / 1e6;

  if (item.cutout) {
    const track = store.matte(media.id);
    if (track && track.ready > 0) {
      const index = Math.min(track.count - 1, Math.max(0, Math.round((srcSeconds - track.start) * track.fps)));
      if (index < track.ready) {
        const size = track.width * track.height;
        out.matte = { key: "matte:" + item.id, pixels: track.data.subarray(index * size, (index + 1) * size), version: index, width: track.width, height: track.height, edge: 0.55 };
      }
    }
  }

  const strength = item.stabilize?.strength ?? 0;
  if (strength > 0 && media.width && media.height) {
    const c = store.correction(media.id, strength, media.width / media.height);
    if (c && (c.zoom > 1 || c.dx.length)) {
      const s = shiftAt(c, srcSeconds);
      out.stab = { dx: s.dx, dy: s.dy, rot: s.rot, zoom: s.zoom };
    }
  }

  const amount = item.enhance?.amount ?? 0;
  if (amount > 0) out.enhance = { denoise: amount * 0.75, sharpen: amount * 0.7 };

  const trail = motionTrail(project, item, t);
  if (trail) out.trail = trail;
  return out;
}

export interface TemporalPlan {
  mode: TemporalMode;
  /** Streak only: how much of the frame to frame motion the shutter covers. */
  length: number;
}

/** Which in between frame work a clip needs right now, if any. */
export function temporalPlan(item: MediaItem, media: MediaRef): TemporalPlan | null {
  if (media.kind !== "video" || item.freeze) return null;
  if (item.slowMotion && item.speed < 0.999) return { mode: item.slowMotion === "flow" ? "flow" : "blend", length: 0 };
  const shutter = item.motionBlur?.amount ?? 0;
  // faster than the source: each output frame spans several source frames, so the picture smears along its motion
  if (shutter > 0.01 && item.speed > 1.05) return { mode: "streak", length: Math.min(1.5, shutter * item.speed) };
  return null;
}

export function sourceFrameLength(media: MediaRef): number {
  return 1 / (media.fps && media.fps > 1 ? media.fps : 30);
}

/** Seconds into the source of the frame after the one at `sourceSeconds`. */
export function nextFrameTime(media: MediaRef, sourceSeconds: number): number {
  const step = sourceFrameLength(media);
  return Math.min(Math.max(0, media.duration / 1e6 - 1e-3), sourceSeconds + step);
}

export function temporalLayer(plan: TemporalPlan, a: { timestamp: number }, b: { timestamp: number }, sourceSeconds: number, next: LayerSource): Layer["temporal"] {
  const span = b.timestamp - a.timestamp;
  // the clip's last frame has no successor; hold it
  const mix = span > 1e-6 ? Math.min(1, Math.max(0, (sourceSeconds - a.timestamp) / span)) : 0;
  return { mode: plan.mode, next, mix, length: plan.length };
}

// ---------------------------------------------------------------- motion blur from animation

const TRAIL_MIN = 3;
const TRAIL_MAX = 48;

function visualsOf(scene: SceneNode[], id: string): Visual | null {
  for (const n of scene) {
    if (n.kind === "visual") {
      if (n.visual.item.id === id) return n.visual;
    } else {
      if (n.a.item.id === id) return n.a;
      if (n.b.item.id === id) return n.b;
    }
  }
  return null;
}

/** The box at several moments inside the shutter. Nothing returns while the clip is not moving. */
export function motionTrail(project: Project, item: MediaItem, t: Micros): Layer["trail"] | undefined {
  const amount = item.motionBlur?.amount ?? 0;
  if (amount < 0.01) return undefined;
  const shutter = amount * frameDuration(project);
  const at = (offset: number) => {
    const v = visualsOf(buildScene(project, Math.round(t + offset)), item.id);
    if (!v) return null;
    const f = layerFields(v.place, true);
    return { x: f.x, y: f.y, width: f.width, height: f.height, rotation: f.rotation };
  };
  const a = at(-shutter / 2), b = at(shutter / 2);
  if (!a || !b) return undefined;
  const reach = Math.max(a.width, a.height) * 0.5;
  const travel = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.width - a.width) * 0.5 + Math.abs(b.height - a.height) * 0.5 + Math.abs(b.rotation - a.rotation) * (Math.PI / 180) * reach;
  if (travel < 0.8) return undefined;
  const n = Math.min(TRAIL_MAX, Math.max(TRAIL_MIN, Math.round(travel / 1.2) + 1));
  const out: NonNullable<Layer["trail"]> = [];
  for (let i = 0; i < n; i++) {
    const s = at((i / (n - 1) - 0.5) * shutter);
    if (s) out.push(s);
  }
  return out.length > 1 ? out : undefined;
}
