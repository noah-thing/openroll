import { describe, expect, it } from "vitest";
import { isRtl, wrap } from "../../src/engine/text";

// Ten pixels a character is enough to see where lines break.
const g = { measureText: (s: string) => ({ width: s.length * 10 }) } as OffscreenCanvasRenderingContext2D;
const lay = (text: string, max: number) => wrap(g, text.split(/(\s+)/), max, text.split("\n").map(isRtl));
const say = (lines: ReturnType<typeof lay>) => lines.map(l => l.pieces.map(p => p.text).join(""));

describe("text wrapping", () => {
  it("breaks between words and drops the space at a break", () => {
    expect(say(lay("one two three", 80))).toEqual(["one two", "three"]);
  });

  it("breaks a run with no spaces between characters instead of running off the frame", () => {
    const lines = lay("这是一个很长的中文句子", 50);
    expect(say(lines)).toEqual(["这是一个很", "长的中文句", "子"]);
    expect(lines.every(l => l.width <= 50)).toBe(true);
  });

  it("cuts one very long word over lines and keeps a single word number for the highlight", () => {
    const lines = lay("a ".concat("x".repeat(25)), 100);
    const words = new Set(lines.flatMap(l => l.pieces.filter(p => p.word >= 0).map(p => p.word)));
    expect(say(lines)[0]).toBe("a");
    expect(lines.length).toBeGreaterThan(2);
    expect([...words]).toEqual([0, 1]);
  });

  it("keeps combining marks with their letter", () => {
    const text = "é".repeat(6);
    const pieces = lay(text, 30).flatMap(l => l.pieces.map(p => p.text));
    expect(pieces.every(p => p.length % 2 === 0)).toBe(true);
  });

  it("marks a line that starts with Hebrew or Arabic as right to left, per paragraph", () => {
    const lines = lay("שלום עולם\nhello there", 500);
    expect(lines.map(l => l.rtl)).toEqual([true, false]);
    expect(isRtl("مرحبا")).toBe(true);
    expect(isRtl("123 שלום")).toBe(true);
    expect(isRtl("")).toBe(false);
  });
});
