import { describe, expect, it } from "vitest";
import type { Layer, Node } from "../../src/engine/compositor";
import { frameKey } from "../../src/engine/frame-key";

const layer = (extra: Partial<Layer> = {}): Layer => ({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  time: 1,
  source: { key: "a", pixels: null, version: 1, width: 10, height: 10 },
  ...extra,
});
const key = (l: Layer) => frameKey([{ kind: "layer", layer: l } as Node], [0, 0, 0], 960, 540);

describe("frame key", () => {
  it("stays put while the picture and the look stay put, however the clock moves", () => {
    expect(key(layer({ time: 1 }))).toBe(key(layer({ time: 1.4 })));
  });

  it("changes with a new source frame, a move, or another size", () => {
    const base = key(layer());
    expect(key(layer({ source: { key: "a", pixels: null, version: 2, width: 10, height: 10 } }))).not.toBe(base);
    expect(key(layer({ x: 3 }))).not.toBe(base);
    expect(frameKey([{ kind: "layer", layer: layer() }], [0, 0, 0], 480, 270)).not.toBe(base);
  });

  it("follows the clock for effects that move", () => {
    const moving = (time: number) => layer({ time, effects: [{ id: "e", kind: "tape", amount: 0.5, speed: 1, style: 0 }] });
    expect(key(moving(1))).not.toBe(key(moving(1.01)));
  });

  it("ignores the clock for effects that hold still", () => {
    const still = (time: number) => layer({ time, effects: [{ id: "e", kind: "bloom", amount: 0.5, speed: 1, style: 0 }] });
    expect(key(still(1))).toBe(key(still(1.4)));
  });

  it("steps grain 24 times a second", () => {
    const grainy = (time: number) => layer({ time, adjust: { grain: 30 } });
    expect(key(grainy(1.001))).toBe(key(grainy(1.02)));
    expect(key(grainy(1.001))).not.toBe(key(grainy(1.05)));
  });
});
