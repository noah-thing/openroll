import { describe, expect, it } from "vitest";
import { createProject, findItem, mainTrack, type MediaItem, type MediaRef, type Project } from "../../src/core/project";
import { addMedia, insertItems, mediaItem, split, trim } from "../../src/core/edit";
import {
  addTrack,
  closeAllGaps,
  closeGap,
  copyItems,
  freezeFrame,
  itemsFrom,
  moveGroup,
  moveTrack,
  pasteItems,
  pasteStyle,
  removeMarker,
  removeTrack,
  renameTrack,
  replaceMedia,
  reverseItems,
  rippleDeleteItems,
  rippleTrim,
  rollTrim,
  setItemColor,
  setMagnetic,
  setTrackHeight,
  slip,
  trimToTime,
  updateMarker,
} from "../../src/core/timeline-edit";
import { addMarker } from "../../src/core/edit";

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

/** A project with an overlay lane holding clips at the given [start, length] seconds. */
function withOverlay(...spans: [number, number][]): { p: Project; ids: string[]; trackId: string } {
  let p = createProject("t");
  p = addMedia(p, [ref("o", 60)]);
  const items = spans.map(([s, l]) => ({ ...mediaItem(p.media.o, s * S), duration: l * S }));
  p = addTrack(p, "video", "ov1");
  const trackId = "ov1";
  p = insertItems(p, items, { trackId });
  return { p, ids: items.map(i => i.id), trackId };
}

const media = (p: Project, id: string) => findItem(p, id)!.item as MediaItem;
const mainStarts = (p: Project) => mainTrack(p).items.map(i => [i.start / S, i.duration / S]);

describe("selection", () => {
  it("selects everything that ends after the playhead", () => {
    const { p, ids } = withClips(3, 2, 4);
    expect(itemsFrom(p, 3.5 * S)).toEqual([ids[1], ids[2]]);
    expect(itemsFrom(p, 3.5 * S, "nope")).toEqual([]);
  });
});

describe("clipboard", () => {
  it("pastes a copied clip at the playhead on the main track", () => {
    const { p, ids } = withClips(3, 2);
    const clip = copyItems(p, [ids[0]])!;
    const { project, ids: made } = pasteItems(p, clip, 3 * S);
    expect(mainTrack(project).items.length).toBe(3);
    expect(mainTrack(project).items[1].id).toBe(made[0]);
    expect(made[0]).not.toBe(ids[0]);
    expect(mainStarts(project)).toEqual([[0, 3], [3, 3], [6, 2]]);
  });

  it("keeps offsets between pasted overlay clips and their lane", () => {
    const { p, ids, trackId } = withOverlay([1, 2], [5, 1]);
    const clip = copyItems(p, ids)!;
    const { project, ids: made } = pasteItems(p, clip, 20 * S);
    const a = findItem(project, made[0])!;
    const b = findItem(project, made[1])!;
    expect(b.item.start - a.item.start).toBe(4 * S);
    expect(a.track.id).toBe(trackId);
    expect(a.item.start).toBe(20 * S);
  });

  it("falls back to a track of the same kind when the original is gone", () => {
    const { p, ids } = withOverlay([1, 2]);
    const clip = copyItems(p, ids)!;
    const gone = removeTrack(p, clip.entries[0].trackId);
    expect(gone.tracks.some(t => t.id === clip.entries[0].trackId)).toBe(false);
    const { project, ids: made } = pasteItems(gone, clip, 0);
    expect(findItem(project, made[0])!.track.kind).toBe("video");
  });

  it("brings media along to another project", () => {
    const { p, ids } = withClips(3);
    const clip = copyItems(p, ids)!;
    const other = createProject("other");
    const { project } = pasteItems(other, clip, 0);
    expect(Object.keys(project.media)).toEqual(["m0"]);
    expect(mainTrack(project).items.length).toBe(1);
  });

  it("pastes style without touching timing or text", () => {
    const { p, ids } = withClips(3, 2);
    const q = structuredClone(p);
    const a = findItem(q, ids[0])!.item as MediaItem;
    a.adjust = { contrast: 0.4 };
    a.effects = [{ id: "e1", kind: "blur", amount: 0.5 }];
    a.transform.scale = 1.4;
    const out = pasteStyle(q, a, [ids[1]]);
    const b = media(out, ids[1]);
    expect(b.adjust).toEqual({ contrast: 0.4 });
    expect(b.effects?.[0].kind).toBe("blur");
    expect(b.effects?.[0].id).not.toBe("e1");
    expect(b.transform.scale).toBe(1.4);
    expect(b.duration).toBe(2 * S);
  });

  it("pastes speed and the clip changes length with it", () => {
    const { p, ids } = withClips(4, 4);
    const q = structuredClone(p);
    (findItem(q, ids[0])!.item as MediaItem).speed = 2;
    const out = pasteStyle(q, findItem(q, ids[0])!.item, [ids[1]]);
    expect(media(out, ids[1]).duration).toBe(2 * S);
  });
});

