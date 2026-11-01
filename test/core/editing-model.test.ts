import { describe, expect, it } from "vitest";
import { MIN_ITEM, addMedia, duplicateItems, insertItems, mediaItem, moveItem, rippleDeleteRange, setSpeed, setTrack, setTransition, split, trim } from "../../src/core/edit";
import { replaceMedia, rollTrim } from "../../src/core/timeline-edit";
import { applyOps } from "../../src/core/agent/ops";
import { valueAt } from "../../src/core/animate";
import { IDENTITY, createProject, findItem, itemEnd, mainTrack, newId, type CaptionItem, type MediaItem, type MediaRef, type Project, type Track } from "../../src/core/project";

const S = 1_000_000;

const ref = (id: string, seconds: number, kind: MediaRef["kind"] = "video"): MediaRef => ({
  id, kind, path: `/m/${id}`, name: id, size: 1, mtime: 0, duration: seconds * S, hasAudio: kind !== "image", hasVideo: kind !== "audio", width: 1920, height: 1080,
});

function base(): Project {
  return addMedia(createProject("t"), [ref("a", 10), ref("b", 8), ref("pic", 5, "image"), ref("song", 30, "audio")]);
}

function lane(p: Project): Project {
  const q = structuredClone(p);
  q.tracks.splice(0, 0, { id: "over", kind: "video", name: "Overlay", items: [] });
  return q;
}

function put(p: Project, media: string, start: number, dur?: number, patch: Partial<MediaItem> = {}): { p: Project; id: string } {
  const it = { ...mediaItem(p.media[media], start), ...patch };
  if (dur) it.duration = dur;
  return { p: insertItems(p, [it], { trackId: "over" }), id: it.id };
}

const inOrder = (...items: MediaItem[]): Project => insertItems(base(), items, { index: 0 });

const track = (p: Project, id: string): Track => p.tracks.find(t => t.id === id)!;

describe("split", () => {
  it("keeps a freeze frame on the same frame on both sides", () => {
    const p = base();
    const clip = { ...mediaItem(p.media.a, 0), freeze: true, in: 4 * S, duration: 2 * S };
    const q = split(insertItems(p, [clip]), S);
    const [l, r] = mainTrack(q).items as MediaItem[];
    expect([l.in, r.in]).toEqual([4 * S, 4 * S]);
  });

  it("keeps an image at in 0", () => {
    const p = insertItems(base(), [mediaItem(base().media.pic, 0)]);
    const q = split(p, 2 * S);
    expect((mainTrack(q).items as MediaItem[]).map(i => i.in)).toEqual([0, 0]);
  });

  it("refuses a cut that would leave a piece shorter than the minimum", () => {
    const p = insertItems(base(), [mediaItem(base().media.a, 0)]);
    expect(split(p, MIN_ITEM - 1)).toBe(p);
    expect(split(p, 10 * S - MIN_ITEM + 1)).toBe(p);
    expect(mainTrack(split(p, MIN_ITEM)).items).toHaveLength(2);
  });

  it("gives both halves the value the animation had at the cut", () => {
    let p = insertItems(base(), [mediaItem(base().media.a, 0)]);
    const id = mainTrack(p).items[0].id;
    p = structuredClone(p);
    mainTrack(p).items[0].keyframes = { "transform.scale": [{ t: S, v: 1, ease: "linear" }, { t: 5 * S, v: 2, ease: "linear" }] };
    const whole = mainTrack(p).items[0];
    const q = split(p, 3 * S);
    const [l, r] = mainTrack(q).items;
    expect(l.id).toBe(id);
    expect(valueAt(l, "transform.scale", 3 * S)).toBeCloseTo(valueAt(whole, "transform.scale", 3 * S));
    expect(valueAt(r, "transform.scale", 0)).toBeCloseTo(valueAt(whole, "transform.scale", 3 * S));
    expect(valueAt(r, "transform.scale", 2 * S)).toBeCloseTo(valueAt(whole, "transform.scale", 5 * S));
    for (const it of [l, r]) for (const k of it.keyframes!["transform.scale"]) expect(k.t >= 0 && k.t <= it.duration).toBe(true);
  });

  it("holds the animated value on a half that has no keys of its own", () => {
    let p = insertItems(base(), [mediaItem(base().media.a, 0)]);
    p = structuredClone(p);
    mainTrack(p).items[0].keyframes = { "transform.x": [{ t: S, v: 40, ease: "ease" }, { t: 2 * S, v: 100, ease: "ease" }] };
    const [l, r] = mainTrack(split(p, 6 * S)).items;
    expect(valueAt(r, "transform.x", 0)).toBe(100);
    expect(valueAt(l, "transform.x", 5 * S)).toBe(100);
    const [l2, r2] = mainTrack(split(p, S / 2 + 400_000)).items;
    expect(valueAt(l2, "transform.x", l2.duration)).toBe(40);
    expect(valueAt(r2, "transform.x", 0)).toBeCloseTo(40);
  });

  it("shortens a transition that no longer fits the clip before it", () => {
    let p = inOrder(mediaItem(base().media.a, 0), mediaItem(base().media.b, 0));
    const second = mainTrack(p).items[1].id;
    p = setTransition(p, second, "dissolve", 4 * S);
    expect(findItem(p, second)!.item.transitionIn!.duration).toBe(4 * S);
    const q = split(p, 10 * S - 600_000);
    const prev = mainTrack(q).items[1];
    expect(prev.duration).toBe(600_000);
    expect(findItem(q, second)!.item.transitionIn!.duration).toBe(300_000);
  });
});

