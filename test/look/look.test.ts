import { describe, expect, it } from "vitest";
import { parseCube, sampleLut, lutToBase64, lutFromBase64, CubeError } from "../../src/core/look/lut";
import { bakeCurves, curvesAreFlat, FLAT_CURVE, makeCurve } from "../../src/core/look/curves";
import { defaultMask, maskAlpha } from "../../src/core/look/mask";
import { EASINGS, isAnimated, keyIndexAt, keyTimes, neighbourKey, removeKey, setEase, setKey, toggleKey } from "../../src/core/look/keyframes";
import { FILTERS, FILTER_GROUPS } from "../../src/core/look/filters";
import { EFFECTS, effectIndex, newEffect } from "../../src/core/look/effects";
import { sample } from "../../src/core/animate";

function identityCube(n: number, extra = ""): string {
  const rows: string[] = [];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return `# made by a test\nTITLE "Identity"\nLUT_3D_SIZE ${n}\n${extra}\n${rows.join("\n")}\n`;
}

describe("cube parsing", () => {
  it("reads an identity LUT and samples it back unchanged", () => {
    const lut = parseCube(identityCube(5));
    expect(lut.size).toBe(5);
    expect(lut.title).toBe("Identity");
    const [r, g, b] = sampleLut(lut, 0.3, 0.6, 0.9);
    expect(r).toBeCloseTo(0.3, 5);
    expect(g).toBeCloseTo(0.6, 5);
    expect(b).toBeCloseTo(0.9, 5);
  });

  it("keeps red fastest in memory", () => {
    const lut = parseCube(identityCube(3));
    expect(Array.from(lut.data.slice(3, 6))).toEqual([0.5, 0, 0]);
    expect(Array.from(lut.data.slice(9, 12))).toEqual([0, 0.5, 0]);
  });

  it("rescales by the domain", () => {
    const text = "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n" + ["0 0 0", "2 0 0", "0 2 0", "2 2 0", "0 0 2", "2 0 2", "0 2 2", "2 2 2"].join("\n");
    const lut = parseCube(text);
    expect(Math.max(...lut.data)).toBe(1);
  });

  it("expands a 1D LUT", () => {
    const lut = parseCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n");
    expect(lut.size).toBe(33);
    const [r, g, b] = sampleLut(lut, 0.5, 0.25, 1);
    expect([r, g, b].map(v => Math.round(v * 100) / 100)).toEqual([0.5, 0.25, 1]);
  });

  it("rejects bad files with a plain message", () => {
    expect(() => parseCube("hello")).toThrow(CubeError);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(/Expected 8/);
    expect(() => parseCube("LUT_3D_SIZE 2\n" + "a b c\n".repeat(8))).toThrow();
  });

  it("round trips through base64 bytes", () => {
    const lut = parseCube(identityCube(4));
    const bytes = lutFromBase64(4, lutToBase64(lut));
    expect(bytes.length).toBe(4 ** 3 * 3);
    expect(bytes[3]).toBe(Math.round(lut.data[3] * 255));
    expect(() => lutFromBase64(5, lutToBase64(lut))).toThrow();
  });
});

describe("curves", () => {
  it("leaves a flat curve alone", () => {
    expect(curvesAreFlat({})).toBe(true);
    expect(curvesAreFlat({ master: FLAT_CURVE })).toBe(true);
    const tex = bakeCurves({});
    expect(tex[0]).toBe(0);
    expect(tex[128 * 4]).toBe(128);
    expect(tex[255 * 4]).toBe(255);
  });

  it("passes through its control points", () => {
    const f = makeCurve([{ x: 0, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.7, y: 0.9 }, { x: 1, y: 1 }]);
    expect(f(0)).toBeCloseTo(0.1);
    expect(f(0.3)).toBeCloseTo(0.2);
    expect(f(0.7)).toBeCloseTo(0.9);
    expect(f(1)).toBeCloseTo(1);
  });

  it("never overshoots or goes backwards", () => {
    const f = makeCurve([{ x: 0, y: 0 }, { x: 0.3, y: 0.05 }, { x: 0.35, y: 0.95 }, { x: 1, y: 1 }]);
    let last = -1;
    for (let i = 0; i <= 200; i++) {
      const v = f(i / 200);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      last = v;
    }
  });

  it("folds the master curve into every channel", () => {
    const tex = bakeCurves({ master: [{ x: 0, y: 0 }, { x: 0.33, y: 0.5 }, { x: 0.66, y: 0.8 }, { x: 1, y: 1 }], b: [{ x: 0, y: 0 }, { x: 0.33, y: 0.2 }, { x: 0.66, y: 0.5 }, { x: 1, y: 1 }] });
    const i = 84 * 4;
    expect(tex[i]).toBeGreaterThan(110);
    expect(tex[i + 2]).toBeLessThan(tex[i]);
  });
});

