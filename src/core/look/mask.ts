import type { Mask } from "../project";

export function defaultMask(shape: Mask["shape"]): Mask {
  const base: Mask = { shape, x: 0, y: 0, width: 0.6, height: 0.6, rotation: 0, feather: 0.1, invert: false };
  switch (shape) {
    case "rect":
      return { ...base, width: 0.7, height: 0.6, feather: 0.04 };
    case "linear":
      return { ...base, width: 1, height: 1 };
    case "mirror":
      return { ...base, width: 1, height: 0.4, feather: 0.06 };
    default:
      return base;
  }
}

/**
 * Coverage of the mask at a point of the item box, 0..1. `u` and `v` run 0..1 across the
 * box. The maths is done in pixels of the box so circles stay round. The compositor runs
 * the same formulas in GLSL; keep the two in step.
 */
export function maskAlpha(m: Mask, u: number, v: number, boxW: number, boxH: number): number {
  const px = (u - 0.5 - m.x) * boxW;
  const py = (v - 0.5 - m.y) * boxH;
  const a = (-m.rotation * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const qx = px * c - py * s;
  const qy = px * s + py * c;
  const hx = (m.width * boxW) / 2, hy = (m.height * boxH) / 2;

  let d: number;
  if (m.shape === "rect") {
    const ax = Math.abs(qx) - hx, ay = Math.abs(qy) - hy;
    d = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0);
  } else if (m.shape === "ellipse") {
    d = (Math.hypot(qx / Math.max(hx, 1e-4), qy / Math.max(hy, 1e-4)) - 1) * Math.min(hx, hy);
  } else if (m.shape === "linear") {
    d = -qy;
  } else {
    d = Math.abs(qy) - hy;
  }
  const f = Math.max(m.feather * Math.min(boxW, boxH) * 0.5, 1);
  const t = Math.min(1, Math.max(0, (d + f) / (2 * f)));
  const inside = 1 - t * t * (3 - 2 * t);
  return m.invert ? 1 - inside : inside;
}
