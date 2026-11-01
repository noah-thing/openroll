// Camera motion between two frames: a translation and a small roll, found by Gauss Newton
// on a grey image pyramid. Everything runs on frames of a few hundred pixels, which is
// plenty to see handheld shake and costs about a millisecond per pair.

export interface Grey {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Motion {
  /** Shift in pixels of this image's own size. */
  tx: number;
  ty: number;
  /** Roll in radians about the image centre. */
  rot: number;
  /** 0..1, how well the two frames agree after the fit. Low means the estimate is not to be trusted. */
  confidence: number;
}

export function toGrey(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Grey {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) / 255;
  return { width, height, data };
}

export function halve(g: Grey): Grey {
  const w = Math.max(1, g.width >> 1), h = Math.max(1, g.height >> 1);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * 2 * g.width + x * 2;
      data[y * w + x] = (g.data[i] + g.data[i + 1] + g.data[i + g.width] + g.data[i + g.width + 1]) / 4;
    }
  return { width: w, height: h, data };
}

/** Light blur so the gradients that drive the fit are not all pixel noise. */
export function soften(g: Grey): Grey {
  const { width: w, height: h } = g;
  const tmp = new Float32Array(g.data.length), out = new Float32Array(g.data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = g.data[y * w + Math.max(0, x - 1)], c = g.data[y * w + x], r = g.data[y * w + Math.min(w - 1, x + 1)];
      tmp[y * w + x] = (l + 2 * c + r) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = tmp[Math.max(0, y - 1) * w + x], c = tmp[y * w + x], d = tmp[Math.min(h - 1, y + 1) * w + x];
      out[y * w + x] = (u + 2 * c + d) / 4;
    }
  return { width: w, height: h, data: out };
}

export function pyramid(g: Grey, levels: number): Grey[] {
  const out = [soften(g)];
  for (let i = 1; i < levels; i++) out.push(soften(halve(out[i - 1])));
  return out;
}

function bilinear(g: Grey, x: number, y: number): number {
  const { width: w, height: h, data } = g;
  x = Math.min(w - 1.001, Math.max(0, x));
  y = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
}

/**
 * Where is the content of `a` in `b`? Both are pyramids of the same shape. The returned
 * motion is in pixels of the finest level.
 */
export function estimateMotion(a: Grey[], b: Grey[], start: Motion = { tx: 0, ty: 0, rot: 0, confidence: 0 }): Motion {
  const top = a.length - 1;
  let tx = start.tx / 2 ** top, ty = start.ty / 2 ** top, rot = start.rot;
  let confidence = 0;
  for (let level = top; level >= 0; level--) {
    const A = a[level], B = b[level];
    const w = A.width, h = A.height;
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    // ignore a border the warp would sample outside of
    const margin = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    for (let iter = 0; iter < 6; iter++) {
      const c = Math.cos(rot), s = Math.sin(rot);
      // normal equations for (tx, ty, rot), with weights that shrink big residuals
      const H = new Float64Array(9), g = new Float64Array(3);
      const residuals: number[] = [];
      const samples: { jx: number; jy: number; jr: number; e: number }[] = [];
      for (let y = margin; y < h - margin; y += 1) {
        for (let x = margin; x < w - margin; x += 1) {
          const px = x - cx, py = y - cy;
          const wx = c * px - s * py + cx + tx, wy = s * px + c * py + cy + ty;
          if (wx < 1 || wy < 1 || wx > w - 2 || wy > h - 2) continue;
          const gx = (bilinear(B, wx + 1, wy) - bilinear(B, wx - 1, wy)) * 0.5;
          const gy = (bilinear(B, wx, wy + 1) - bilinear(B, wx, wy - 1)) * 0.5;
          if (gx * gx + gy * gy < 1e-5) continue;
          const e = bilinear(B, wx, wy) - A.data[y * w + x];
          const rx = wx - cx - tx, ry = wy - cy - ty;
          samples.push({ jx: gx, jy: gy, jr: -gx * ry + gy * rx, e });
          residuals.push(Math.abs(e));
        }
      }
      if (samples.length < 40) return { tx: tx * 2 ** level, ty: ty * 2 ** level, rot, confidence: 0 };
      residuals.sort((p, q) => p - q);
      const sigma = Math.max(0.01, residuals[Math.floor(residuals.length * 0.5)] * 1.5);
      for (const smp of samples) {
        const wgt = 1 / (1 + (smp.e / sigma) ** 2);
        const j = [smp.jx, smp.jy, smp.jr];
        for (let r = 0; r < 3; r++) {
          g[r] -= wgt * j[r] * smp.e;
          for (let q = 0; q < 3; q++) H[r * 3 + q] += wgt * j[r] * j[q];
        }
      }
      // a touch of damping keeps flat scenes from throwing the roll around
      for (let r = 0; r < 3; r++) H[r * 3 + r] += 1e-6 * samples.length + (r === 2 ? 1e-3 * samples.length : 0);
      const d = solve3(H, g);
      if (!d) break;
      tx += d[0];
      ty += d[1];
      rot += d[2];
      if (level === 0) confidence = 1 / (1 + (sigma * 20) ** 2);
      if (Math.abs(d[0]) + Math.abs(d[1]) < 0.002 && Math.abs(d[2]) < 1e-5) break;
    }
    if (level > 0) {
      tx *= 2;
      ty *= 2;
    }
  }
  return { tx, ty, rot, confidence };
}

function solve3(m: Float64Array, v: Float64Array): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  const inv = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  return [
    inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2],
    inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2],
    inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2],
  ];
}
