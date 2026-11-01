import { session } from "./models";

export const TILE = 128;
const OVERLAP = 8;
const STEP = TILE - OVERLAP * 2;
export const SCALE = 4;

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Runs the network on one planar 3 x 128 x 128 tile in 0..1 and returns 3 x 512 x 512. */
export type TileRunner = (tile: Float32Array) => Promise<Float32Array>;

export function tileCount(width: number, height: number): number {
  return Math.ceil(width / STEP) * Math.ceil(height / STEP);
}

/**
 * Real ESRGAN compact, four times larger. The network takes fixed 128 pixel squares, so the
 * picture is cut into overlapping tiles and each one keeps only its middle, which hides the
 * seams. Tiles that would hang over the picture are slid back inside it.
 */
export async function upscaleWith(run: TileRunner, src: Rgba, onTile?: (done: number, total: number) => void, isCancelled?: () => boolean): Promise<Rgba> {
  const { width: w, height: h } = src;
  const out: Rgba = { width: w * SCALE, height: h * SCALE, data: new Uint8ClampedArray(w * SCALE * h * SCALE * 4) };
  const input = new Float32Array(3 * TILE * TILE);
  const side = TILE * SCALE;
  const total = tileCount(w, h);
  let n = 0;
  for (let ty = 0; ty < h; ty += STEP) {
    for (let tx = 0; tx < w; tx += STEP) {
      if (isCancelled?.()) throw new Error("cancelled");
      const x0 = Math.max(0, Math.min(w - TILE, tx - OVERLAP)), y0 = Math.max(0, Math.min(h - TILE, ty - OVERLAP));
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const p = (Math.min(h - 1, y0 + y) * w + Math.min(w - 1, x0 + x)) * 4;
          const i = y * TILE + x;
          input[i] = src.data[p] / 255;
          input[TILE * TILE + i] = src.data[p + 1] / 255;
          input[2 * TILE * TILE + i] = src.data[p + 2] / 255;
        }
      const o = await run(input);
      for (let y = ty; y < Math.min(h, ty + STEP); y++)
        for (let x = tx; x < Math.min(w, tx + STEP); x++) {
          for (let sy = 0; sy < SCALE; sy++)
            for (let sx = 0; sx < SCALE; sx++) {
              const i = ((y - y0) * SCALE + sy) * side + (x - x0) * SCALE + sx;
              const d = ((y * SCALE + sy) * out.width + x * SCALE + sx) * 4;
              out.data[d] = o[i] * 255;
              out.data[d + 1] = o[side * side + i] * 255;
              out.data[d + 2] = o[2 * side * side + i] * 255;
              out.data[d + 3] = 255;
            }
        }
      onTile?.(++n, total);
    }
  }
  return out;
}

export async function upscale(src: Rgba, onTile?: (done: number, total: number) => void, isCancelled?: () => boolean): Promise<Rgba> {
  const [ort, net] = await Promise.all([import("onnxruntime-web"), session("superres")]);
  const run: TileRunner = async tile => {
    const r = await net.run({ image: new ort.Tensor("float32", tile, [1, 3, TILE, TILE]) });
    return r.upscaled_image.data as Float32Array;
  };
  return upscaleWith(run, src, onTile, isCancelled);
}