describe("trim", () => {
  it("keeps a reversed clip's footage when the end runs into a neighbour", () => {
    let { p, id } = put(lane(base()), "a", 0, 2 * S, { in: 5 * S, reversed: true });
    p = put(p, "a", 3 * S, 2 * S).p;
    const before = findItem(p, id)!.item as MediaItem;
    const q = trim(p, id, "end", 4 * S);
    const it = findItem(q, id)!.item as MediaItem;
    expect(itemEnd(it)).toBe(3 * S);
    // start of a reversed clip shows the top of its source span, which must not move
    expect(it.in + it.duration * it.speed).toBe(before.in + before.duration * before.speed);
  });

  it("stops the start edge at the previous clip instead of shortening the clip", () => {
    let { p, id } = put(lane(base()), "a", 6 * S, 3 * S, { in: 4 * S });
    p = put(p, "b", 1 * S, 2 * S).p;
    const q = trim(p, id, "start", -6 * S);
    const it = findItem(q, id)!.item as MediaItem;
    expect([it.start, itemEnd(it)]).toEqual([3 * S, 9 * S]);
    expect(it.in).toBe(1 * S);
  });

  it("clips caption words with the item", () => {
    const words = [0, 1, 2, 3].map(i => ({ text: "w" + i, start: i * S, end: (i + 1) * S }));
    const cap: CaptionItem = { id: newId("i"), type: "caption", start: 0, duration: 4 * S, transform: { ...IDENTITY }, style: { text: "", font: "x", size: 1, weight: 4, color: "#fff", align: "center", lineHeight: 1, letterSpacing: 0 }, words };
    const p = insertItems(base(), [cap]);
    const shorter = trim(p, cap.id, "end", -(S + S / 2));
    expect((findItem(shorter, cap.id)!.item as CaptionItem).words.map(w => [w.start, w.end])).toEqual([[0, S], [S, 2 * S], [2 * S, 2.5 * S]]);
    const later = trim(p, cap.id, "start", S + S / 2);
    expect((findItem(later, cap.id)!.item as CaptionItem).words.map(w => [w.start, w.end])).toEqual([[0, S / 2], [S / 2, 1.5 * S], [1.5 * S, 2.5 * S]]);
  });

  it("leaves an image's in point alone", () => {
    const p = insertItems(base(), [mediaItem(base().media.pic, 0)]);
    const q = trim(p, mainTrack(p).items[0].id, "start", 2 * S);
    expect((mainTrack(q).items[0] as MediaItem).in).toBe(0);
  });
});

