import { describe, expect, it } from "vitest";
import { applyOps, OpError, type Op } from "../../src/core/agent/ops";
import { summarize } from "../../src/core/agent/summary";
import { addMedia, insertItems } from "../../src/core/edit";
import { setMagnetic } from "../../src/core/timeline-edit";
import { createProject, mainTrack, type MediaRef, type Project } from "../../src/core/project";

const S = 1_000_000;
const ref = (id: string, seconds: number, kind: MediaRef["kind"] = "video"): MediaRef => ({
  id, kind, path: `/m/${id}.mp4`, name: `${id}.mp4`, size: 1, mtime: 0, duration: seconds * S, hasAudio: true, hasVideo: kind !== "audio", width: 1920, height: 1080,
});

function base(): Project {
  return addMedia(createProject("t"), [ref("a", 10), ref("b", 8), ref("song", 60, "audio")]);
}

describe("applyOps", () => {
  it("builds a cut in one batch with names and seconds", () => {
    const ops: Op[] = [
      { op: "add_clip", media: "a", in: 2, duration: 3, as: "first" },
      { op: "add_clip", media: "b", duration: 4, as: "second" },
      { op: "add_clip", media: "song", at: 0 },
      { op: "transition", id: "$second", kind: "dissolve", duration: 0.4 },
      { op: "add_text", text: "Day one", at: 0.5, duration: 2, as: "title" },
      { op: "set", id: "$title", props: { y: -300, animationIn: { kind: "fade", duration: 0.3 } } },
      { op: "set", id: "$first", props: { volume: 0.5, fadeOut: 0.2 } },
      { op: "keyframe", id: "$first", prop: "transform.scale", at: 0, value: 1 },
      { op: "keyframe", id: "$first", prop: "transform.scale", at: 3, value: 1.15 },
      { op: "filter", id: "$second", filter: "harbour", amount: 0.6 },
      { op: "effect", id: "$second", kind: "thump", amount: 0.4 },
    ];
    const { project, results } = applyOps(base(), ops);
    const main = mainTrack(project).items;
    expect(main.map(i => [i.start / S, i.duration / S])).toEqual([[0, 3], [3, 4]]);
    expect(main[1].transitionIn).toEqual({ kind: "dissolve", duration: 400_000 });
    expect(results.every(r => r.op)).toBe(true);
    const sum = summarize(project);
    expect(sum.duration).toBe(60);
    const title = sum.tracks.flatMap(t => t.items).find(i => i.type === "text")!;
    expect(title).toMatchObject({ text: "Day one", start: 0.5, end: 2.5, y: -300 });
  });

  it("is atomic: one bad operation applies nothing", () => {
    const start = base();
    expect(() => applyOps(start, [{ op: "add_clip", media: "a" }, { op: "set", id: "nope", props: { volume: 1 } }])).toThrow(OpError);
    try {
      applyOps(start, [{ op: "add_clip", media: "a" }, { op: "effect", id: "x", kind: "zzz" }]);
    } catch (e) {
      expect((e as OpError).index).toBe(1);
    }
    expect(mainTrack(start).items).toHaveLength(0);
  });

  it("explains mistakes in words the model can act on", () => {
    const bad = (op: Op) => {
      try {
        applyOps(base(), [{ op: "add_clip", media: "a", as: "c" }, op]);
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(bad({ op: "transition", id: "$c", kind: "warp" })).toMatch(/unknown transition/);
    expect(bad({ op: "set", id: "$c", props: { sparkle: 1 } })).toMatch(/unknown property sparkle/);
    expect(bad({ op: "add_clip", media: "missing" })).toMatch(/import_media/);
    expect(bad({ op: "set", id: "$c", props: { sparkle: 1 } })).toMatch(/Allowed: .*volume/);
    expect(bad({ op: "ripple_delete" } as never)).toMatch(/Operations: add_clip/);
    expect(bad({ op: "set", id: "$missing", props: {} })).toMatch(/nothing was named/);
  });

  it("splits, trims to the source and removes ranges", () => {
    const { project } = applyOps(base(), [
      { op: "add_clip", media: "a", as: "a" },
      { op: "trim", id: "$a", in: 8, duration: 5 },
      { op: "add_clip", media: "b" },
      { op: "split", at: 3 },
      { op: "remove_range", from: 1, to: 2 },
    ]);
    expect(mainTrack(project).items.map(i => i.duration / S)).toEqual([1, 1, 7]);
  });

  it("notices music running past the picture and black gaps", () => {
    const { project } = applyOps(base(), [
      { op: "add_clip", media: "a", duration: 4 },
      { op: "add_clip", media: "song", at: 0 },
      { op: "add_track", kind: "video", as: "over" },
      { op: "add_text", text: "Hi", at: 0, y: 2000 },
    ]);
    const n = summarize(project).notes;
    expect(n.some(x => x.startsWith("Sound runs 56 s past the last picture"))).toBe(true);
    expect(n.some(x => /frame edge/.test(x))).toBe(true);
  });

  it("changes the frame by ratio", () => {
    const { project } = applyOps(base(), [{ op: "project", ratio: "9:16", fps: 60, name: "Vertical cut" }]);
    expect(project.settings).toMatchObject({ width: 1080, height: 1920, fps: { num: 60, den: 1 } });
    expect(project.name).toBe("Vertical cut");
  });

  it("appends to a main track that is not magnetic instead of parking the clip at the end of time", () => {
    const loose = setMagnetic(base(), mainTrack(base()).id, false);
    const { project } = applyOps(loose, [{ op: "add_clip", media: "a", duration: 2 }, { op: "add_clip", media: "b" }]);
    expect(mainTrack(project).items.map(i => i.start / S)).toEqual([0, 2]);
  });

  it("refuses values a clip cannot hold instead of saving them", () => {
    const start = applyOps(base(), [{ op: "add_clip", media: "a" }, { op: "add_text", text: "hi", at: 0, as: "t" }]);
    const id = mainTrack(start.project).items[0].id;
    const bad: Op[] = [
      { op: "set", id, props: { blend: "burn" } },
      { op: "set", id, props: { mask: "round" } },
      { op: "set", id, props: { crop: { left: "a" } } },
      { op: "set", id: start.results[1].id!, props: { style: { size: "huge" } } },
      { op: "add_text", text: "x", at: 0, style: { align: "middle" } as never },
      { op: "add_color", color: 5 as never, at: 0, duration: 1 },
      { op: "keyframe", id, prop: "transform.x", at: 1, value: 1, ease: "bounce" as never },
      { op: "keyframe", id, prop: "__proto__", at: 1, value: 1 },
    ];
    for (const op of bad) expect(() => applyOps(start.project, [op])).toThrow(OpError);
    const ok = applyOps(start.project, [{ op: "set", id, props: { blend: "screen", volume: 500, mask: null } }]);
    expect(mainTrack(ok.project).items[0]).toMatchObject({ blend: "screen", volume: 100 });
  });

  it("cuts a caption's words when a trim shortens it", () => {
    const words = [{ text: "a", start: 0, end: 2 * S }, { text: "b", start: 2 * S, end: 4 * S }];
    const cap = { id: "cap", type: "caption" as const, start: 0, duration: 4 * S, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, style: { text: "", font: "x", size: 10, weight: 400, color: "#fff", align: "center" as const, lineHeight: 1, letterSpacing: 0 }, words };
    const p = insertItems(base(), [cap]);
    const out = applyOps(p, [{ op: "trim", id: "cap", duration: 1 }]).project;
    expect(out.tracks.flatMap(t => t.items).find(i => i.id === "cap")).toMatchObject({ words: [{ text: "a", start: 0, end: S }] });
  });
});
