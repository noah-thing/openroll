import { describe, expect, it } from "vitest";
import {
  captionsFromCues,
  captionsFromWords,
  chunkWords,
  cuesFromCaptions,
  parseSubtitles,
  placeCaptions,
  restyleCaptions,
  retimeWords,
  spreadWords,
  toSrt,
  toVtt,
  type CaptionTemplate,
  type TimedWord,
} from "../../src/core/captions";
import { createProject, type CaptionItem, type CaptionWord, type TextStyle } from "../../src/core/project";

const S = 1_000_000;
const style: TextStyle = { text: "", font: "Familjen Grotesk", size: 64, weight: 600, color: "#fff", align: "center", lineHeight: 1.1, letterSpacing: 0 };
const template: CaptionTemplate = { style, y: 300, highlight: "#f2c23a" };

/** Words spoken one per `step` seconds with no gaps, starting at `at`. */
function speak(text: string, at = 0, step = 0.4): TimedWord[] {
  return text.split(" ").map((t, i) => ({ text: t, start: Math.round((at + i * step) * S), end: Math.round((at + (i + 1) * step) * S) }));
}

describe("chunkWords", () => {
  it("keeps short phrases together", () => {
    expect(chunkWords(speak("so we went down")).map(g => g.length)).toEqual([4]);
  });

  it("caps captions at the word limit", () => {
    const groups = chunkWords(speak("one two three four five six seven eight nine ten eleven twelve"));
    expect(Math.max(...groups.map(g => g.length))).toBeLessThanOrEqual(7);
    expect(groups.flat()).toHaveLength(12);
  });

  it("starts a new caption after a long pause", () => {
    const words = [...speak("hello there", 0), ...speak("how are you", 3)];
    expect(chunkWords(words).map(g => g.map(w => w.text).join(" "))).toEqual(["hello there", "how are you"]);
  });

  it("breaks at the end of a sentence once it has some body", () => {
    const words = speak("It was cold. We stayed in");
    expect(chunkWords(words).map(g => g.map(w => w.text).join(" "))).toEqual(["It was cold.", "We stayed in"]);
  });

  it("does not leave a single word alone at the end", () => {
    const groups = chunkWords(speak("one two three four five six seven"));
    expect(groups.every(g => g.length > 1)).toBe(true);
  });

  it("breaks on character count for long words", () => {
    const groups = chunkWords(speak("extraordinarily unbelievable straightforward magnificently"), { maxChars: 30 });
    expect(groups.length).toBeGreaterThan(1);
  });
});

describe("captionsFromWords", () => {
  it("makes items whose words are relative to the item", () => {
    const items = captionsFromWords(speak("hello there friend", 5), template);
    expect(items).toHaveLength(1);
    const c = items[0];
    expect(c.start).toBe(5 * S);
    expect(c.words[0].start).toBe(0);
    expect(c.words.at(-1)!.end).toBeLessThanOrEqual(c.duration);
    expect(c.transform.y).toBe(300);
    expect(c.highlight).toBe("#f2c23a");
  });

  it("never overlaps the next caption", () => {
    const items = captionsFromWords([...speak("first part here", 0), ...speak("second part here", 1.5)], template, { pause: 100_000 });
    expect(items.length).toBe(2);
    expect(items[0].start + items[0].duration).toBeLessThanOrEqual(items[1].start);
  });

  it("closes small gaps between words so the highlight does not blink", () => {
    const words: TimedWord[] = [
      { text: "a", start: 0, end: 200_000 },
      { text: "b", start: 300_000, end: 500_000 },
    ];
    const [c] = captionsFromWords(words, template);
    expect(c.words[0].end).toBe(c.words[1].start);
  });

  it("gives a one word caption a readable minimum length", () => {
    const [c] = captionsFromWords([{ text: "Wow", start: 0, end: 100_000 }], template);
    expect(c.duration).toBeGreaterThanOrEqual(400_000);
  });
});

