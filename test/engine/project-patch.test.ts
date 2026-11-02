import { describe, expect, it } from "vitest";
import { applyPatch, diffProject } from "../../src/engine/project-patch";
import { audioKey } from "../../src/core/audio-plan";
import type { MediaItem, Project } from "../../src/core/project";
import { STEPS, begin, rng } from "../core/model-gen";

describe("project patches", () => {
  it("rebuild the next project from the previous one, whatever the edit", () => {
    let sent = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      let p = begin();
      let held: Project = structuredClone(p);
      for (let n = 0; n < 16; n++) {
        const next = r.pick(STEPS).run(p, r);
        const patch = diffProject(p, next);
        expect(patch).not.toBeNull();
        // postMessage copies, so the worker never shares objects with the page
        held = applyPatch(held, structuredClone(patch!));
        expect(held).toEqual(next);
        sent += patch!.tracks.length;
        p = next;
      }
    }
    expect(sent).toBeGreaterThan(0);
  });

  it("leaves untouched tracks out", () => {
    const p = begin();
    const next = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, name: "renamed" } : t)) };
    const patch = diffProject(p, next)!;
    expect(patch.tracks.map(t => t.id)).toEqual([p.tracks[0].id]);
    expect(patch.order).toEqual(p.tracks.map(t => t.id));
  });

  it("falls back to a full send when track ids repeat", () => {
    const p = begin();
    const dup = { ...p, tracks: [p.tracks[0], p.tracks[0]] };
    expect(diffProject(p, dup)).toBeNull();
  });
});

describe("audio key", () => {
  const withSound = (): Project => {
    const p = begin();
    const media = { ...Object.values(p.media)[0], hasAudio: true, kind: "video" as const };
    const item = { id: "a", type: "media", mediaId: media.id, start: 0, duration: 2_000_000, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } as MediaItem;
    return { ...p, media: { ...p.media, [media.id]: media }, tracks: [{ id: "t", kind: "video", name: "v", items: [item] }] };
  };
  const urls = (p: Project) => Object.fromEntries(Object.keys(p.media).map(id => [id, "blob:" + id]));
  const edit = (p: Project, change: Partial<MediaItem>): Project => ({ ...p, tracks: [{ ...p.tracks[0], items: [{ ...(p.tracks[0].items[0] as MediaItem), ...change }] }] });

  it("ignores edits that cannot be heard", () => {
    const p = withSound();
    const key = audioKey(p, urls(p));
    expect(audioKey(edit(p, { transform: { x: 40, y: 0, scale: 2, rotation: 0, opacity: 0.5 } }), urls(p))).toBe(key);
    expect(audioKey(edit(p, { filter: { id: "mono", amount: 1 } }), urls(p))).toBe(key);
  });

  it("changes when sound, level, timing or speed change", () => {
    const p = withSound();
    const key = audioKey(p, urls(p));
    for (const change of [{ volume: 0.5 }, { fadeOut: 500_000 }, { speed: 2 }, { start: 100_000 }, { in: 100_000 }, { duration: 1_000_000 }, { muteAudio: true }]) {
      expect(audioKey(edit(p, change), urls(p))).not.toBe(key);
    }
  });

  it("follows track mute", () => {
    const p = withSound();
    const muted = { ...p, tracks: [{ ...p.tracks[0], muted: true }] };
    expect(audioKey(muted, urls(p))).not.toBe(audioKey(p, urls(p)));
  });
});