describe("ripple delete and reverse", () => {
  it("pulls later overlay clips left", () => {
    const { p, ids } = withOverlay([1, 2], [3, 1], [6, 1]);
    const out = rippleDeleteItems(p, [ids[0]]);
    expect(findItem(out, ids[1])!.item.start).toBe(1 * S);
    expect(findItem(out, ids[2])!.item.start).toBe(4 * S);
  });

  it("closes several deletions at once", () => {
    const { p, ids } = withOverlay([0, 2], [2, 2], [4, 2], [6, 2]);
    const out = rippleDeleteItems(p, [ids[0], ids[2]]);
    expect(findItem(out, ids[1])!.item.start).toBe(0);
    expect(findItem(out, ids[3])!.item.start).toBe(2 * S);
  });

  it("toggles reverse and keeps timing", () => {
    const { p, ids } = withClips(3);
    const once = reverseItems(p, ids);
    expect(media(once, ids[0]).reversed).toBe(true);
    const twice = reverseItems(once, ids);
    expect(media(twice, ids[0]).reversed).toBeUndefined();
    expect(media(twice, ids[0]).duration).toBe(3 * S);
  });
});

describe("freeze frame", () => {
  it("inserts a two second still and ripples the main track", () => {
    const { p, ids } = withClips(10, 4);
    const out = freezeFrame(p, ids[0], 4 * S, { id: "freeze" });
    const items = mainTrack(out).items;
    expect(items.length).toBe(4);
    expect(items[1].id).toBe("freeze");
    expect(mainStarts(out)).toEqual([[0, 4], [4, 2], [6, 6], [12, 4]]);
    const f = items[1] as MediaItem;
    expect(f.freeze).toBe(true);
    expect(f.in).toBe(4 * S);
  });

  it("freezes the frame the right half starts on when reversed", () => {
    const { p, ids } = withClips(10);
    const rev = reverseItems(p, ids);
    const out = freezeFrame(rev, ids[0], 4 * S, { id: "f" });
    expect((mainTrack(out).items[1] as MediaItem).in).toBe(6 * S);
  });

  it("shifts later clips on an overlay lane", () => {
    const { p, ids } = withOverlay([2, 6], [9, 1]);
    const out = freezeFrame(p, ids[0], 4 * S, { id: "f" });
    expect(findItem(out, ids[1])!.item.start).toBe(11 * S);
  });

  it("does nothing for images", () => {
    let p = createProject("t");
    p = addMedia(p, [ref("i", 5, "image")]);
    const it = mediaItem(p.media.i, 0);
    p = insertItems(p, [it]);
    expect(freezeFrame(p, it.id, 1 * S)).toBe(p);
  });
});

describe("replace", () => {
  it("keeps position and clamps to the new file", () => {
    const { p, ids } = withClips(5, 3);
    const out = replaceMedia(p, ids[0], ref("n", 2));
    expect(media(out, ids[0]).mediaId).toBe("n");
    expect(media(out, ids[0]).duration).toBe(2 * S);
    expect(mainStarts(out)).toEqual([[0, 2], [2, 3]]);
  });

  it("refuses an audio file for a video clip", () => {
    const { p, ids } = withClips(5);
    expect(replaceMedia(p, ids[0], ref("a", 9, "audio"))).toBe(p);
  });
});

describe("labels", () => {
  it("sets and clears a colour", () => {
    const { p, ids } = withClips(3, 2);
    const a = setItemColor(p, ids, "red");
    expect(findItem(a, ids[1])!.item.color).toBe("red");
    expect(findItem(setItemColor(a, ids, null), ids[0])!.item.color).toBeUndefined();
    expect(setItemColor(a, ids, "red")).toBe(a);
  });
});

