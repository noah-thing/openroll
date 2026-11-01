// Pure maths for the AI visual features: turning measured camera motion into a steady
// path, a subject track into framing keyframes, and the small binary format analysis
// results are kept in. Nothing here touches a model or a frame, so it is all testable.

import type { Keyframe, MediaItem, Micros } from "./project";

/** Camera motion measured between frames, accumulated from the first frame. */
export interface CameraPath {
  fps: number;
  /** Source time of sample 0, in seconds. */
  start: number;
  /** Sideways and vertical shift of the picture, in frame widths. */
  dx: Float32Array;
  dy: Float32Array;
  /** Roll in radians. */
  rot: Float32Array;
}

export interface Correction {
  fps: number;
  start: number;
  dx: Float32Array;
  dy: Float32Array;
  rot: Float32Array;
  /** One constant zoom hides every border the corrections would show. */
  zoom: number;
}

export interface StabilizeShift {
  dx: number;
  dy: number;
  rot: number;
  zoom: number;
}

export const MAX_STABILIZE_ZOOM = 1.35;

/** Gaussian smoothing that renormalises at the ends instead of fading to zero. */
export function smooth(values: Float32Array, sigma: number): Float32Array {
  if (sigma < 0.05 || values.length < 2) return Float32Array.from(values);
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let acc = 0, weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = kernel[k + radius];
      acc += values[j] * w;
      weight += w;
    }
    out[i] = acc / weight;
  }
  return out;
}

/** Smallest zoom at which a picture shifted by (dx, dy) and rolled by rot still covers the frame. */
export function coverZoom(dx: number, dy: number, rot: number, aspect: number): number {
  const hx = 0.5, hy = 0.5 / aspect;
  const c = Math.cos(rot), s = Math.sin(rot);
  let zoom = 1;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = sx * hx - dx, py = sy * hy - dy;
    // inverse roll brings the frame corner back into the picture's own axes
    const qx = px * c + py * s, qy = -px * s + py * c;
    zoom = Math.max(zoom, Math.abs(qx) / hx, Math.abs(qy) / hy);
  }
  return zoom;
}

/** What to move each frame by so the camera path becomes a slow drift, and the crop that hides the edges. */
export function buildCorrection(path: CameraPath, strength: number, aspect: number): Correction {
  const n = path.dx.length;
  const s = Math.min(1, Math.max(0, strength));
  // from a quick tidy of hand shake (a tenth of a second) up to a locked off tripod look
  const sigma = s <= 0 ? 0 : path.fps * (0.1 + s * s * 2.4);
  const target = (v: Float32Array) => (s >= 0.995 ? new Float32Array(n).fill(v.reduce((a, b) => a + b, 0) / Math.max(1, n)) : smooth(v, sigma));
  const sx = target(path.dx), sy = target(path.dy), sr = target(path.rot);
  const dx = new Float32Array(n), dy = new Float32Array(n), rot = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dx[i] = sx[i] - path.dx[i];
    dy[i] = sy[i] - path.dy[i];
    rot[i] = sr[i] - path.rot[i];
  }
  let zoom = zoomFor(dx, dy, rot, aspect);
  // Some clips would need a huge crop. Give back stillness rather than resolution.
  if (zoom > MAX_STABILIZE_ZOOM) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (zoomFor(dx, dy, rot, aspect, mid) > MAX_STABILIZE_ZOOM) hi = mid;
      else lo = mid;
    }
    for (let i = 0; i < n; i++) {
      dx[i] *= lo;
      dy[i] *= lo;
      rot[i] *= lo;
    }
    zoom = zoomFor(dx, dy, rot, aspect);
  }
  return { fps: path.fps, start: path.start, dx, dy, rot, zoom };
}

function zoomFor(dx: Float32Array, dy: Float32Array, rot: Float32Array, aspect: number, k = 1): number {
  let zoom = 1;
  for (let i = 0; i < dx.length; i++) zoom = Math.max(zoom, coverZoom(dx[i] * k, dy[i] * k, rot[i] * k, aspect));
  // a hair of margin for the filter at the border
  return zoom > 1 ? zoom * 1.004 : 1;
}

/** The shift for a source time, blended between the two nearest samples. */
export function shiftAt(c: Correction, sourceSeconds: number): StabilizeShift {
  const n = c.dx.length;
  if (!n) return { dx: 0, dy: 0, rot: 0, zoom: 1 };
  const f = Math.min(n - 1, Math.max(0, (sourceSeconds - c.start) * c.fps));
  const i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
  const mix = (a: Float32Array) => a[i] + (a[j] - a[i]) * k;
  return { dx: mix(c.dx), dy: mix(c.dy), rot: mix(c.rot), zoom: c.zoom };
}

/** Where the main subject sits in the source frame, 0..1 on both axes. */
export interface SubjectSample {
  /** Source seconds. */
  t: number;
  x: number;
  y: number;
  /** Height of the subject as a fraction of the frame. */
  h: number;
}

export interface ReframeInput {
  samples: SubjectSample[];
  /** Project frame in pixels. */
  frameWidth: number;
  frameHeight: number;
  /** The clip as fitted inside the frame, before any user scale. */
  fitWidth: number;
  fitHeight: number;
  /** How tight to frame, 0 = just fill the frame, 1 = lean in on small subjects. */
  tightness?: number;
}

