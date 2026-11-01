import { describe, expect, it } from "vitest";
import { SCALE, TILE, tileCount, upscaleWith, type Rgba, type TileRunner } from "../../src/engine/ai/superres";

/** A stand in network that repeats each pixel four by four, so the right answer is known. */
const nearest: TileRunner = async tile => {
  const side = TILE * SCALE;
  const out = new Float32Array(3 * side * side);
  for (let c = 0; c < 3; c++)
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) out[c * side * side + y * side + x] = tile[c * TILE * TILE + Math.floor(y / SCALE) * TILE + Math.floor(x / SCALE)];
  return out;
};

function picture(w: number, h: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = (x * 7) % 256;
      data[p + 1] = (y * 11) % 256;
      data[p + 2] = (x + y) % 256;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe("tiled upscaling", () => {
  for (const [w, h] of [[300, 170], [128, 128], [97, 41], [480, 270]]) {
    it(`covers every pixel of ${w} x ${h} without seams`, async () => {
      const src = picture(w, h);
      const out = await upscaleWith(nearest, src);
      expect(out.width).toBe(w * SCALE);
      let bad = 0;
      for (let y = 0; y < out.height; y += 3)
        for (let x = 0; x < out.width; x += 3) {
          const s = (Math.floor(y / SCALE) * w + Math.floor(x / SCALE)) * 4;
          const d = (y * out.width + x) * 4;
          if (Math.abs(out.data[d] - src.data[s]) > 1 || Math.abs(out.data[d + 1] - src.data[s + 1]) > 1 || out.data[d + 3] !== 255) bad++;
        }
      expect(bad).toBe(0);
    });
  }

  it("counts tiles and can be cancelled", async () => {
    expect(tileCount(480, 270)).toBe(15);
    let calls = 0;
    await expect(upscaleWith(nearest, picture(300, 300), () => calls++, () => calls >= 2)).rejects.toThrow("cancelled");
  });
});
