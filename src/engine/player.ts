import { AudioEngine } from "./audio";
import type { PreviewIn, PreviewOut } from "./preview-protocol";
import type { AiSync } from "./ai/protocol";
import { projectDuration, type Micros, type Project } from "../core/project";
import { audioKey } from "../core/audio-plan";
import { diffProject } from "./project-patch";

export interface PreviewStats {
  /** Frames drawn per second; a loop pass that found nothing new is counted in `skipped` instead. */
  fps: number;
  skipped: number;
  late: number;
  worstMs: number;
  readers: number;
  /** Decoded frames and decoders held, for spotting leaks. */
  open: number;
  decoders: number;
  seekMs: number;
  seekP95: number;
  seeks: number;
}

type Listener = () => void;

/**
 * Owns playback: the audio clock, the preview worker and the playhead position.
 * The UI reads `time` on its own animation frames; nothing here renders React.
 */
export class Player {
  private worker: Worker;
  private audio = new AudioEngine();
  private project: Project | null = null;
  /** The project the worker holds, which edits are sent against. */
  private sent: Project | null = null;
  /** What the running audio was built from. */
  private heard = "";
  private urls: Record<string, string> = {};
  private still: Micros = 0;
  private endTimer = 0;
  private listeners = new Set<Listener>();
  private snapshots = new Map<number, (img: ImageData) => void>();
  private nextSnapshot = 1;
  stats: PreviewStats = { fps: 0, skipped: 0, late: 0, worstMs: 0, readers: 0, open: 0, decoders: 0, seekMs: 0, seekP95: 0, seeks: 0 };
  onError: ((message: string) => void) | null = null;
  /** A reader could not keep up while playing, so its source is a candidate for a proxy. */
  onSlowDecode: ((mediaId: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<PreviewOut>) => this.receive(e.data);
    const offscreen = canvas.transferControlToOffscreen();
    this.send({ type: "init", canvas: offscreen }, [offscreen]);
  }

  private send(m: PreviewIn, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  private receive(m: PreviewOut): void {
    if (m.type === "stats") this.stats = m;
    else if (m.type === "error") this.onError?.(m.message);
    else if (m.type === "slow-decode") this.onSlowDecode?.(m.mediaId);
    else if (m.type === "snapshot") {
      this.snapshots.get(m.id)?.(m.image);
      this.snapshots.delete(m.id);
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get playing(): boolean {
    return this.audio.playing;
  }

  get time(): Micros {
    return this.audio.playing ? Math.min(this.audio.now(), this.duration) : this.still;
  }

  get duration(): Micros {
    return this.project ? projectDuration(this.project) : 0;
  }

  setProject(p: Project, urls: Record<string, string>): void {
    const was = this.project;
    this.project = p;
    this.urls = urls;
    const patch = this.sent ? diffProject(this.sent, p) : null;
    this.send(patch ? { type: "patch", patch, urls } : { type: "project", project: p, urls });
    this.sent = p;
    // Audio restarts from where we are only when the edit changes what you hear.
    if (this.playing && was !== p && audioKey(p, urls) !== this.heard) this.restart();
    // A silent edit can move the end of the timeline, and the stop timer was set against the old one.
    else if (this.playing && was !== p) this.scheduleEnd();
    if (!this.playing && this.still > this.duration) this.seek(this.duration);
  }

  /** Hand the render worker a matte or a camera path as it becomes available. */
  syncAi(sync: AiSync): void {
    this.send({ type: "ai", sync });
  }

  setSize(width: number, height: number): void {
    this.send({ type: "size", width, height });
  }

  setHardwareDecoding(hardware: boolean): void {
    this.send({ type: "decode", hardware });
  }

  async play(): Promise<void> {
    if (!this.project || this.playing) return;
    if (this.still >= this.duration - 1000) this.still = 0;
    // The audio context runs even with nothing to play, so it is always the clock.
    this.heard = audioKey(this.project, this.urls);
    await this.audio.play(this.project, this.still, this.urls);
    this.send({ type: "clock", playing: true, t: this.still, at: this.audio.wallAtStart(), rate: 1 });
    this.scheduleEnd();
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.still = this.time;
    this.audio.stop();
    this.audio.seek(this.still);
    clearTimeout(this.endTimer);
    this.send({ type: "clock", playing: false, t: this.still, at: 0, rate: 1 });
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: Micros): void {
    const clamped = Math.max(0, Math.min(t, this.duration));
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.audio.stop();
      clearTimeout(this.endTimer);
    }
    this.still = clamped;
    this.audio.seek(clamped);
    if (wasPlaying) void this.play();
    else this.send({ type: "clock", playing: false, t: clamped, at: 0, rate: 1 });
    this.emit();
  }

  /** Seek for a drag: like seek, plus a short grain of the audio under the playhead. */
  scrub(t: Micros): void {
    this.seek(t);
    if (!this.playing && this.project) this.audio.scrub(this.project, Math.max(0, Math.min(t, this.duration)), this.urls);
  }

  private restart(): void {
    const t = this.time;
    this.audio.stop();
    this.still = t;
    void this.play();
  }

  private scheduleEnd(): void {
    clearTimeout(this.endTimer);
    const left = (this.duration - this.time) / 1000;
    this.endTimer = window.setTimeout(() => {
      if (this.time >= this.duration - 20_000) {
        this.pause();
        this.seek(this.duration);
      } else this.scheduleEnd();
    }, Math.max(16, left));
  }

  snapshot(t: Micros, bare?: string, opts: { settle?: boolean; width?: number } = {}): Promise<ImageData> {
    const id = this.nextSnapshot++;
    return new Promise(resolve => {
      this.snapshots.set(id, resolve);
      this.send({ type: "snapshot", id, t, bare, ...opts });
    });
  }

  dispose(): void {
    this.audio.dispose();
    this.worker.terminate();
  }
}