describe("retimeWords", () => {
  const old: CaptionWord[] = [
    { text: "we", start: 0, end: 300_000 },
    { text: "went", start: 300_000, end: 700_000 },
    { text: "down", start: 700_000, end: 1_200_000 },
    { text: "slowly", start: 1_200_000, end: 2_000_000 },
  ];

  it("keeps timing when only case or punctuation changes", () => {
    const out = retimeWords(old, "We went down, slowly.", 2 * S);
    expect(out.map(w => w.text)).toEqual(["We", "went", "down,", "slowly."]);
    expect(out.map(w => [w.start, w.end])).toEqual(old.map(w => [w.start, w.end]));
  });

  it("keeps the timing of untouched words around a replacement", () => {
    const out = retimeWords(old, "we walked down slowly", 2 * S);
    expect(out[0]).toMatchObject({ start: 0, end: 300_000 });
    expect(out[1]).toMatchObject({ text: "walked", start: 300_000, end: 700_000 });
    expect(out[2]).toMatchObject({ start: 700_000, end: 1_200_000 });
  });

  it("shares the time of a replaced run among the new words", () => {
    const out = retimeWords(old, "we went all the way down slowly", 2 * S);
    const mid = out.slice(2, 5);
    expect(mid.map(w => w.text)).toEqual(["all", "the", "way"]);
    expect(out[1].end).toBeLessThanOrEqual(mid[0].start);
    expect(mid[2].end).toBeLessThanOrEqual(out[5].start);
  });

  it("makes room for an inserted word between words that touch", () => {
    const out = retimeWords(old, "we went really down slowly", 2 * S);
    const w = out.find(x => x.text === "really")!;
    expect(w.end - w.start).toBeGreaterThanOrEqual(90_000);
  });

  it("drops deleted words and keeps the rest in place", () => {
    const out = retimeWords(old, "we went slowly", 2 * S);
    expect(out.map(w => w.text)).toEqual(["we", "went", "slowly"]);
    expect(out[2].start).toBeGreaterThanOrEqual(700_000);
  });

  it("never runs backwards", () => {
    for (const text of ["slowly down went we", "x", "we we we we we we", "went"]) {
      const out = retimeWords(old, text, 2 * S);
      let at = 0;
      for (const w of out) {
        expect(w.start).toBeGreaterThanOrEqual(at);
        expect(w.end).toBeGreaterThan(w.start);
        at = w.end;
      }
    }
  });

  it("spreads new words over the whole item when there was no text", () => {
    const out = retimeWords([], "brand new words", 3 * S);
    expect(out).toHaveLength(3);
    expect(out[0].start).toBe(0);
    expect(out[2].end).toBe(3 * S);
  });

  it("returns nothing for empty text", () => {
    expect(retimeWords(old, "   ", S)).toEqual([]);
  });
});

describe("spreadWords", () => {
  it("covers the span exactly", () => {
    const out = spreadWords(["a", "bb", "ccc"], 1000, 91_000);
    expect(out[0].start).toBe(1000);
    expect(out[2].end).toBe(91_000);
    out.forEach((w, i) => i && expect(w.start).toBe(out[i - 1].end));
  });
});

