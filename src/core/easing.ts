// Easing curves for keyframes and speed ramps. A named easing is a fixed shape; a cubic
// bezier is four numbers, the two inner control points of a curve that runs from (0, 0)
// to (1, 1), the same convention CSS uses.

import type { CubicBezier, Ease } from "./project";

const NAMED: Record<string, (x: number) => number> = {
  linear: x => x,
  ease: x => x * x * (3 - 2 * x),
  easeIn: x => x * x * x,
  easeOut: x => 1 - (1 - x) ** 3,
  hold: () => 0,
};

/** The named shapes written as beziers. Their x control points sit a third and two thirds along, which makes x(s) = s, so they match the closed forms above exactly. */
const AS_BEZIER: Record<string, CubicBezier> = {
  linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  ease: [1 / 3, 0, 2 / 3, 1],
  easeIn: [1 / 3, 0, 2 / 3, 0],
  easeOut: [1 / 3, 1, 2 / 3, 1],
};

export function isNamedEase(v: unknown): v is string {
  return typeof v === "string" && Object.hasOwn(NAMED, v);
}

/** Whether a value read from a file is a usable ease: a known name, or four finite numbers with x inside 0..1. */
export function isEase(v: unknown): v is Ease {
  if (typeof v === "string") return isNamedEase(v);
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every(n => typeof n === "number" && Number.isFinite(n)) &&
    v[0] >= 0 && v[0] <= 1 && v[2] >= 0 && v[2] <= 1 &&
    Math.abs(v[1]) <= 10 && Math.abs(v[3]) <= 10
  );
}

/** Shape of an ease at x in 0..1. Bezier eases may overshoot 0..1 on the way. */
export function easeAt(e: Ease, x: number): number {
  if (typeof e === "string") return (NAMED[e] ?? NAMED.ease)(x);
  return bezierAt(e, x);
}

function bezierX(c: CubicBezier, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * c[0] + 3 * u * s * s * c[2] + s * s * s;
}

function bezierY(c: CubicBezier, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * c[1] + 3 * u * s * s * c[3] + s * s * s;
}

/** The curve parameter whose x is `x`. x(s) never decreases, so bisection always lands. */
function solveParam(c: CubicBezier, x: number): number {
  let s = x;
  for (let i = 0; i < 6; i++) {
    const err = bezierX(c, s) - x;
    if (Math.abs(err) < 1e-12) return s;
    const u = 1 - s;
    const slope = 3 * u * u * c[0] + 6 * u * s * (c[2] - c[0]) + 3 * s * s * (1 - c[2]);
    if (slope < 1e-6) break;
    s -= err / slope;
    if (s < 0 || s > 1) break;
  }
  let lo = 0, hi = 1;
  s = 0.5;
  for (let i = 0; i < 60; i++) {
    if (bezierX(c, s) < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

function bezierAt(c: CubicBezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return bezierY(c, solveParam(c, x));
}

type Poly = [number[], number[]];

/** Control points of the part of a cubic from `s` to 1. */
function cutRight([x, y]: Poly, s: number): Poly {
  const l = (a: number, b: number) => a + (b - a) * s;
  const x1 = [l(x[0], x[1]), l(x[1], x[2]), l(x[2], x[3])];
  const y1 = [l(y[0], y[1]), l(y[1], y[2]), l(y[2], y[3])];
  const x2 = [l(x1[0], x1[1]), l(x1[1], x1[2])];
  const y2 = [l(y1[0], y1[1]), l(y1[1], y1[2])];
  return [[l(x2[0], x2[1]), x2[1], x1[2], x[3]], [l(y2[0], y2[1]), y2[1], y1[2], y[3]]];
}

/** Control points of the part of a cubic from 0 to `s`. */
function cutLeft([x, y]: Poly, s: number): Poly {
  const l = (a: number, b: number) => a + (b - a) * s;
  const x1 = [l(x[0], x[1]), l(x[1], x[2]), l(x[2], x[3])];
  const y1 = [l(y[0], y[1]), l(y[1], y[2]), l(y[2], y[3])];
  const x2 = [l(x1[0], x1[1]), l(x1[1], x1[2])];
  const y2 = [l(y1[0], y1[1]), l(y1[1], y1[2])];
  return [[x[0], x1[0], x2[0], l(x2[0], x2[1])], [y[0], y1[0], y2[0], l(y2[0], y2[1])]];
}

/**
 * The ease that covers only the part of a segment from fraction f0 to f1, stretched back
 * to run 0..1. A cubic bezier cut with de Casteljau is still a cubic bezier, which is what
 * lets a split leave both halves exactly where the whole curve was.
 */
export function sliceEase(e: Ease, f0: number, f1: number): Ease {
  if (e === "hold") return "hold";
  if (f0 <= 0 && f1 >= 1) return e;
  const c = typeof e === "string" ? AS_BEZIER[e] : e;
  const s0 = f0 <= 0 ? 0 : solveParam(c, f0);
  const s1 = f1 >= 1 ? 1 : solveParam(c, f1);
  const y0 = bezierY(c, s0), y1 = bezierY(c, s1);
  const dy = y1 - y0;
  if (Math.abs(dy) < 1e-9 || s1 - s0 < 1e-9) return "linear";
  const whole: Poly = [[0, c[0], c[2], 1], [0, c[1], c[3], 1]];
  const rest = cutRight(whole, s0);
  const [qx, qy] = cutLeft(rest, s0 >= 1 ? 1 : (s1 - s0) / (1 - s0));
  const dx = qx[3] - qx[0];
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp((qx[1] - qx[0]) / dx), (qy[1] - y0) / dy, clamp((qx[2] - qx[0]) / dx), (qy[2] - y0) / dy];
}

/** The bezier a named ease is drawn with in an editor. Hold has none. */
export function easeAsBezier(e: Ease): CubicBezier | null {
  if (e === "hold") return null;
  return typeof e === "string" ? [...AS_BEZIER[e]] : [...e];
}
