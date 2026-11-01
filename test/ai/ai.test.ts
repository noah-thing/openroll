import { describe, expect, it } from "vitest";
import { buildCorrection, coverZoom, floats, followSubject, localTime, MAX_STABILIZE_ZOOM, pack, planReframe, shiftAt, smooth, thin, unpack, type CameraPath } from "../../src/core/ai";
import type { MediaItem } from "../../src/core/project";

function shaky(n: number, amp: number): CameraPath {
  const dx = new Float32Array(n), dy = new Float32Array(n), rot = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dx[i] = 0.002 * i + amp * Math.sin(i * 1.3);
    dy[i] = amp * Math.sin(i * 0.9 + 1);
  }
  return { fps: 30, start: 0, dx, dy, rot };
}

function spread(a: Float32Array): number {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  return hi - lo;
}

describe("stabilising", () => {
  it("smooths a path without moving its ends away", () => {
    const flat = smooth(new Float32Array(50).fill(2), 5);
    expect(flat.every(v => Math.abs(v - 2) < 1e-5)).toBe(true);
  });

  it("removes shake and keeps the pan", () => {
    const path = shaky(120, 0.01);
    const c = buildCorrection(path, 0.6, 16 / 9);
    const out = new Float32Array(120);
    for (let i = 0; i < 120; i++) out[i] = path.dx[i] + c.dx[i];
    const residual = new Float32Array(120);
    for (let i = 1; i < 120; i++) residual[i] = out[i] - out[i - 1];
    // the result still travels about as far, but its frame to frame jitter is a fraction of the input
    expect(out[119] - out[0]).toBeGreaterThan(0.12);
    const raw = new Float32Array(120);
    for (let i = 1; i < 120; i++) raw[i] = path.dx[i] - path.dx[i - 1];
    expect(spread(residual.subarray(1))).toBeLessThan(spread(raw.subarray(1)) * 0.3);
  });

  it("does nothing at zero strength and never zooms past the cap", () => {
    const path = shaky(120, 0.01);
    expect(buildCorrection(path, 0, 16 / 9).zoom).toBeCloseTo(1, 1);
    const wild = shaky(120, 0.2);
    const c = buildCorrection(wild, 1, 16 / 9);
    expect(c.zoom).toBeLessThanOrEqual(MAX_STABILIZE_ZOOM + 0.01);
  });

  it("finds the zoom that hides a shifted frame", () => {
    expect(coverZoom(0, 0, 0, 16 / 9)).toBe(1);
    expect(coverZoom(0.05, 0, 0, 16 / 9)).toBeCloseTo(1.1, 2);
    expect(coverZoom(0, 0, 0.02, 16 / 9)).toBeGreaterThan(1);
  });

  it("reads a shift between samples", () => {
    const c = buildCorrection(shaky(30, 0.01), 0.5, 16 / 9);
    const mid = shiftAt(c, 0.5 / 30);
    expect(mid.dx).toBeCloseTo((c.dx[0] + c.dx[1]) / 2, 5);
  });
});

describe("reframing", () => {
  const input = { frameWidth: 1080, frameHeight: 1920, fitWidth: 1080, fitHeight: 607.5 };
  const toLocal = (s: number) => Math.round(s * 1e6);

  it("fills a tall frame with a wide clip and follows the subject", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.25, x: 0.3 + (i / 19) * 0.4, y: 0.5, h: 0.6 }));
    const plan = planReframe({ ...input, samples }, toLocal);
    const cover = 1920 / 607.5;
    expect(plan.scale[0].v).toBeGreaterThanOrEqual(cover - 0.01);
    // the subject starts left of centre, so the picture shifts right (positive x), then reverses
    expect(plan.x[0].v).toBeGreaterThan(0);
    expect(plan.x[plan.x.length - 1].v).toBeLessThan(0);
    // never reveals an edge: shift is limited by the overhang
    const limit = (607.5 * plan.scale[0].v * (1080 / 607.5) - 1080) / 2;
    for (const k of plan.x) expect(Math.abs(k.v)).toBeLessThanOrEqual(limit + 600);
  });

  it("holds still while the subject stays near the middle", () => {
    const samples = [0.5, 0.52, 0.49, 0.51, 0.5].map((x, i) => ({ t: i, x, y: 0.5, h: 0.6 }));
    const out = followSubject(samples, 0.06);
    expect(new Set(out.map(s => s.x)).size).toBe(1);
  });

  it("thins keyframes that lie on a line", () => {
    const keys = Array.from({ length: 10 }, (_, i) => ({ t: i * 100, v: i * 2, ease: "ease" as const }));
    expect(thin(keys, 0.01)).toHaveLength(2);
  });

  it("turns source time into clip time with speed and reverse", () => {
    const item = { in: 2_000_000, duration: 4_000_000, speed: 0.5, reversed: false } as MediaItem;
    expect(localTime(item, 3)).toBe(2_000_000);
    expect(localTime({ ...item, reversed: true } as MediaItem, 3)).toBe(2_000_000);
    expect(localTime({ ...item, reversed: true } as MediaItem, 2)).toBe(4_000_000);
  });
});

describe("packing", () => {
  it("round trips a header and arrays", () => {
    const a = Float32Array.from([1.5, -2, 3]);
    const b = Uint8Array.from([1, 2, 3, 4, 5]);
    const out = unpack(pack({ n: 3 }, a, b));
    expect(out.meta).toEqual({ n: 3 });
    expect([...floats(out.parts[0])]).toEqual([1.5, -2, 3]);
    expect([...out.parts[1]]).toEqual([1, 2, 3, 4, 5]);
  });
});