describe("SRT and VTT", () => {
  const cues = [
    { start: 1_500_000, end: 3_250_000, text: "Hello there" },
    { start: 3_600_000, end: 5_000_000, text: "Second line" },
  ];

  it("writes SRT with comma milliseconds and numbering", () => {
    expect(toSrt(cues)).toBe("1\n00:00:01,500 --> 00:00:03,250\nHello there\n\n2\n00:00:03,600 --> 00:00:05,000\nSecond line\n");
  });

  it("writes VTT with a header and dot milliseconds", () => {
    expect(toVtt(cues)).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nHello there\n\n00:00:03.600 --> 00:00:05.000\nSecond line\n");
  });

  it("round trips through SRT and VTT", () => {
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
    expect(parseSubtitles(toVtt(cues))).toEqual(cues);
  });

  it("breaks long cues over two lines and reads them back intact", () => {
    const long = [{ start: 0, end: 4 * S, text: "this is a rather long caption that would not fit on one line" }];
    const srt = toSrt(long);
    const textLines = srt.split("\n").filter(l => l && !/^\d+$/.test(l) && !l.includes("-->"));
    expect(textLines).toHaveLength(2);
    expect(parseSubtitles(srt)[0].text.replace("\n", " ")).toBe(long[0].text);
  });

  it("formats hours and rounds to milliseconds", () => {
    expect(toSrt([{ start: 3_661_234_567, end: 3_662_000_000, text: "x" }])).toContain("01:01:01,235 --> 01:01:02,000");
  });

  it("reads Windows line endings, a byte order mark and cue ids", () => {
    const text = "﻿WEBVTT\r\n\r\nintro\r\n00:01.000 --> 00:02.000 align:start\r\nShort form\r\n\r\n1\r\n00:00:03.000 --> 00:00:04.000\r\n<i>Styled</i> &amp; tagged\r\n";
    expect(parseSubtitles(text)).toEqual([
      { start: S, end: 2 * S, text: "Short form" },
      { start: 3 * S, end: 4 * S, text: "Styled & tagged" },
    ]);
  });

  it("skips notes, styles and broken blocks", () => {
    const text = "WEBVTT\n\nNOTE written by hand\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:00.500\nbackwards\n\nnot a cue at all\n\n00:00:02.000 --> 00:00:03.000\nkept\n";
    expect(parseSubtitles(text)).toEqual([{ start: 2 * S, end: 3 * S, text: "kept" }]);
  });

  it("drops ASS style overrides some SRT files carry", () => {
    expect(parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Top line\n")[0].text).toBe("Top line");
  });

  it("sorts cues by start", () => {
    const text = "1\n00:00:05,000 --> 00:00:06,000\nlate\n\n2\n00:00:01,000 --> 00:00:02,000\nearly\n";
    expect(parseSubtitles(text).map(c => c.text)).toEqual(["early", "late"]);
  });

  it("returns nothing for a file that is not subtitles", () => {
    expect(parseSubtitles("just some words\nand more")).toEqual([]);
  });
});

describe("captions on the timeline", () => {
  it("builds items from cues and writes them back out unchanged", () => {
    const cues = [
      { start: S, end: 3 * S, text: "first caption" },
      { start: 4 * S, end: 6 * S, text: "second one here" },
    ];
    const items = captionsFromCues(cues, template);
    expect(items[1].words.map(w => w.text)).toEqual(["second", "one", "here"]);
    expect(cuesFromCaptions(items)).toEqual(cues);
  });

  it("places captions on their own text track and replaces earlier ones under the same span", () => {
    const first = captionsFromWords(speak("hello there friend", 1), template);
    let p = placeCaptions(createProject(), first, [{ from: 0, to: 10 * S }]);
    const lanes = p.tracks.filter(t => t.kind === "text");
    expect(lanes).toHaveLength(1);
    expect(lanes[0].name).toBe("Captions");

    const again = captionsFromWords(speak("different words now", 1), template);
    p = placeCaptions(p, again, [{ from: 0, to: 10 * S }]);
    const all = p.tracks.flatMap(t => t.items) as CaptionItem[];
    expect(all).toHaveLength(1);
    expect(all[0].words[0].text).toBe("different");
  });

  it("restyles every caption and leaves the words alone", () => {
    let p = placeCaptions(createProject(), captionsFromWords([...speak("one two three", 0), ...speak("four five six", 5)], template));
    const loud: CaptionTemplate = { style: { ...style, size: 99, color: "#ff0" }, y: -100, highlight: "#0f0" };
    const before = JSON.stringify(p);
    p = restyleCaptions(p, loud);
    const items = p.tracks.flatMap(t => t.items) as CaptionItem[];
    expect(items.every(i => i.style.size === 99 && i.highlight === "#0f0" && i.transform.y === -100)).toBe(true);
    expect(items.map(i => i.words.length)).toEqual([3, 3]);
    expect(JSON.stringify(p)).not.toBe(before);
  });
});
