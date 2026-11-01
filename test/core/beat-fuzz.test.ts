import { describe, expect, it } from "vitest";
import { cutToBeat } from "../../src/core/beat-edit";
import { insertItems, mediaItem } from "../../src/core/edit";
import { mainTrack } from "../../src/core/project";
import { S, begin, check, rng } from "./model-gen";

describe("cutToBeat", () => {
  it("leaves a sound project whatever the clips, tempo and density", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      let p = begin();
      const bpm = r.int(60, 180);
      const beats = Array.from({ length: 60 * 2 }, (_, i) => Math.round((i * 60 * S) / bpm) + r.int(-5000, 5000)).filter(b => b >= 0 && b < 30 * S);
      p = { ...p, media: { ...p.media, song: { ...p.media.song, beats } } };
      const clips = Array.from({ length: r.int(1, 3) }, () => mediaItem(p.media[r.pick(["a", "b", "c", "img"])], 0));
      for (const c of clips) if (r.f() < 0.4 && c.duration > 4 * S) c.duration = r.int(2, 4) * S;
      p = insertItems(p, clips, { index: 0 });
      const song = mediaItem(p.media.song, 0);
      song.in = r.pick([0, 0, 2 * S]);
      song.duration = r.pick([song.duration, 12 * S]) - song.in;
      p = insertItems(p, [song]);
      const out = cutToBeat(p, clips.map(c => c.id), song.id, r.pick([1, 2, 4] as const), r.f() < 0.5);
      expect(check(out.project), `seed ${seed}`).toEqual([]);
      if (out.pieces) {
        const items = mainTrack(out.project).items;
        expect(items).toHaveLength(out.pieces);
        for (let i = 1; i < items.length; i++) expect(items[i].start).toBe(items[i - 1].start + items[i - 1].duration);
      }
    }
  });
});
