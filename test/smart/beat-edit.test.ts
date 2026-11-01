import { describe, expect, it } from "vitest";
import { cutToBeat, cutTimes, planBeatEdit, type PlanClip } from "../../src/core/beat-edit";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { createProject, itemEnd, mainTrack, type MediaRef } from "../../src/core/project";

const S = 1_000_000;
/** 120 bpm: a beat every half second from 0.25 s. */
const beats = Array.from({ length: 40 }, (_, i) => Math.round((0.25 + i * 0.5) * S));

describe("cutTimes", () => {
  it("takes every beat, every second or every fourth", () => {
    // The beat at 0.25 s is too close to the start to cut on, so seven of eight remain.
    expect(cutTimes(beats, 1, 0, 4 * S)).toHaveLength(7);
    expect(cutTimes(beats, 2, 0, 4 * S).map(t => t / S)).toEqual([1.25, 2.25, 3.25]);
    expect(cutTimes(beats, 4, 0, 4 * S).map(t => t / S)).toEqual([2.25]);
    expect(cutTimes(beats, 4, 0, 8 * S).map(t => t / S)).toEqual([2.25, 4.25, 6.25]);
  });

  it("drops a first cut that would leave a sliver at the start", () => {
    expect(cutTimes([100_000, 500_000, 1_000_000], 1, 0, 2 * S)).toEqual([500_000, 1_000_000]);
  });

  it("ignores beats outside the range", () => {
    expect(cutTimes(beats, 1, 2 * S, 3 * S).every(t => t >= 2 * S && t < 3 * S)).toBe(true);
  });
});

const clip = (id: string, available: number, endless = false): PlanClip => ({ id, in: 0, available: available * S, endless });

describe("planBeatEdit", () => {
  it("lays pieces edge to edge with every cut on a beat", () => {
    const pieces = planBeatEdit([clip("a", 30), clip("b", 30)], beats, 2, 0, 6 * S);
    expect(pieces[0].start).toBe(0);
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].start).toBe(pieces[i - 1].start + pieces[i - 1].duration);
      expect(beats).toContain(pieces[i].start);
    }
    const last = pieces.at(-1)!;
    expect(last.start + last.duration).toBe(6 * S);
  });

  it("alternates clips and moves each clip forward so nothing repeats", () => {
    const pieces = planBeatEdit([clip("a", 30), clip("b", 30)], beats, 2, 0, 8 * S);
    expect(pieces.map(p => p.clipId).slice(0, 4)).toEqual(["a", "b", "a", "b"]);
    const aPieces = pieces.filter(p => p.clipId === "a");
    expect(aPieces[1].in).toBe(aPieces[0].in + aPieces[0].duration);
  });

  it("starts a short clip over rather than running past its end", () => {
    const pieces = planBeatEdit([clip("a", 3)], beats, 2, 0, 8 * S);
    for (const p of pieces) expect(p.in + p.duration * p.speed).toBeLessThanOrEqual(3 * S + 1);
  });

  it("slows a clip that is shorter than one beat group, but never below half speed", () => {
    const [piece] = planBeatEdit([clip("a", 1.5)], beats, 4, 0, 6 * S);
    expect(piece.speed).toBeGreaterThanOrEqual(0.5);
    expect(piece.speed).toBeLessThan(1);
  });

  it("lets a picture run for as long as the beat lasts", () => {
    const pieces = planBeatEdit([clip("p", 5, true)], beats, 1, 0, 3 * S);
    expect(pieces.every(p => p.speed === 1 && p.in === 0)).toBe(true);
  });

  it("returns nothing without clips or beats", () => {
    expect(planBeatEdit([], beats, 1, 0, 5 * S)).toEqual([]);
    expect(planBeatEdit([clip("a", 5)], [], 1, 0, 5 * S)).toEqual([]);
  });
});

function ref(id: string, kind: "video" | "audio", duration: number, extra: Partial<MediaRef> = {}): MediaRef {
  return { id, kind, path: `/${id}`, name: id, size: 1, mtime: 1, duration: duration * S, hasAudio: true, hasVideo: kind === "video", width: 1920, height: 1080, ...extra };
}

describe("cutToBeat", () => {
  function setup() {
    let p = createProject();
    const a = ref("a", "video", 20), b = ref("b", "video", 20), song = ref("song", "audio", 10, { beats });
    p = addMedia(p, [a, b, song]);
    const ia = mediaItem(a, 0), ib = mediaItem(b, 0), im = mediaItem(song, 0);
    p = insertItems(p, [ia, ib]);
    p = insertItems(p, [im]);
    return { p, ia, ib, im };
  }

  it("replaces the clips with pieces that run as long as the music", () => {
    const { p, ia, ib, im } = setup();
    const r = cutToBeat(p, [ia.id, ib.id], im.id, 2);
    expect(r.pieces).toBeGreaterThan(3);
    const main = mainTrack(r.project);
    expect(main.items[0].start).toBe(0);
    expect(itemEnd(main.items.at(-1)!)).toBe(10 * S);
    for (const i of main.items.slice(1)) expect(beats).toContain(i.start);
  });

  it("silences the clips so the music carries", () => {
    const { p, ia, ib, im } = setup();
    const r = cutToBeat(p, [ia.id, ib.id], im.id, 1);
    expect(mainTrack(r.project).items.every(i => i.type === "media" && i.volume === 0)).toBe(true);
    expect(cutToBeat(p, [ia.id, ib.id], im.id, 1, false).project.tracks[0].items.some(i => i.type === "media" && i.volume === 1)).toBe(true);
  });

  it("does nothing when the music has no beats", () => {
    const { p, ia, im } = setup();
    const quiet = { ...p, media: { ...p.media, song: { ...p.media.song, beats: [] } } };
    expect(cutToBeat(quiet, [ia.id], im.id, 1).project).toBe(quiet);
  });
});
