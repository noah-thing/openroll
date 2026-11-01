import type { AudioAnalysis } from "../../core/analyze";
import type { MediaRef } from "../../core/project";
import type { MediaJob, MediaJobResult } from "../../engine/media-protocol";

export interface Filmstrip {
  sheet: ImageBitmap;
  frameWidth: number;
  frameHeight: number;
  /** Seconds of source between frames. */
  step: number;
  count: number;
}

type Listener = () => void;

/** Filmstrips and waveforms for the timeline, generated once per file and kept on disk. */
export class MediaCache {
  private worker = new Worker(new URL("../../engine/media.worker.ts", import.meta.url), { type: "module" });
  private strips = new Map<string, Filmstrip>();
  private peaks = new Map<string, Uint8Array>();
  private analyses = new Map<string, AudioAnalysis>();
  private pending = new Set<string>();
  private listeners = new Set<Listener>();
  version = 0;

  constructor(private url: (m: MediaRef) => string) {
    this.worker.onmessage = (e: MessageEvent<MediaJobResult>) => void this.receive(e.data);
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Something outside changed which file a source reads from. */
  refresh(): void {
    this.bump();
  }

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  filmstrip(m: MediaRef): Filmstrip | null {
    const hit = this.strips.get(m.id);
    if (hit) return hit;
    if (m.kind === "video") void this.load(m, "filmstrip");
    return null;
  }

  waveform(m: MediaRef): Uint8Array | null {
    const hit = this.peaks.get(m.id);
    if (hit) return hit;
    if (m.hasAudio) void this.load(m, "peaks");
    return null;
  }

  /** Loudness, speech and beats for a file, measured once and kept on disk. */
  analysis(m: MediaRef): AudioAnalysis | null {
    const hit = this.analyses.get(m.id);
    if (hit) return hit;
    if (m.hasAudio) void this.load(m, "analyze");
    return null;
  }

  private async load(m: MediaRef, kind: MediaJob["kind"]): Promise<void> {
    const id = `${kind}:${m.id}`;
    if (this.pending.has(id)) return;
    // A converted copy that is still being made has no url yet; the next bump asks again.
    if (!this.url(m)) return;
    this.pending.add(id);
    const key = await diskKey(m, kind);
    this.keys.set(id, key);
    if (kind === "filmstrip") {
      const [meta, jpeg] = await Promise.all([window.openroll.cache.get(key + ".json"), window.openroll.cache.get(key + ".jpg")]);
      if (meta && jpeg) {
        try {
          const info = JSON.parse(new TextDecoder().decode(meta));
          const sheet = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
          this.strips.set(m.id, { sheet, ...info });
          this.bump();
          return;
        } catch {
          /* regenerate */
        }
      }
    } else if (kind === "analyze") {
      const raw = await window.openroll.cache.get(key + ".json");
      if (raw) {
        try {
          this.analyses.set(m.id, JSON.parse(new TextDecoder().decode(raw)));
          this.bump();
          return;
        } catch {
          /* measure again */
        }
      }
    } else {
      const raw = await window.openroll.cache.get(key + ".peaks");
      if (raw) {
        this.peaks.set(m.id, new Uint8Array(raw));
        this.bump();
        return;
      }
    }
    this.worker.postMessage({ id, kind, url: this.url(m) } satisfies MediaJob);
  }

  private keys = new Map<string, string>();

  private async receive(r: MediaJobResult): Promise<void> {
    const [kind, mediaId] = r.id.split(/:(.*)/s);
    if (r.kind === "error") {
      console.warn(`${kind} failed for ${mediaId}: ${r.message}`);
      // Forget it, so relinking the file or finishing its conversion lets the next look try again.
      this.pending.delete(r.id);
      return;
    }
    const key = this.keys.get(r.id);
    if (r.kind === "filmstrip") {
      this.strips.get(mediaId)?.sheet.close();
      this.strips.set(mediaId, { sheet: r.sheet, frameWidth: r.frameWidth, frameHeight: r.frameHeight, step: r.step, count: r.count });
      if (r.final && r.jpeg && key) {
        const meta = { frameWidth: r.frameWidth, frameHeight: r.frameHeight, step: r.step, count: r.count };
        void window.openroll.cache.put(key + ".json", new TextEncoder().encode(JSON.stringify(meta)));
        void window.openroll.cache.put(key + ".jpg", r.jpeg);
      }
    } else if (r.kind === "analysis") {
      this.analyses.set(mediaId, r.analysis);
      if (key) void window.openroll.cache.put(key + ".json", new TextEncoder().encode(JSON.stringify(r.analysis)));
    } else {
      this.peaks.set(mediaId, r.peaks);
      if (r.final && key) void window.openroll.cache.put(key + ".peaks", r.peaks);
    }
    this.bump();
  }

  dispose(): void {
    this.worker.terminate();
    for (const s of this.strips.values()) s.sheet.close();
  }
}

async function diskKey(m: MediaRef, kind: string): Promise<string> {
  const text = `${kind}|v${kind === "analyze" ? 2 : 1}|${m.path}|${m.size}|${m.mtime}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, "0")).join("");
}
