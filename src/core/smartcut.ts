// Finding the dead air and filler words in a spoken clip, and cutting them out in one go.
// Everything here works on timeline microseconds and a list of timed words, so it is
// testable without audio.

import { MIN_ITEM, rippleDeleteRange } from "./edit";
import type { Micros, Project } from "./project";
import type { TimedWord } from "./captions";

export interface Range {
  from: Micros;
  to: Micros;
}

export interface CutOptions {
  pauses: boolean;
  fillers: boolean;
  /** Pauses at least this long are shortened. */
  minPause: Micros;
  /** How much of a shortened pause stays at each side, so speech does not run together. */
  keep: Micros;
  /** Language of the speech, which decides what counts as a filler. */
  language?: string;
}

export const DEFAULT_CUT: CutOptions = { pauses: true, fillers: true, minPause: 600_000, keep: 150_000, language: undefined };

export interface CutPlan {
  ranges: Range[];
  pauses: number;
  fillers: number;
  removed: Micros;
}

/** Shortest piece worth removing. Anything smaller is inaudible or a rounding artefact. */
const MIN_RANGE: Micros = 150_000;

const FILLERS: Record<string, string[]> = {
  en: ["um", "umm", "uh", "uhh", "uhm", "er", "erm", "hmm", "hm", "mm", "mmm", "ah", "eh"],
  sv: ["eh", "ehm", "öh", "ööh", "öhm", "hmm", "hm", "mm", "mmm", "liksom", "ah"],
  de: ["äh", "ähm", "öh", "hmm", "mm"],
  fr: ["euh", "heu", "hmm", "mm"],
  es: ["eh", "em", "este", "hmm", "mm"],
};

/** Words that are only fillers when said on their own, set apart by commas or pauses. */
const ISOLATED: Record<string, string[]> = { en: ["like"] };

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** A rough language guess from the words, for when the speaker was not asked. */
export function guessLanguage(words: TimedWord[]): string {
  const text = words.map(w => w.text.toLowerCase()).join(" ");
  const swedish = (text.match(/[åäö]|\b(och|att|det|jag|inte|som|på|är|men|så|en|ett)\b/g) ?? []).length;
  const english = (text.match(/\b(the|and|that|this|you|with|have|for|are|was|it|is)\b/g) ?? []).length;
  return swedish > english ? "sv" : "en";
}

export function isFiller(words: TimedWord[], index: number, language: string): boolean {
  const w = words[index];
  const token = clean(w.text);
  if (!token) return false;
  if ((FILLERS[language] ?? FILLERS.en).includes(token)) return true;
  if (!(ISOLATED[language] ?? []).includes(token)) return false;
  const prev = words[index - 1];
  const next = words[index + 1];
  const setApartBefore = !prev || /[,.;:…!?]$/.test(prev.text) || w.start - prev.end >= 200_000;
  const setApartAfter = !next || /[,.;:…!?]$/.test(w.text) || next.start - w.end >= 200_000;
  return setApartBefore && setApartAfter;
}

/** Join ranges that overlap or sit so close that the sliver between them could not be kept. */
export function mergeRanges(ranges: Range[], minGap: Micros = MIN_ITEM): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from - last.to < minGap) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

/**
 * What to cut from a clip that spans [clip.from, clip.to) on the timeline. `words` are in
 * timeline time and may reach past the clip; only the part inside counts.
 */
export function planCuts(words: TimedWord[], clip: Range, options: Partial<CutOptions> = {}): CutPlan {
  const o = { ...DEFAULT_CUT, ...options };
  const inside = words.filter(w => w.end > clip.from && w.start < clip.to).sort((a, b) => a.start - b.start);
  const raw: Range[] = [];
  let pauses = 0;
  let fillers = 0;

  if (o.pauses && inside.length) {
    // Silence before the first word, between words, and after the last.
    const edges: { a: Micros; b: Micros; atClipStart: boolean; atClipEnd: boolean }[] = [];
    edges.push({ a: clip.from, b: Math.max(clip.from, inside[0].start), atClipStart: true, atClipEnd: false });
    for (let i = 0; i < inside.length - 1; i++) edges.push({ a: inside[i].end, b: inside[i + 1].start, atClipStart: false, atClipEnd: false });
    edges.push({ a: Math.min(clip.to, inside[inside.length - 1].end), b: clip.to, atClipStart: false, atClipEnd: true });
    for (const e of edges) {
      if (e.b - e.a < o.minPause) continue;
      // The clip's own edge needs no padding: nothing is there to run together with.
      const from = e.atClipStart ? e.a : e.a + o.keep;
      const to = e.atClipEnd ? e.b : e.b - o.keep;
      if (to - from >= MIN_RANGE) {
        raw.push({ from, to });
        pauses++;
      }
    }
  }

  if (o.fillers) {
    const language = o.language ?? guessLanguage(inside);
    inside.forEach((w, i) => {
      if (!isFiller(inside, i, language)) return;
      const from = Math.max(clip.from, w.start);
      const to = Math.min(clip.to, w.end);
      if (to > from) {
        raw.push({ from, to });
        fillers++;
      }
    });
  }

  const ranges = mergeRanges(raw).map(r => ({ from: Math.max(clip.from, r.from), to: Math.min(clip.to, r.to) }));
  // Ranges that touch the clip edge are pulled onto it: a split closer than MIN_ITEM would be refused.
  for (const r of ranges) {
    if (r.from - clip.from < MIN_ITEM) r.from = clip.from;
    if (clip.to - r.to < MIN_ITEM) r.to = clip.to;
  }
  const usable = ranges.filter(r => r.to - r.from >= MIN_RANGE && r.to - r.from < clip.to - clip.from);
  return { ranges: usable, pauses, fillers, removed: usable.reduce((n, r) => n + (r.to - r.from), 0) };
}

/** Remove the ranges, latest first so earlier times stay valid, pulling everything left. */
export function applyCuts(p: Project, ranges: Range[]): Project {
  let next = p;
  for (const r of [...ranges].sort((a, b) => b.from - a.from)) next = rippleDeleteRange(next, r.from, r.to);
  return next;
}

export function describePlan(plan: CutPlan): string {
  if (!plan.ranges.length) return "Nothing to remove";
  const parts: string[] = [];
  if (plan.pauses) parts.push(`${plan.pauses} ${plan.pauses === 1 ? "pause" : "pauses"}`);
  if (plan.fillers) parts.push(`${plan.fillers} ${plan.fillers === 1 ? "filler word" : "filler words"}`);
  const s = plan.removed / 1e6;
  return `Removes ${parts.join(" and ")}, ${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}
