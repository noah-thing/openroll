import { allCaptions, captionsFromWords, placeCaptions, type TimedWord } from "../../core/captions";
import { templateFor, type CaptionChoice } from "../../core/caption-styles";
import { itemEnd, sourceSpan, SECOND, type MediaItem, type MediaRef, type Micros, type Project } from "../../core/project";
import type { SpeechModel } from "../../engine/speech-protocol";
import { derived } from "./derived-media";
import type { Editor } from "./editor";
import { SpeechCancelled, SpeechClient } from "./speech";

export interface ListenSettings {
  language: string | null;
  model: SpeechModel;
}

export interface JobState {
  phase: "idle" | "working" | "error";
  stage: "model" | "decode" | "listen";
  fraction: number;
  /** Bytes are coming over the network, which only happens the first time. */
  downloading: boolean;
  clip: { index: number; count: number };
  etaSeconds: number | null;
  message: string;
  /** What the last finished run did, in words. */
  summary: string;
}

const IDLE: JobState = { phase: "idle", stage: "listen", fraction: 0, downloading: false, clip: { index: 0, count: 0 }, etaSeconds: null, message: "", summary: "" };

interface Transcript {
  /** Source range this covers, in microseconds. */
  from: Micros;
  to: Micros;
  language: string | null;
  model: SpeechModel;
  words: TimedWord[];
  /** What the model heard, which decides the filler word list. */
  spoken: string | null;
}

export interface Target {
  item: MediaItem;
  media: MediaRef;
}

/** Clips with something to listen to. Reversed and frozen clips have no usable speech. */
export function listenTargets(project: Project, ids: string[] | null): Target[] {
  const out: Target[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === "text") continue;
    for (const item of track.items) {
      if (item.type !== "media" || item.reversed || item.freeze) continue;
      if (ids && !ids.includes(item.id)) continue;
      const media = project.media[item.mediaId];
      if (media?.hasAudio) out.push({ item, media });
    }
  }
  return out.sort((a, b) => a.item.start - b.item.start);
}

/**
 * Owns the speech worker and what it has heard, so a job survives switching panels and
 * the smart cut can reuse a transcript instead of listening again.
 */
export class CaptionService {
  state: JobState = IDLE;
  private listeners = new Set<() => void>();
  private speech = new SpeechClient();
  private transcripts = new Map<string, Transcript[]>();
  private cancelCurrent: (() => void) | null = null;
  private cancelled = false;

  constructor(private editor: Editor) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<JobState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  get busy(): boolean {
    return this.state.phase === "working";
  }

  cancel(): void {
    this.cancelled = true;
    this.cancelCurrent?.();
  }

  /** Words of a clip in timeline time, from an earlier listen, or null if it has not been heard. */
  heard(item: MediaItem, settings?: Partial<ListenSettings>): TimedWord[] | null {
    const span = sourceSpan(item);
    const t = (this.transcripts.get(item.mediaId) ?? []).find(
      x => x.from <= item.in && x.to >= item.in + span && (!settings?.model || x.model === settings.model) && (settings?.language === undefined || x.language === settings.language),
    );
    return t ? toTimeline(t.words, item) : null;
  }

