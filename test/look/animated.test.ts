import { describe, expect, it } from "vitest";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { createProject, findItem, type MediaItem, type MediaRef, type Project } from "../../src/core/project";
import { effectPath, readAt, readBase, setAnimated, toggleDiamond } from "../../src/core/look/animated";
import { addEffectTo, addLut, moveEffect, patchEffect, removeEffect, removeLut, setFilter } from "../../src/core/look/edit";
import { parseCube } from "../../src/core/look/lut";
import { buildScene } from "../../src/core/scene";

const S = 1_000_000;

function setup(): { p: Project; id: string } {
  const ref: MediaRef = { id: "m", kind: "video", path: "/x.mp4", name: "x.mp4", size: 1, mtime: 0, duration: 10 * S, hasAudio: false, hasVideo: true, width: 1920, height: 1080 };
  let p = addMedia(createProject("t"), [ref]);
  const item = mediaItem(ref, 0);
  p = insertItems(p, [item]);
  return { p, id: item.id };
}

const get = (p: Project, id: string) => findItem(p, id)!.item as MediaItem;

describe("animated properties", () => {
  it("writes the plain value until a property has keys", () => {
    const { p, id } = setup();
    const next = setAnimated(p, id, "transform.scale", 2 * S, 1.4);
    expect(get(next, id).transform.scale).toBe(1.4);
    expect(get(next, id).keyframes).toBeUndefined();
    expect(get(p, id).transform.scale).toBe(1);
  });

  it("creates adjust values that did not exist", () => {
    const { p, id } = setup();
    const next = setAnimated(p, id, "adjust.exposure", 0, 30);
    expect(get(next, id).adjust).toEqual({ exposure: 30 });
    expect(readBase(get(next, id), "adjust.exposure")).toBe(30);
  });

  it("a diamond adds a key at the current value, then slider edits become keys", () => {
    const { p, id } = setup();
    let next = toggleDiamond(p, id, "transform.scale", S);
    expect(get(next, id).keyframes!["transform.scale"]).toEqual([{ t: S, v: 1, ease: "ease" }]);
    next = setAnimated(next, id, "transform.scale", 3 * S, 2);
    expect(get(next, id).keyframes!["transform.scale"].map(k => [k.t, k.v])).toEqual([[S, 1], [3 * S, 2]]);
    expect(readAt(get(next, id), "transform.scale", 2 * S)).toBeCloseTo(1.5, 1);
    expect(get(next, id).transform.scale).toBe(1);
  });

  it("removing the last key keeps the value it held", () => {
    const { p, id } = setup();
    let next = toggleDiamond(p, id, "transform.x", S);
    next = setAnimated(next, id, "transform.x", S, 120);
    next = toggleDiamond(next, id, "transform.x", S);
    expect(get(next, id).keyframes).toBeUndefined();
    expect(get(next, id).transform.x).toBe(120);
  });

  it("feeds keyframed adjust, filter and effect values into the scene", () => {
    const { p, id } = setup();
    let next = setFilter(p, id, "halide", 1);
    const added = addEffectTo(next, id, "bloom");
    next = added.project;
    const fx = added.effect!;
    next = toggleDiamond(next, id, "adjust.contrast", 0);
    next = setAnimated(next, id, "adjust.contrast", 4 * S, 80);
    next = toggleDiamond(next, id, "filter.amount", 0);
    next = setAnimated(next, id, "filter.amount", 4 * S, 0);
    next = toggleDiamond(next, id, effectPath(fx.id), 0);
    next = setAnimated(next, id, effectPath(fx.id), 4 * S, 1);
    const at = (t: number) => {
      const node = buildScene(next, t)[0];
      if (node.kind !== "visual" || node.visual.kind !== "media") throw new Error("no media");
      return node.visual.place;
    };
    expect(at(2 * S).adjust!.contrast).toBeCloseTo(40, 0);
    expect(at(2 * S).filter!.amount).toBeCloseTo(0.5, 1);
    expect(at(2 * S).effects![0].amount).toBeCloseTo((fx.amount + 1) / 2, 1);
    expect(at(2 * S).time).toBe(2);
  });
});

describe("look edits", () => {
  it("adds, reorders and removes effects, and clears their keys", () => {
    const { p, id } = setup();
    const a = addEffectTo(p, id, "prism");
    const b = addEffectTo(a.project, id, "tape");
    let next = moveEffect(b.project, id, b.effect!.id, -1);
    expect(get(next, id).effects!.map(e => e.kind)).toEqual(["tape", "prism"]);
    next = patchEffect(next, id, a.effect!.id, e => void (e.off = true));
    expect(get(next, id).effects![1].off).toBe(true);
    next = toggleDiamond(next, id, effectPath(a.effect!.id), 0);
    next = removeEffect(next, id, a.effect!.id);
    expect(get(next, id).effects!.map(e => e.kind)).toEqual(["tape"]);
    expect(get(next, id).keyframes).toBeUndefined();
    next = removeEffect(next, id, b.effect!.id);
    expect(get(next, id).effects).toBeUndefined();
  });

  it("stores an imported LUT and drops filters that used it", () => {
    const { p, id } = setup();
    const lut = parseCube("LUT_3D_SIZE 2\n" + ["0 0 0", "1 0 0", "0 1 0", "1 1 0", "0 0 1", "1 0 1", "0 1 1", "1 1 1"].join("\n"));
    const r = addLut(p, "Plain", lut);
    expect(r.id.startsWith("lut:")).toBe(true);
    expect(r.project.luts![r.id].size).toBe(2);
    let next = setFilter(r.project, id, r.id, 0.7);
    expect(get(next, id).filter).toEqual({ id: r.id, amount: 0.7 });
    next = removeLut(next, r.id);
    expect(next.luts).toBeUndefined();
    expect(get(next, id).filter).toBeUndefined();
  });

  it("ignores a filter on something that is not a media item", () => {
    const { p } = setup();
    expect(setFilter(p, "nope", "halide")).toBe(p);
  });
});