describe("setSpeed", () => {
  it("never reads past the end of the file when a short clip is sped up", () => {
    const p = insertItems(base(), [{ ...mediaItem(base().media.a, 0), duration: 4 * S, in: 2 * S }]);
    const id = mainTrack(p).items[0].id;
    const q = setSpeed(p, id, 100);
    const it = mainTrack(q).items[0] as MediaItem;
    expect(it.duration).toBeGreaterThanOrEqual(MIN_ITEM);
    expect(it.in + Math.round(it.duration * it.speed)).toBeLessThanOrEqual(10 * S + 1);
  });

  it("leaves a freeze frame alone", () => {
    const p = insertItems(base(), [{ ...mediaItem(base().media.a, 0), freeze: true, duration: 2 * S }]);
    expect(setSpeed(p, mainTrack(p).items[0].id, 2)).toBe(p);
  });

  it("ignores a speed that is not a number", () => {
    const p = insertItems(base(), [mediaItem(base().media.a, 0)]);
    expect(setSpeed(p, mainTrack(p).items[0].id, NaN)).toBe(p);
  });
});

describe("transitions", () => {
  it("never run longer than half of either clip", () => {
    const short = (m: string) => ({ ...mediaItem(base().media[m], 0), duration: 150_000 });
    let p = inOrder(short("a"), short("b"));
    p = setTransition(p, mainTrack(p).items[1].id, "dissolve", S);
    expect(mainTrack(p).items[1].transitionIn!.duration).toBe(75_000);
  });

  it("are dropped when a move leaves the clip away from its neighbour", () => {
    let { p } = put(lane(base()), "a", 0, 2 * S);
    const second = put(p, "b", 2 * S, 2 * S);
    p = setTransition(second.p, second.id, "dissolve", S);
    expect(findItem(p, second.id)!.item.transitionIn).toBeDefined();
    const moved = moveItem(p, second.id, { trackId: "over", start: 7 * S });
    expect(findItem(moved, second.id)!.item.transitionIn).toBeUndefined();
  });
});

describe("replaceMedia", () => {
  it("pulls the in point back when a short file at a fast speed cannot fill the minimum length", () => {
    const p = insertItems(base(), [{ ...mediaItem(base().media.a, 0), in: 6 * S, duration: S, speed: 4 }]);
    const short = ref("short", 0.5);
    const q = replaceMedia(p, mainTrack(p).items[0].id, short);
    const it = mainTrack(q).items[0] as MediaItem;
    expect(it.in + Math.round(it.duration * it.speed)).toBeLessThanOrEqual(short.duration);
    expect(it.in).toBeGreaterThanOrEqual(0);
  });

  it("slows a clip whose speed the new file is too short for", () => {
    const p = insertItems(base(), [{ ...mediaItem(base().media.b, 0), duration: MIN_ITEM, speed: 70 }]);
    const short = ref("short", 3);
    const q = replaceMedia(p, mainTrack(p).items[0].id, short);
    const it = mainTrack(q).items[0] as MediaItem;
    expect(it.in + Math.round(it.duration * it.speed)).toBeLessThanOrEqual(short.duration);
  });
});

describe("duplicate", () => {
  it("puts each copy right after its own original when several main clips are selected", () => {
    const p = inOrder(mediaItem(base().media.a, 0), mediaItem(base().media.b, 0));
    const [a, b] = mainTrack(p).items;
    const q = duplicateItems(p, [a.id, b.id]);
    const names = mainTrack(q).items.map(i => (i as MediaItem).mediaId);
    expect(names).toEqual(["a", "a", "b", "b"]);
    expect(mainTrack(q).items.map(i => i.start)).toEqual([0, 10 * S, 20 * S, 28 * S]);
    const ids = mainTrack(q).items.map(i => i.id);
    expect([ids[0], ids[2]]).toEqual([a.id, b.id]);
  });
});

