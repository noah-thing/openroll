// Speed ramps. A ramp is a curve of playback speed along the source span of a clip. Time
// spent on a stretch of footage is 1 / speed, so the clip's length is the area under 1 / speed
// and a timeline time maps to a source time by walking that area. Preview, audio and export
// all ask these functions, which is why they cannot disagree about a frame.

import { easeAt, sliceEase } from "./easing";
import type { Ease, MediaItem, Micros, SpeedKey, SpeedRamp } from "./project";

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 100;
/** Most points a person or the assistant places on a curve. */
export const MAX_SPEED_KEYS = 24;
/** Most a stored curve holds: cutting and growing a clip add a few keys to what was placed, and dropping any would change the footage. */
const STORED_KEYS = 256;
/** Keys closer than this along the span are one key, so a drag cannot stack keys on top of each other. */
const MIN_GAP = 0.002;
/** Keys cut from a longer curve stay apart however close they sit: merging them would move frames a split or trim had placed. */
export const CUT_GAP = 1e-9;
/** Audio is kept only while the whole curve stays inside this band; outside it resampling turns speech into noise. */
export const AUDIO_SPEED_RANGE: [number, number] = [0.25, 4];

const clampSpeed = (v: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));

/** Speed inside the segment from `a` to `b` at fraction f of the way. Hold keeps `a` right up to `b`. */
function segmentSpeed(a: SpeedKey, b: SpeedKey, f: number): number {
  const e = a.ease ?? "ease";
  return clampSpeed(e === "hold" ? a.v : a.v + (b.v - a.v) * easeAt(e, f));
}

/** Speed at x along the span. */
export function speedAt(keys: SpeedKey[], x: number): number {
  const n = keys.length;
  if (x <= keys[0].x) return keys[0].v;
  if (x >= keys[n - 1].x) return keys[n - 1].v;
  let i = 1;
  while (keys[i].x < x) i++;
  const a = keys[i - 1], b = keys[i];
  const f = (x - a.x) / (b.x - a.x);
  return f >= 1 ? b.v : segmentSpeed(a, b, f);
}

interface Table {
  xs: Float64Array;
  /** Time per unit of span reached at each x, so tau[last] is the clip length divided by the span. */
  tau: Float64Array;
}

const tables = new Map<string, Table>();
const TABLE_LIMIT = 48;
/** Integration cells for a segment as wide as the whole span. */
const CELLS = 2048;

/** A cell is split in two while its own estimate and the finer one disagree by more than this, which a steep stretch of 1 / speed (a 0.1 to 100 ramp) needs far beyond the base cell count. */
const CELL_TOLERANCE = 1e-7;
const CELL_DEPTH = 10;

function tableFor(keys: SpeedKey[]): Table {
  const sig = JSON.stringify(keys);
  const hit = tables.get(sig);
  if (hit) return hit;
  const xs: number[] = [keys[0].x];
  const tau: number[] = [0];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    const w = b.x - a.x;
    const cells = Math.min(CELLS, Math.max(16, Math.ceil(CELLS * w)));
    const g = (f: number) => 1 / segmentSpeed(a, b, f);
    const simpson = (f0: number, f1: number, g0: number, gm: number, g1: number) => ((w * (f1 - f0)) / 6) * (g0 + 4 * gm + g1);
    const cell = (f0: number, f1: number, g0: number, gm: number, g1: number, depth: number): void => {
      const mid = (f0 + f1) / 2;
      const gl = g((f0 + mid) / 2), gr = g((mid + f1) / 2);
      const whole = simpson(f0, f1, g0, gm, g1);
      const halves = simpson(f0, mid, g0, gl, gm) + simpson(mid, f1, gm, gr, g1);
      if (depth < CELL_DEPTH && Math.abs(halves - whole) > CELL_TOLERANCE * halves) {
        cell(f0, mid, g0, gl, gm, depth + 1);
        cell(mid, f1, gm, gr, g1, depth + 1);
        return;
      }
      tau.push(tau[tau.length - 1] + halves);
      xs.push(f1 >= 1 ? b.x : a.x + w * f1);
    };
    for (let c = 0; c < cells; c++) {
      const f0 = c / cells, f1 = (c + 1) / cells;
      cell(f0, f1, g(f0), g((f0 + f1) / 2), g(f1), 0);
    }
  }
  const table = { xs: Float64Array.from(xs), tau: Float64Array.from(tau) };
  if (tables.size >= TABLE_LIMIT) tables.delete(tables.keys().next().value!);
  tables.set(sig, table);
  return table;
}

