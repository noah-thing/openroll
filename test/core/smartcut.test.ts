import { describe, expect, it } from "vitest";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { applyCuts, describePlan, guessLanguage, isFiller, mergeRanges, planCuts } from "../../src/core/smartcut";
import { createProject, mainTrack, type MediaRef } from "../../src/core/project";
import type { TimedWord } from "../../src/core/captions";

const S = 1_000_000;
const w = (text: string, from: number, to: number): TimedWord => ({ text, start: Math.round(from * S), end: Math.round(to * S) });
const clip = { from: 0, to: 20 * S };

describe("pauses", () => {
  it("shortens a long pause and keeps some of it at both sides", () => {
    const words = [w("hello", 1, 1.5), w("again", 3.5, 4)];
    const plan = planCuts(words, clip, { fillers: false });
    const mid = plan.ranges.find(r => r.from > 1 * S)!;
    expect(mid.from).toBe(1.5 * S + 150_000);
    expect(mid.to).toBe(3.5 * S - 150_000);
    expect(plan.pauses).toBe(3);
  });

  it("leaves pauses shorter than the threshold alone", () => {
    const words = [w("a", 0, 0.5), w("b", 1.0, 1.5), w("c", 2.0, 2.5)];
    expect(planCuts(words, { from: 0, to: 2.5 * S }, { minPause: 600_000 }).ranges).toEqual([]);
  });

  it("cuts silence at the head and tail of the clip down to the clip edge", () => {
    const plan = planCuts([w("only", 4, 4.5)], clip, { fillers: false });
    expect(plan.ranges[0]).toEqual({ from: 0, to: 4 * S - 150_000 });
    expect(plan.ranges.at(-1)).toEqual({ from: 4.5 * S + 150_000, to: 20 * S });
  });

  it("does nothing when no speech was found", () => {
    expect(planCuts([], clip).ranges).toEqual([]);
  });

  it("ignores words outside the clip", () => {
    expect(planCuts([w("far", 30, 31)], clip).ranges).toEqual([]);
  });

  it("can be switched off", () => {
    const words = [w("a", 0, 1), w("b", 5, 6)];
    expect(planCuts(words, { from: 0, to: 6 * S }, { pauses: false, fillers: false }).ranges).toEqual([]);
  });
});

describe("filler words", () => {
  it("finds um and uh, ignoring case and punctuation", () => {
    const words = [w("So", 0, 0.3), w("Um,", 0.3, 0.7), w("we", 0.7, 1), w("uh", 1, 1.4), w("left", 1.4, 1.8)];
    const plan = planCuts(words, { from: 0, to: 1.8 * S }, { pauses: false, language: "en" });
    expect(plan.fillers).toBe(2);
    expect(plan.ranges).toEqual([{ from: 0.3 * S, to: 0.7 * S }, { from: 1 * S, to: 1.4 * S }]);
  });

  it("removes like only when it stands apart", () => {
    const apart = [w("it", 0, 0.2), w("was,", 0.2, 0.5), w("like,", 0.5, 0.8), w("huge", 0.8, 1.2)];
    expect(isFiller(apart, 2, "en")).toBe(true);
    const verb = [w("I", 0, 0.2), w("like", 0.2, 0.5), w("cats", 0.5, 0.9)];
    expect(isFiller(verb, 1, "en")).toBe(false);
    const gap = [w("it", 0, 0.2), w("like", 0.6, 0.9), w("huge", 1.3, 1.6)];
    expect(isFiller(gap, 1, "en")).toBe(true);
  });

  it("knows Swedish fillers and keeps the Swedish word er", () => {
    const words = [w("det", 0, 0.3), w("var", 0.3, 0.6), w("liksom", 0.6, 1.1), w("öh", 1.1, 1.4), w("er", 1.4, 1.6)];
    const plan = planCuts(words, { from: 0, to: 1.6 * S }, { pauses: false, language: "sv" });
    expect(plan.fillers).toBe(2);
    expect(isFiller(words, 4, "sv")).toBe(false);
    expect(isFiller(words, 4, "en")).toBe(true);
  });

  it("guesses Swedish from the words when the language is not given", () => {
    expect(guessLanguage([w("jag", 0, 1), w("är", 1, 2), w("inte", 2, 3), w("här", 3, 4)])).toBe("sv");
    expect(guessLanguage([w("the", 0, 1), w("cat", 1, 2), w("and", 2, 3)])).toBe("en");
  });

  it("merges a filler with the pause beside it into one cut", () => {
    const words = [w("well", 0, 0.4), w("um", 1.2, 1.6), w("ok", 2.8, 3.2)];
    const plan = planCuts(words, { from: 0, to: 3.2 * S }, { language: "en" });
    // The 0.15 s of speech room around the filler survives, so three cuts rather than one.
    expect(plan.ranges).toEqual([{ from: 550_000, to: 1_050_000 }, { from: 1_200_000, to: 1_600_000 }, { from: 1_750_000, to: 2_650_000 }]);
    expect(plan.fillers).toBe(1);
    expect(plan.pauses).toBe(2);
    const tight = planCuts(words, { from: 0, to: 3.2 * S }, { language: "en", keep: 40_000 });
    // A sliver under 0.1 s cannot survive a split, so those cuts fuse.
    expect(tight.ranges.length).toBe(1);
  });
});