describe("locked tracks", () => {
  it("do not take a dropped clip or an inserted one, and their clips do not move", () => {
    let { p, id } = put(lane(base()), "a", 0, 2 * S);
    const other = put(p, "b", 5 * S, 2 * S);
    p = setTrack(other.p, "over", { locked: true });
    const mainClip = insertItems(p, [mediaItem(p.media.b, 0)]);
    const mid = mainTrack(mainClip).items[0].id;
    const dropped = moveItem(mainClip, mid, { trackId: "over", start: 20 * S });
    expect(track(dropped, "over").items.map(i => i.id)).toEqual(track(p, "over").items.map(i => i.id));
    expect(moveItem(p, id, { trackId: mainTrack(p).id, start: 0 })).toBe(p);
    const filled = insertItems(p, [mediaItem(p.media.b, 30 * S)], { trackId: "over" });
    expect(track(filled, "over").items).toHaveLength(2);
    expect(duplicateItems(p, [id])).toBe(p);
  });
});

describe("rippleDeleteRange", () => {
  it("cuts exactly where asked even a few frames from a clip edge", () => {
    let { p } = put(lane(base()), "a", 0, 4 * S);
    p = put(p, "b", 4 * S, 4 * S).p;
    const q = rippleDeleteRange(p, 30_000, 2 * S);
    // the 30 ms left of the first clip is too short to keep, the rest closes up behind the cut
    expect(track(q, "over").items.map(i => [i.start, i.duration])).toEqual([[30_000, 2 * S], [2 * S + 30_000, 4 * S]]);
  });

  it("ignores the part of the range before zero", () => {
    let { p } = put(lane(base()), "a", 0, 4 * S);
    p = put(p, "b", 5 * S, 2 * S).p;
    const q = rippleDeleteRange(p, -3 * S, 2 * S);
    expect(track(q, "over").items.map(i => i.start)).toEqual([0, 3 * S]);
  });
});

describe("rollTrim", () => {
  it("moves the right clip's keyframes with its content", () => {
    let p = inOrder({ ...mediaItem(base().media.a, 0), duration: 5 * S }, mediaItem(base().media.b, 0));
    p = structuredClone(p);
    const [a, b] = mainTrack(p).items;
    b.keyframes = { "transform.x": [{ t: 2 * S, v: 50, ease: "linear" }] };
    const q = rollTrim(p, a.id, b.id, S);
    const moved = findItem(q, b.id)!.item;
    expect(moved.keyframes!["transform.x"][0].t).toBe(S);
  });

  it("leaves an image's in point alone", () => {
    const p = inOrder({ ...mediaItem(base().media.a, 0), duration: 5 * S }, mediaItem(base().media.pic, 0));
    const [a, pic] = mainTrack(p).items;
    const q = rollTrim(p, a.id, pic.id, S);
    expect(findItem(q, a.id)!.item.duration).toBe(6 * S);
    expect((findItem(q, pic.id)!.item as MediaItem).in).toBe(0);
  });
});

