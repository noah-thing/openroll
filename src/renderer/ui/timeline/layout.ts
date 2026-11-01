import type { Micros, Project, Track } from "../../../core/project";
import { itemEnd } from "../../../core/project";

export const HEAD_W = 132;
export const RULER_H = 28;

export function trackHeight(t: Track): number {
  if (t.height) return t.height;
  if (t.main) return 68;
  if (t.kind === "audio") return 46;
  if (t.kind === "text") return 30;
  return 54;
}

export interface LaneBox {
  track: Track;
  top: number;
  height: number;
}

export function lanes(p: Project): LaneBox[] {
  let top = RULER_H;
  return p.tracks.map(track => {
    const box = { track, top, height: trackHeight(track) };
    top += box.height + 2;
    return box;
  });
}

export function laneAt(boxes: LaneBox[], y: number): LaneBox | null {
  return boxes.find(b => y >= b.top - 1 && y < b.top + b.height + 1) ?? null;
}

/** Times worth snapping to: playhead, markers, and every clip edge except the ones moving. */
export function snapPoints(p: Project, playhead: Micros, exclude: Set<string>): number[] {
  const out = [0, playhead];
  for (const m of p.markers) out.push(m.t);
  for (const t of p.tracks) for (const i of t.items) {
    if (exclude.has(i.id)) continue;
    out.push(i.start, itemEnd(i));
  }
  return out;
}

/**
 * Snap `times` (one or both edges of what is being dragged) to the nearest point within
 * `tolerance`. Returns how far to shift and where the guide line goes.
 */
export function snap(times: number[], points: number[], tolerance: number): { shift: number; at: number | null } {
  let best = tolerance;
  let shift = 0;
  let at: number | null = null;
  for (const t of times) {
    for (const p of points) {
      const d = Math.abs(p - t);
      if (d < best) {
        best = d;
        shift = p - t;
        at = p;
      }
    }
  }
  return { shift, at };
}

/** Ruler spacing that keeps labels about 90px apart at any zoom. */
export function rulerStep(pps: number): { major: number; minor: number } {
  const steps = [1 / 30, 1 / 15, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const major = steps.find(s => s * pps >= 90) ?? 3600;
  const minorDiv = major >= 60 ? 6 : major >= 1 ? 5 : 2;
  return { major, minor: major / minorDiv };
}

/** Ids of items whose box touches the rectangle. Times in microseconds, y in content pixels. */
export function itemsInRect(boxes: LaneBox[], t0: Micros, t1: Micros, y0: number, y1: number): string[] {
  const out: string[] = [];
  const [ta, tb] = t0 < t1 ? [t0, t1] : [t1, t0];
  const [ya, yb] = y0 < y1 ? [y0, y1] : [y1, y0];
  for (const b of boxes) {
    if (b.top + b.height < ya || b.top > yb) continue;
    for (const i of b.track.items) if (i.start < tb && itemEnd(i) > ta) out.push(i.id);
  }
  return out;
}
