import { describe, expect, it } from "vitest";
import { applyCuts, planCuts } from "../../src/core/smartcut";
import { insertItems, mediaItem } from "../../src/core/edit";
import { mainTrack } from "../../src/core/project";
import { begin, check, rng } from "./model-gen";

const WORDS = ["so", "um", "the", "plan", "uh", "is", "like", "simple", "okay", "hmm"];

describe("smart cuts", () => {
  it("remove what the plan names, keep the project sound, and shorten the clip by exactly that", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      let p = insertItems(begin(), [mediaItem(begin().media.a, 0)]);
      if (r.f() < 0.5) p = insertItems(p, [{ ...mediaItem(p.media.b, 0), start: 0 }], { index: 0 });
      const main = mainTrack(p).items;
      const clip = { from: main[0].start, to: main[0].start + main[0].duration };
      let at = clip.from + r.int(0, 800_000);
      const words = [];
      while (at < clip.to) {
        const start = at + r.pick([20_000, 80_000, 300_000, 900_000, 1_500_000]);
        const end = start + r.int(150_000, 600_000);
        words.push({ text: r.pick(WORDS), start, end });
        at = end;
      }
      const plan = planCuts(words, clip);
      const out = applyCuts(p, plan.ranges);
      expect(check(out), `seed ${seed}`).toEqual([]);
      const total = (q: typeof p) => mainTrack(q).items.reduce((n, i) => n + i.duration, 0);
      expect(total(p) - total(out)).toBe(plan.removed);
    }
  });
});
