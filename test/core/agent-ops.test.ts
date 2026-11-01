import { describe, expect, it } from "vitest";
import { applyOps, OpError, type Op } from "../../src/core/agent/ops";
import { summarize } from "../../src/core/agent/summary";
import { addMedia } from "../../src/core/edit";
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
});
