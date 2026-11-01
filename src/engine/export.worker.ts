/// <reference lib="webworker" />
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  VideoSampleSink,
  type InputVideoTrack,
  type StreamTargetChunk,
  type VideoSample,
} from "mediabunny";
import { Compositor, type Layer, type Node } from "./compositor";
import { rasterText } from "./text";
import { rasterShape } from "./shape-raster";
import { loadFonts } from "./fonts";
import { buildScene, type Visual } from "../core/scene";
import { layerFields, syncLuts } from "./layer-look";
import { aiLayerFields, nextFrameTime, temporalLayer, temporalPlan } from "./ai/apply";
import { AiStore } from "./ai/store";
import type { AiSync } from "./ai/protocol";
import type { MediaRef, Project } from "../core/project";
import { projectDuration } from "../core/project";
import type { ExportIn, ExportOut, ExportSettings } from "./export-protocol";
import { ensureAac } from "./aac";

declare const self: DedicatedWorkerGlobalScope;

let cancelled = false;
const writeAcks = new Map<number, () => void>();
const audioWaiters = new Map<number, (chunk: { planes: Float32Array[]; frames: number } | null) => void>();
let nextReq = 1;

const post = (m: ExportOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ExportIn>) => {
  const m = e.data;
  if (m.type === "start") void run(m.project, m.urls, m.settings, m.ai ?? []).catch(err => post({ type: "error", message: (err as Error).message }));
  else if (m.type === "cancel") cancelled = true;
  else if (m.type === "written") writeAcks.get(m.req)?.();
  else if (m.type === "audio") audioWaiters.get(m.req)?.(m.planes ? { planes: m.planes, frames: m.frames } : null);
};

/** Reads frames strictly in order and never skips one, unlike the preview reader. */
class SequentialReader {
  private sink: VideoSampleSink;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;
  private ahead: VideoSample | null = null;
  private done = false;

  private hardware = true;

  constructor(private track: InputVideoTrack) {
    this.sink = new VideoSampleSink(track, { hardwareAcceleration: "prefer-hardware" });
  }

  async frameAt(t: number): Promise<VideoSample | null> {
    try {
      return await this.read(t);
    } catch (err) {
      if (!this.hardware) throw err;
      // Same as the preview reader: no hardware decoder, or one that refuses this stream.
      this.hardware = false;
      this.dispose();
      this.current = this.ahead = this.iter = null;
      this.sink = new VideoSampleSink(this.track, { hardwareAcceleration: "prefer-software" });
      return this.read(t);
    }
  }

  private async read(t: number): Promise<VideoSample | null> {
    const eps = 1e-4;
    const jump = !this.iter || (this.current && t < this.current.timestamp - eps) || (this.ahead && t > this.ahead.timestamp + 2);
    if (jump) await this.restart(t);
    while (this.ahead && this.ahead.timestamp <= t + eps) {
      this.current?.close();
      this.current = this.ahead;
      this.ahead = await this.pull();
    }
    return this.current ?? this.ahead;
  }

  private async restart(t: number): Promise<void> {
    await this.iter?.return(undefined);
    this.current?.close();
    this.ahead?.close();
    this.iter = this.sink.samples(t);
    this.done = false;
    this.current = await this.pull();
    this.ahead = await this.pull();
  }

  private async pull(): Promise<VideoSample | null> {
    if (this.done || !this.iter) return null;
    const r = await this.iter.next();
    if (r.done) {
      this.done = true;
      return null;
    }
    return r.value;
  }

  dispose(): void {
    this.current?.close();
    this.ahead?.close();
    this.iter?.return(undefined).catch(() => {});
  }
}

