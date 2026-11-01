import type { CurvePoint, Curves } from "../project";

export const FLAT_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1 / 3, y: 1 / 3 },
  { x: 2 / 3, y: 2 / 3 },
  { x: 1, y: 1 },
];

export function isFlat(points?: CurvePoint[]): boolean {
  return !points || points.every(p => Math.abs(p.x - p.y) < 1e-3);
}

export function curvesAreFlat(c?: Curves): boolean {
  return !c || (isFlat(c.master) && isFlat(c.r) && isFlat(c.g) && isFlat(c.b));
}

/**
 * Evaluate a monotone cubic through the points (Fritsch-Carlson), so a curve never
 * overshoots between points and never inverts the picture.
 */
export function makeCurve(points: CurvePoint[]): (x: number) => number {
  const p = [...points].sort((a, b) => a.x - b.x);
  const n = p.length;
  if (n < 2) return x => x;
  const dx = new Array<number>(n - 1);
  const slope = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(1e-6, p[i + 1].x - p[i].x);
    slope[i] = (p[i + 1].y - p[i].y) / dx[i];
  }
  const m = new Array<number>(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slope[i]) < 1e-9) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * slope[i]) / h;
      m[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  return x => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    let i = 0;
    while (p[i + 1].x < x) i++;
    const h = dx[i], t = (x - p[i].x) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1];
  };
}

/** 256 RGBA texels: red, green and blue lookups with the master curve folded in. */
export function bakeCurves(c: Curves): Uint8Array {
  const master = makeCurve(c.master ?? FLAT_CURVE);
  const chans = [c.r, c.g, c.b].map(pts => makeCurve(pts ?? FLAT_CURVE));
  const out = new Uint8Array(256 * 4);
  const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = clamp(chans[ch](master(x)));
    out[i * 4 + 3] = 255;
  }
  return out;
}