describe("agent ops on odd input", () => {
  const run = (...ops: unknown[]) => applyOps(base(), ops as never).project;
  const fails = (...ops: unknown[]) => {
    try {
      run(...ops);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };

  it("keeps everything at or after zero and at least the minimum length", () => {
    const p = run(
      { op: "add_text", text: "hi", at: -4, duration: -1 },
      { op: "add_color", color: "#fff", at: -1, duration: 0 },
      { op: "add_clip", media: "song", at: -2 },
      { op: "marker", at: -3 },
    );
    for (const t of p.tracks) for (const i of t.items) {
      expect(i.start).toBeGreaterThanOrEqual(0);
      expect(i.duration).toBeGreaterThanOrEqual(MIN_ITEM);
    }
    expect(p.markers[0].t).toBe(0);
  });

  it("puts audio with no time at zero, not at the end of the universe", () => {
    const p = run({ op: "add_clip", media: "song" });
    expect(p.tracks.flatMap(t => t.items)[0].start).toBe(0);
    const q = run({ op: "add_clip", media: "song", as: "s" }, { op: "add_clip", media: "song", track: "auto" });
    expect(Math.max(...q.tracks.flatMap(t => t.items).map(i => i.start))).toBeLessThan(60 * S);
  });

  it("rejects numbers that cannot be real times", () => {
    expect(fails({ op: "add_text", text: "x", at: 1e12 })).toMatch(/out of range/);
    expect(fails({ op: "add_text", text: "x", at: Infinity })).toMatch(/number of seconds/);
    expect(fails({ op: "add_text", text: "x", at: 0, x: NaN })).toMatch(/x must be a number/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "keyframe", id: "$c", prop: "transform.scale", at: 1, value: Infinity })).toMatch(/value must be a number/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "keyframe", id: "$c", prop: "__proto__", at: 1, value: 1 })).toMatch(/path/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "set", id: "$c", props: { speed: Infinity } })).toMatch(/speed/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "set", id: "$c", props: { volume: "loud" } })).toMatch(/volume/);
    expect(fails({ op: "project", width: -5 })).toMatch(/width/);
    expect(fails({ op: "project", fps: 0.01 })).toMatch(/fps/);
  });

  it("does not let a track op rewrite the track", () => {
    const start = base();
    const main = mainTrack(start);
    const { project } = applyOps(start, [{ op: "add_clip", media: "a" }, { op: "track", id: main.id, items: [], main: false, name: " Cuts ", muted: true } as never]);
    const after = mainTrack(project);
    expect(after.items).toHaveLength(1);
    expect(after.main).toBe(true);
    expect([after.name, after.muted]).toEqual(["Cuts", true]);
    expect(fails({ op: "track", id: "main", muted: "yes" })).toMatch(/muted/);
  });

  it("refuses a second use of a name, and a name on a split that makes several clips", () => {
    expect(fails({ op: "add_clip", media: "a", as: "x" }, { op: "add_clip", media: "b", as: "x" })).toMatch(/already names/);
    expect(
      fails(
        { op: "add_clip", media: "a" },
        { op: "add_clip", media: "song", at: 0 },
        { op: "add_clip", media: "b", at: 0, track: "main" },
        { op: "split", at: 2, as: "half" },
      ),
    ).toMatch(/exactly one/);
  });

  it("reports a reference to something deleted earlier in the batch", () => {
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "delete", ids: ["$c"] }, { op: "set", id: "$c", props: { volume: 1 } })).toMatch(/no clip/);
    expect(fails({ op: "add_clip", media: "a", as: "c" }, { op: "remove_range", from: 0, to: 10 }, { op: "split", at: 1, ids: ["$c"] })).toMatch(/nothing to split/);
  });

  it("lets a layout win over an animated position", () => {
    const p = run(
      { op: "add_clip", media: "a", as: "c" },
      { op: "keyframe", id: "$c", prop: "transform.x", at: 0, value: 400 },
      { op: "layout", id: "$c", layout: "pip-br" },
    );
    const it = mainTrack(p).items[0];
    expect(it.keyframes?.["transform.x"]).toBeUndefined();
    expect(valueAt(it, "transform.x", 0)).toBeGreaterThan(0);
    expect(fails({ op: "add_clip", media: "song", as: "s" }, { op: "layout", id: "$s", layout: "top" })).toMatch(/video and image/);
  });

  it("trims a free clip without running into its neighbour", () => {
    const p = run(
      { op: "add_track", kind: "video", as: "v" },
      { op: "add_clip", media: "a", track: "$v", at: 0, duration: 2, as: "one" },
      { op: "add_clip", media: "b", track: "$v", at: 3, duration: 2 },
      { op: "trim", id: "$one", duration: 6 },
    );
    const items = p.tracks.find(t => t.items.length === 2 && !t.main)!.items;
    expect(itemEnd(items[0])).toBeLessThanOrEqual(items[1].start);
  });

  it("clips the main track's transition to the new lengths after a trim", () => {
    const p = run(
      { op: "add_clip", media: "a", duration: 4, as: "one" },
      { op: "add_clip", media: "b", duration: 4, as: "two" },
      { op: "transition", id: "$two", kind: "dissolve", duration: 2 },
      { op: "trim", id: "$one", duration: 1 },
    );
    expect(mainTrack(p).items[1].transitionIn!.duration).toBe(500_000);
  });
});
