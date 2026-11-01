import { describe, expect, it } from "vitest";
import { retimeWords, spreadWords } from "../../src/core/captions";
import { rng } from "./model-gen";

const VOCAB = ["so", "the", "quick", "brown", "fox", "jumps", "over", "a", "lazy", "dog", "och", "det", "var", "bra"];

describe("retimeWords", () => {
  it("keeps one timed word per token, in order, inside the caption, whatever the edit", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const duration = r.int(300_000, 6_000_000);
      const old = spreadWords(Array.from({ length: r.int(1, 9) }, () => r.pick(VOCAB)), 0, duration);
      const tokens = old.map(w => w.text);
      for (let k = r.int(0, 4); k > 0; k--) {
        const at = r.int(0, tokens.length);
        const op = r.int(0, 2);
        if (op === 0) tokens.splice(at, 0, ...Array.from({ length: r.int(1, 3) }, () => r.pick(VOCAB)));
        else if (op === 1) tokens.splice(at, r.int(1, 2));
        else if (tokens[at] !== undefined) tokens[at] = r.pick(VOCAB);
      }
      const text = tokens.join(" ");
      const out = retimeWords(old, text, duration);
      expect(out.map(w => w.text)).toEqual(text.trim().split(/\s+/).filter(Boolean));
      let at = 0;
      for (const w of out) {
        expect(w.start).toBeGreaterThanOrEqual(at);
        expect(w.end).toBeGreaterThan(w.start);
        expect(Number.isInteger(w.start) && Number.isInteger(w.end)).toBe(true);
        at = w.end;
      }
      if (out.length) expect(out.at(-1)!.end).toBeLessThanOrEqual(duration + out.length * 100_000);
    }
  });
});
