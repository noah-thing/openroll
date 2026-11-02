// Decisions about how an item should sound, kept free of Web Audio so the live player
// and the exporter ask the same questions and tests can check the answers.

import { dbToGain } from "./dsp";
import { localAtPlayed, rampKeepsAudio } from "./speed";
import { normalizeGainDb } from "./loudness";
import { itemEnd, type CaptionItem, type MediaItem, type MediaRef, type Micros, type Project, type VoiceFx } from "./project";

export const DUCK_DB = -12;
export const DUCK_ATTACK: Micros = 120_000;
export const DUCK_RELEASE: Micros = 450_000;

export interface Point {
  t: Micros;
  g: number;
}

export interface ChainPlan {
  denoise: number;
  voice: boolean;
  fx?: VoiceFx;
}

export function chainPlan(item: MediaItem): ChainPlan {
  return { denoise: item.audio?.denoise ?? 0, voice: !!item.audio?.voice, fx: item.voiceFx };
}

/** Steady gain for an item: its volume times the loudness correction when normalising. */
export function itemGain(item: MediaItem, media: MediaRef): number {
  const norm = item.audio?.normalize && media.loudness != null ? dbToGain(normalizeGainDb(media.loudness)) : 1;
  return item.volume * norm;
}

/** Whether an item makes sound at all. Reversed and frozen items stay silent, and so do speed curves that leave the band where resampled sound is still usable. */
export function audible(item: MediaItem, media: MediaRef | undefined): media is MediaRef {
  return !!media?.hasAudio && !item.muteAudio && !item.reversed && !item.freeze && item.volume > 0 && (!item.ramp || rampKeepsAudio(item.ramp));
}

/** Piecewise linear fade multiplier over the item, in timeline time. */
export function fadeCurve(item: MediaItem): Point[] {
  const end = itemEnd(item);
  const fin = Math.min(item.fadeIn, item.duration);
  const fout = Math.min(item.fadeOut, item.duration - fin);
  const pts: Point[] = [{ t: item.start, g: fin > 0 ? 0 : 1 }];
  if (fin > 0) pts.push({ t: item.start + fin, g: 1 });
  if (fout > 0) pts.push({ t: end - fout, g: 1 }, { t: end, g: 0 });
  return pts;
}

export function valueAt(points: Point[], t: Micros): number {
  if (t <= points[0].t) return points[0].g;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) return b.t === a.t ? b.g : a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1].g;
}

type Range = [Micros, Micros];

/** Timeline ranges where someone speaks on an item other than `self` and its ducked kin. */
export function speechRanges(p: Project, self: MediaItem): Range[] {
  const out: Range[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const item of track.items) {
      if (item.id === self.id) continue;
      if (item.type === "caption") {
        out.push(...captionRanges(item));
        continue;
      }
      if (item.type !== "media" || item.audio?.duckUnder) continue;
      const media = p.media[item.mediaId];
      if (!audible(item, media) || !media.speech) continue;
      const end = itemEnd(item);
      for (let i = 0; i + 1 < media.speech.length; i += 2) {
        const a = item.start + localAtPlayed(item, media.speech[i] - item.in);
        const b = item.start + localAtPlayed(item, media.speech[i + 1] - item.in);
        const from = Math.max(a, item.start), to = Math.min(b, end);
        if (to > from) out.push([Math.round(from), Math.round(to)]);
      }
    }
  }
  return mergeRanges(out, 0);
}

function captionRanges(item: CaptionItem): Range[] {
  if (!item.words.length) return [];
  const relative = item.words.every(w => w.end <= item.duration);
  const base = relative ? item.start : 0;
  return item.words.map(w => [base + w.start, base + w.end] as Range);
}

export function mergeRanges(ranges: Range[], gap: Micros): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] <= gap) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Gain curve that dips under speech: down over a short attack, held while talking,
 * back up over a slower release. Pauses shorter than attack plus release stay ducked,
 * so the music does not pump between words.
 */
export function duckCurve(speech: Range[], from: Micros, to: Micros, depthDb = DUCK_DB): Point[] {
  const low = dbToGain(depthDb);
  const merged = mergeRanges(speech, DUCK_ATTACK + DUCK_RELEASE).filter(r => r[1] + DUCK_RELEASE > from && r[0] - DUCK_ATTACK < to);
  const pts: Point[] = [];
  for (const [a, b] of merged) pts.push({ t: a - DUCK_ATTACK, g: 1 }, { t: a, g: low }, { t: b, g: low }, { t: b + DUCK_RELEASE, g: 1 });
  return pts.length ? pts : [{ t: from, g: 1 }];
}