async function run(project: Project, urls: Record<string, string>, s: ExportSettings, aiSync: AiSync[]): Promise<void> {
  cancelled = false;
  const aiStore = new AiStore();
  for (const m of aiSync) aiStore.sync(m);
  const still = s.format === "png";
  await loadFonts(self.fonts);
  const duration = projectDuration(project);
  const fps = s.fps;
  const frameCount = still ? 1 : Math.max(1, Math.ceil((duration / 1e6) * fps));
  const canvas = new OffscreenCanvas(s.width, s.height);
  const compositor = new Compositor(canvas);
  compositor.resize(s.width, s.height, project.settings.width, project.settings.height);
  syncLuts(compositor, project);

  let written = 0;
  const writable = new WritableStream<StreamTargetChunk>({
    write: chunk =>
      new Promise<void>(resolve => {
        const req = nextReq++;
        writeAcks.set(req, () => {
          writeAcks.delete(req);
          resolve();
        });
        written = Math.max(written, chunk.position + chunk.data.byteLength);
        post({ type: "write", req, position: chunk.position, data: chunk.data }, [chunk.data.buffer]);
      }),
  });

  const piped = s.encoder === "ffmpeg";
  const useCodecs = !piped && !still;
  const webm = s.format === "webm";
  const output = useCodecs
    ? new Output({
        format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }),
        target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
      })
    : null;
  const video = output
    ? new CanvasSource(canvas, {
        codec: s.codec,
        bitrate: s.bitrate,
        keyFrameInterval: 2,
        latencyMode: "quality",
        hardwareAcceleration: s.encoder === "hardware" ? "prefer-hardware" : "prefer-software",
      })
    : null;
  if (output && video) output.addVideoTrack(video, { frameRate: fps });
  if (output && s.audio && !webm) await ensureAac();
  const audio = output && s.audio ? new AudioSampleSource({ codec: webm ? "opus" : "aac", bitrate: webm ? 128_000 : 192_000 }) : null;
  if (output && audio) output.addAudioTrack(audio);
  await output?.start();

  const inputs = new Map<string, Promise<InputVideoTrack | null>>();
  const readers = new Map<string, SequentialReader>();
  const images = new Map<string, ImageBitmap>();
  const trackOf = (m: MediaRef) => {
    let t = inputs.get(m.id);
    if (!t) {
      t = new Input({ formats: ALL_FORMATS, source: new UrlSource(urls[m.id]) }).getPrimaryVideoTrack();
      inputs.set(m.id, t);
    }
    return t;
  };

  const AUDIO_CHUNK = 10;
  let audioDone = 0;
  const pumpAudio = async (until: number) => {
    while (audio && audioDone < until && audioDone < duration / 1e6) {
      const req = nextReq++;
      const chunk = await new Promise<{ planes: Float32Array[]; frames: number } | null>(resolve => {
        audioWaiters.set(req, resolve);
        post({ type: "need-audio", req, from: audioDone, seconds: AUDIO_CHUNK });
      });
      audioWaiters.delete(req);
      if (chunk && chunk.frames > 0) {
        const data = new Float32Array(chunk.frames * chunk.planes.length);
        chunk.planes.forEach((p, i) => data.set(p.subarray(0, chunk.frames), i * chunk.frames));
        const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: chunk.planes.length, sampleRate: 48_000, timestamp: audioDone });
        await audio.add(sample);
        sample.close();
      }
      audioDone += AUDIO_CHUNK;
    }
  };

  let inFlight: Promise<void> = Promise.resolve();

  // GL rows run bottom up, and transparent frames are premultiplied; a PNG wants neither.
  const writeStill = async (px: Uint8Array) => {
    const w = s.width, h = s.height, row = w * 4;
    const out = new Uint8ClampedArray(px.length);
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * row;
      for (let x = 0; x < row; x += 4) {
        const a = s.transparent ? px[from + x + 3] : 255;
        const k = a > 0 && a < 255 ? 255 / a : 1;
        out[y * row + x] = Math.min(255, px[from + x] * k);
        out[y * row + x + 1] = Math.min(255, px[from + x + 1] * k);
        out[y * row + x + 2] = Math.min(255, px[from + x + 2] * k);
        out[y * row + x + 3] = a;
      }
    }
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d")!.putImageData(new ImageData(out, w, h), 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    const data = new Uint8Array(await blob.arrayBuffer());
    const req = nextReq++;
    await new Promise<void>(resolve => {
      writeAcks.set(req, () => (writeAcks.delete(req), resolve()));
      written = data.byteLength;
      post({ type: "write", req, position: 0, data }, [data.buffer]);
    });
  };

  const started = performance.now();
  try {
    for (let i = 0; i < frameCount; i++) {
      if (cancelled) throw new Error("cancelled");
      const t = still ? s.at : Math.round((i / fps) * 1e6);
      if (!still && i % Math.round(fps) === 0) await pumpAudio(t / 1e6 + 2);
      const scene = buildScene(project, t);
      const frames: VideoFrame[] = [];
      const layerFor = async (v: Visual): Promise<Layer | null> => {
        const base = layerFields(v.place);
        const ai = v.kind === "media" ? aiLayerFields(aiStore, project, v, t) : {};
        if (v.kind === "color") return { ...base, color: hex(v.item.color) };
        if (v.kind === "shape") {
          const k = s.width / project.settings.width;
          const r = rasterShape(v.item.shape, v.item.width, v.item.height, base.width * k, base.height * k);
          return { ...base, source: { key: v.item.id, pixels: r.canvas, version: r.key, width: r.canvas.width, height: r.canvas.height } };
        }
        if (v.kind === "text") {
          const userScale = v.place.width / project.settings.width;
          const r = rasterText(v.item.style, v.text, v.highlight, v.item.type === "caption" ? v.item.highlight : undefined, project.settings.width * 0.86, (s.width / project.settings.width) * userScale * v.place.animScale);
          return { ...base, width: r.width * userScale * v.place.animScale, height: r.height * userScale * v.place.animScale, source: { key: v.item.id, pixels: r.canvas, version: r.key, width: r.canvas.width, height: r.canvas.height } };
        }
        if (v.media.kind === "image") {
          let bmp = images.get(v.media.id);
          if (!bmp) {
            bmp = await createImageBitmap(await (await fetch(urls[v.media.id])).blob(), { imageOrientation: "from-image" });
            images.set(v.media.id, bmp);
          }
          return { ...base, ...ai, source: { key: "img:" + v.media.id, pixels: bmp, version: 1, width: bmp.width, height: bmp.height } };
        }
        let reader = readers.get(v.item.id);
        if (!reader) {
          const track = await trackOf(v.media);
          if (!track) return null;
          reader = new SequentialReader(track);
          readers.set(v.item.id, reader);
        }
        const sample = await reader.frameAt(v.sourceTime / 1e6);
        if (!sample) return null;
        const f = sample.toVideoFrame();
        frames.push(f);
        const big = v.item.enhance?.upscale ? await upscaled(v.item.id, sample.timestamp, f) : null;
        const layer: Layer = big
          ? { ...base, ...ai, source: { key: v.item.id, pixels: big, version: `${t}u`, width: big.width, height: big.height, rotation: sample.rotation } }
          : { ...base, ...ai, source: { key: v.item.id, pixels: f, version: t, width: f.codedWidth, height: f.codedHeight, rotation: sample.rotation } };
        const plan = temporalPlan(v.item, v.media);
        if (plan) {
          const key = v.item.id + "#n";
          let ahead = readers.get(key);
          if (!ahead) {
            const track = await trackOf(v.media);
            if (track) readers.set(key, (ahead = new SequentialReader(track)));
          }
          const seconds = v.sourceTime / 1e6;
          const other = await ahead?.frameAt(nextFrameTime(v.media, seconds));
          if (other && other.timestamp > sample.timestamp) {
            const g = other.toVideoFrame();
            frames.push(g);
            const bigNext = v.item.enhance?.upscale ? await upscaled(key, other.timestamp, g) : null;
            layer.temporal = temporalLayer(plan, sample, other, seconds, bigNext ? { key, pixels: bigNext, version: `${t}u`, width: bigNext.width, height: bigNext.height, rotation: other.rotation } : { key, pixels: g, version: t, width: g.codedWidth, height: g.codedHeight, rotation: other.rotation });
          }
        }
        return layer;
      };

      const nodes: Node[] = [];
      for (const n of scene) {
        if (n.kind === "visual") {
          const l = await layerFor(n.visual);
          if (l) nodes.push({ kind: "layer", layer: l });
        } else {
          const [a, b] = await Promise.all([layerFor(n.a), layerFor(n.b)]);
          if (a && b) nodes.push({ kind: "transition", a: [a], b: [b], transition: n.transition, progress: n.progress });
          else if (a || b) nodes.push({ kind: "layer", layer: (a ?? b)! });
        }
      }
      compositor.render(nodes, hex(project.settings.background));
      if (video) {
        for (const f of frames) f.close();
        await video.add(i / fps, 1 / fps);
      } else {
        const px = new Uint8Array(s.width * s.height * 4);
        compositor.readRaw(s.transparent, px);
        for (const f of frames) f.close();
        if (still) await writeStill(px);
        else {
          // One frame may be in flight while the next renders; more would pile up memory.
          await inFlight;
          const req = nextReq++;
          inFlight = new Promise<void>(resolve => writeAcks.set(req, () => (writeAcks.delete(req), resolve())));
          post({ type: "frame", req, data: px }, [px.buffer]);
        }
      }

      if (i % 5 === 0 || i === frameCount - 1) {
        const elapsed = (performance.now() - started) / 1000;
        post({ type: "progress", frame: i + 1, frames: frameCount, elapsed, bytes: written });
      }
    }
    await inFlight;
    await pumpAudio(Infinity);
    await output?.finalize();
    post({ type: "done", bytes: written, seconds: (performance.now() - started) / 1000 });
  } catch (err) {
    await output?.cancel().catch(() => {});
    if (cancelled) post({ type: "cancelled" });
    else throw err;
  } finally {
    for (const r of readers.values()) r.dispose();
    for (const b of images.values()) b.close();
    compositor.dispose();
  }
}

