import { describe, expect, it } from "vitest";
import { applyOps, type Op } from "../../src/core/agent/ops";
import { summarize } from "../../src/core/agent/summary";
import { addMedia, setSpeedRamp } from "../../src/core/edit";
import { readProject } from "../../src/core/load";
import { createProject, findItem, mainTrack, sourceSpan, type MediaItem, type MediaRef, type Project } from "../../src/core/project";
import { SPEED_PRESETS } from "../../src/core/speed-presets";
import { copyItems, pasteItems } from "../../src/core/timeline-edit";
import { S } from "./model-gen";

const ref = (id: string, seconds: number): MediaRef => ({ id, kind: "video", path: `/m/${id}.mp4`, name: `${id}.mp4`, size: 1, mtime: 0, duration: seconds * S, hasAudio: true, hasVideo: true, width: 1920, height: 1080 });
const base = (): Project => addMedia(createProject("t"), [ref("a", 10), ref("b", 8)]);
const run = (...ops: Op[]) => applyOps(base(), ops);
const fails = (...ops: unknown[]) => {
  try {
    applyOps(base(), ops as Op[]);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const clipOf = (p: Project, id: string) => findItem(p, id)!.item as MediaItem;

function withRamp(): { p: Project; id: string } {
  const { project, results } = run({ op: "add_clip", media: "a", in: 1, duration: 6, as: "c" }, { op: "speed_ramp", id: "$c", preset: "montage" });
  return { p: project, id: results[0].id! };
}

describe("loading a project with speed curves", () => {
  const load = (v: unknown) => readProject(JSON.stringify(v));

  it("passes a healthy curve through unchanged", () => {
    const { p } = withRamp();
    const r = load(p);
    expect(r.ok && r.repairs).toEqual([]);
    expect(r.ok && r.project).toEqual(p);
  });

  it("opens projects saved before curves existed with nothing to repair", () => {
    const { p, id } = withRamp();
    const old = structuredClone(p);
    delete (clipOf(old, id) as Partial<MediaItem>).ramp;
    const r = load(old);
    expect(r.ok && r.repairs).toEqual([]);
    expect(r.ok && (findItem(r.project, id)!.item as MediaItem).ramp).toBeUndefined();
  });

  it("drops a curve it cannot use and keeps the clip", () => {
    const { p, id } = withRamp();
    for (const ramp of [{ keys: "no", span: 5 }, { keys: [{ x: "a", v: 1 }], span: 5 }, { keys: [{ x: 0, v: 1 }, { x: 1, v: 2 }], span: -3 }, { keys: [{ x: 0, v: 1 }, { x: 1, v: 2 }] }, 7, null, { keys: [], span: 1000 }]) {
      const bad = structuredClone(p) as unknown as { tracks: { items: Record<string, unknown>[] }[] };
      bad.tracks[0].items[0].ramp = ramp;
      const r = load(bad);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const it = findItem(r.project, id)!.item as MediaItem;
      expect(it.ramp).toBeUndefined();
      expect(it.speed).toBeGreaterThan(0);
      expect(r.repairs).toContain("speed curve");
    }
  });

  it("clamps speeds, sorts keys and ignores an unknown easing in a curve", () => {
    const { p, id } = withRamp();
    const odd = structuredClone(p) as unknown as { tracks: { items: Record<string, unknown>[] }[] };
    odd.tracks[0].items[0].ramp = { keys: [{ x: 1, v: 9000 }, { x: 0, v: 0, ease: "bounce" }, { x: 0.5, v: 3, ease: [2, 0, 0, 0] }], span: 6_000_000 };
    const r = load(odd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const it = findItem(r.project, id)!.item as MediaItem;
    expect(it.ramp!.keys.map(k => k.x)).toEqual([0, 0.5, 1]);
    expect(it.ramp!.keys.every(k => k.v >= 0.1 && k.v <= 100)).toBe(true);
    expect(it.ramp!.keys.every(k => k.ease === undefined)).toBe(true);
    expect(it.speed).toBeCloseTo(it.ramp!.span / it.duration, 9);
  });

  it("repairs keyframes with an easing it does not know and drops ones without a number", () => {
    const { p, id } = withRamp();
    const odd = structuredClone(p) as unknown as { tracks: { items: Record<string, unknown>[] }[] };
    odd.tracks[0].items[0].keyframes = {
      "transform.scale": [{ t: 2_000_000, v: 2, ease: [0.2, 0.8, 0.4, 1] }, { t: 0, v: 1, ease: "wobble" }, { t: "x", v: 1, ease: "ease" }, { t: 1, v: NaN, ease: "ease" }],
      "transform.x": "nope",
      "transform.y": [],
    };
    const r = load(odd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = findItem(r.project, id)!.item.keyframes!;
    expect(keys["transform.scale"]).toEqual([{ t: 0, v: 1, ease: "ease" }, { t: 2_000_000, v: 2, ease: [0.2, 0.8, 0.4, 1] }]);
    expect(keys["transform.x"]).toBeUndefined();
    expect(r.repairs).toContain("clip");
  });

  it("keeps a healthy bezier keyframe as it is", () => {
    const { project } = run({ op: "add_clip", media: "a", as: "c" }, { op: "keyframe", id: "$c", prop: "transform.scale", at: 0, value: 1, ease: [0.2, 0.9, 0.3, 1.2] });
    const r = load(project);
    expect(r.ok && r.repairs).toEqual([]);
  });
});

describe("speed_ramp and bezier eases in the AI edit language", () => {
  it("applies a preset and reports the new length", () => {
    const { project, results } = run({ op: "add_clip", media: "a", in: 1, duration: 6, as: "c" }, { op: "speed_ramp", id: "$c", preset: "hero" });
    const it = clipOf(project, results[0].id!);
    expect(it.ramp?.preset).toBe("hero");
    expect(results[1].duration).toBe(it.duration / S);
    expect(sourceSpan(it)).toBe(6 * S);
  });

  it("takes custom points and removes a curve with none", () => {
    const { project, results } = run(
      { op: "add_clip", media: "a", duration: 6, as: "c" },
      { op: "speed_ramp", id: "$c", points: [{ at: 0, speed: 1 }, { at: 0.5, speed: 3, ease: [0.2, 0.9, 0.3, 1] }, { at: 1, speed: 1 }] },
    );
    const it = clipOf(project, results[0].id!);
    expect(it.ramp!.keys).toHaveLength(3);
    expect(it.ramp!.keys[1].ease).toEqual([0.2, 0.9, 0.3, 1]);
    expect(it.ramp!.keys[0].ease).toBeUndefined();
    const cleared = applyOps(project, [{ op: "speed_ramp", id: it.id, preset: "none" }]).project;
    expect(clipOf(cleared, it.id).ramp).toBeUndefined();
  });

  it("explains what is wrong with a bad request", () => {
    const add = { op: "add_clip", media: "a", as: "c" };
    expect(fails(add, { op: "speed_ramp", id: "$c" })).toMatch(/preset/);
    expect(fails(add, { op: "speed_ramp", id: "$c", preset: "wobble" })).toMatch(/unknown preset/);
    expect(fails(add, { op: "speed_ramp", id: "$c", points: [{ at: 0, speed: 1 }] })).toMatch(/2 to/);
    expect(fails(add, { op: "speed_ramp", id: "$c", points: [{ at: 0, speed: 1 }, { at: 2, speed: 1 }] })).toMatch(/between 0 and 1/);
    expect(fails(add, { op: "speed_ramp", id: "$c", points: [{ at: 0, speed: 1 }, { at: 1, speed: 500 }] })).toMatch(/speed is between/);
    expect(fails(add, { op: "speed_ramp", id: "$c", points: [{ at: 0, speed: 1 }, { at: 1, speed: 2, ease: [5, 0, 0, 0] }] })).toMatch(/ease/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "set", id: "$c", props: { freeze: true } }, { op: "speed_ramp", id: "$c", preset: "hero" })).toMatch(/footage/);
    expect(fails({ op: "add_text", text: "x", at: 0, as: "t" }, { op: "speed_ramp", id: "$t", preset: "hero" })).toMatch(/footage/);
  });

  it("set speed replaces a curve with one steady speed", () => {
    const { p, id } = withRamp();
    const q = applyOps(p, [{ op: "set", id, props: { speed: 2 } }]).project;
    expect(clipOf(q, id).ramp).toBeUndefined();
    expect(clipOf(q, id).speed).toBe(2);
  });

  it("freezing a curved clip drops the curve", () => {
    const { p, id } = withRamp();
    const q = applyOps(p, [{ op: "set", id, props: { freeze: true } }]).project;
    expect(clipOf(q, id).ramp).toBeUndefined();
  });

  it("trim on a curved clip moves the end through the curve and slides the in point inside the footage", () => {
    const { p, id } = withRamp();
    const before = clipOf(p, id);
    const q = applyOps(p, [{ op: "trim", id, duration: before.duration / S - 1 }]).project;
    const it = clipOf(q, id);
    expect(it.duration).toBe(before.duration - S);
    expect(sourceSpan(it)).toBeLessThan(sourceSpan(before));
    const r = applyOps(q, [{ op: "trim", id, in: 100 }]).project;
    expect(clipOf(r, id).in + sourceSpan(clipOf(r, id))).toBeLessThanOrEqual(10 * S);
  });

  it("names a bezier on a keyframe and changes the ease of one that exists", () => {
    const { project, results } = run(
      { op: "add_clip", media: "a", duration: 6, as: "c" },
      { op: "keyframe", id: "$c", prop: "transform.scale", at: 0, value: 1 },
      { op: "keyframe", id: "$c", prop: "transform.scale", at: 2, value: 2, ease: [0.2, 0.9, 0.3, 1] },
      { op: "keyframe", id: "$c", prop: "transform.scale", at: 0, value: 1, ease: "hold" },
    );
    const keys = clipOf(project, results[0].id!).keyframes!["transform.scale"];
    expect(keys[0].ease).toBe("hold");
    expect(keys[1].ease).toEqual([0.2, 0.9, 0.3, 1]);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "keyframe", id: "$c", prop: "transform.scale", at: 0, value: 1, ease: [3, 0, 0, 0] })).toMatch(/ease is/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "keyframe", id: "$c", prop: "transform.scale", at: 0, value: 1, ease: "bounce" })).toMatch(/ease is/);
  });

  it("shows the curve in the project summary", () => {
    const { p, id } = withRamp();
    const item = summarize(p).tracks.flatMap(t => t.items).find(i => i.id === id) as unknown as { speedCurve: { preset: string; points: number[][] } };
    expect(item.speedCurve.preset).toBe("montage");
    expect(item.speedCurve.points).toEqual([[0, 0.4], [0.5, 3], [1, 0.4]]);
  });
});

describe("copying a curved clip", () => {
  it("pasting keeps the curve, and pasting a look onto another clip gives it the curve too", () => {
    const { p, id } = withRamp();
    const clip = copyItems(p, [id])!;
    const pasted = pasteItems(p, clip, 20 * S).project;
    const copies = pasted.tracks.flatMap(t => t.items).filter(i => i.id !== id) as MediaItem[];
    expect(copies[0].ramp).toEqual(clipOf(p, id).ramp);
    const plain = applyOps(p, [{ op: "add_clip", media: "b", as: "other" }]);
    expect(plain.project.tracks[0].items).toHaveLength(2);
    expect((mainTrack(setSpeedRamp(plain.project, plain.results[0].id!, SPEED_PRESETS[1].keys, "hero")).items[1] as MediaItem).ramp?.preset).toBe("hero");
  });
});
