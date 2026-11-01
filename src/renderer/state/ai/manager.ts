import { buildCorrection, floats, localTime, pack, planReframe, unpack, wantsStabilize, type CameraPath, type SubjectSample } from "../../../core/ai";
import { findItem, sourceSpan, sourceTime, type MediaItem, type MediaRef, type Micros } from "../../../core/project";
import { fitSize } from "../../../core/scene";
import type { AiEvent, AiRequest, AiSync, MatteTrack } from "../../../engine/ai/protocol";
import type { Editor } from "../editor";
import { deflate, digest, inflate } from "./zip";

export type AiFeature = "cutout" | "stabilize" | "reframe";

export interface AiStatus {
  state: "idle" | "queued" | "preparing" | "ready" | "error";
  /** 0..1 */
  progress: number;
  label?: string;
  message?: string;
  /** What the last run cost, for people who like numbers. */
  detail?: string;
}

const IDLE: AiStatus = { state: "idle", progress: 0 };
const PAD = 0.3;

interface Coverage {
  from: number;
  to: number;
  quality: "fast" | "best";
}

interface Running {
  feature: AiFeature;
  mediaId: string;
  from: number;
  to: number;
  quality: "fast" | "best";
  itemId?: string;
  still: boolean;
  resolve(r: Running): void;
  reject(e: Error): void;
  /** Frames stored by the job, for writing the file when it ends. */
  track?: MatteTrack;
  camera?: CameraPath;
  subject?: { samples: SubjectSample[]; found: number };
}

type Listener = () => void;

/**
 * Runs the analysis the AI features rely on, keeps the results, tells the render workers
 * about them, and exposes per clip status for the inspector. Results are saved on disk, so
 * a clip is only ever analysed once.
 */
export class AiManager {
  private worker: Worker | null = null;
  private nextId = 1;
  private running = new Map<number, Running>();
  private statuses = new Map<string, AiStatus>();
  private mattes = new Map<string, MatteTrack>();
  private cameras = new Map<string, CameraPath>();
  private covers = new Map<string, Coverage>();
  private suppressed = new Set<string>();
  private starting = new Set<string>();
  private frameJobs = new Map<number, { onProgress(done: number, total: number, label?: string): void; resolve(r: { before: ImageBitmap; after: ImageBitmap; seconds: number }): void; reject(e: Error): void; got?: { before: ImageBitmap; after: ImageBitmap; seconds: number } }>();
  private listeners = new Set<Listener>();
  private lastPlayer: unknown = null;
  private lastSettings: { width: number; height: number } | null = null;
  private unsubscribe: () => void;
  version = 0;

