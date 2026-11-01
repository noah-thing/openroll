import { describe, expect, it } from "vitest";
import { estimateMotion, pyramid, type Grey } from "../../src/engine/ai/motion";

/** A smooth random scene, sampled with a shift and roll so the true motion is known. */
function scene(w: number, h: number, tx = 0, ty = 0, rot = 0): Grey {
  const waves = Array.from({ length: 24 }, (_, i) => {
    const r = Math.sin(i * 12.9898) * 43758.5453;
    const f = (n: number) => n - Math.floor(n);
    return { fx: (f(r) - 0.5) * 0.35, fy: (f(r * 1.7) - 0.5) * 0.35, ph: f(r * 3.1) * 6.28, a: 0.2 + f(r * 5.3) * 0.5 };
  });
  const data = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // content moves by (+tx, +ty) and rolls: sample the world at the inverse position
      const px = x - cx - tx, py = y - cy - ty;
      const wx = c * px + s * py + cx, wy = -s * px + c * py + cy;
      let v = 0.5;
      for (const k of waves) v += 0.04 * k.a * Math.sin(k.fx * wx + k.fy * wy + k.ph);
      data[y * w + x] = v;
    }
  return { width: w, height: h, data };
}

describe("estimateMotion", () => {
  it("finds a sideways and vertical shift", () => {
    const a = pyramid(scene(256, 144), 3);
    const b = pyramid(scene(256, 144, 3.4, -2.1), 3);
    const m = estimateMotion(a, b);
    expect(m.tx).toBeCloseTo(3.4, 0);
    expect(m.ty).toBeCloseTo(-2.1, 0);
    expect(Math.abs(m.rot)).toBeLessThan(0.004);
  });

  it("finds a small roll", () => {
    const a = pyramid(scene(256, 144), 3);
    const b = pyramid(scene(256, 144, 0, 0, 0.02), 3);
    const m = estimateMotion(a, b);
    expect(m.rot).toBeCloseTo(0.02, 2);
  });

  it("reports no motion for identical frames", () => {
    const a = pyramid(scene(256, 144), 3);
    const m = estimateMotion(a, a);
    expect(Math.abs(m.tx) + Math.abs(m.ty)).toBeLessThan(0.05);
  });
});
