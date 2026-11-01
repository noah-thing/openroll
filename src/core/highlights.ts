// Picking short highlights out of a long talking or vlog clip. Pure: it takes the words
// with their times, an energy curve and the scene cuts, and returns the best few
// windows with a plain reason for each. Everything is in one time base, whichever the
// caller chose (the timeline in practice), in microseconds.

import type { TimedWord } from "./captions";
import type { Micros } from "./project";

export interface Series {
  /** Time of the first value, and the gap between values. */
  start: Micros;
  step: Micros;
  /** 0..1, louder is higher. */
  values: ArrayLike<number>;
}

export interface HighlightInput {
  from: Micros;
  to: Micros;
  words: TimedWord[];
  energy?: Series;
  /** Times where the picture changes scene. */
  cuts?: Micros[];
}

export interface HighlightOptions {
  minLength: Micros;
  maxLength: Micros;
  /** Length the score favours. */
  idealLength: Micros;
  min: number;
  max: number;
}

export const DEFAULT_HIGHLIGHTS: HighlightOptions = { minLength: 15_000_000, maxLength: 60_000_000, idealLength: 38_000_000, min: 3, max: 8 };

export interface Highlight {
  from: Micros;
  to: Micros;
  score: number;
  /** One plain sentence, the strongest thing going for it. */
  reason: string;
  /** All the reasons that applied, strongest first. */
  reasons: string[];
  /** The first words, to recognise it by. */
  title: string;
  laughter: boolean;
}

interface Sentence {
  start: Micros;
  end: Micros;
  words: TimedWord[];
  text: string;
}