describe("gaps", () => {
  it("closes the gap under the playhead", () => {
    const { p, ids, trackId } = withOverlay([1, 2], [6, 1], [9, 1]);
    const out = closeGap(p, trackId, 4 * S);
    expect(findItem(out, ids[1])!.item.start).toBe(3 * S);
    expect(findItem(out, ids[2])!.item.start).toBe(6 * S);
    expect(closeGap(p, trackId, 1.5 * S)).toBe(p);
  });

  it("closes every gap but keeps the first clip where it is", () => {
    const { p, ids, trackId } = withOverlay([1, 2], [6, 1], [9, 1]);
    const out = closeAllGaps(p, trackId);
    expect([ids[0], ids[1], ids[2]].map(id => findItem(out, id)!.item.start / S)).toEqual([1, 3, 4]);
  });
});

describe("group move", () => {
  it("keeps offsets between overlay clips", () => {
    const { p, ids } = withOverlay([1, 2], [5, 1]);
    const out = moveGroup(p, ids, { dt: 3 * S });
    expect(findItem(out, ids[0])!.item.start).toBe(4 * S);
    expect(findItem(out, ids[1])!.item.start).toBe(8 * S);
  });

  it("stops at zero without squashing the offsets", () => {
    const { p, ids } = withOverlay([1, 2], [5, 1]);
    const out = moveGroup(p, ids, { dt: -4 * S });
    expect(findItem(out, ids[0])!.item.start).toBe(0);
    expect(findItem(out, ids[1])!.item.start).toBe(4 * S);
  });

  it("moves selected main clips as a block to the slot under the pointer", () => {
    const { p, ids } = withClips(2, 2, 2, 2);
    const out = moveGroup(p, [ids[0], ids[1]], { dt: 0, slotTime: 7 * S });
    expect(mainTrack(out).items.map(i => i.id)).toEqual([ids[2], ids[3], ids[0], ids[1]]);
    expect(mainStarts(out)).toEqual([[0, 2], [2, 2], [4, 2], [6, 2]]);
  });

  it("hops a clip to another lane when the target is taken", () => {
    const { p, ids } = withOverlay([0, 2], [3, 2], [5, 2]);
    const out = moveGroup(p, [ids[0]], { dt: 3 * S });
    expect(out.tracks.filter(t => t.kind === "video" && !t.main).length).toBe(2);
    expect(findItem(out, ids[0])!.item.start).toBe(3 * S);
  });
});