  constructor(private editor: Editor) {
    this.lastSettings = { width: editor.project.settings.width, height: editor.project.settings.height };
    this.unsubscribe = editor.subscribe(() => this.onEditor());
    queueMicrotask(() => this.onEditor());
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  status(mediaId: string, feature: AiFeature): AiStatus {
    return this.statuses.get(`${feature}:${mediaId}`) ?? IDLE;
  }

  private setStatus(feature: AiFeature, mediaId: string, s: AiStatus): void {
    this.statuses.set(`${feature}:${mediaId}`, s);
    this.bump();
  }

  // ---------------------------------------------------------------- what the project asks for

  private onEditor(): void {
    const player = this.editor.player;
    if (player && player !== this.lastPlayer) {
      this.lastPlayer = player;
      for (const m of this.snapshot()) player.syncAi(m);
    }
    this.watchFrameShape();
    this.ensure();
  }

  /** Walk the project and start whatever analysis its clips need that is not done or running. */
  ensure(): void {
    const p = this.editor.project;
    const wants = new Map<string, { media: MediaRef; from: number; to: number; feature: AiFeature }>();
    for (const t of p.tracks) {
      for (const item of t.items) {
        if (item.type !== "media") continue;
        const media = p.media[item.mediaId];
        if (!media || media.kind === "audio") continue;
        const add = (feature: AiFeature) => {
          const [from, to] = media.kind === "image" ? [0, 0.04] : sourceWindow(item, media);
          const key = `${feature}:${media.id}`;
          const hit = wants.get(key);
          wants.set(key, { media, feature, from: hit ? Math.min(hit.from, from) : from, to: hit ? Math.max(hit.to, to) : to });
        };
        if (item.cutout) add("cutout");
        if (media.kind === "video" && wantsStabilize(item)) add("stabilize");
      }
    }
    // a feature switched off everywhere forgets that it was cancelled, so switching it on again retries
    for (const key of this.suppressed) if (!wants.has(key)) this.suppressed.delete(key);
    for (const [key, w] of wants) {
      if (this.suppressed.has(key) || this.starting.has(key)) continue;
      const have = this.covers.get(key);
      if (have && have.from <= w.from + 1e-6 && have.to >= w.to - 1e-6) continue;
      if ([...this.running.values()].some(r => r.feature === w.feature && r.mediaId === w.media.id && r.from <= w.from + 1e-6 && r.to >= w.to - 1e-6)) continue;
      void this.start(w.feature, w.media, w.from, w.to);
    }
  }

  private async start(feature: AiFeature, media: MediaRef, from: number, to: number): Promise<void> {
    const key = `${feature}:${media.id}`;
    this.starting.add(key);
    try {
      const have = this.covers.get(key);
      // never shrink what has been computed; a wider request replaces it
      if (have) [from, to] = [Math.min(from, have.from), Math.max(to, have.to)];
      const quality = have?.quality ?? "fast";
      const file = await this.fileFor(feature, media, from, to, quality);
      const cached = await window.openroll.cache.get(file).catch(() => null);
      if (cached && (await this.install(feature, media, from, to, quality, new Uint8Array(cached)))) return;
      this.setStatus(feature, media.id, { state: "queued", progress: 0, label: "Waiting" });
      await this.runJob(feature, media, from, to, quality);
    } catch (err) {
      const message = (err as Error).message;
      if (message !== "cancelled") this.setStatus(feature, media.id, { state: "error", progress: 0, message });
    } finally {
      this.starting.delete(key);
    }
  }

  private async fileFor(feature: AiFeature, media: MediaRef, from: number, to: number, quality: string): Promise<string> {
    const id = await digest(`${feature}|${media.path}|${media.size}|${media.mtime}|${from.toFixed(2)}|${to.toFixed(2)}|${quality}|v1`);
    return `ai-${feature}-${id}.bin`;
  }

  // ---------------------------------------------------------------- the worker

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("../../../engine/ai.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<AiEvent>) => this.receive(e.data);
    w.onerror = e => {
      this.worker?.terminate();
      this.worker = null;
      const message = e.message || "The analysis engine stopped unexpectedly.";
      for (const [id, r] of this.running) {
        this.running.delete(id);
        this.setStatus(r.feature, r.mediaId, { state: "error", progress: 0, message });
        r.reject(new Error(message));
      }
    };
    this.worker = w;
    return w;
  }

  private post(req: AiRequest): void {
    this.ensureWorker().postMessage(req);
  }

  private runJob(feature: AiFeature, media: MediaRef, from: number, to: number, quality: "fast" | "best", itemId?: string): Promise<Running> {
    const id = this.nextId++;
    const url = window.openroll.mediaUrl(media.path);
    const sourceFps = media.fps && media.fps > 1 ? media.fps : 30;
    return new Promise<Running>((resolve, reject) => {
      const still = media.kind === "image";
      this.running.set(id, { feature, mediaId: media.id, from, to, quality, itemId, still, resolve, reject });
      const base = { id, url, mediaId: media.id, from, to };
      if (feature === "cutout") this.post({ kind: "matte", quality, still, fps: Math.min(30, sourceFps), ...base });
      else if (feature === "stabilize") this.post({ kind: "stabilize", fps: Math.min(60, sourceFps), ...base });
      else this.post({ kind: "subject", fps: 5, ...base });
    });
  }

  private receive(ev: AiEvent): void {
    const fj = this.frameJobs.get(ev.id);
    if (fj) {
      if (ev.type === "progress") fj.onProgress(ev.done, ev.total, ev.label);
      else if (ev.type === "enhanced") fj.got = { before: ev.before, after: ev.after, seconds: ev.seconds };
      else if (ev.type === "done" && fj.got) (this.frameJobs.delete(ev.id), fj.resolve(fj.got));
      else if (ev.type === "cancelled") (this.frameJobs.delete(ev.id), fj.reject(new Error("cancelled")));
      else if (ev.type === "error") (this.frameJobs.delete(ev.id), fj.reject(new Error(ev.message)));
      return;
    }
    const r = this.running.get(ev.id);
    if (!r) return;
    switch (ev.type) {
      case "progress": {
        const downloading = ev.stage === "model";
        const label = downloading ? `Downloading ${ev.label ?? "model"}` : r.feature === "cutout" ? "Finding the subject" : r.feature === "stabilize" ? "Tracking the camera" : "Looking for people";
        this.setStatus(r.feature, r.mediaId, { state: "preparing", progress: ev.total ? ev.done / ev.total : 0, label });
        break;
      }
      case "matte-info": {
        const t: MatteTrack = { ...ev.track, data: new Uint8Array(ev.track.width * ev.track.height * ev.track.count) };
        r.track = t;
        this.mattes.set(r.mediaId, t);
        this.syncAll({ media: r.mediaId, kind: "matte-info", track: ev.track });
        break;
      }
      case "matte-part": {
        const t = r.track;
        if (!t) break;
        const size = t.width * t.height;
        t.data.set(ev.bytes, ev.from * size);
        t.ready = Math.max(t.ready, ev.from + ev.bytes.byteLength / size);
        this.syncAll({ media: r.mediaId, kind: "matte-part", from: ev.from, bytes: ev.bytes.slice() });
        this.bump();
        break;
      }
      case "camera":
        r.camera = ev.path;
        this.cameras.set(r.mediaId, ev.path);
        this.syncAll({ media: r.mediaId, kind: "camera", path: ev.path });
        break;
      case "subject":
        r.subject = { samples: ev.samples, found: ev.found };
        break;
      case "done":
        this.running.delete(ev.id);
        void this.finish(r, ev.seconds, ev.frames, ev.backend);
        break;
      case "cancelled":
        this.running.delete(ev.id);
        this.setStatus(r.feature, r.mediaId, IDLE);
        r.reject(new Error("cancelled"));
        break;
      case "error":
        this.running.delete(ev.id);
        this.setStatus(r.feature, r.mediaId, { state: "error", progress: 0, message: ev.message });
        r.reject(new Error(ev.message));
        break;
    }
  }

  private async finish(r: Running, seconds: number, frames: number, backend?: string): Promise<void> {
    const key = `${r.feature}:${r.mediaId}`;
    const media = this.editor.project.media[r.mediaId];
    if (r.feature !== "reframe") this.covers.set(key, { from: r.from, to: r.to, quality: r.quality });
    const detail = `${frames} frames in ${seconds.toFixed(1)} s${backend ? `, ${backend}` : ""}`;
    this.setStatus(r.feature, r.mediaId, { state: "ready", progress: 1, detail });
    if (media) {
      try {
        const file = await this.fileFor(r.feature, media, r.from, r.to, r.quality);
        if (r.feature === "cutout" && r.track) {
          const t = r.track;
          const body = await deflate(t.data);
          await window.openroll.cache.put(file, pack({ width: t.width, height: t.height, fps: t.fps, start: t.start, count: t.count, ready: t.ready }, body));
        } else if (r.feature === "stabilize" && r.camera) {
          const c = r.camera;
          await window.openroll.cache.put(file, pack({ fps: c.fps, start: c.start }, c.dx, c.dy, c.rot));
        }
      } catch (err) {
        console.warn("could not save analysis", err);
      }
    }
    r.resolve(r);
  }

  /** Put a saved result in place. False when the file is damaged and the work should run again. */
  private async install(feature: AiFeature, media: MediaRef, from: number, to: number, quality: "fast" | "best", bytes: Uint8Array): Promise<boolean> {
    try {
      const { meta, parts } = unpack(bytes);
      if (feature === "cutout") {
        const m = meta as Omit<MatteTrack, "data">;
        const data = await inflate(parts[0]);
        if (data.byteLength !== m.width * m.height * m.count) return false;
        this.mattes.set(media.id, { ...m, data });
        const info = { width: m.width, height: m.height, fps: m.fps, start: m.start, count: m.count, ready: 0 };
        this.syncAll({ media: media.id, kind: "matte-info", track: info });
        this.syncAll({ media: media.id, kind: "matte-part", from: 0, bytes: data.slice() });
      } else if (feature === "stabilize") {
        const m = meta as { fps: number; start: number };
        const path: CameraPath = { fps: m.fps, start: m.start, dx: floats(parts[0]), dy: floats(parts[1]), rot: floats(parts[2]) };
        this.cameras.set(media.id, path);
        this.syncAll({ media: media.id, kind: "camera", path });
      }
      this.covers.set(`${feature}:${media.id}`, { from, to, quality });
      this.setStatus(feature, media.id, { state: "ready", progress: 1, detail: "Loaded from a saved analysis" });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- controls

  cancel(feature: AiFeature, mediaId: string): void {
    this.suppressed.add(`${feature}:${mediaId}`);
    for (const [id, r] of this.running) if (r.feature === feature && r.mediaId === mediaId) this.post({ kind: "cancel", id });
    this.setStatus(feature, mediaId, IDLE);
  }

  retry(feature: AiFeature, mediaId: string): void {
    this.suppressed.delete(`${feature}:${mediaId}`);
    this.covers.delete(`${feature}:${mediaId}`);
    this.setStatus(feature, mediaId, IDLE);
    this.ensure();
  }

  /** What the render workers need, for a new preview or for an export. */
  snapshot(): AiSync[] {
    const out: AiSync[] = [];
    for (const [media, t] of this.mattes) {
      out.push({ media, kind: "matte-info", track: { width: t.width, height: t.height, fps: t.fps, start: t.start, count: t.count, ready: 0 } });
      if (t.ready > 0) out.push({ media, kind: "matte-part", from: 0, bytes: t.data.slice(0, Math.ceil(t.ready) * t.width * t.height) });
    }
    for (const [media, path] of this.cameras) out.push({ media, kind: "camera", path });
    return out;
  }

  private syncAll(m: AiSync): void {
    this.editor.player?.syncAi(m);
  }

  /** Sharper mattes for the final render. Waits for them, reporting how far along it is. */
  async prepareForExport(onProgress: (label: string, done: number, total: number) => void): Promise<void> {
    const p = this.editor.project;
    const wanted: { media: MediaRef; from: number; to: number }[] = [];
    for (const [key, have] of this.covers) {
      if (!key.startsWith("cutout:") || have.quality === "best") continue;
      const media = p.media[key.slice(7)];
      if (media && media.kind === "video") wanted.push({ media, from: have.from, to: have.to });
    }
    let done = 0;
    for (const w of wanted) {
      onProgress("Refining cutouts", done, wanted.length);
      const file = await this.fileFor("cutout", w.media, w.from, w.to, "best");
      const cached = await window.openroll.cache.get(file).catch(() => null);
      if (cached && (await this.install("cutout", w.media, w.from, w.to, "best", new Uint8Array(cached)))) {
        done++;
        continue;
      }
      await this.runJob("cutout", w.media, w.from, w.to, "best");
      done++;
    }
    onProgress("Refining cutouts", wanted.length, wanted.length);
  }

  /** The super resolution model on a window of the picture at the playhead, for a before and after. */
  enhancePreview(itemId: string, onProgress: (done: number, total: number, label?: string) => void): { result: Promise<{ before: ImageBitmap; after: ImageBitmap; seconds: number }>; cancel(): void } {
    const p = this.editor.project;
    const hit = findItem(p, itemId);
    const item = hit?.item;
    const media = item?.type === "media" ? p.media[item.mediaId] : undefined;
    const id = this.nextId++;
    const result = new Promise<{ before: ImageBitmap; after: ImageBitmap; seconds: number }>((resolve, reject) => {
      if (!item || item.type !== "media" || !media) return reject(new Error("Select a clip first."));
      this.frameJobs.set(id, { onProgress, resolve, reject });
      const at = sourceTime(item, Math.min(item.start + item.duration - 1, Math.max(item.start, this.editor.time)), media.duration) / 1e6;
      this.post({ kind: "enhance-frame", id, url: window.openroll.mediaUrl(media.path), at, scale: 4 });
    });
    return { result, cancel: () => this.post({ kind: "cancel", id }) };
  }

  /** How much a clip is cropped in to hide the edges at a strength, from its measured camera path. */
  stabilizeCrop(mediaId: string, strength: number): number | null {
    const path = this.cameras.get(mediaId);
    const media = this.editor.project.media[mediaId];
    if (!path || !media?.width || !media.height) return null;
    return buildCorrection(path, strength, media.width / media.height).zoom - 1;
  }

  // ---------------------------------------------------------------- framing

  /** Find the main person in a clip and key its position and scale to fill the frame. */
  async reframe(itemId: string): Promise<{ found: boolean }> {
    const p = this.editor.project;
    const hit = findItem(p, itemId);
    if (!hit || hit.item.type !== "media") return { found: false };
    const item = hit.item;
    const media = p.media[item.mediaId];
    if (!media || media.kind === "audio") return { found: false };
    const [from, to] = media.kind === "image" ? [0, 0.04] : sourceWindow(item, media);
    this.setStatus("reframe", media.id, { state: "queued", progress: 0, label: "Waiting" });
    let subject: { samples: SubjectSample[]; found: number } | undefined;
    try {
      subject = (await this.runJob("reframe", media, from, to, "fast", itemId)).subject;
    } catch (err) {
      if ((err as Error).message !== "cancelled") this.editor.toast((err as Error).message, { tone: "error" });
      return { found: false };
    }
    const samples = subject?.samples ?? [];
    const now = findItem(this.editor.project, itemId);
    if (!now || now.item.type !== "media") return { found: false };
    const fit = fitSize(this.editor.project, media);
    const plan = planReframe({ samples: media.kind === "image" ? samples.slice(0, 1) : samples, frameWidth: this.editor.project.settings.width, frameHeight: this.editor.project.settings.height, fitWidth: fit.width, fitHeight: fit.height }, s => localTime(now.item as MediaItem, s));
    const still = media.kind === "image" || plan.x.length < 2;
    this.editor.apply("Auto reframe", pr => {
      const next = structuredClone(pr);
      const target = findItem(next, itemId);
      if (!target || target.item.type !== "media") return pr;
      const it = target.item;
      const keys = { ...(it.keyframes ?? {}) };
      if (still) {
        const k = (v: number[]) => (v.length ? v[0] : 0);
        it.transform = { ...it.transform, x: k(plan.x.map(a => a.v)), y: k(plan.y.map(a => a.v)), scale: k(plan.scale.map(a => a.v)) || it.transform.scale };
        delete keys["transform.x"];
        delete keys["transform.y"];
        delete keys["transform.scale"];
      } else {
        keys["transform.x"] = plan.x;
        keys["transform.y"] = plan.y;
        keys["transform.scale"] = plan.scale;
      }
      if (Object.keys(keys).length) it.keyframes = keys;
      else delete it.keyframes;
      return next;
    });
    this.setStatus("reframe", media.id, { state: "ready", progress: 1, detail: subject?.found ? `Followed a person for ${subject.found} samples` : "No one found, framed the middle" });
    return { found: !!subject?.found };
  }

  // ---------------------------------------------------------------- frame shape

  /** Offer to reframe when the project turns from wide to tall. */
  private watchFrameShape(): void {
    const s = this.editor.project.settings;
    const before = this.lastSettings;
    this.lastSettings = { width: s.width, height: s.height };
    if (!before) return;
    const wasWide = before.width > before.height, nowTall = s.height > s.width;
    if (!wasWide || !nowTall) return;
    const wide = this.editor.project.tracks.flatMap(t => t.items).filter((i): i is MediaItem => i.type === "media" && this.editor.project.media[i.mediaId]?.kind === "video" && !i.keyframes?.["transform.x"]);
    if (!wide.length) return;
    this.editor.toast("The frame is vertical now. Reframe the clips to follow the people in them?", {
      action: { label: "Reframe", run: () => void this.reframeAll(wide.map(i => i.id)) },
    });
  }

  async reframeAll(ids: string[]): Promise<void> {
    let found = 0;
    for (const id of ids) if ((await this.reframe(id)).found) found++;
    this.editor.toast(found ? `Reframed ${ids.length} ${ids.length === 1 ? "clip" : "clips"}` : "No one found to follow, the clips are centred");
  }

  dispose(): void {
    this.unsubscribe();
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}

/** The part of a source file a clip reads, with a little room either side. */
export function sourceWindow(item: MediaItem, media: MediaRef): [number, number] {
  const start = item.in as Micros;
  const end = start + sourceSpan(item);
  return [Math.max(0, start / 1e6 - PAD), Math.min(media.duration / 1e6, end / 1e6 + PAD)];
}
