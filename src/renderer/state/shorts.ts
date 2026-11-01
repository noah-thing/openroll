import type { TimedWord } from "../../core/captions";
import { cutsFromDifferences, energyForClip, findHighlights, type Highlight, type Series } from "../../core/highlights";
import { findItem, itemEnd, type MediaItem, type MediaRef, type Micros, type Project } from "../../core/project";
import { buildShort, reframeHook } from "../../core/shorts";
import { PEAKS_PER_SECOND } from "../../engine/media-protocol";
import { recall } from "../ui/captions/CaptionsPanel";
import { captionService } from "./captions";
import type { Editor } from "./editor";
import { framePlace, type Filmstrip, type MediaCache } from "./media-cache";
import { requestOpen } from "./smart-events";

export interface ShortsSource {
  item: MediaItem;
  media: MediaRef;
}

/** Clips worth looking for highlights in: video with sound, long enough to hold a short. */
export function shortsSources(p: Project): ShortsSource[] {
  const out: ShortsSource[] = [];
  for (const t of p.tracks) {
    if (t.kind !== "video") continue;
    for (const item of t.items) {
      if (item.type !== "media" || item.reversed || item.freeze) continue;
      const media = p.media[item.mediaId];
      if (media?.kind === "video" && media.hasAudio && item.duration >= 20_000_000) out.push({ item, media });
    }
  }
  return out.sort((a, b) => b.item.duration - a.item.duration);
}

/** The clip the panel works on: the selected one if it qualifies, else the longest. */
export function pickSource(p: Project, selection: string[]): ShortsSource | null {
  const all = shortsSources(p);
  return all.find(s => selection.includes(s.item.id)) ?? all[0] ?? null;
}

export interface FoundShorts {
  itemId: string;
  highlights: Highlight[];
  words: TimedWord[];
  /** What the pass drew on, for the line under the cards. */
  basis: string;
}

type Step = "listen" | "picture";

async function until<T>(read: () => T | null, cache: MediaCache, ms: number): Promise<T | null> {
  const first = read();
  if (first) return first;
  return new Promise(resolve => {
    const stop = () => {
      off();
      clearTimeout(timer);
    };
    const off = cache.subscribe(() => {
      const v = read();
      if (v) {
        stop();
        resolve(v);
      }
    });
    const timer = setTimeout(() => {
      stop();
      resolve(read());
    }, ms);
  });
}

/** Mean absolute difference between neighbouring filmstrip frames, as 0..1. Null while the strip is still filling in. */
export function filmstripDifferences(strip: Filmstrip): Float32Array | null {
  const w = 24, h = 14;
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const luma: Float32Array[] = [];
  for (let i = 0; i < strip.count; i++) {
    g.clearRect(0, 0, w, h);
    const f = framePlace(strip, i);
    g.drawImage(strip.sheet, f.x, f.y, f.w, f.h, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    // A frame that has not been drawn yet is fully transparent.
    if (px[3] === 0 && px[(w * h - 1) * 4 + 3] === 0) return null;
    const l = new Float32Array(w * h);
    for (let k = 0; k < l.length; k++) l[k] = (0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2]) / 255;
    luma.push(l);
  }
  const out = new Float32Array(strip.count);
  for (let i = 1; i < luma.length; i++) {
    let sum = 0;
    for (let k = 0; k < luma[i].length; k++) sum += Math.abs(luma[i][k] - luma[i - 1][k]);
    out[i] = sum / luma[i].length;
  }
  return out;
}

/** Scene changes inside a clip, in timeline time. */
export function sceneCuts(strip: Filmstrip, diffs: Float32Array, item: MediaItem): Micros[] {
  const step = Math.round(strip.step * 1e6);
  return cutsFromDifferences(diffs, step, 0)
    .map(s => item.start + Math.round((s - item.in) / item.speed))
    .filter(t => t > item.start && t < itemEnd(item));
}

export async function findShorts(editor: Editor, cache: MediaCache, source: ShortsSource, onStep: (s: Step) => void): Promise<FoundShorts | null> {
  const { item, media } = source;
  const service = captionService(editor);
  const saved = recall();
  const settings = { language: saved.language === "auto" ? null : saved.language, model: saved.model };

  onStep("listen");
  let words = service.heard(item, settings) ?? service.fromCaptions(item);
  if (!words) {
    const heard = await service.listen([{ item, media }], settings);
    if (!heard) return null;
    words = heard.get(item.id) ?? [];
  }

  onStep("picture");
  const peaks = await until(() => cache.waveform(media), cache, 8000);
  const energy: Series | undefined = peaks ? energyForClip(peaks, PEAKS_PER_SECOND, item) : undefined;
  const strip = await until(() => {
    const s = cache.filmstrip(media);
    return s && filmstripDifferences(s) ? s : null;
  }, cache, 25000);
  const diffs = strip ? filmstripDifferences(strip) : null;
  const cuts = strip && diffs ? sceneCuts(strip, diffs, item) : [];

  const highlights = findHighlights({ from: item.start, to: itemEnd(item), words, energy, cuts });
  const basis = [words.length ? "what is said" : null, energy ? "how loud it gets" : null, cuts.length ? "scene changes" : null].filter(Boolean).join(", ");
  return { itemId: item.id, highlights, words, basis };
}

/** Build the short as its own project, save it and open it. */
export async function makeShort(editor: Editor, itemId: string, h: Highlight, words: TimedWord[]): Promise<boolean> {
  const found = findItem(editor.project, itemId);
  if (!found || found.item.type !== "media") return false;
  const clip = found.item;
  const media = editor.project.media[clip.mediaId];
  const reframe = (await reframeHook.reframer?.track(media, h.from, h.to).catch(() => null)) ?? null;
  const project = buildShort({ source: editor.project, clip, from: h.from, to: h.to, words, reframe, name: `${editor.project.name}, ${shortName(h)}` });
  const saved = await window.openroll.projects.save(null, project.name, JSON.stringify(project));
  if (!saved.ok || !saved.path) {
    editor.toast(`Could not save the short: ${saved.error ?? "unknown error"}`, { tone: "error" });
    return false;
  }
  requestOpen(project, saved.path, `Made from ${editor.project.name}. The original is still in your projects.`);
  return true;
}

function shortName(h: Highlight): string {
  const m = Math.floor(h.from / 60e6), s = Math.floor((h.from / 1e6) % 60);
  return `short at ${m}:${String(s).padStart(2, "0")}`;
}
