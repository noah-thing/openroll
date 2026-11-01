// Captions as pure data: grouping words into readable lines, SRT and VTT in and out,
// and keeping word timing sensible when someone edits the text.

import { deleteItems, insertItems } from "./edit";
import { IDENTITY, itemEnd, newId, type CaptionItem, type CaptionWord, type Micros, type Project, type TextStyle, type Track } from "./project";

export interface TimedWord {
  text: string;
  start: Micros;
  end: Micros;
}

export interface Cue {
  start: Micros;
  end: Micros;
  text: string;
}

export interface ChunkOptions {
  maxWords: number;
  maxChars: number;
  /** A silence at least this long always starts a new caption. */
  pause: Micros;
  maxDuration: Micros;
}

export const DEFAULT_CHUNK: ChunkOptions = { maxWords: 6, maxChars: 34, pause: 450_000, maxDuration: 4_500_000 };

const SENTENCE_END = /[.!?…。！？]["')\]]*$/;
const CLAUSE_END = /[,;:，、]["')\]]*$/;

/** Split a word stream into caption sized groups, breaking on pauses and punctuation. */
export function chunkWords(words: TimedWord[], options: Partial<ChunkOptions> = {}): TimedWord[][] {
  const o = { ...DEFAULT_CHUNK, ...options };
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  let chars = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const wouldBe = chars + (cur.length ? 1 : 0) + w.text.length;
    if (prev && (w.start - prev.end >= o.pause || cur.length >= o.maxWords || wouldBe > o.maxChars || w.end - cur[0].start > o.maxDuration)) {
      groups.push(cur);
      cur = [];
      chars = 0;
    }
    chars += (cur.length ? 1 : 0) + w.text.length;
    cur.push(w);
    // A sentence end closes a caption once it has some body; a comma only once it is nearly full.
    const closes = SENTENCE_END.test(w.text) ? cur.length >= 2 : CLAUSE_END.test(w.text) && cur.length >= Math.ceil(o.maxWords * 0.6);
    if (closes) {
      groups.push(cur);
      cur = [];
      chars = 0;
    }
  }
  if (cur.length) groups.push(cur);

  // A lone trailing word reads badly on its own screen; fold it into the line before if it fits.
  for (let i = groups.length - 1; i > 0; i--) {
    const g = groups[i];
    const before = groups[i - 1];
    if (g.length !== 1 || SENTENCE_END.test(before[before.length - 1].text)) continue;
    const gap = g[0].start - before[before.length - 1].end;
    const joined = [...before, ...g];
    if (gap < o.pause && joined.length <= o.maxWords + 1 && joined.map(w => w.text).join(" ").length <= o.maxChars + 8) {
      groups[i - 1] = joined;
      groups.splice(i, 1);
    }
  }
  return groups;
}

export interface CaptionTemplate {
  style: TextStyle;
  highlight?: string;
  y: number;
  animationIn?: { kind: string; duration: Micros };
}

/** Longest a caption lingers after its last word, if nothing follows soon. */
const LINGER: Micros = 350_000;
const MIN_CAPTION: Micros = 400_000;

export function captionsFromWords(words: TimedWord[], template: CaptionTemplate, options: Partial<ChunkOptions> = {}): CaptionItem[] {
  const groups = chunkWords(words, options);
  return groups.map((group, gi) => {
    const start = group[0].start;
    const lastEnd = group[group.length - 1].end;
    const nextStart = groups[gi + 1]?.[0].start ?? Infinity;
    const end = Math.max(lastEnd, Math.min(lastEnd + LINGER, nextStart), start + MIN_CAPTION);
    const relative: CaptionWord[] = group.map((w, i) => {
      const next = group[i + 1];
      // Close small gaps so the highlight hands over from word to word without a blink.
      const stretched = next && next.start - w.end < 300_000 ? next.start : w.end;
      return { text: w.text, start: w.start - start, end: Math.max(w.start - start + 1, stretched - start) };
    });
    return {
      id: newId("i"),
      type: "caption",
      name: "Caption",
      start,
      duration: Math.max(1, Math.min(end, nextStart) - start),
      transform: { ...IDENTITY, y: template.y },
      style: { ...template.style, text: "" },
      words: relative,
      highlight: template.highlight,
      animationIn: template.animationIn,
    } satisfies CaptionItem;
  });
}

/** Spread the words of one caption evenly, weighted by length, over a span. Used when only text is known. */
export function spreadWords(tokens: string[], from: Micros, to: Micros): CaptionWord[] {
  if (!tokens.length) return [];
  const weights = tokens.map(t => t.length + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: CaptionWord[] = [];
  let at = from;
  tokens.forEach((text, i) => {
    const end = i === tokens.length - 1 ? to : Math.round(at + ((to - from) * weights[i]) / total);
    out.push({ text, start: at, end: Math.max(at + 1, end) });
    at = end;
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function captionText(item: CaptionItem): string {
  return item.words.map(w => w.text).join(" ");
}

const MIN_WORD: Micros = 90_000;

/**
 * Words after the text of a caption has been edited. Words that survived the edit keep
 * their timing; replaced or inserted words share the time of whatever they replaced.
 */
export function retimeWords(old: CaptionWord[], text: string, duration: Micros): CaptionWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  if (!old.length) return spreadWords(tokens, 0, duration);

  const a = old.map(w => norm(w.text));
  const b = tokens.map(norm);
  // Longest common subsequence of the words, which are the anchors that stay put.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] && a[i] !== "" ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: CaptionWord[] = new Array(tokens.length);
  const gaps: { oldFrom: number; oldTo: number; newFrom: number; newTo: number }[] = [];
  let i = 0, j = 0;
  let gap = { oldFrom: 0, oldTo: 0, newFrom: 0, newTo: 0 };
  const closeGap = (oi: number, nj: number) => {
    gap.oldTo = oi;
    gap.newTo = nj;
    if (gap.newTo > gap.newFrom) gaps.push(gap);
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j] && a[i] !== "") {
      closeGap(i, j);
      out[j] = { text: tokens[j], start: old[i].start, end: old[i].end };
      i++;
      j++;
      gap = { oldFrom: i, oldTo: i, newFrom: j, newTo: j };
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  closeGap(a.length, b.length);

  for (const g of gaps) {
    const n = g.newTo - g.newFrom;
    const before = out[g.newFrom - 1];
    const after = out[g.newTo];
    let from: Micros, to: Micros;
    if (g.oldTo > g.oldFrom) {
      from = old[g.oldFrom].start;
      to = old[g.oldTo - 1].end;
    } else {
      from = before ? before.end : 0;
      to = after ? after.start : duration;
    }
    // A pure insertion between two words that touch has no room; borrow it from the neighbours.
    const need = n * MIN_WORD;
    if (to - from < need) {
      const missing = need - (to - from);
      const takeBefore = before ? Math.min(missing * (after ? 0.5 : 1), Math.max(0, (before.end - before.start - MIN_WORD))) : 0;
      if (before) {
        before.end -= takeBefore;
        from = Math.min(from, before.end);
      }
      const takeAfter = after ? Math.min(missing - takeBefore, Math.max(0, after.end - after.start - MIN_WORD)) : 0;
      if (after) {
        after.start += takeAfter;
        to = Math.max(to, after.start);
      }
      if (to - from < need) to = from + need;
    }
    spreadWords(tokens.slice(g.newFrom, g.newTo), from, to).forEach((w, k) => (out[g.newFrom + k] = w));
  }
  // Timing must never run backwards, whatever the edit did.
  let at = 0;
  for (const w of out) {
    w.start = Math.max(Math.round(w.start), at);
    w.end = Math.max(Math.round(w.end), w.start + 1);
    at = w.end;
  }
  return out;
}

function stamp(t: Micros, comma: boolean): string {
  const ms = Math.max(0, Math.round(t / 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}${comma ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}

/** Break a long cue over two lines near the middle, the way subtitle players expect. */
function wrapCue(text: string, max = 42): string {
  const flat = text.replace(/\s*\n\s*/g, " ").trim();
  if (flat.length <= max) return flat;
  const mid = flat.length / 2;
  let best = -1;
  for (let i = 0; i < flat.length; i++) if (flat[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? flat : flat.slice(0, best) + "\n" + flat.slice(best + 1);
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${wrapCue(c.text)}\n`)
      .join("\n")
  );
}

export function toVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map(c => `${stamp(c.start, false)} --> ${stamp(c.end, false)}\n${wrapCue(c.text)}\n`).join("\n");
}

function parseStamp(s: string): Micros | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return ((Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + ms) * 1000;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&lrm;": "", "&rlm;": "" };

function cleanCueText(raw: string): string {
  return raw
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|lrm|rlm|#39);/g, e => ENTITIES[e] ?? e)
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Read SRT or WebVTT. Unreadable blocks are skipped rather than failing the whole file. */
export function parseSubtitles(source: string): Cue[] {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex(l => l.includes("-->"));
    if (at < 0) continue;
    const m = /^\s*(\S+)\s*-->\s*(\S+)/.exec(lines[at]);
    if (!m) continue;
    const start = parseStamp(m[1]);
    const end = parseStamp(m[2]);
    if (start === null || end === null || end <= start) continue;
    const body = cleanCueText(lines.slice(at + 1).join("\n"));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function cuesFromCaptions(items: CaptionItem[]): Cue[] {
  return [...items]
    .filter(i => i.words.length)
    .sort((a, b) => a.start - b.start)
    .map(i => ({ start: i.start, end: itemEnd(i), text: captionText(i) }));
}

/** One caption per cue; word timing is spread evenly because subtitle files do not carry it. */
export function captionsFromCues(cues: Cue[], template: CaptionTemplate): CaptionItem[] {
  return cues.map(c => ({
    id: newId("i"),
    type: "caption",
    name: "Caption",
    start: c.start,
    duration: c.end - c.start,
    transform: { ...IDENTITY, y: template.y },
    style: { ...template.style, text: "" },
    words: spreadWords(c.text.split(/\s+/).filter(Boolean), 0, c.end - c.start),
    highlight: template.highlight,
    animationIn: template.animationIn,
  }));
}

export const CAPTION_TRACK = "Captions";

export function allCaptions(p: Project): CaptionItem[] {
  return p.tracks.flatMap(t => t.items.filter((i): i is CaptionItem => i.type === "caption"));
}

/**
 * Put captions on a text track named Captions, replacing any that already sit under the
 * given spans so generating twice does not stack two sets.
 */
export function placeCaptions(p: Project, items: CaptionItem[], replaceSpans: { from: Micros; to: Micros }[] = []): Project {
  if (!items.length) return p;
  const stale = allCaptions(p).filter(c => replaceSpans.some(s => c.start < s.to && itemEnd(c) > s.from));
  let next = stale.length ? deleteItems(p, stale.map(c => c.id)) : p;
  let home = next.tracks.find((t: Track) => t.kind === "text" && t.name === CAPTION_TRACK && !t.locked);
  if (!home) {
    // Captions get a lane of their own, on top, so titles and overlays never share it.
    home = { id: newId("t"), kind: "text", name: CAPTION_TRACK, items: [] };
    next = { ...next, tracks: [home, ...next.tracks] };
  }
  return insertItems(next, items, { trackId: home.id });
}

/** Give every caption the same look, keeping its words and timing. */
export function restyleCaptions(p: Project, template: CaptionTemplate): Project {
  const items = allCaptions(p);
  if (!items.length) return p;
  const ids = new Set(items.map(i => i.id));
  return {
    ...p,
    modified: Date.now(),
    tracks: p.tracks.map(t =>
      t.items.some(i => ids.has(i.id))
        ? {
            ...t,
            items: t.items.map(i =>
              ids.has(i.id) && i.type === "caption"
                ? { ...i, style: { ...template.style, text: "" }, highlight: template.highlight, transform: { ...i.transform, y: template.y }, animationIn: template.animationIn }
                : i,
            ),
          }
        : t,
    ),
  };
}