describe("mask maths", () => {
  const W = 1600, H = 900;

  it("keeps the inside of an ellipse and drops the outside", () => {
    const m = { ...defaultMask("ellipse"), feather: 0 };
    expect(maskAlpha(m, 0.5, 0.5, W, H)).toBe(1);
    expect(maskAlpha(m, 0.02, 0.02, W, H)).toBe(0);
  });

  it("stays round on a wide box", () => {
    const m = { ...defaultMask("ellipse"), width: 0.5, height: 0.5 * (W / H), feather: 0 };
    // equal radii in pixels: 400 px wide each way
    expect(maskAlpha(m, 0.5 + 380 / W, 0.5, W, H)).toBe(1);
    expect(maskAlpha(m, 0.5, 0.5 + 380 / H, W, H)).toBe(1);
    expect(maskAlpha(m, 0.5 + 420 / W, 0.5, W, H)).toBe(0);
  });

  it("feathers across the edge", () => {
    const m = { ...defaultMask("rect"), width: 0.5, height: 0.5, feather: 0.2 };
    const edge = 0.5 + 0.25;
    const a = maskAlpha(m, edge, 0.5, W, H);
    expect(a).toBeGreaterThan(0.4);
    expect(a).toBeLessThan(0.6);
    expect(maskAlpha(m, edge + 0.1, 0.5, W, H)).toBeLessThan(0.1);
  });

  it("inverts", () => {
    const m = { ...defaultMask("rect"), feather: 0, invert: true };
    expect(maskAlpha(m, 0.5, 0.5, W, H)).toBe(0);
    expect(maskAlpha(m, 0.02, 0.5, W, H)).toBe(1);
  });

  it("follows the centre offset and rotation", () => {
    const m = { ...defaultMask("rect"), x: 0.25, width: 0.1, height: 0.4, feather: 0 };
    expect(maskAlpha(m, 0.75, 0.5, W, H)).toBe(1);
    expect(maskAlpha(m, 0.5, 0.5, W, H)).toBe(0);
    const turned = { ...m, x: 0, y: 0, rotation: 90, width: 0.1, height: 0.8 };
    // a tall bar turned a quarter becomes a wide one
    expect(maskAlpha(turned, 0.5 + 0.2, 0.5, W, H)).toBe(1);
  });

  it("linear keeps one side, mirror keeps a band", () => {
    const lin = { ...defaultMask("linear"), feather: 0 };
    expect(maskAlpha(lin, 0.5, 0.8, W, H)).toBe(1);
    expect(maskAlpha(lin, 0.5, 0.2, W, H)).toBe(0);
    const band = { ...defaultMask("mirror"), feather: 0 };
    expect(maskAlpha(band, 0.1, 0.5, W, H)).toBe(1);
    expect(maskAlpha(band, 0.1, 0.05, W, H)).toBe(0);
    expect(maskAlpha(band, 0.1, 0.95, W, H)).toBe(0);
  });
});

describe("keyframe edits", () => {
  const S = 1_000_000;

  it("adds, overwrites and sorts keys", () => {
    let m = setKey(undefined, "transform.scale", 2 * S, 2);
    m = setKey(m, "transform.scale", 0, 1);
    m = setKey(m, "transform.scale", 2 * S + 1000, 3);
    expect(m!["transform.scale"].map(k => [k.t, k.v])).toEqual([[0, 1], [2 * S, 3]]);
  });

  it("toggles the diamond and removes the property when its last key goes", () => {
    let m = toggleKey(undefined, "transform.x", S, 40);
    expect(isAnimated({ keyframes: m } as never, "transform.x")).toBe(true);
    expect(keyIndexAt(m!["transform.x"], S + 3000)).toBe(0);
    m = toggleKey(m, "transform.x", S + 3000, 40);
    expect(m).toBeUndefined();
  });

  it("keeps easing when a key is rewritten and can change it", () => {
    let m = setKey(undefined, "p", 0, 0, "easeIn");
    m = setKey(m, "p", 0, 5);
    expect(m!.p[0]).toMatchObject({ v: 5, ease: "easeIn" });
    m = setEase(m, "p", 0, "hold");
    expect(m!.p[0].ease).toBe("hold");
    expect(EASINGS.map(e => e.value)).toContain("hold");
  });

  it("finds neighbouring keys across properties", () => {
    let m = setKey(undefined, "a", S, 1);
    m = setKey(m, "b", 3 * S, 1);
    m = setKey(m, "a", 3 * S, 2);
    expect(keyTimes(m)).toEqual([S, 3 * S]);
    expect(neighbourKey(m, 0, 1)).toBe(S);
    expect(neighbourKey(m, S, 1)).toBe(3 * S);
    expect(neighbourKey(m, 3 * S, 1)).toBeNull();
    expect(neighbourKey(m, 2 * S, -1)).toBe(S);
    expect(neighbourKey(m, S, -1)).toBeNull();
  });

  it("interpolates what it stored", () => {
    let m = setKey(undefined, "p", 0, 0, "linear");
    m = setKey(m, "p", 2 * S, 10, "linear");
    expect(sample(m!.p, S)).toBeCloseTo(5);
    m = removeKey(m, "p", 2 * S);
    expect(sample(m!.p, S)).toBe(0);
  });
});

describe("catalogues", () => {
  it("has 24 filters in four groups with unique ids", () => {
    expect(FILTERS.length).toBe(24);
    expect(new Set(FILTERS.map(f => f.id)).size).toBe(24);
    for (const g of FILTER_GROUPS) expect(FILTERS.some(f => f.group === g)).toBe(true);
  });

  it("has at least 20 effects and indexes match their order", () => {
    expect(EFFECTS.filter(e => !e.internal).length).toBeGreaterThanOrEqual(20);
    EFFECTS.forEach((e, i) => expect(effectIndex(e.kind)).toBe(i));
    const fx = newEffect("thump");
    expect(fx.params?.speed).toBe(2);
    expect(newEffect("mirror").params?.style).toBe(0);
  });
});

describe("parseCube limits", () => {
  it("stops reading a table padded far past the largest grid", () => {
    const text = "LUT_3D_SIZE 2\n" + "0 0 0\n".repeat(2_200_000);
    expect(() => parseCube(text)).toThrow(CubeError);
  });
});
