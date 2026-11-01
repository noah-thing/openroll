/// <reference lib="webworker" />
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
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
import type { MediaRef, Project } from "../core/project";
import { projectDuration } from "../core/project";
import type { ExportIn, ExportOut, ExportSettings } from "./export-protocol";

declare const self: DedicatedWorkerGlobalScope;

let cancelled = false;
const writeAcks = new Map<number, () => void>();
const audioWaiters = new Map<number, (chunk: { planes: Float32Array[]; frames: number } | null) => void>();
let nextReq = 1;

const post = (m: ExportOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ExportIn>) => {
  const m = e.data;
  if (m.type === "start") void run(m.project, m.urls, m.settings).catch(err => post({ type: "error", message: (err as Error).message }));
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

  constructor(track: InputVideoTrack) {
    this.sink = new VideoSampleSink(track, { hardwareAcceleration: "prefer-hardware" });
  }

  async frameAt(t: number): Promise<VideoSample | null> {
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
    void this.iter?.return(undefined);
  }
}

async function run(project: Project, urls: Record<string, string>, s: ExportSettings): Promise<void> {
  cancelled = false;
  await loadFonts(self.fonts);
  const duration = projectDuration(project);
  const fps = s.fps;
  const frameCount = Math.max(1, Math.ceil((duration / 1e6) * fps));
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

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
  });
  const video = new CanvasSource(canvas, {
    codec: s.codec,
    bitrate: s.bitrate,
    keyFrameInterval: 2,
    latencyMode: "quality",
    hardwareAcceleration: s.hardware ? "prefer-hardware" : "prefer-software",
  });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = s.audio ? new AudioSampleSource({ codec: "aac", bitrate: 192_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

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

  const started = performance.now();
  try {
    for (let i = 0; i < frameCount; i++) {
      if (cancelled) throw new Error("cancelled");
      const t = Math.round((i / fps) * 1e6);
      if (i % Math.round(fps) === 0) await pumpAudio(t / 1e6 + 2);
      const scene = buildScene(project, t);
      const frames: VideoFrame[] = [];
      const layerFor = async (v: Visual): Promise<Layer | null> => {
        const base = layerFields(v.place);
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
          return { ...base, source: { key: "img:" + v.media.id, pixels: bmp, version: 1, width: bmp.width, height: bmp.height } };
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
        return { ...base, source: { key: v.item.id, pixels: f, version: t, width: f.codedWidth, height: f.codedHeight, rotation: sample.rotation } };
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
      for (const f of frames) f.close();
      await video.add(i / fps, 1 / fps);

      if (i % 5 === 0 || i === frameCount - 1) {
        const elapsed = (performance.now() - started) / 1000;
        post({ type: "progress", frame: i + 1, frames: frameCount, elapsed, bytes: written });
      }
    }
    await pumpAudio(Infinity);
    await output.finalize();
    post({ type: "done", bytes: written, seconds: (performance.now() - started) / 1000 });
  } catch (err) {
    await output.cancel().catch(() => {});
    if (cancelled) post({ type: "cancelled" });
    else throw err;
  } finally {
    for (const r of readers.values()) r.dispose();
    for (const b of images.values()) b.close();
    compositor.dispose();
  }
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