/** Index i of the last entry in the sorted array that is at most v. */
function floorIndex(arr: Float64Array, v: number): number {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lookup(from: Float64Array, to: Float64Array, v: number): number {
  const last = from.length - 1;
  if (v <= from[0]) return to[0];
  if (v >= from[last]) return to[last];
  const i = floorIndex(from, v);
  const span = from[i + 1] - from[i];
  return span > 0 ? to[i] + ((to[i + 1] - to[i]) * (v - from[i])) / span : to[i];
}

/** Time per unit of source for the whole curve, 1 / its harmonic mean speed. */
function totalTau(keys: SpeedKey[]): number {
  const t = tableFor(keys).tau;
  return t[t.length - 1];
}

/** The clip length that plays `span` of source along this curve. */
export function rampDuration(keys: SpeedKey[], span: Micros): Micros {
  return Math.max(1, Math.round(span * totalTau(keys)));
}

/** Mean speed over the clip: the source it uses per unit of timeline. */
export function averageSpeed(keys: SpeedKey[]): number {
  return 1 / totalTau(keys);
}

/**
 * Source time played after `local` microseconds of a clip that lasts `duration`. Exact at
 * both ends whatever rounding the duration went through, and past the ends it carries on at
 * the speed of the nearest key, which is what a transition overrun and a trim extension need.
 */
export function rampOffset(r: SpeedRamp, duration: Micros, local: Micros): number {
  if (local === 0) return 0;
  if (local === duration) return r.span;
  const table = tableFor(r.keys);
  const natural = r.span * table.tau[table.tau.length - 1];
  const n = (local * natural) / duration;
  if (n <= 0) return n * speedAt(r.keys, 0);
  if (n >= natural) return r.span + (n - natural) * speedAt(r.keys, 1);
  return r.span * lookup(table.tau, table.xs, n / r.span);
}

/** Inverse of rampOffset: the clip time at which `played` microseconds of source have gone by. */
export function rampLocal(r: SpeedRamp, duration: Micros, played: number): number {
  if (played === 0) return 0;
  if (played === r.span) return duration;
  const table = tableFor(r.keys);
  const natural = r.span * table.tau[table.tau.length - 1];
  let n: number;
  if (played <= 0) n = played / speedAt(r.keys, 0);
  else if (played >= r.span) n = natural + (played - r.span) / speedAt(r.keys, 1);
  else n = r.span * lookup(table.xs, table.tau, played / r.span);
  return (n * duration) / natural;
}

/** Source time a clip has played after `local` microseconds, before reverse is applied. */
export function playedOffset(item: MediaItem, local: Micros): number {
  return item.ramp && !item.freeze ? rampOffset(item.ramp, item.duration, local) : local * item.speed;
}

/** Inverse of playedOffset. */
export function localAtPlayed(item: MediaItem, played: number): number {
  return item.ramp && !item.freeze ? rampLocal(item.ramp, item.duration, played) : played / item.speed;
}

/** Speed at the first or last frame as the timeline sees it. A trim that grows the clip plays on at this speed. */
export function edgeSpeed(item: MediaItem, edge: "head" | "tail"): number {
  if (!item.ramp) return item.speed;
  const v = speedAt(item.ramp.keys, edge === "head" ? 0 : 1);
  return v * ((item.ramp.span * totalTau(item.ramp.keys)) / item.duration);
}

/** The lowest and highest speed the curve reaches, found on keys and a fine sample between them. */
export function speedRange(keys: SpeedKey[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const v = speedAt(keys, i / 200);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (const k of keys) {
    lo = Math.min(lo, k.v);
    hi = Math.max(hi, k.v);
  }
  return [lo, hi];
}

/** Whether a ramped clip keeps its sound. Pitch follows speed, as it does for a constant speed, so a curve that leaves the band is silenced rather than played as noise. */
export function rampKeepsAudio(r: SpeedRamp): boolean {
  const [lo, hi] = speedRange(r.keys);
  return lo >= AUDIO_SPEED_RANGE[0] - 1e-9 && hi <= AUDIO_SPEED_RANGE[1] + 1e-9;
}

/** Sorted keys covering 0..1 with legal speeds and eases; null when nothing usable was given. */
export function normalizeKeys(keys: SpeedKey[], gap = MIN_GAP): SpeedKey[] | null {
  const ok = keys.filter(k => Number.isFinite(k.x) && Number.isFinite(k.v));
  if (!ok.length) return null;
  const sorted = ok
    .map(k => ({ x: Math.min(1, Math.max(0, k.x)), v: clampSpeed(k.v), ...(k.ease !== undefined ? { ease: k.ease } : {}) }))
    .sort((a, b) => a.x - b.x);
  // Past the limit the middle goes, never the end, which would change where the clip finishes.
  if (sorted.length > STORED_KEYS) sorted.splice(STORED_KEYS - 1, sorted.length - STORED_KEYS + 1, sorted[sorted.length - 1]);
  const out: SpeedKey[] = [];
  for (const k of sorted) {
    const last = out[out.length - 1];
    if (last && k.x - last.x < gap) {
      // The later key wins so a dragged point replaces the one it landed on.
      out[out.length - 1] = { ...k, x: last.x };
      continue;
    }
    out.push(k);
  }
  if (out[0].x > 0) out.unshift({ x: 0, v: out[0].v, ease: "linear" });
  else out[0].x = 0;
  const end = out[out.length - 1];
  if (end.x < 1) {
    if (1 - end.x < gap && out.length > 1) end.x = 1;
    else out.push({ x: 1, v: end.v });
  }
  if (out.length < 2) out.push({ x: 1, v: out[0].v });
  if (out.length > 2 && 1 - out[out.length - 2].x < gap) out.splice(out.length - 2, 1);
  out[out.length - 1].x = 1;
  return out;
}

/** The part of a curve between two fractions of its span, stretched to 0..1. Evaluates identically there. */
export function sliceKeys(keys: SpeedKey[], x0: number, x1: number): SpeedKey[] {
  const w = x1 - x0;
  const out: SpeedKey[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    const lo = Math.max(a.x, x0), hi = Math.min(b.x, x1);
    if (hi - lo <= 1e-12) continue;
    const seg = b.x - a.x;
    const f0 = (lo - a.x) / seg, f1 = (hi - a.x) / seg;
    out.push({ x: (lo - x0) / w, v: f0 <= 0 ? a.v : segmentSpeed(a, b, f0), ease: sliceEase(a.ease ?? "ease", f0, f1) });
    if (hi >= x1 - 1e-12) {
      const atEnd = f1 >= 1;
      out.push({ x: 1, v: atEnd ? b.v : segmentSpeed(a, b, f1) });
    }
  }
  if (!out.length) {
    const v = speedAt(keys, x0);
    return [{ x: 0, v }, { x: 1, v }];
  }
  if (out[out.length - 1].x < 1) out.push({ x: 1, v: speedAt(keys, x1) });
  return out;
}

export interface Reshaped {
  ramp: SpeedRamp;
  /** Source time taken off the start of the played span; negative when the start grew. */
  headSpan: Micros;
  /** Source time taken off the end of the played span; negative when the end grew. */
  tailSpan: Micros;
}

/**
 * Cut or grow a ramped clip. `head` and `tail` are timeline microseconds removed from the
 * start and end, negative to add. Added time plays at the speed the edge already had, since
 * the curve says nothing about footage beyond it.
 */
export function reshapeRamp(source: SpeedRamp, duration: Micros, head: Micros, tail: Micros): Reshaped {
  // A clip held at the minimum length plays its curve slightly rescaled. Writing that scale into the speeds first keeps the frames it shows where they are.
  const scale = (source.span * totalTau(source.keys)) / duration;
  const r = Math.abs(scale - 1) > 1e-6 ? { ...source, keys: source.keys.map(k => ({ ...k, v: k.v * scale })) } : source;
  const a = Math.max(0, head), b = duration - Math.max(0, tail);
  const sA = a > 0 ? Math.min(r.span - 1, Math.round(rampOffset(r, duration, a))) : 0;
  const sB = b < duration ? Math.max(sA + 1, Math.round(rampOffset(r, duration, b))) : r.span;
  let keys = sA === 0 && sB === r.span ? r.keys.map(k => ({ ...k })) : sliceKeys(r.keys, sA / r.span, sB / r.span);
  let span = sB - sA;
  const speedHead = speedAt(keys, 0), speedTail = speedAt(keys, 1);
  // Convert to span units so keys can be moved without rescaling twice.
  let abs = keys.map(k => ({ ...k, x: k.x * span }));
  const growHead = head < 0 ? Math.round(-head * speedHead) : 0;
  const growTail = tail < 0 ? Math.round(-tail * speedTail) : 0;
  if (growHead > 0) abs = [{ x: 0, v: speedHead, ease: "linear" as Ease }, ...abs.map(k => ({ ...k, x: k.x + growHead }))];
  if (growTail > 0) abs = [...abs, { x: span + growHead + growTail, v: speedTail }];
  if (growHead > 0 || growTail > 0) {
    // The old end key now sits mid span and must run flat into the extension.
    if (growTail > 0) abs[abs.length - 2] = { ...abs[abs.length - 2], ease: "linear" };
    span += growHead + growTail;
    keys = abs.map(k => ({ ...k, x: k.x / span }));
  }
  const ramp: SpeedRamp = { keys: normalizeKeys(keys, CUT_GAP) ?? keys, span };
  return { ramp, headSpan: growHead > 0 ? -growHead : sA, tailSpan: growTail > 0 ? -growTail : r.span - sB };
}

export interface RateStep {
  /** Seconds after the buffer starts playing. */
  at: number;
  rate: number;
}

/** Longest stretch played at one rate. Short enough that pitch moves smoothly, long enough to keep automation light. */
const RATE_STEP = 0.01;

/**
 * Playback rates that make a buffer covering source seconds `from` to `to` of a ramped clip
 * follow the curve. Each step's rate is the source it covers divided by the timeline time it
 * lasts, so the buffer ends exactly where the next one begins.
 */
export function rateSteps(item: MediaItem, from: number, to: number): RateStep[] {
  const l0 = localAtPlayed(item, from * 1e6 - item.in);
  const l1 = localAtPlayed(item, to * 1e6 - item.in);
  const n = Math.max(1, Math.ceil((l1 - l0) / 1e6 / RATE_STEP));
  const steps: RateStep[] = [];
  for (let j = 0; j < n; j++) {
    const a = l0 + ((l1 - l0) * j) / n, b = l0 + ((l1 - l0) * (j + 1)) / n;
    const rate = b > a ? (playedOffset(item, b) - playedOffset(item, a)) / (b - a) : edgeSpeed(item, "tail");
    steps.push({ at: (a - l0) / 1e6, rate });
  }
  return steps;
}

/** Speed at one moment, for the short grains played while scrubbing. */
export function speedNow(item: MediaItem, local: Micros): number {
  if (!item.ramp) return item.speed;
  const h = 5_000;
  return (playedOffset(item, local + h) - playedOffset(item, local)) / h;
}

/** Keep the average speed field in step with a ramp so code that only reads `speed` stays close. */
export function syncSpeed(item: MediaItem): void {
  if (item.ramp && item.duration > 0) item.speed = item.ramp.span / item.duration;
}