export interface ReframePlan {
  x: Keyframe[];
  y: Keyframe[];
  scale: Keyframe[];
}

/** Keep the camera still until the subject leaves the middle of the frame, then follow smoothly. */
export function followSubject(samples: SubjectSample[], deadzone: number): SubjectSample[] {
  if (!samples.length) return [];
  const out: SubjectSample[] = [];
  let cx = samples[0].x, cy = samples[0].y;
  for (const s of samples) {
    const ex = s.x - cx, ey = s.y - cy;
    if (Math.abs(ex) > deadzone) cx = s.x - Math.sign(ex) * deadzone;
    if (Math.abs(ey) > deadzone) cy = s.y - Math.sign(ey) * deadzone;
    out.push({ ...s, x: cx, y: cy });
  }
  return out;
}

/**
 * Keyframes that fill a new frame shape with the clip and keep the subject in view.
 * `toLocal` turns source seconds into time on the clip, so speed and reverse are respected.
 */
export function planReframe(input: ReframeInput, toLocal: (sourceSeconds: number) => Micros): ReframePlan {
  const { frameWidth: fw, frameHeight: fh, fitWidth, fitHeight } = input;
  const cover = Math.max(fw / fitWidth, fh / fitHeight);
  const tight = input.tightness ?? 0.5;
  const base = input.samples.length ? input.samples : [{ t: 0, x: 0.5, y: 0.5, h: 0.5 }];
  // follow a smoothed copy of the subject, not every twitch of the detector
  const sx = smooth(Float32Array.from(base.map(s => s.x)), 1.5);
  const sy = smooth(Float32Array.from(base.map(s => s.y)), 1.5);
  const sh = smooth(Float32Array.from(base.map(s => s.h)), 2.5);
  const followed = followSubject(base.map((s, i) => ({ t: s.t, x: sx[i], y: sy[i], h: sh[i] })), 0.06);
  const raw: { t: Micros; x: number; y: number; scale: number }[] = followed.map(s => {
    // small subjects earn a gentle push in; large ones keep the plain fill
    const lean = 1 + tight * Math.max(0, Math.min(0.35, 0.5 - s.h) * 0.9);
    const scale = cover * lean;
    const w = fitWidth * scale, h = fitHeight * scale;
    const limitX = Math.max(0, (w - fw) / 2), limitY = Math.max(0, (h - fh) / 2);
    const x = clamp(-(s.x - 0.5) * w, -limitX, limitX);
    const y = clamp(-(s.y - 0.5) * h, -limitY, limitY);
    return { t: toLocal(s.t), x, y, scale: scale };
  });
  raw.sort((a, b) => a.t - b.t);
  const key = (pick: (r: (typeof raw)[number]) => number, tol: number): Keyframe[] =>
    thin(raw.map(r => ({ t: r.t, v: pick(r), ease: "ease" as const })), tol);
  return { x: key(r => r.x, fw * 0.004), y: key(r => r.y, fh * 0.004), scale: key(r => r.scale, 0.004) };
}

/** Drop keyframes that a straight line between their neighbours already describes. */
export function thin(keys: Keyframe[], tolerance: number): Keyframe[] {
  if (keys.length <= 2) return keys;
  const out: Keyframe[] = [keys[0]];
  let anchor = 0;
  for (let i = 2; i < keys.length; i++) {
    const a = keys[anchor], b = keys[i];
    let worst = 0;
    for (let k = anchor + 1; k < i; k++) {
      const f = (keys[k].t - a.t) / (b.t - a.t || 1);
      worst = Math.max(worst, Math.abs(keys[k].v - (a.v + (b.v - a.v) * f)));
    }
    if (worst > tolerance) {
      out.push(keys[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** Source seconds to time on the clip, the inverse of how the scene reads a media item. */
export function localTime(item: MediaItem, sourceSeconds: number): Micros {
  const src = sourceSeconds * 1e6;
  const span = item.duration * item.speed;
  const offset = item.reversed ? item.in + span - src : src - item.in;
  return Math.round(Math.max(0, Math.min(item.duration, offset / item.speed)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function wantsStabilize(i: MediaItem): boolean {
  return (i.stabilize?.strength ?? 0) > 0;
}

/** A JSON header plus raw arrays in one file. The cache stores bytes, so analysis results use this. */
export function pack(meta: unknown, ...arrays: ArrayBufferView[]): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ meta, sizes: arrays.map(a => a.byteLength) }));
  const total = 4 + head.byteLength + arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, head.byteLength, true);
  out.set(head, 4);
  let at = 4 + head.byteLength;
  for (const a of arrays) {
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at);
    at += a.byteLength;
  }
  return out;
}

export function unpack(bytes: Uint8Array): { meta: unknown; parts: Uint8Array[] } {
  const headLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headLen))) as { meta: unknown; sizes: number[] };
  const parts: Uint8Array[] = [];
  let at = 4 + headLen;
  for (const size of head.sizes) {
    // copies, so the arrays are aligned for typed views
    parts.push(bytes.slice(at, at + size));
    at += size;
  }
  return { meta: head.meta, parts };
}

export function floats(part: Uint8Array): Float32Array {
  return new Float32Array(part.buffer, part.byteOffset, part.byteLength / 4);
}
