import { ALL_FORMATS, AudioBufferSink, Input, UrlSource, type InputAudioTrack } from "mediabunny";
import { itemEnd, type MediaItem, type Project } from "../core/project";
import type { ExportIn, ExportOut, ExportSettings } from "./export-protocol";

export interface ExportProgress {
  frame: number;
  frames: number;
  elapsed: number;
  bytes: number;
}

export interface ExportHandlers {
  onProgress(p: ExportProgress): void;
}

const RATE = 48_000;

/**
 * Runs an export: the worker renders and encodes video, this side mixes audio in chunks
 * (OfflineAudioContext only exists on the page) and writes bytes to disk.
 */
export class Exporter {
  private worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  private tracks = new Map<string, Promise<InputAudioTrack | null>>();

  constructor(private project: Project, private urls: Record<string, string>, private writerId: number) {}

  run(settings: ExportSettings, h: ExportHandlers): Promise<{ bytes: number; seconds: number }> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = async (e: MessageEvent<ExportOut>) => {
        const m = e.data;
        switch (m.type) {
          case "write":
            await window.openroll.write(this.writerId, m.position, m.data);
            this.send({ type: "written", req: m.req });
            break;
          case "need-audio": {
            const planes = await this.mix(m.from, m.seconds).catch(err => {
              console.warn("audio mix failed", err);
              return null;
            });
            this.send({ type: "audio", req: m.req, planes, frames: planes?.[0].length ?? 0 }, planes?.map(p => p.buffer) ?? []);
            break;
          }
          case "progress":
            h.onProgress(m);
            break;
          case "done":
            resolve(m);
            break;
          case "cancelled":
            reject(new Error("cancelled"));
            break;
          case "error":
            reject(new Error(m.message));
            break;
        }
      };
      this.worker.onerror = e => reject(new Error(e.message || "The export worker stopped."));
      this.send({ type: "start", project: this.project, urls: this.urls, settings });
    });
  }

  cancel(): void {
    this.send({ type: "cancel" });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private send(m: ExportIn, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  private track(mediaId: string): Promise<InputAudioTrack | null> {
    let t = this.tracks.get(mediaId);
    if (!t) {
      t = new Input({ formats: ALL_FORMATS, source: new UrlSource(this.urls[mediaId]) }).getPrimaryAudioTrack().catch(() => null);
      this.tracks.set(mediaId, t);
    }
    return t;
  }

  /** Mix [from, from + seconds) of the timeline into stereo planes. */
  private async mix(from: number, seconds: number): Promise<Float32Array[]> {
    const p = this.project;
    const total = Math.min(seconds, Math.max(0, itemsEnd(p) / 1e6 - from));
    const frames = Math.max(1, Math.round(total * RATE));
    const ctx = new OfflineAudioContext(2, frames, RATE);
    const winStart = from * 1e6, winEnd = (from + total) * 1e6;

    const jobs: Promise<void>[] = [];
    for (const track of p.tracks) {
      if (track.muted) continue;
      for (const item of track.items) {
        if (item.type !== "media" || item.reversed || item.freeze || item.volume <= 0) continue;
        const media = p.media[item.mediaId];
        if (!media?.hasAudio || itemEnd(item) <= winStart || item.start >= winEnd) continue;
        jobs.push(this.place(ctx, item, winStart, winEnd));
      }
    }
    await Promise.all(jobs);
    const out = await ctx.startRendering();
    return [out.getChannelData(0), out.getChannelData(1)];
  }

  private async place(ctx: OfflineAudioContext, item: MediaItem, winStart: number, winEnd: number): Promise<void> {
    const track = await this.track(item.mediaId);
    if (!track) return;
    const from = Math.max(winStart, item.start);
    const to = Math.min(winEnd, itemEnd(item));
    const srcFrom = (item.in + (from - item.start) * item.speed) / 1e6;
    const srcTo = (item.in + (to - item.start) * item.speed) / 1e6;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const at = (t: number) => Math.max(0, (t - winStart) / 1e6);
    gain.gain.setValueAtTime(item.volume, 0);
    if (item.fadeIn > 0) {
      gain.gain.setValueAtTime(0, at(item.start));
      gain.gain.linearRampToValueAtTime(item.volume, at(item.start + item.fadeIn));
    }
    if (item.fadeOut > 0) {
      gain.gain.setValueAtTime(item.volume, at(itemEnd(item) - item.fadeOut));
      gain.gain.linearRampToValueAtTime(0, at(itemEnd(item)));
    }
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers(srcFrom, srcTo)) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = item.speed;
      node.connect(gain);
      const offset = Math.max(0, srcFrom - timestamp);
      const tl = item.start + ((timestamp + offset) * 1e6 - item.in) / item.speed;
      const dur = Math.min(buffer.duration - offset, srcTo - (timestamp + offset));
      if (dur > 0) node.start(at(tl), offset, dur);
    }
  }
}

function itemsEnd(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
  return end;
}
