import { cpus } from "node:os";
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { DerivedKind, DerivedState, InspectResult, ProxyRequest, StreamSummary } from "../shared/derived";
import { proxyReason, proxyShrinks } from "../engine/proxy-policy";
import { cacheKey, parseEncoders, prepareArgs, proxyArgs, type Encoders } from "./ffmpeg-args";
import { findBinaries } from "./ffmpeg-binaries";
import { renameBusy } from "./fs-retry";
import { fraction } from "./ffmpeg-progress";
import { keyframeInterval, parseProbe } from "./ffmpeg-probe";
import { JobQueue } from "./ffmpeg-queue";
import { capture, start } from "./ffmpeg-runner";

const CACHE_LIMIT = 12 * 1024 ** 3;

export interface MediaServiceDeps {
  cacheDir(): string;
  /** Makes a file readable through the media protocol. */
  allow(path: string): void;
  emit(path: string, state: DerivedState): void;
}

/**
 * Background conversions of imported media: edit friendly copies of files the page cannot
 * decode, and small proxies of heavy ones. Results are cached by path, size and mtime.
 */
export class MediaService {
  readonly queue = new JobQueue(cpus().length);
  private states = new Map<string, DerivedState>();
  private infos = new Map<string, Promise<StreamSummary | null>>();
  private gops = new Map<string, Promise<number | null>>();
  private encoderSet: Promise<Encoders> | null = null;

  constructor(private deps: MediaServiceDeps) {}

  get available(): boolean {
    return !!findBinaries();
  }

  private dir(): string {
    return join(this.deps.cacheDir(), "derived");
  }

  encoders(): Promise<Encoders> {
    const bins = findBinaries();
    if (!bins) return Promise.resolve(new Set());
    this.encoderSet ??= capture(bins.ffmpeg, ["-hide_banner", "-encoders"]).then(r => parseEncoders(r.stdout));
    return this.encoderSet;
  }

  inspect(path: string): Promise<StreamSummary | null> {
    let hit = this.infos.get(path);
    if (!hit) {
      hit = this.probe(path);
      this.infos.set(path, hit);
    }
    return hit;
  }