describe("ranges", () => {
  it("merges overlapping and nearly touching ranges", () => {
    expect(mergeRanges([{ from: 5, to: 10 }, { from: 0, to: 6 }, { from: 90_000, to: 200_000 }, { from: 400_000, to: 500_000 }], 100_000)).toEqual([{ from: 0, to: 200_000 }, { from: 400_000, to: 500_000 }]);
  });

  it("pulls a cut that nearly reaches the clip edge onto it", () => {
    const plan = planCuts([w("y", 3, 3.5)], { from: 0, to: 3.5 * S }, { fillers: false, keep: 40_000, minPause: 400_000 });
    expect(plan.ranges[0].from).toBe(0);
    const near = planCuts([w("x", 0.05, 0.5), w("y", 3, 3.5)], { from: 0, to: 3.5 * S }, { fillers: false });
    expect(near.ranges.every(r => r.from > 0.5 * S)).toBe(true);
  });

  it("describes the plan in plain words", () => {
    expect(describePlan({ ranges: [], pauses: 0, fillers: 0, removed: 0 })).toBe("Nothing to remove");
    expect(describePlan({ ranges: [{ from: 0, to: 1 }], pauses: 14, fillers: 0, removed: 38 * S })).toBe("Removes 14 pauses, 38 s");
    expect(describePlan({ ranges: [{ from: 0, to: 1 }], pauses: 1, fillers: 2, removed: 2.4 * S })).toBe("Removes 1 pause and 2 filler words, 2.4 s");
  });
});

describe("applying cuts", () => {
  function project() {
    const ref: MediaRef = { id: "m", kind: "video", path: "/t.mp4", name: "t.mp4", size: 1, mtime: 0, duration: 20 * S, hasAudio: true, hasVideo: true };
    let p = addMedia(createProject(), [ref]);
    p = insertItems(p, [mediaItem(ref, 0)]);
    return p;
  }

  it("removes every range in one pass and closes the gaps", () => {
    const ranges = [{ from: 2 * S, to: 4 * S }, { from: 10 * S, to: 11 * S }, { from: 15 * S, to: 18 * S }];
    const next = applyCuts(project(), ranges);
    const items = mainTrack(next).items;
    expect(items.reduce((n, i) => n + i.duration, 0)).toBe(20 * S - 6 * S);
    expect(items[0].start).toBe(0);
    items.forEach((it, i) => i && expect(it.start).toBe(items[i - 1].start + items[i - 1].duration));
  });

  it("keeps the right part of the source in each remaining piece", () => {
    const next = applyCuts(project(), [{ from: 2 * S, to: 4 * S }]);
    const [a, b] = mainTrack(next).items;
    expect(a.type === "media" && a.in).toBe(0);
    expect(b.type === "media" && b.in).toBe(4 * S);
  });

  it("leaves the input project untouched", () => {
    const p = project();
    const before = JSON.stringify(p);
    applyCuts(p, [{ from: S, to: 2 * S }]);
    expect(JSON.stringify(p)).toBe(before);
  });
});
