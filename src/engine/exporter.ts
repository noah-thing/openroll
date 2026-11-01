import { ALL_FORMATS, AudioBufferSink, AudioSample, AudioSampleSource, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource, type InputAudioTrack, type StreamTargetChunk } from "mediabunny";
import { audible } from "../core/audio-plan";
import { itemEnd, type MediaItem, type Project } from "../core/project";
import type { PipeSpec } from "../shared/ffexport";
import { buildChain, calibrate, createBus, loadWorklet, needsWorklet } from "./audio-graph";
import { ladder, pipeFormat } from "./export-formats";
import type { ExportIn, ExportOut, ExportSettings } from "./export-protocol";
import type { AiSync } from "./ai/protocol";

export interface ExportProgress {
  frame: number;
  frames: number;
  elapsed: number;
  bytes: number;
  /** Plain words about what is happening, such as a retry with another encoder. */
  note?: string;
}

export interface ExportHandlers {
  onProgress(p: ExportProgress): void;
}

const RATE = 48_000;
/** Seconds rendered before each chunk and thrown away, so stateful effects settle. */
const PREROLL = 1.5;
/** Room before time zero for processors that delay their output. */
const LATENCY_ROOM = 0.02;
const AUDIO_CHUNK = 10;

/** The file could not be written. Another encoder would hit the same wall, so the ladder stops here. */
export class OutputError extends Error {}

interface Result {
  bytes: number;
  seconds: number;
}

/**
 * Runs an export: a worker renders video, this side mixes audio in chunks (OfflineAudioContext
 * only exists on the page) and moves bytes to disk or into ffmpeg. The project passed in is a
 * snapshot, so editing carries on while this runs.
 */
export class Exporter {
  private worker: Worker | null = null;
  private tracks = new Map<string, Promise<InputAudioTrack | null>>();
  private cancelled = false;
  private pipeId: string | null = null;

  constructor(private project: Project, private urls: Record<string, string>, private writerId: number, private ai: AiSync[] = []) {}

  /** Tries each encoder in turn. Only when every one fails does the caller hear about it. */
  async run(settings: ExportSettings, h: ExportHandlers): Promise<Result> {
    const ffmpeg = (await window.openroll.convert.status()).available;
    const rungs = ladder(settings, ffmpeg);
    if (!rungs.length) throw new Error("This format needs the converter that ships with OpenRoll, and it is missing. Reinstalling usually fixes this.");
    const first = Math.max(0, rungs.indexOf(settings.encoder));
    let last: Error | null = null;
    for (const [n, rung] of rungs.slice(first).entries()) {
      if (n > 0) {
        await window.openroll.resetWriter(this.writerId);
        h.onProgress({ frame: 0, frames: 1, elapsed: 0, bytes: 0, note: rung === "software" ? "Trying the software encoder" : "Trying another encoder" });
      }
      try {
        return await this.attempt({ ...settings, encoder: rung }, h);
      } catch (err) {
        if (this.cancelled || (err as Error).message === "cancelled") throw new Error("cancelled");
        if (err instanceof OutputError) throw err;
        last = err as Error;
        console.warn(`export with ${rung} failed`, err);
      }
    }
    throw new Error(rungs.length > 1 ? `no encoder on this computer could finish it (${last?.message}).` : (last?.message ?? "unknown error"));
  }

  private attempt(s: ExportSettings, h: ExportHandlers): Promise<Result> {
    // A stop that lands between two encoders has no worker to receive it yet.
    if (this.cancelled) return Promise.reject(new Error("cancelled"));
    if (s.format === "m4a" || s.format === "wav") return this.audioOnly(s, h);
    if (s.encoder === "ffmpeg") return this.piped(s, h);
    return this.render(s, h, async () => {});
  }