  /** Listen to the clips, remember what was said, and return each clip's words in timeline time. */
  async listen(targets: Target[], settings: ListenSettings): Promise<Map<string, TimedWord[]> | null> {
    if (this.busy) return null;
    this.cancelled = false;
    const result = new Map<string, TimedWord[]>();
    const total = targets.reduce((n, t) => n + t.item.duration, 0) || 1;
    let done = 0;
    let audioSeconds = 0;
    let listenMs = 0;
    let device = "";
    let listenStart = 0;
    this.set({ ...IDLE, phase: "working", stage: "model", message: "", clip: { index: 0, count: targets.length } });
    try {
      for (let i = 0; i < targets.length; i++) {
        const { item, media } = targets[i];
        const cached = this.heard(item, settings);
        if (cached) {
          result.set(item.id, cached);
          done += item.duration;
          continue;
        }
        const from = item.in;
        const to = item.in + sourceSpan(item);
        const share = item.duration / total;
        const base = done / total;
        listenStart = 0;
        const run = this.speech.run(
          { url: derived.decodeUrl(media), from: from / SECOND, to: to / SECOND, model: settings.model, language: settings.language, device: window.openroll.qa ? qaDevice() : undefined },
          p => {
            if (p.stage === "listen" && !listenStart) listenStart = performance.now();
            const eta = p.stage === "listen" && p.fraction > 0.04 ? ((performance.now() - listenStart) * (1 - p.fraction)) / p.fraction / 1000 : null;
            // The bar covers the whole job; the model and decoding take a fixed small share of each clip.
            const within = p.stage === "model" ? 0 : p.stage === "decode" ? 0.08 * p.fraction : 0.08 + 0.92 * p.fraction;
            this.set({ stage: p.stage, downloading: p.stage === "model" && !!p.downloading, fraction: p.stage === "model" ? p.fraction : base + share * within, etaSeconds: eta, clip: { index: i, count: targets.length } });
          },
        );
        this.cancelCurrent = run.cancel;
        const out = await run.result;
        this.cancelCurrent = null;
        audioSeconds += out.audioSeconds;
        listenMs += out.timings.listenMs + out.timings.decodeMs;
        device = out.device;
        const words: TimedWord[] = out.words.map(w => ({ text: w.text, start: Math.round(w.start * SECOND), end: Math.round(w.end * SECOND) }));
        const list = this.transcripts.get(item.mediaId) ?? [];
        list.push({ from, to, language: settings.language, model: settings.model, words, spoken: out.language });
        this.transcripts.set(item.mediaId, list);
        result.set(item.id, toTimeline(words, item));
        done += item.duration;
        if (window.openroll.qa) (window as unknown as Record<string, unknown>).__orSpeech = { audioSeconds, listenMs, device, realtime: audioSeconds / (listenMs / 1000), modelMs: out.timings.modelMs };
      }
      const speed = listenMs ? audioSeconds / (listenMs / 1000) : 0;
      this.set({ ...IDLE, summary: audioSeconds ? `Listened to ${clock(audioSeconds)} in ${clock(listenMs / 1000)}, ${speed.toFixed(1)} times faster than real time (${device === "webgpu" ? "graphics card" : "processor"}).` : "" });
      return result;
    } catch (err) {
      this.cancelCurrent = null;
      if (err instanceof SpeechCancelled || this.cancelled) this.set({ ...IDLE });
      else this.set({ ...IDLE, phase: "error", message: friendly((err as Error).message) });
      return null;
    }
  }

  async generate(scope: string[] | null, settings: ListenSettings, choice: CaptionChoice): Promise<void> {
    const targets = listenTargets(this.editor.project, scope);
    if (!targets.length) {
      this.editor.toast(scope ? "Select a clip with sound, or clear the selection to caption everything" : "Nothing on the timeline has sound to caption");
      return;
    }
    const heard = await this.listen(targets, settings);
    if (!heard) return;
    const items = targets.flatMap(({ item }) => captionsFromWords(heard.get(item.id) ?? [], templateFor(choice, this.editor.project)));
    if (!items.length) {
      this.editor.toast("No speech found");
      return;
    }
    const spans = targets.map(({ item }) => ({ from: item.start, to: itemEnd(item) }));
    this.editor.apply("Generate captions", p => placeCaptions(p, items, spans));
    this.editor.toast(`Added ${items.length} captions`, { undo: true });
  }

  /** Language found when a clip was heard, if it was. */
  spokenLanguage(item: MediaItem): string | null {
    return (this.transcripts.get(item.mediaId) ?? []).find(x => x.from <= item.in && x.to >= item.in + sourceSpan(item))?.spoken ?? null;
  }

  /** Captions already on the timeline as a stand in transcript, for clips that were heard in an earlier session. */
  fromCaptions(item: MediaItem): TimedWord[] | null {
    const project = this.editor.project;
    const words: TimedWord[] = [];
    for (const c of allCaptions(project)) {
      if (c.start >= itemEnd(item) || itemEnd(c) <= item.start) continue;
      for (const w of c.words) words.push({ text: w.text, start: c.start + w.start, end: c.start + w.end });
    }
    return words.length ? words.sort((a, b) => a.start - b.start) : null;
  }

  dispose(): void {
    this.speech.dispose();
    this.listeners.clear();
  }
}

/** Source time words to timeline time for a clip, keeping only what the clip still shows. */
function toTimeline(words: TimedWord[], item: MediaItem): TimedWord[] {
  const end = item.in + sourceSpan(item);
  const out: TimedWord[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid < item.in || mid >= end) continue;
    const start = item.start + Math.round((Math.max(w.start, item.in) - item.in) / item.speed);
    const stop = item.start + Math.round((Math.min(w.end, end) - item.in) / item.speed);
    out.push({ text: w.text, start, end: Math.max(start + 1, stop) });
  }
  return out;
}

/** The QA harness can force a backend to compare them. */
function qaDevice(): "webgpu" | "wasm" | undefined {
  return (window as unknown as { __orDevice?: "webgpu" | "wasm" }).__orDevice;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

function friendly(message: string): string {
  if (/fetch|network|Failed to load|NetworkError/i.test(message)) return "Could not download the speech model. Check your connection and try again.";
  return message || "Something went wrong while listening.";
}

const services = new WeakMap<Editor, CaptionService>();

export function captionService(editor: Editor): CaptionService {
  let s = services.get(editor);
  if (!s) {
    s = new CaptionService(editor);
    services.set(editor, s);
  }
  return s;
}
