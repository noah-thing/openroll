import { describe, expect, it } from "vitest";
import { fuzzyMatch, rank } from "../../src/core/fuzzy";

const items = [
  { id: "split", label: "Split at playhead" },
  { id: "speed2", label: "Change speed to 2x", keywords: "faster fast" },
  { id: "export", label: "Export" },
  { id: "export-captions", label: "Export captions as SRT" },
  { id: "silences", label: "Remove silences", keywords: "pauses dead air" },
  { id: "vertical", label: "Make vertical", keywords: "9:16 portrait shorts" },
];

describe("fuzzyMatch", () => {
  it("needs every word to appear", () => {
    expect(fuzzyMatch("split play", "Split at playhead")).not.toBeNull();
    expect(fuzzyMatch("split zebra", "Split at playhead")).toBeNull();
  });

  it("accepts letters in order with gaps", () => {
    expect(fuzzyMatch("rmsil", "Remove silences")).not.toBeNull();
    expect(fuzzyMatch("slir", "Remove silences")).toBeNull();
  });

  it("scores a word start above a hit in the middle", () => {
    const start = fuzzyMatch("play", "Split at playhead")!;
    const middle = fuzzyMatch("lay", "Split at playhead")!;
    expect(start.score).toBeGreaterThan(middle.score);
  });

  it("reports the matched positions for highlighting", () => {
    expect(fuzzyMatch("exp", "Export")!.hits).toEqual([0, 1, 2]);
  });

  it("finds through keywords but prefers the label", () => {
    expect(fuzzyMatch("faster", "Change speed to 2x", "faster fast")).not.toBeNull();
    const inLabel = fuzzyMatch("speed", "Change speed to 2x", "speed")!;
    const inWords = fuzzyMatch("speed", "Go quicker", "speed")!;
    expect(inLabel.score).toBeGreaterThan(inWords.score);
  });
});

describe("rank", () => {
  it("puts the shorter exact label first", () => {
    const r = rank(items, "export");
    expect(r[0].item.id).toBe("export");
    expect(r[1].item.id).toBe("export-captions");
  });

  it("lifts recent commands with an empty query, newest first", () => {
    const r = rank(items, "", ["silences", "split"]);
    expect(r.slice(0, 2).map(x => x.item.id)).toEqual(["silences", "split"]);
    expect(r).toHaveLength(items.length);
  });

  it("lets a recent command beat a slightly better match", () => {
    const plain = rank(items, "sp").map(x => x.item.id);
    const withRecent = rank(items, "sp", ["speed2"]).map(x => x.item.id);
    expect(withRecent.indexOf("speed2")).toBeLessThanOrEqual(plain.indexOf("speed2"));
  });

  it("finds a command by what people call it", () => {
    expect(rank(items, "dead air")[0].item.id).toBe("silences");
    expect(rank(items, "9:16")[0].item.id).toBe("vertical");
  });

  it("returns nothing when nothing matches", () => {
    expect(rank(items, "qqqq")).toEqual([]);
  });
});