const SENTENCE_END = /[.!?…]["')\]]*$/;
const SEC = 1_000_000;
/** A silence this long closes a sentence even without punctuation. */
const SENTENCE_GAP: Micros = 800_000;

export function sentencesOf(words: TimedWord[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, text: cur.map(w => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end >= SENTENCE_GAP) flush();
    cur.push(w);
    if (SENTENCE_END.test(w.text)) flush();
  }
  flush();
  return out;
}

const HOOK_START = /^(so|okay|ok|listen|look|here'?s|here is|the (secret|truth|biggest|best|worst|one)|why|how|what|never|stop|don'?t|you (need|should|have|won'?t|can'?t)|imagine|let me|i('?ll| will) (show|tell)|this is|nobody|everyone|most people|if you)\b/i;
const CONNECTOR_START = /^(and|but|so|because|which|that|then|or|also|anyway|well)\b/i;
const NUMBER = /\d/;

/** 0..1 for how well a sentence works as the first line of a short. */
export function hookStrength(s: Sentence): number {
  const first = s.words.slice(0, 12).map(w => w.text).join(" ");
  let v = 0;
  if (/\?["')\]]*$/.test(s.text)) v += 0.45;
  if (HOOK_START.test(first)) v += 0.35;
  if (NUMBER.test(first)) v += 0.15;
  if (/!["')\]]*$/.test(s.text)) v += 0.15;
  // A short, punchy opener lands harder than a long wind up.
  const words = s.words.length;
  if (words >= 4 && words <= 14) v += 0.15;
  if (CONNECTOR_START.test(s.text) && !HOOK_START.test(s.text)) v -= 0.4;
  return Math.max(0, Math.min(1, v));
}

function energyBetween(series: Series | undefined, a: Micros, b: Micros): number[] {
  if (!series) return [];
  const out: number[] = [];
  const i0 = Math.max(0, Math.floor((a - series.start) / series.step));
  const i1 = Math.min(series.values.length - 1, Math.floor((b - series.start) / series.step));
  for (let i = i0; i <= i1; i++) out.push(series.values[i]);
  return out;
}

const mean = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0);

interface Scored {
  from: Micros;
  to: Micros;
  score: number;
  parts: Record<string, number>;
  first: Sentence;
  laughter: boolean;
}

/** Moments with no words but high energy, which in a talking clip are mostly laughter or applause. */
export function laughterSpans(input: HighlightInput): { from: Micros; to: Micros }[] {
  const e = input.energy;
  if (!e || !input.words.length) return [];
  const level = mean(Array.from(e.values as ArrayLike<number>));
  const spans: { from: Micros; to: Micros }[] = [];
  const sorted = [...input.words].sort((a, b) => a.start - b.start);
  const gaps: [Micros, Micros][] = [];
  let at = input.from;
  for (const w of sorted) {
    if (w.start - at >= 900_000) gaps.push([at, w.start]);
    at = Math.max(at, w.end);
  }
  if (input.to - at >= 900_000) gaps.push([at, input.to]);
  for (const [a, b] of gaps) {
    const v = energyBetween(e, a + 150_000, b - 150_000);
    if (v.length >= 3 && mean(v) > Math.max(0.35, level * 1.6)) spans.push({ from: a, to: b });
  }
  return spans;
}

function windows(input: HighlightInput, o: HighlightOptions): Scored[] {
  const sentences = sentencesOf(input.words.filter(w => w.end > input.from && w.start < input.to));
  const cuts = (input.cuts ?? []).filter(c => c > input.from && c < input.to);
  const baseline = mean(energyBetween(input.energy, input.from, input.to));
  const laughs = laughterSpans(input);
  const out: Scored[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const first = sentences[i];
    const startAt = Math.max(input.from, first.start - 250_000);
    for (let j = i; j < sentences.length; j++) {
      const last = sentences[j];
      const endAt = Math.min(input.to, last.end + 400_000);
      const len = endAt - startAt;
      if (len > o.maxLength) break;
      if (len < o.minLength) continue;

      const inside = sentences.slice(i, j + 1);
      const spoken = inside.reduce((n, s) => n + (s.end - s.start), 0);
      const wordCount = inside.reduce((n, s) => n + s.words.length, 0);
      const pace = wordCount / (len / SEC);
      const parts: Record<string, number> = {};

      parts.hook = hookStrength(first);
      // Steady speech reads as a person who knows where they are going; long silences do not.
      parts.density = Math.max(0, Math.min(1, spoken / len)) * (pace >= 1.8 && pace <= 4 ? 1 : 0.6);
      parts.complete = (SENTENCE_END.test(last.text) ? 0.6 : 0.1) + (CONNECTOR_START.test(first.text) ? 0 : 0.4);
      parts.length = 1 - Math.min(1, Math.abs(len - o.idealLength) / o.idealLength);
      parts.punch = Math.min(1, inside.filter(s => /[?!]["')\]]*$/.test(s.text)).length / 3);

      const level = energyBetween(input.energy, startAt, endAt);
      parts.energy = level.length ? Math.max(0, Math.min(1, (mean(level) - baseline) * 3 + 0.4)) : 0;

      const inCuts = cuts.filter(c => c > startAt && c < endAt).length;
      const cutAtStart = cuts.some(c => Math.abs(c - first.start) < 900_000);
      parts.scene = Math.min(1, inCuts / 4) * 0.6 + (cutAtStart ? 0.4 : 0);

      const laughter = laughs.some(l => l.from >= startAt && l.to <= endAt + 600_000);
      parts.laughter = laughter ? 1 : 0;

      const score =
        parts.hook * 2.2 + parts.density * 1.6 + parts.complete * 1.4 + parts.length * 1.0 + parts.punch * 0.6 + parts.energy * 1.2 + parts.scene * 0.5 + parts.laughter * 1.0;
      out.push({ from: startAt, to: endAt, score, parts, first, laughter });
    }
  }
  return out;
}

/** With no speech to work from, lean on loud stretches and scene changes. */
function silentWindows(input: HighlightInput, o: HighlightOptions): Scored[] {
  const cuts = [input.from, ...(input.cuts ?? []).filter(c => c > input.from && c < input.to)];
  const baseline = mean(energyBetween(input.energy, input.from, input.to));
  const out: Scored[] = [];
  const empty: Sentence = { start: 0, end: 0, words: [], text: "" };
  const len = Math.min(o.maxLength, Math.max(o.minLength, o.idealLength));
  for (const c of cuts) {
    const to = Math.min(input.to, c + len);
    if (to - c < o.minLength) continue;
    const level = mean(energyBetween(input.energy, c, to));
    const inCuts = cuts.filter(x => x > c && x < to).length;
    const parts = { energy: Math.max(0, Math.min(1, (level - baseline) * 3 + 0.4)), scene: Math.min(1, inCuts / 4) + 0.3 };
    out.push({ from: c, to, score: parts.energy * 2 + parts.scene, parts, first: empty, laughter: false });
  }
  return out;
}

const overlap = (a: { from: Micros; to: Micros }, b: { from: Micros; to: Micros }) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));

function reasonsOf(c: Scored): string[] {
  const p = c.parts;
  const list: [number, string][] = [
    [c.laughter ? 2.4 : 0, "Laughter"],
    [p.hook >= 0.45 ? p.hook * 2.2 : 0, /\?$/.test(c.first.text) ? "Opens with a question" : "Strong opening line"],
    [p.energy >= 0.7 ? p.energy * 1.2 : 0, "Lively delivery"],
    [p.scene >= 0.6 ? p.scene * 0.9 : 0, "Clean scene change at the start"],
    [p.punch >= 0.34 ? p.punch * 0.8 : 0, "Punchy, with a few sharp lines"],
    [p.density >= 0.8 && p.complete >= 0.9 ? 1.4 : 0, "Complete thought, steady pace"],
    [p.density >= 0.85 ? 0.9 : 0, "Dense, steady speech"],
  ];
  const picked = list.filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]).map(([, text]) => text);
  return picked.length ? picked : [p.complete >= 0.9 ? "Complete thought" : "A solid stretch to start from"];
}

const title = (s: Sentence) => {
  const words = s.words.slice(0, 8).map(w => w.text);
  const text = words.join(" ").replace(/[,;:]$/, "");
  return s.words.length > 8 ? text + "…" : text;
};

/** Pick the best non overlapping highlights, best first by score, returned in timeline order. */
export function findHighlights(input: HighlightInput, options: Partial<HighlightOptions> = {}): Highlight[] {
  const o = { ...DEFAULT_HIGHLIGHTS, ...options };
  const talk = input.words.length >= 12;
  const pool = (talk ? windows(input, o) : silentWindows(input, o)).sort((a, b) => b.score - a.score);
  if (!pool.length) return [];

  // Scale the count to the length of the source: a 10 minute talk earns more cards than a 2 minute one.
  const span = input.to - input.from;
  const want = Math.max(o.min, Math.min(o.max, Math.round(span / (90 * SEC))));
  const chosen: Scored[] = [];
  for (const maxShare of [0.15, 0.5]) {
    for (const c of pool) {
      if (chosen.length >= want) break;
      if (chosen.includes(c)) continue;
      const clash = chosen.some(k => overlap(c, k) > maxShare * Math.min(c.to - c.from, k.to - k.from));
      if (!clash) chosen.push(c);
    }
    if (chosen.length >= o.min) break;
  }
  return chosen
    .sort((a, b) => a.from - b.from)
    .map(c => {
      const reasons = reasonsOf(c);
      return { from: c.from, to: c.to, score: Math.round(c.score * 100) / 100, reason: reasons[0], reasons, title: title(c.first) || "Scene", laughter: c.laughter };
    });
}

/** Per second loudness from the 100 per second peak bins the timeline already has, scaled 0..1. */
export function energyFromPeaks(peaks: ArrayLike<number>, binsPerSecond: number, stepSeconds = 0.5): Series {
  const per = Math.max(1, Math.round(binsPerSecond * stepSeconds));
  const values: number[] = [];
  for (let i = 0; i < peaks.length; i += per) {
    let sum = 0, n = 0;
    for (let k = i; k < Math.min(peaks.length, i + per); k++) {
      sum += peaks[k] / 255;
      n++;
    }
    values.push(n ? sum / n : 0);
  }
  // Rescale so the loudest half second is 1, otherwise a quiet recording scores low everywhere.
  const top = Math.max(0.05, ...values);
  return { start: 0, step: Math.round(stepSeconds * SEC), values: values.map(v => v / top) };
}

/** Scene cuts from mean frame differences: a difference far above its neighbours is a cut. */
export function cutsFromDifferences(diffs: ArrayLike<number>, step: Micros, start: Micros = 0, strength = 3): Micros[] {
  const out: Micros[] = [];
  const n = diffs.length;
  if (n < 5) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += diffs[i];
  const avg = sum / n;
  for (let i = 1; i < n; i++) {
    const around = [diffs[i - 2], diffs[i - 1], diffs[i + 1], diffs[i + 2]].filter(v => v !== undefined);
    const local = around.length ? mean(around) : avg;
    if (diffs[i] > Math.max(0.06, local * strength, avg * 2)) out.push(start + i * step);
  }
  return out;
}

/** The energy of one clip as it sits on the timeline: source loudness resampled through the clip's in point and speed. */
export function energyForClip(peaks: ArrayLike<number>, binsPerSecond: number, clip: { start: Micros; duration: Micros; in: Micros; speed: number }, stepSeconds = 0.5): Series {
  const step = Math.round(stepSeconds * SEC);
  const values: number[] = [];
  for (let t = 0; t < clip.duration; t += step) {
    const a = Math.floor(((clip.in + t * clip.speed) / SEC) * binsPerSecond);
    const b = Math.max(a + 1, Math.floor(((clip.in + Math.min(clip.duration, t + step) * clip.speed) / SEC) * binsPerSecond));
    let sum = 0, n = 0;
    for (let k = a; k < Math.min(peaks.length, b); k++) {
      sum += peaks[k] / 255;
      n++;
    }
    values.push(n ? sum / n : 0);
  }
  const top = Math.max(0.05, ...values);
  return { start: clip.start, step, values: values.map(v => v / top) };
}