  private async probe(path: string): Promise<StreamSummary | null> {
    const bins = findBinaries();
    if (!bins?.ffprobe) return null;
    const r = await capture(bins.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]).catch(() => null);
    if (!r || r.code !== 0) return null;
    try {
      const info = parseProbe(JSON.parse(r.stdout));
      return info.video || info.audio ? info : null;
    } catch {
      return null;
    }
  }

  /** Median keyframe gap over the first half minute, which is enough to tell phone footage from screen recordings. */
  keyframeGap(path: string): Promise<number | null> {
    let hit = this.gops.get(path);
    if (!hit) {
      hit = this.measureGap(path);
      this.gops.set(path, hit);
    }
    return hit;
  }

  private async measureGap(path: string): Promise<number | null> {
    const bins = findBinaries();
    if (!bins?.ffprobe) return null;
    const r = await capture(bins.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-read_intervals", "%+30", "-of", "json", path], 30_000).catch(() => null);
    if (!r || r.code !== 0) return null;
    try {
      return keyframeInterval((JSON.parse(r.stdout) as { packets?: { flags?: string; pts_time?: string }[] }).packets ?? []);
    } catch {
      return null;
    }
  }

  async describe(path: string): Promise<InspectResult | null> {
    const info = await this.inspect(path);
    if (!info) return null;
    return { duration: info.duration, video: info.video, audio: info.audio };
  }

  private slot(path: string, kind: DerivedKind): string {
    return `${kind}:${path}`;
  }

  state(path: string, kind: DerivedKind): DerivedState | null {
    return this.states.get(this.slot(path, kind)) ?? null;
  }

  private set(path: string, state: DerivedState): void {
    this.states.set(this.slot(path, state.kind), state);
    this.deps.emit(path, state);
  }

  private async target(path: string, kind: DerivedKind, audioOnly: boolean): Promise<{ file: string; part: string } | null> {
    const s = await stat(path).catch(() => null);
    if (!s) return null;
    const key = cacheKey(path, s.size, Math.round(s.mtimeMs), kind);
    const ext = kind === "proxy" ? "proxy.mp4" : audioOnly ? "m4a" : "mp4";
    const file = join(this.dir(), `${key}.${ext}`);
    return { file, part: file + ".part" };
  }

  /** Whatever the cache already holds for these files, without starting any work. */
  async existing(paths: string[]): Promise<Record<string, DerivedState[]>> {
    const out: Record<string, DerivedState[]> = {};
    for (const path of paths) {
      const found: DerivedState[] = [];
      for (const kind of ["prepare", "proxy"] as const) {
        const live = this.state(path, kind);
        if (live) {
          found.push(live);
          continue;
        }
        for (const audioOnly of kind === "prepare" ? [false, true] : [false]) {
          const t = await this.target(path, kind, audioOnly);
          if (t && (await stat(t.file).catch(() => null))) {
            this.deps.allow(t.file);
            const s: DerivedState = { kind, status: "ready", progress: 1, file: t.file };
            this.states.set(this.slot(path, kind), s);
            found.push(s);
            break;
          }
        }
      }
      out[path] = found;
    }
    return out;
  }

  /** Converts an unreadable file into an edit friendly MP4 or M4A. Calling again for the same file is harmless. */
  async prepare(path: string, hints: { videoDecodable?: boolean } = {}): Promise<DerivedState> {
    const live = this.state(path, "prepare");
    if (live && live.status !== "failed") return live;
    const bins = findBinaries();
    if (!bins) return this.fail(path, "prepare", "OpenRoll could not find its converter. Reinstalling usually fixes this.");
    const info = await this.inspect(path);
    if (!info) return this.fail(path, "prepare", "This file could not be read, even by the converter.");
    const t = await this.target(path, "prepare", !info.video);
    if (!t) return this.fail(path, "prepare", "The file is missing.");
    if (await stat(t.file).catch(() => null)) {
      this.deps.allow(t.file);
      const ready: DerivedState = { kind: "prepare", status: "ready", progress: 1, file: t.file };
      this.set(path, ready);
      return ready;
    }
    const encoders = await this.encoders();
    return this.enqueue(path, "prepare", t, info.duration, 5, ctx => prepareArgs(path, t.part, info, { encoders, threads: ctx.threads }, hints));
  }

  /** Makes a proxy when the policy says so. Returns null when no proxy is wanted. */
  async proxy(path: string, req: ProxyRequest): Promise<DerivedState | null> {
    const live = this.state(path, "proxy");
    if (live && live.status !== "failed") return live;
    if (!findBinaries()) return null;
    const info = await this.inspect(path);
    if (!info?.video || !proxyShrinks(info.video.width, info.video.height)) return null;
    const gap = req.mode === "auto" ? await this.keyframeGap(path) : null;
    const reason = proxyReason(req.mode, { hasVideo: true, width: info.video.width, height: info.video.height, keyframeInterval: gap, slowDecode: req.slow });
    if (!reason) return null;
    const t = await this.target(path, "proxy", false);
    if (!t) return null;
    if (await stat(t.file).catch(() => null)) {
      this.deps.allow(t.file);
      const ready: DerivedState = { kind: "proxy", status: "ready", progress: 1, file: t.file, reason };
      this.set(path, ready);
      return ready;
    }
    const encoders = await this.encoders();
    return this.enqueue(path, "proxy", t, info.duration, 1, ctx => proxyArgs(path, t.part, info, { encoders, threads: ctx.threads }), reason);
  }

  private enqueue(path: string, kind: DerivedKind, t: { file: string; part: string }, duration: number, priority: number, args: (ctx: { threads?: number }) => string[], reason?: string): DerivedState {
    const queued: DerivedState = { kind, status: "queued", progress: 0, reason };
    this.set(path, queued);
    const bins = findBinaries()!;
    const id = this.slot(path, kind);
    void this.queue
      .add({
        id,
        heavy: true,
        priority,
        run: async ctx => {
          await mkdir(this.dir(), { recursive: true });
          this.set(path, { kind, status: "running", progress: 0, reason });
          const cores = cpus().length;
          const a = args({ threads: ctx.playbackActive ? Math.max(1, Math.floor(cores / 4)) : undefined });
          const run = start(bins.ffmpeg, [...a.slice(0, -1), "-f", "mp4", t.part], {
            signal: ctx.signal,
            lowPriority: true,
            onProgress: p => this.set(path, { kind, status: "running", progress: fraction(p.time, duration), reason }),
          });
          await run.done;
          await renameBusy(t.part, t.file);
          // Touch so the trim that drops the oldest keeps what people are using.
          await utimes(t.file, new Date(), new Date()).catch(() => {});
          this.deps.allow(t.file);
          this.set(path, { kind, status: "ready", progress: 1, file: t.file, reason });
          void this.trim();
        },
      })
      .catch(async err => {
        await rm(t.part, { force: true });
        if ((err as Error).message === "cancelled") this.states.delete(id), this.deps.emit(path, { kind, status: "cancelled", progress: 0 });
        else this.set(path, { kind, status: "failed", progress: 0, error: friendly((err as Error).message), reason });
      });
    return queued;
  }

  private fail(path: string, kind: DerivedKind, error: string): DerivedState {
    const s: DerivedState = { kind, status: "failed", progress: 0, error };
    this.set(path, s);
    return s;
  }

  cancel(path: string, kind: DerivedKind): void {
    this.queue.cancel(this.slot(path, kind));
  }

  /** The cache holds regenerable files, so the oldest go first once it grows past the limit. */
  private async trim(): Promise<void> {
    const dir = this.dir();
    const files = await Promise.all(
      (await readdir(dir).catch(() => [])).map(async n => ({ n, s: await stat(join(dir, n)).catch(() => null) })),
    );
    let total = files.reduce((a, f) => a + (f.s?.size ?? 0), 0);
    const live = new Set([...this.states.values()].map(s => s.file));
    for (const f of files.filter(f => f.s).sort((a, b) => a.s!.mtimeMs - b.s!.mtimeMs)) {
      if (total <= CACHE_LIMIT) break;
      if (live.has(join(dir, f.n))) continue;
      await rm(join(dir, f.n), { force: true });
      total -= f.s!.size;
    }
  }

  /** After the cache folder is cleared, remembered results would point at files that are gone. */
  reset(): void {
    this.states.clear();
  }
}

function friendly(reason: string): string {
  return reason ? `The converter stopped: ${reason}` : "The converter stopped.";
}