  /** Video through the worker. `onFrame` receives raw frames when ffmpeg is the encoder. */
  private render(s: ExportSettings, h: ExportHandlers, onFrame: (data: Uint8Array) => Promise<void>): Promise<Result> {
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    return new Promise<Result>((resolve, reject) => {
      worker.onmessage = async (e: MessageEvent<ExportOut>) => {
        const m = e.data;
        try {
          switch (m.type) {
            case "write":
              await this.put(m.position, m.data);
              this.send({ type: "written", req: m.req });
              break;
            case "frame":
              await onFrame(m.data);
              this.send({ type: "written", req: m.req });
              break;
            case "need-audio": {
              // A chunk that cannot be mixed fails the export; skipping it would leave a silent gap in the file.
              const planes = await this.mix(m.from, m.seconds);
              this.send({ type: "audio", req: m.req, planes, frames: planes[0].length }, planes.map(p => p.buffer));
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
        } catch (err) {
          reject(err as Error);
        }
      };
      worker.onerror = e => reject(new Error(e.message || "The export worker stopped."));
      this.send({ type: "start", project: this.project, urls: this.urls, settings: s, ai: this.ai });
    }).finally(() => {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    });
  }

  /** Frames go to ffmpeg as raw pixels. Audio is mixed first and staged in a file, since a pipe carries one stream. */
  private async piped(s: ExportSettings, h: ExportHandlers): Promise<Result> {
    const started = performance.now();
    const id = await window.openroll.ffexport.open();
    this.pipeId = id;
    try {
      const staged = s.audio && s.format !== "gif" ? await this.stageAudio(id, h) : 0;
      const spec: PipeSpec = {
        format: pipeFormat(s),
        width: s.width,
        height: s.height,
        fps: s.fps,
        transparent: s.transparent,
        bitrate: s.bitrate,
        hasAudio: staged > 0,
      };
      await window.openroll.ffexport.begin(id, this.writerId, spec);
      let bytes = 0;
      const r = await this.render({ ...s, audio: false }, h, async data => {
        bytes += data.byteLength;
        await window.openroll.ffexport.frame(id, data);
      });
      h.onProgress({ frame: 1, frames: 1, elapsed: r.seconds, bytes: 0, note: "Finishing the file" });
      await window.openroll.ffexport.finish(id, spec);
      return { bytes, seconds: (performance.now() - started) / 1000 };
    } catch (err) {
      await window.openroll.ffexport.cancel(id).catch(() => {});
      throw err;
    } finally {
      this.pipeId = null;
    }
  }

  /** Interleaved float32 stereo into the staging file. Returns the bytes written; 0 means silence. */
  private async stageAudio(id: string, h: ExportHandlers): Promise<number> {
    const total = itemsEnd(this.project) / 1e6;
    if (!this.hasAudio()) return 0;
    let bytes = 0;
    for (let from = 0; from < total; from += AUDIO_CHUNK) {
      if (this.cancelled) throw new Error("cancelled");
      h.onProgress({ frame: 0, frames: 1, elapsed: 0, bytes: 0, note: "Mixing sound" });
      const [l, r] = await this.mix(from, AUDIO_CHUNK);
      const out = new Float32Array(l.length * 2);
      for (let i = 0; i < l.length; i++) {
        out[i * 2] = l[i];
        out[i * 2 + 1] = r[i];
      }
      const data = new Uint8Array(out.buffer);
      bytes += data.byteLength;
      await window.openroll.ffexport.audio(id, data);
    }
    return bytes;
  }

  private hasAudio(): boolean {
    return this.project.tracks.some(t => !t.muted && t.items.some(i => i.type === "media" && audible(i, this.project.media[i.mediaId])));
  }

  private async audioOnly(s: ExportSettings, h: ExportHandlers): Promise<Result> {
    const started = performance.now();
    const total = itemsEnd(this.project) / 1e6;
    const chunks = Math.max(1, Math.ceil(total / AUDIO_CHUNK));
    const progress = (n: number) => h.onProgress({ frame: n, frames: chunks, elapsed: (performance.now() - started) / 1000, bytes: 0 });
    let written = 0;

    if (s.format === "wav") {
      let pos = 44;
      for (let n = 0; n < chunks; n++) {
        if (this.cancelled) throw new Error("cancelled");
        progress(n);
        const pcm = pcm16(await this.mix(n * AUDIO_CHUNK, AUDIO_CHUNK));
        await this.put(pos, pcm);
        pos += pcm.byteLength;
      }
      await this.put(0, wavHeader(pos - 44));
      return { bytes: pos, seconds: (performance.now() - started) / 1000 };
    }

    const writable = new WritableStream<StreamTargetChunk>({
      write: async chunk => {
        written = Math.max(written, chunk.position + chunk.data.byteLength);
        await this.put(chunk.position, chunk.data);
      },
    });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 }) });
    const source = new AudioSampleSource({ codec: "aac", bitrate: 256_000 });
    output.addAudioTrack(source);
    await output.start();
    try {
      for (let n = 0; n < chunks; n++) {
        if (this.cancelled) throw new Error("cancelled");
        progress(n);
        const planes = await this.mix(n * AUDIO_CHUNK, AUDIO_CHUNK);
        const data = new Float32Array(planes[0].length * 2);
        data.set(planes[0], 0);
        data.set(planes[1], planes[0].length);
        const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: RATE, timestamp: n * AUDIO_CHUNK });
        await source.add(sample);
        sample.close();
      }
      await output.finalize();
    } catch (err) {
      await output.cancel().catch(() => {});
      throw err;
    }
    return { bytes: written, seconds: (performance.now() - started) / 1000 };
  }

  private put(position: number, data: Uint8Array): Promise<void> {
    return window.openroll.write(this.writerId, position, data).catch(err => {
      throw new OutputError(`the file could not be written (${ipcReason(err)})`);
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.send({ type: "cancel" });
    if (this.pipeId) void window.openroll.ffexport.cancel(this.pipeId);
  }

  dispose(): void {
    this.worker?.terminate();
  }

  private send(m: ExportIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }

  private track(mediaId: string): Promise<InputAudioTrack | null> {
    let t = this.tracks.get(mediaId);
    if (!t) {
      t = new Input({ formats: ALL_FORMATS, source: new UrlSource(this.urls[mediaId]) }).getPrimaryAudioTrack().catch(() => null);
      this.tracks.set(mediaId, t);
    }
    return t;
  }

  /**
   * Mix [from, from + seconds) of the timeline into stereo planes. Each chunk renders in a
   * fresh context, so it starts a little early and drops that lead in: compressors, the
   * noise model and echo tails then arrive at the chunk edge already settled.
   */
  private async mix(from: number, seconds: number): Promise<Float32Array[]> {
    const p = this.project;
    const total = Math.min(seconds, Math.max(0, itemsEnd(p) / 1e6 - from));
    const lead = from === 0 ? LATENCY_ROOM : Math.min(from, PREROLL);
    const frames = Math.max(1, Math.round((total + lead) * RATE));
    const ctx = new OfflineAudioContext(2, frames, RATE);
    const winStart = (from - lead) * 1e6, winEnd = (from + total) * 1e6;

    const items: MediaItem[] = [];
    for (const track of p.tracks) {
      if (track.muted) continue;
      for (const item of track.items) {
        if (item.type !== "media") continue;
        if (!audible(item, p.media[item.mediaId]) || itemEnd(item) <= winStart || item.start >= winEnd) continue;
        items.push(item);
      }
    }
    await calibrate();
    if (items.some(needsWorklet)) await loadWorklet(ctx);
    const bus = createBus(ctx, ctx.destination);
    await Promise.all(items.map(item => this.place(ctx, bus, item, winStart, winEnd)));
    const out = await ctx.startRendering();
    const skip = Math.round(lead * RATE);
    return [out.getChannelData(0).slice(skip), out.getChannelData(1).slice(skip)];
  }

  private async place(ctx: OfflineAudioContext, bus: AudioNode, item: MediaItem, winStart: number, winEnd: number): Promise<void> {
    const track = await this.track(item.mediaId);
    if (!track) return;
    const media = this.project.media[item.mediaId];
    const at = (t: number) => Math.max(0, (t - winStart) / 1e6);
    const chain = buildChain(ctx, this.project, item, media, { from: winStart, toCtx: at, now: 0 });
    chain.output.connect(bus);
    const from = Math.max(winStart, item.start);
    const to = Math.min(winEnd, itemEnd(item));
    const srcFrom = (item.in + (from - item.start) * item.speed) / 1e6;
    const srcTo = (item.in + (to - item.start) * item.speed) / 1e6;
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers(srcFrom, srcTo)) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = item.speed;
      node.connect(chain.input);
      const offset = Math.max(0, srcFrom - timestamp);
      const tl = item.start + ((timestamp + offset) * 1e6 - item.in) / item.speed;
      const dur = Math.min(buffer.duration - offset, srcTo - (timestamp + offset));
      if (dur > 0) node.start(Math.max(0, at(tl) - chain.latency), offset, dur);
    }
  }
}

/** Electron wraps errors from the main process in a long prefix; keep the part a person can use. */
export function ipcReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/, "").replace(/^Error: /, "");
}

function itemsEnd(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
  return end;
}

function pcm16(planes: Float32Array[]): Uint8Array {
  const frames = planes[0].length;
  const out = new Uint8Array(frames * planes.length * 2);
  const v = new DataView(out.buffer);
  let at = 0;
  for (let i = 0; i < frames; i++) {
    for (const p of planes) {
      const x = Math.max(-1, Math.min(1, p[i]));
      v.setInt16(at, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      at += 2;
    }
  }
  return out;
}

function wavHeader(dataBytes: number): Uint8Array {
  const out = new Uint8Array(44);
  const v = new DataView(out.buffer);
  const text = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, dataBytes, true);
  return out;
}
