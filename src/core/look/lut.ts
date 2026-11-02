// Adobe/Resolve .cube files. Only the grid and the domain matter for rendering;
// the result is a size^3 RGB table with red varying fastest, which is also the
// memory order a WebGL 3D texture wants.

export interface Lut {
  title: string;
  size: number;
  /** size^3 * 3 values in 0..1, already scaled by the file's domain. */
  data: Float32Array;
}

export class CubeError extends Error {}

const MAX_SIZE = 129;
const MAX_VALUES = MAX_SIZE ** 3 * 3;

export function parseCube(text: string): Lut {
  let title = "";
  let size1d = 0;
  let size3d = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const rows: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const c = line.charCodeAt(0);
    if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) throw new CubeError("A colour row needs three numbers");
      for (let i = 0; i < 3; i++) {
        const v = Number(parts[i]);
        if (!Number.isFinite(v)) throw new CubeError(`Not a number: ${parts[i]}`);
        rows.push(v);
      }
      // No valid table is longer than the biggest grid; stop before a padded file fills memory.
      if (rows.length > MAX_VALUES) throw new CubeError("The LUT has too many colour rows");
      continue;
    }
    const [key, ...rest] = line.split(/\s+/);
    switch (key.toUpperCase()) {
      case "TITLE":
        title = rest.join(" ").replace(/^"|"$/g, "");
        break;
      case "LUT_1D_SIZE":
        size1d = parseInt(rest[0], 10);
        break;
      case "LUT_3D_SIZE":
        size3d = parseInt(rest[0], 10);
        break;
      case "DOMAIN_MIN":
        min = rest.slice(0, 3).map(Number);
        break;
      case "DOMAIN_MAX":
        max = rest.slice(0, 3).map(Number);
        break;
      // Input range keys and anything unknown are ignored.
    }
  }

  const span = [0, 1, 2].map(i => max[i] - min[i] || 1);
  const norm = (rowsIn: number[]) => {
    const out = new Float32Array(rowsIn.length);
    for (let i = 0; i < rowsIn.length; i++) out[i] = Math.min(1, Math.max(0, (rowsIn[i] - min[i % 3]) / span[i % 3]));
    return out;
  };

  if (size3d) {
    if (size3d < 2 || size3d > MAX_SIZE) throw new CubeError("The LUT size is out of range");
    if (rows.length !== size3d ** 3 * 3) throw new CubeError(`Expected ${size3d ** 3} colour rows, found ${rows.length / 3}`);
    return { title, size: size3d, data: norm(rows) };
  }
  if (size1d) {
    if (size1d < 2) throw new CubeError("The LUT size is out of range");
    if (rows.length !== size1d * 3) throw new CubeError(`Expected ${size1d} colour rows, found ${rows.length / 3}`);
    return { title, size: 33, data: expand1d(norm(rows), size1d, 33) };
  }
  throw new CubeError("This is not a .cube file: no LUT_3D_SIZE");
}

/** A per channel 1D curve laid out as a 3D grid, so one code path renders both. */
function expand1d(curve: Float32Array, n: number, size: number): Float32Array {
  const at = (ch: number, x: number) => {
    const f = x * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const k = f - i;
    return curve[i * 3 + ch] * (1 - k) + curve[(i + 1) * 3 + ch] * k;
  };
  const out = new Float32Array(size ** 3 * 3);
  let o = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        out[o++] = at(0, r / (size - 1));
        out[o++] = at(1, g / (size - 1));
        out[o++] = at(2, b / (size - 1));
      }
  return out;
}

/** Sample the table the way the GPU does: trilinear between grid points. */
export function sampleLut(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size;
  const f = (v: number) => Math.min(1, Math.max(0, v)) * (n - 1);
  const [fr, fg, fb] = [f(r), f(g), f(b)];
  const [r0, g0, b0] = [Math.min(n - 2, Math.floor(fr)), Math.min(n - 2, Math.floor(fg)), Math.min(n - 2, Math.floor(fb))];
  const [tr, tg, tb] = [fr - r0, fg - g0, fb - b0];
  const out: [number, number, number] = [0, 0, 0];
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? tr : 1 - tr) * (dy ? tg : 1 - tg) * (dz ? tb : 1 - tb);
        const i = ((b0 + dz) * n * n + (g0 + dy) * n + (r0 + dx)) * 3;
        out[0] += lut.data[i] * w;
        out[1] += lut.data[i + 1] * w;
        out[2] += lut.data[i + 2] * w;
      }
  return out;
}

export function lutToBase64(lut: Lut): string {
  const bytes = new Uint8Array(lut.data.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(lut.data[i] * 255);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function lutFromBase64(size: number, data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  if (out.length !== size ** 3 * 3) throw new CubeError("The stored LUT is damaged");
  return out;
}
