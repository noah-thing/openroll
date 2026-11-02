import { describe, expect, it } from "vitest";
import { createProject, findItem, mainTrack, type MediaRef, type Project, type MediaItem } from "../../src/core/project";
import { addMedia, deleteItems, insertItems, mediaItem, moveItem, rippleDeleteRange, setSpeed, split, trim, duplicateItems, setTransition } from "../../src/core/edit";

const S = 1_000_000;

function ref(id: string, seconds: number, kind: MediaRef["kind"] = "video"): MediaRef {
  return { id, kind, path: `/tmp/${id}.mp4`, name: `${id}.mp4`, size: 1, mtime: 0, duration: seconds * S, hasAudio: kind !== "image", hasVideo: kind !== "audio" };
}

function withClips(...lens: number[]): { p: Project; ids: string[] } {
  let p = createProject("t");
  const refs = lens.map((l, i) => ref("m" + i, l));
  p = addMedia(p, refs);
  const items = refs.map(r => mediaItem(r, Number.MAX_SAFE_INTEGER));
  p = insertItems(p, items);
  return { p, ids: items.map(i => i.id) };
}

const starts = (p: Project) => mainTrack(p).items.map(i => [i.start / S, i.duration / S]);

describe("main track", () => {
  it("packs appended clips edge to edge", () => {
    const { p } = withClips(3, 2, 4);
    expect(starts(p)).toEqual([[0, 3], [3, 2], [5, 4]]);
  });

  it("never mutates the input project", () => {
    const { p, ids } = withClips(3, 2);
    const before = JSON.stringify(p);
    split(p, 1 * S);
    deleteItems(p, [ids[0]]);
    trim(p, ids[1], "start", S);
    moveItem(p, ids[0], { trackId: mainTrack(p).id, start: 10 * S });
    expect(JSON.stringify(p)).toBe(before);
  });

  it("closes the gap when a clip is deleted", () => {
    const { p, ids } = withClips(3, 2, 4);
    expect(starts(deleteItems(p, [ids[1]]))).toEqual([[0, 3], [3, 4]]);
  });

  it("reorders by dropping a clip in the first half of another", () => {
    const { p, ids } = withClips(3, 2, 4);
    const next = moveItem(p, ids[2], { trackId: mainTrack(p).id, start: 0.5 * S });
    expect(mainTrack(next).items.map(i => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(starts(next)).toEqual([[0, 4], [4, 3], [7, 2]]);
  });

  it("ripples following clips when an end is trimmed", () => {
    const { p, ids } = withClips(3, 2);
    const next = trim(p, ids[0], "end", -1 * S);
    expect(starts(next)).toEqual([[0, 2], [2, 2]]);
  });

  it("cannot trim a clip past the end of its source", () => {
    const { p, ids } = withClips(3);
    const next = trim(p, ids[0], "end", 10 * S);
    expect(starts(next)).toEqual([[0, 3]]);
  });

  it("moves the source in point when the start is trimmed", () => {
    const { p, ids } = withClips(5);
    const next = trim(p, ids[0], "start", 2 * S);
    const it = mainTrack(next).items[0] as MediaItem;
    expect([it.start, it.in, it.duration]).toEqual([0, 2 * S, 3 * S]);
    const back = trim(next, ids[0], "start", -5 * S);
    expect((mainTrack(back).items[0] as MediaItem).in).toBe(0);
    expect(mainTrack(back).items[0].duration).toBe(5 * S);
  });
});

describe("split", () => {
  it("splits at the playhead and keeps the source continuous", () => {
    const { p, ids } = withClips(4);
    const next = split(p, 1.5 * S);
    const [a, b] = mainTrack(next).items as MediaItem[];
    expect(a.id).toBe(ids[0]);
    expect([a.start, a.duration, a.in]).toEqual([0, 1.5 * S, 0]);
    expect([b.start, b.duration, b.in]).toEqual([1.5 * S, 2.5 * S, 1.5 * S]);
  });

  it("respects speed when finding the right half's source point", () => {
    const { p, ids } = withClips(8);
    const fast = setSpeed(p, ids[0], 2);
    expect(mainTrack(fast).items[0].duration).toBe(4 * S);
    const [, b] = mainTrack(split(fast, 1 * S)).items as MediaItem[];
    expect(b.in).toBe(2 * S);
  });

  it("does nothing on an edit point or empty space", () => {
    const { p } = withClips(2, 2);
    expect(split(p, 2 * S)).toBe(p);
    expect(split(p, 50 * S)).toBe(p);
  });

  it("splits caption words between the halves", () => {
    let p = createProject("c");
    p = insertItems(p, [{ id: "cap", type: "caption", start: 0, duration: 3 * S, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      style: { text: "", font: "x", size: 10, weight: 700, color: "#fff", align: "center", lineHeight: 1.2, letterSpacing: 0 },
      words: [{ text: "one", start: 0, end: S }, { text: "two", start: S, end: 2 * S }, { text: "three", start: 2 * S, end: 3 * S }] }]);
    const next = split(p, 1.5 * S);
    const caps = next.tracks.flatMap(t => t.items).filter(i => i.type === "caption");
    expect(caps.map(c => c.type === "caption" && c.words.map(w => w.text))).toEqual([["one", "two"], ["three"]]);
  });

  it("gives a word spoken across the cut to the half that holds most of it", () => {
    let p = createProject("c");
    p = insertItems(p, [{ id: "cap", type: "caption", start: 0, duration: 3 * S, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      style: { text: "", font: "x", size: 10, weight: 700, color: "#fff", align: "center", lineHeight: 1.2, letterSpacing: 0 },
      words: [{ text: "one", start: 0, end: S }, { text: "two", start: S, end: 2 * S }, { text: "three", start: 2 * S, end: 3 * S }] }]);
    const caps = split(p, 1.8 * S).tracks.flatMap(t => t.items).filter(i => i.type === "caption");
    expect(caps.map(c => c.type === "caption" && c.words.map(w => w.text))).toEqual([["one", "two"], ["three"]]);
    const early = split(p, 1.2 * S).tracks.flatMap(t => t.items).filter(i => i.type === "caption");
    expect(early.map(c => c.type === "caption" && c.words.map(w => w.text))).toEqual([["one"], ["two", "three"]]);
  });
});

describe("free tracks", () => {
  function overlayTrackId(p: Project): string {
    // dropping onto the main track's kind with an explicit overlay request: make one
    const track = { id: "ov1", kind: "video" as const, name: "Overlay", items: [] };
    p.tracks.unshift(track);
    return track.id;
  }

  it("puts a second overlay on a new lane when the spot is taken", () => {
    let p = createProject("o");
    const r = ref("ov", 3);
    p = addMedia(p, [r]);
    const lane = overlayTrackId(p);
    const a = mediaItem(r, 1 * S), b = mediaItem(r, 2 * S);
    p = insertItems(p, [a], { trackId: lane });
    p = insertItems(p, [b], { trackId: lane });
    expect(findItem(p, a.id)!.track.id).toBe(lane);
    expect(findItem(p, b.id)!.track.id).not.toBe(lane);
    expect(findItem(p, b.id)!.track.main).toBeFalsy();
  });

  it("stacks overlapping music on separate audio lanes", () => {
    let p = createProject("a");
    const song = ref("song", 30, "audio");
    p = addMedia(p, [song]);
    p = insertItems(p, [mediaItem(song, 0), mediaItem(song, 10 * S)]);
    expect(p.tracks.filter(t => t.kind === "audio" && t.items.length).length).toBe(2);
    expect(mainTrack(p).items.length).toBe(0);
  });

  it("removes an overlay lane once it is empty", () => {
    let p = createProject("o");
    const r = ref("ov", 3);
    p = addMedia(p, [r]);
    const lane = overlayTrackId(p);
    const it = mediaItem(r, 0);
    p = insertItems(p, [it], { trackId: lane });
    p = deleteItems(p, [it.id]);
    expect(p.tracks.some(t => t.id === lane)).toBe(false);
    expect(p.tracks.some(t => t.kind === "audio")).toBe(true);
  });
});

describe("range and transitions", () => {
  it("ripple deletes a range across clips", () => {
    const { p } = withClips(3, 3);
    expect(starts(rippleDeleteRange(p, 2 * S, 4 * S))).toEqual([[0, 2], [2, 2]]);
  });

  it("only allows a transition where two clips touch", () => {
    const { p, ids } = withClips(3, 3);
    const t = setTransition(p, ids[1], "dissolve", 0.5 * S);
    expect(findItem(t, ids[1])!.item.transitionIn).toEqual({ kind: "dissolve", duration: 0.5 * S });
    expect(setTransition(p, ids[0], "dissolve", S)).toBe(p);
  });

  it("duplicates right after the original", () => {
    const { p, ids } = withClips(3, 2);
    const next = duplicateItems(p, [ids[0]]);
    expect(starts(next)).toEqual([[0, 3], [3, 3], [6, 2]]);
  });
});
