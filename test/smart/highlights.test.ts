import { describe, expect, it } from "vitest";
import type { TimedWord } from "../../src/core/captions";
import { cutsFromDifferences, energyFromPeaks, findHighlights, hookStrength, laughterSpans, sentencesOf, type Series } from "../../src/core/highlights";

const S = 1_000_000;

/** A sentence of `n` words spread over `seconds`, starting at `at`. */
function say(text: string, at: number, seconds: number): TimedWord[] {
  const tokens = text.split(" ");
  const each = seconds / tokens.length;
  return tokens.map((t, i) => ({ text: t, start: Math.round((at + i * each) * S), end: Math.round((at + (i + 1) * each - 0.05) * S) }));
}

/** A talk made of `count` sentences, each ~6 s with a short breath between. */
function talk(sentences: string[], gap = 0.4): { words: TimedWord[]; end: number } {
  const words: TimedWord[] = [];
  let at = 1;
  for (const s of sentences) {
    words.push(...say(s, at, 6));
    at += 6 + gap;
  }
  return { words, end: at };
}

const filler = (n: number) => Array.from({ length: n }, (_, i) => `and then the ${["next", "other", "last", "small"][i % 4]} thing happened to the group today.`);

describe("sentences", () => {
  it("splits on end punctuation and on long silences", () => {
    const words = [...say("this is one.", 0, 2), ...say("and this is two", 2.1, 2), ...say("then a long wait before three", 6, 2)];
    expect(sentencesOf(words).map(s => s.text)).toEqual(["this is one.", "and this is two", "then a long wait before three"]);
  });
});

describe("hook strength", () => {
  const first = (text: string) => sentencesOf(say(text, 0, 4))[0];
  it("rewards a question and a classic opener over a connector", () => {
    expect(hookStrength(first("Why does nobody tell you this?"))).toBeGreaterThan(hookStrength(first("and then we went home again.")));
    expect(hookStrength(first("Here's the secret to editing fast."))).toBeGreaterThan(0.4);
  });
  it("stays within 0 and 1", () => {
    const v = hookStrength(first("Stop! Never do this 3 times?"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("findHighlights", () => {
  const lines = [...filler(8), "Why does nobody tell you about this?", "Because the trick is simple and it changes how you cut.", "You trim the start first, then the end.", "That is the whole idea, and it works every time.", ...filler(8), "Here's the secret nobody shows.", "Watch the pauses, they are what make it feel fast.", "Cut them and the whole thing tightens up.", "Try it once and you will not go back.", ...filler(10)];
  const { words, end } = talk(lines);
  const input = { from: 0, to: Math.round((end + 2) * S), words };

  it("returns between three and eight non overlapping windows in order", () => {
    const out = findHighlights(input);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < out.length; i++) expect(out[i].from).toBeGreaterThanOrEqual(out[i - 1].to - 0.15 * (out[i].to - out[i].from));
  });

  it("keeps every window between fifteen and sixty seconds", () => {
    for (const h of findHighlights(input)) {
      expect(h.to - h.from).toBeGreaterThanOrEqual(15 * S);
      expect(h.to - h.from).toBeLessThanOrEqual(60 * S);
    }
  });

  it("finds the strong opening and says so", () => {
    const out = findHighlights(input);
    const hit = out.find(h => h.title.startsWith("Why does nobody"));
    expect(hit).toBeDefined();
    expect(hit!.reason).toBe("Opens with a question");
  });

  it("starts on a sentence, not in the middle of one", () => {
    const starts = new Set(sentencesOf(words).map(s => s.start));
    for (const h of findHighlights(input)) {
      const near = [...starts].some(s => Math.abs(h.from - (s - 250_000)) < 2000 || h.from === 0);
      expect(near).toBe(true);
    }
  });

  it("names laughter when loud energy fills a gap with no words", () => {
    const a = say("So I opened the box and there it was.", 1, 6);
    const b = say("Honestly the best moment of the whole trip.", 12, 6);
    const rest = talk(filler(6)).words.map(w => ({ ...w, start: w.start + 20 * S, end: w.end + 20 * S }));
    const quiet = 0.2;
    const values = Array.from({ length: 120 }, (_, i) => (i * 0.5 >= 7.5 && i * 0.5 <= 11 ? 0.95 : quiet));
    const energy: Series = { start: 0, step: 0.5 * S, values };
    const all = [...a, ...b, ...rest];
    const spans = laughterSpans({ from: 0, to: 60 * S, words: all, energy });
    expect(spans).toHaveLength(1);
    const out = findHighlights({ from: 0, to: 60 * S, words: all, energy });
    expect(out.some(h => h.laughter && h.reasons[0] === "Laughter")).toBe(true);
  });

  it("falls back to scene changes and energy when nobody speaks", () => {
    const cuts = [20, 55, 100, 140].map(s => s * S);
    const values = Array.from({ length: 400 }, (_, i) => (i * 0.5 > 95 && i * 0.5 < 130 ? 0.9 : 0.3));
    const out = findHighlights({ from: 0, to: 200 * S, words: [], cuts, energy: { start: 0, step: 0.5 * S, values } });
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0].title).toBe("Scene");
  });

  it("returns nothing for a clip shorter than the minimum", () => {
    expect(findHighlights({ from: 0, to: 8 * S, words: say("short and sweet.", 0, 3) })).toEqual([]);
  });
});

describe("energy and cuts", () => {
  it("scales loudness so the loudest stretch is one", () => {
    const peaks = new Uint8Array(400).fill(20);
    peaks.fill(100, 100, 200);
    const e = energyFromPeaks(peaks, 100, 0.5);
    const values = Array.from(e.values);
    expect(Math.max(...values)).toBeCloseTo(1);
    expect(values[0]).toBeLessThan(0.3);
    expect(e.step).toBe(0.5 * S);
  });

  it("calls a jump far above its neighbours a cut", () => {
    const diffs = new Float32Array(30).fill(0.02);
    diffs[12] = 0.5;
    expect(cutsFromDifferences(diffs, S, 0)).toEqual([12 * S]);
  });

  it("does not call steady motion a cut", () => {
    const diffs = Float32Array.from({ length: 30 }, (_, i) => 0.05 + (i % 3) * 0.01);
    expect(cutsFromDifferences(diffs, S, 0)).toEqual([]);
  });
});

import { energyForClip } from "../../src/core/highlights";

describe("energyForClip", () => {
  it("follows the in point and lands on the timeline", () => {
    // Loud only between 10 s and 12 s of the source; the clip starts at 10 s and sits at 100 s.
    const peaks = new Uint8Array(30 * 100).fill(10);
    peaks.fill(200, 1000, 1200);
    const e = energyForClip(peaks, 100, { start: 100 * S, duration: 6 * S, in: 8 * S, speed: 1 });
    const values = Array.from(e.values);
    expect(e.start).toBe(100 * S);
    expect(values[0]).toBeLessThan(0.2);
    expect(values[4]).toBeCloseTo(1, 1);
    expect(values[11]).toBeLessThan(0.2);
  });
});