/** Pictures already run through the upscaler, so a frame shown for several output frames is only enhanced once. */
const enlarged = new Map<string, OffscreenCanvas>();
const LARGEST_SOURCE = 960;

/** Four times larger with the on device model. Sources that are already big are left alone. */
async function upscaled(owner: string, timestamp: number, frame: VideoFrame): Promise<OffscreenCanvas | null> {
  if (Math.max(frame.codedWidth, frame.codedHeight) > LARGEST_SOURCE) return null;
  const key = `${owner}@${timestamp}`;
  const hit = enlarged.get(key);
  if (hit) return hit;
  const { upscale } = await import("./ai/superres");
  const small = new OffscreenCanvas(frame.codedWidth, frame.codedHeight);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0);
  const px = ctx.getImageData(0, 0, small.width, small.height);
  const out = await upscale({ width: px.width, height: px.height, data: px.data }, undefined, () => cancelled);
  const canvas = new OffscreenCanvas(out.width, out.height);
  canvas.getContext("2d")!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  enlarged.set(key, canvas);
  while (enlarged.size > 4) enlarged.delete(enlarged.keys().next().value!);
  return canvas;
}

function hex(h: string): [number, number, number] {
  if (!/^#?[0-9a-f]{6}/i.test(h)) return [0, 0, 0];
  const n = parseInt(h.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
