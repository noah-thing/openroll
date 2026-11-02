import { describe, expect, it } from "vitest";
import { imageTileWidth } from "../../src/renderer/ui/timeline/layout";

describe("imageTileWidth", () => {
  it("is zero where there is no height, so a tiling loop cannot stall", () => {
    expect(imageTileWidth(1600, 900, 0)).toBe(0);
    expect(imageTileWidth(0, 0, 40)).toBe(0);
    expect(imageTileWidth(1, 4000, 10)).toBe(0);
  });

  it("keeps the picture's shape otherwise", () => {
    expect(imageTileWidth(1600, 900, 54)).toBeCloseTo(96);
  });
});
