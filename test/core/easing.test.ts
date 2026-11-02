import { describe, expect, it } from "vitest";
import { sample } from "../../src/core/animate";
import { easeAsBezier, easeAt, isEase, sliceEase } from "../../src/core/easing";
import type { CubicBezier, Ease, Keyframe } from "../../src/core/project";
import { rng } from "./model-gen";

describe("easing", () => {
  it("keeps the named shapes exactly as they were", () => {
    for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
      expect(easeAt("linear", x)).toBe(x);
      expect(easeAt("ease", x)).toBe(x * x * (3 - 2 * x));
      expect(easeAt("easeIn", x)).toBe(x * x * x);
      expect(easeAt("easeOut", x)).toBe(1 - (1 - x) ** 3);
    }
  });

  it("draws every named shape (except hold) as a bezier that matches it", () => {
    for (const name of ["linear", "ease", "easeIn", "easeOut"] as const) {
      const b = easeAsBezier(name)!;
      for (let i = 0; i <= 40; i++) expect(easeAt(b, i / 40)).toBeCloseTo(easeAt(name, i / 40), 9);
    }
    expect(easeAsBezier("hold")).toBeNull();
  });

  it("is exact at the ends and never goes backwards for a bezier whose y rises", () => {
    const r = rng(5);
    for (let n = 0; n < 200; n++) {
      const c: CubicBezier = [r.f(), r.f(), r.f(), r.f()];
      expect(easeAt(c, 0)).toBe(0);
      expect(easeAt(c, 1)).toBe(1);
      let last = -Infinity;
      for (let i = 0; i <= 50; i++) {
        const y = easeAt(c, i / 50);
        expect(y).toBeGreaterThanOrEqual(last - 1e-9);
        last = y;
      }
    }
  });

  it("lets a bezier overshoot", () => {
    const back: CubicBezier = [0.34, 1.56, 0.64, 1];
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeAt(back, i / 50)))).toBeGreaterThan(1.05);
  });

  it("slices a segment so the pieces trace the same curve", () => {
    const r = rng(11);
    const eases: Ease[] = ["linear", "ease", "easeIn", "easeOut", [0.2, 0.9, 0.3, 1], [0.7, -0.3, 0.2, 1.4], [0.05, 0.6, 0.95, 0.4]];
    for (let n = 0; n < 300; n++) {
      const e = r.pick(eases);
      const f0 = r.f() * 0.8, f1 = f0 + 0.05 + r.f() * (0.95 - f0);
      const cut = sliceEase(e, f0, Math.min(1, f1));
      const a = easeAt(e, f0), b = easeAt(e, Math.min(1, f1));
      if (Math.abs(b - a) < 1e-3) continue;
      for (let i = 0; i <= 20; i++) {
        const f = i / 20;
        const whole = (easeAt(e, f0 + f * (Math.min(1, f1) - f0)) - a) / (b - a);
        expect(easeAt(cut, f)).toBeCloseTo(whole, 5);
      }
    }
  });

  it("returns the same ease when the whole segment is asked for, and hold stays hold", () => {
    expect(sliceEase("ease", 0, 1)).toBe("ease");
    expect(sliceEase("hold", 0.2, 0.7)).toBe("hold");
  });

  it("accepts only usable values from a file", () => {
    expect(isEase("hold")).toBe(true);
    expect(isEase([0.2, 0.8, 0.4, 1.2])).toBe(true);
    expect(isEase([1.2, 0, 0.4, 1])).toBe(false);
    expect(isEase([0.2, NaN, 0.4, 1])).toBe(false);
    expect(isEase([0.2, 0, 0.4])).toBe(false);
    expect(isEase("bounce")).toBe(false);
    expect(isEase(null)).toBe(false);
  });
});

describe("keyframes with a bezier ease", () => {
  const keys: Keyframe[] = [
    { t: 0, v: 0, ease: [0.2, 0.9, 0.3, 1] },
    { t: 1_000_000, v: 100, ease: "ease" },
  ];

  it("samples through the curve", () => {
    expect(sample(keys, 0)).toBe(0);
    expect(sample(keys, 1_000_000)).toBe(100);
    expect(sample(keys, 500_000)).toBeGreaterThan(70);
  });

  it("a held value changes on the next key, not a frame after it", () => {
    const held: Keyframe[] = [{ t: 0, v: 1, ease: "hold" }, { t: 100, v: 5, ease: "hold" }, { t: 200, v: 9, ease: "hold" }];
    expect(sample(held, 99)).toBe(1);
    expect(sample(held, 100)).toBe(5);
    expect(sample(held, 150)).toBe(5);
  });
});