describe("trims", () => {
  it("ripple trims an overlay clip and moves what follows", () => {
    const { p, ids } = withOverlay([1, 4], [6, 1]);
    const shorter = rippleTrim(p, ids[0], "end", -S);
    expect(findItem(shorter, ids[0])!.item.duration).toBe(3 * S);
    expect(findItem(shorter, ids[1])!.item.start).toBe(5 * S);
    const longer = rippleTrim(p, ids[0], "end", 3 * S);
    expect(findItem(longer, ids[1])!.item.start).toBe(9 * S);
  });

  it("ripple trimming the start leaves the clip start in place", () => {
    const { p, ids } = withOverlay([1, 4], [6, 1]);
    const out = rippleTrim(p, ids[0], "start", S);
    expect(findItem(out, ids[0])!.item.start).toBe(1 * S);
    expect(findItem(out, ids[0])!.item.duration).toBe(3 * S);
    expect(media(out, ids[0]).in).toBe(S);
    expect(findItem(out, ids[1])!.item.start).toBe(5 * S);
  });

  it("rolls the cut between two clips", () => {
    let { p } = withClips(10);
    p = split(p, 4 * S);
    const [a, b] = mainTrack(p).items.map(i => i.id);
    const out = rollTrim(p, a, b, S);
    expect(mainStarts(out)).toEqual([[0, 5], [5, 5]]);
    expect(media(out, b).in).toBe(5 * S);
    expect(media(out, a).in).toBe(0);
  });

  it("stops a roll at the end of the source", () => {
    let { p } = withClips(10);
    p = split(p, 4 * S);
    const [a, b] = mainTrack(p).items.map(i => i.id);
    const trimmed = trim(p, a, "end", -S);
    // the left clip now ends at 3 s of source; rolling right is bounded by the right clip length
    const out = rollTrim(trimmed, a, b, 100 * S);
    expect(mainTrack(out).items[1].duration).toBeGreaterThanOrEqual(100_000);
  });

  it("slips the source and keeps timing", () => {
    const { p, ids } = withClips(10);
    const q = trim(p, ids[0], "end", -6 * S);
    const out = slip(q, ids[0], 2 * S);
    expect(media(out, ids[0]).in).toBe(2 * S);
    expect(media(out, ids[0]).duration).toBe(4 * S);
    expect(media(slip(q, ids[0], 99 * S), ids[0]).in).toBe(6 * S);
    expect(slip(q, ids[0], -S)).toBe(q);
  });

  it("trims start and end to a time", () => {
    const { p } = withClips(10);
    const a = trimToTime(p, 3 * S, "start");
    expect(mainStarts(a)).toEqual([[0, 7]]);
    expect(media(a, mainTrack(a).items[0].id).in).toBe(3 * S);
    const b = trimToTime(p, 3 * S, "end");
    expect(mainStarts(b)).toEqual([[0, 3]]);
    expect(trimToTime(p, 30 * S, "end")).toBe(p);
  });

  it("trims only selected items that contain the time", () => {
    const { p, ids } = withOverlay([1, 4], [8, 2]);
    const out = trimToTime(p, 3 * S, "end", [ids[1]]);
    expect(out).toBe(p);
  });

  it("reversed clips keep the same frames when the end is trimmed", () => {
    const { p, ids } = withClips(10);
    const rev = reverseItems(p, ids);
    const out = trim(rev, ids[0], "end", -4 * S);
    expect(media(out, ids[0]).in).toBe(4 * S);
    const back = trim(out, ids[0], "end", 4 * S);
    expect(media(back, ids[0]).in).toBe(0);
  });
});

describe("markers", () => {
  it("renames, recolours, moves and removes", () => {
    let p = addMarker(createProject("t"), 5 * S);
    p = addMarker(p, 9 * S);
    const id = p.markers[0].id;
    p = updateMarker(p, id, { label: " Intro ", color: "amber" });
    expect(p.markers[0].label).toBe("Intro");
    p = updateMarker(p, id, { t: 12 * S });
    expect(p.markers.map(m => m.t)).toEqual([9 * S, 12 * S]);
    p = removeMarker(p, id);
    expect(p.markers.length).toBe(1);
  });
});

describe("tracks", () => {
  it("adds a track that survives being empty", () => {
    const p = addTrack(createProject("t"), "text", "tx");
    expect(p.tracks.find(t => t.id === "tx")!.pinned).toBe(true);
    const { p: q, ids } = withClips(2);
    const added = addTrack(q, "video", "ov");
    const out = rippleDeleteItems(added, [ids[0]]);
    expect(out.tracks.some(t => t.id === "ov")).toBe(true);
  });

  it("reorders, renames and resizes", () => {
    let p = addTrack(addTrack(createProject("t"), "video", "a"), "text", "b");
    const before = p.tracks.map(t => t.id);
    p = moveTrack(p, "a", before.length - 1);
    expect(p.tracks.at(-1)!.id).toBe("a");
    p = renameTrack(p, "b", "Titles");
    expect(p.tracks.find(t => t.id === "b")!.name).toBe("Titles");
    p = setTrackHeight(p, "b", 5);
    expect(p.tracks.find(t => t.id === "b")!.height).toBe(28);
  });

  it("lets the main track act like a free lane when magnetic is off", () => {
    const { p, ids } = withClips(2, 2, 2);
    const main = mainTrack(p).id;
    const free = setMagnetic(p, main, false);
    // delete the middle clip: the gap stays
    const out = rippleDeleteItems(free, []);
    expect(out).toBe(free);
    const gone = trim(free, ids[1], "end", -S);
    expect(mainStarts(gone)).toEqual([[0, 2], [2, 1], [4, 2]]);
    const back = setMagnetic(gone, main, true);
    expect(mainStarts(back)).toEqual([[0, 2], [2, 1], [3, 2]]);
  });
});
