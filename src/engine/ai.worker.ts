/// <reference lib="webworker" />
// Analysis for the AI visual features, off the render path: background mattes, camera
// motion, and where the people are. Frames are read the same way the exporter reads them,
// shrunk, and handed to a small model or a pure function. One job runs at a time so the
// machine stays responsive; every job reports progress and stops promptly when cancelled.

import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type InputVideoTrack } from "mediabunny";
import type { SubjectSample } from "../core/ai";
import { dropSession, MODELS, session } from "./ai/models";
import { estimateMotion, pyramid, toGrey } from "./ai/motion";
import { MATTE_QUALITY, type AiEvent, type AiRequest } from "./ai/protocol";
import { upscale } from "./ai/superres";

declare const self: DedicatedWorkerGlobalScope;

type Job = Exclude<AiRequest, { kind: "cancel" }>;

const queue: Job[] = [];
const cancelled = new Set<number>();
let busy = false;
let idleTimer = 0;

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  if (req.kind === "cancel") {
    cancelled.add(req.id);
    return;
  }
  queue.push(req);
  void drain();
};

const post = (ev: AiEvent, transfer: Transferable[] = []) => self.postMessage(ev, transfer);

class Cancelled extends Error {}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  clearTimeout(idleTimer);
  while (queue.length) {
    const job = queue.shift()!;
    if (cancelled.has(job.id)) {
      post({ id: job.id, type: "cancelled" });
      continue;
    }
    try {
      const check = () => {
        if (cancelled.has(job.id)) throw new Cancelled();
      };
      if (job.kind === "matte") await runMatte(job, check);
      else if (job.kind === "stabilize") await runStabilize(job, check);
      else if (job.kind === "subject") await runSubject(job, check);
      else await runEnhance(job, check);
    } catch (err) {
      if (err instanceof Cancelled || (err as Error).message === "cancelled") post({ id: job.id, type: "cancelled" });
      else post({ id: job.id, type: "error", message: (err as Error).message });
    }
  }
  busy = false;
  // models hold tens of megabytes; let them go after a quiet while
  idleTimer = self.setTimeout(() => (["matting", "detector", "superres"] as const).forEach(dropSession), 90_000);
}

// ---------------------------------------------------------------- frames

interface Source {
  input: Input;
  track: InputVideoTrack;
  sink: VideoSampleSink;
  /** Degrees clockwise from stored to upright. */
  rotation: number;
  /** Stored size. */
  width: number;
  height: number;
}

async function open(url: string, still = false): Promise<Source> {
  if (still) {
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { imageOrientation: "from-image" });
    const once = {
      async *samplesAtTimestamps(stamps: number[]) {
        for (let i = 0; i < stamps.length; i++) yield { toVideoFrame: () => new VideoFrame(bmp, { timestamp: 0 }), close() {} };
      },
    };
    return { input: { dispose: () => bmp.close() } as unknown as Input, track: null as unknown as InputVideoTrack, sink: once as unknown as VideoSampleSink, rotation: 0, width: bmp.width, height: bmp.height };
  }
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error("This file has no picture to analyse.");
  }
  return { input, track, sink: new VideoSampleSink(track), rotation: track.rotation, width: track.codedWidth, height: track.codedHeight };
}

function times(from: number, to: number, fps: number): number[] {
  const n = Math.max(1, Math.ceil((to - from) * fps));
  return Array.from({ length: n }, (_, i) => from + i / fps);
}

function swaps(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

/** Draw a stored frame upright into a canvas of the given upright size. */
function drawUpright(ctx: OffscreenCanvasRenderingContext2D, frame: VideoFrame, rotation: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const dw = swaps(rotation) ? h : w, dh = swaps(rotation) ? w : h;
  ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/** Draw an upright picture back into stored orientation. */
function drawStored(ctx: OffscreenCanvasRenderingContext2D, img: OffscreenCanvas, rotation: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-rotation * Math.PI) / 180);
  const dw = swaps(rotation) ? h : w, dh = swaps(rotation) ? w : h;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

const round = (v: number, to: number) => Math.max(to, Math.round(v / to) * to);

// ---------------------------------------------------------------- matte

const STORE_SIDE = 384;

async function runMatte(req: Extract<Job, { kind: "matte" }>, check: () => void): Promise<void> {
  const t0 = performance.now();
  const q = MATTE_QUALITY[req.quality];
  post({ id: req.id, type: "progress", stage: "model", done: 0, total: 1, label: MODELS.matting.name });
  const [ort, net] = await Promise.all([
    import("onnxruntime-web"),
    session("matting", (done, total) => post({ id: req.id, type: "progress", stage: "model", done, total, label: MODELS.matting.name })),
  ]);
  check();
  const src = await open(req.url, req.still);
  try {
    const upright = swaps(src.rotation) ? { w: src.height, h: src.width } : { w: src.width, h: src.height };
    const k = q.input / Math.max(upright.w, upright.h);
    const iw = round(upright.w * k, 32), ih = round(upright.h * k, 32);
    // stored size: long side STORE_SIDE, in stored orientation
    const ks = Math.min(1, STORE_SIDE / Math.max(src.width, src.height));
    const sw = Math.max(2, Math.round(src.width * ks)), sh = Math.max(2, Math.round(src.height * ks));
    const fps = req.fps;
    const stamps = req.still ? [0] : times(req.from, req.to, fps);
    post({ id: req.id, type: "matte-info", track: { width: sw, height: sh, fps, start: req.from, count: stamps.length, ready: 0 } });

    const input = new OffscreenCanvas(iw, ih);
    const inCtx = input.getContext("2d", { willReadFrequently: true })!;
    const alpha = new OffscreenCanvas(iw, ih);
    const alphaCtx = alpha.getContext("2d")!;
    const grey = new ImageData(iw, ih);
    const store = new OffscreenCanvas(sw, sh);
    const storeCtx = store.getContext("2d", { willReadFrequently: true })!;
    storeCtx.imageSmoothingQuality = "high";

    const zero = () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
    let state: InstanceType<typeof ort.Tensor>[] = [zero(), zero(), zero(), zero()];
    const ratio = new ort.Tensor("float32", new Float32Array([q.ratio]), [1]);
    const planes = new Float32Array(3 * iw * ih);
    let chunk = new Uint8Array(0);
    let chunkFrom = 0;
    let last = new Uint8Array(sw * sh);
    let i = 0;
    let inferMs = 0;

    for await (const sample of src.sink.samplesAtTimestamps(stamps)) {
      check();
      let matte = last;
      if (sample) {
        const frame = sample.toVideoFrame();
        drawUpright(inCtx, frame, src.rotation, iw, ih);
        frame.close();
        sample.close();
        const px = inCtx.getImageData(0, 0, iw, ih).data;
        const n = iw * ih;
        for (let p = 0, o = 0; p < n; p++, o += 4) {
          planes[p] = px[o] / 255;
          planes[n + p] = px[o + 1] / 255;
          planes[2 * n + p] = px[o + 2] / 255;
        }
        const t1 = performance.now();
        // the model is recurrent: a lone picture needs a few passes before its answer settles
        for (let again = req.still ? 2 : 0; again > 0; again--) {
          const warm = await net.run({ src: new ort.Tensor("float32", planes, [1, 3, ih, iw]), r1i: state[0], r2i: state[1], r3i: state[2], r4i: state[3], downsample_ratio: ratio });
          state = [warm.r1o, warm.r2o, warm.r3o, warm.r4o];
        }
        const out = await net.run({ src: new ort.Tensor("float32", planes, [1, 3, ih, iw]), r1i: state[0], r2i: state[1], r3i: state[2], r4i: state[3], downsample_ratio: ratio });
        inferMs += performance.now() - t1;
        state = [out.r1o, out.r2o, out.r3o, out.r4o];
        const pha = out.pha.data as Float32Array;
        for (let p = 0, o = 0; p < n; p++, o += 4) {
          const v = Math.max(0, Math.min(255, pha[p] * 255));
          grey.data[o] = grey.data[o + 1] = grey.data[o + 2] = v;
          grey.data[o + 3] = 255;
        }
        alphaCtx.putImageData(grey, 0, 0);
        storeCtx.clearRect(0, 0, sw, sh);
        drawStored(storeCtx, alpha, src.rotation, sw, sh);
        const stored = storeCtx.getImageData(0, 0, sw, sh).data;
        matte = new Uint8Array(sw * sh);
        for (let p = 0; p < matte.length; p++) matte[p] = stored[p * 4];
        last = matte;
      }
      if (!chunk.length) chunkFrom = i;
      const grown = new Uint8Array(chunk.length + matte.length);
      grown.set(chunk);
      grown.set(matte, chunk.length);
      chunk = grown;
      i++;
      const framesInChunk = chunk.length / (sw * sh);
      if (framesInChunk >= 12 || i === stamps.length) {
        post({ id: req.id, type: "matte-part", from: chunkFrom, bytes: chunk }, [chunk.buffer]);
        chunk = new Uint8Array(0);
        post({ id: req.id, type: "progress", stage: "inference", done: i, total: stamps.length });
      }
    }
    post({ id: req.id, type: "done", seconds: (performance.now() - t0) / 1000, frames: i, backend: `wasm, ${(inferMs / Math.max(1, i)).toFixed(0)} ms per frame in the model` });
  } finally {
    src.input.dispose();
  }
}

// ---------------------------------------------------------------- stabilise

async function runStabilize(req: Extract<Job, { kind: "stabilize" }>, check: () => void): Promise<void> {
  const t0 = performance.now();
  const src = await open(req.url);
  try {
    const fps = req.fps;
    const stamps = times(req.from, req.to, fps);
    const w = 256, h = Math.max(32, Math.round((256 * src.height) / src.width));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const dx = new Float32Array(stamps.length), dy = new Float32Array(stamps.length), rot = new Float32Array(stamps.length);
    let previous: ReturnType<typeof pyramid> | null = null;
    let carry = { tx: 0, ty: 0, rot: 0, confidence: 0 };
    let i = 0;
    for await (const sample of src.sink.samplesAtTimestamps(stamps)) {
      check();
      if (sample) {
        const frame = sample.toVideoFrame();
        ctx.drawImage(frame, 0, 0, w, h);
        frame.close();
        sample.close();
        const grey = pyramid(toGrey(ctx.getImageData(0, 0, w, h).data, w, h), 3);
        if (previous) {
          const m = estimateMotion(previous, grey, carry);
          // a frame that does not agree with its neighbour (a cut, a flash) adds nothing rather than a jump
          const use = m.confidence > 0.08 ? m : { tx: 0, ty: 0, rot: 0, confidence: 0 };
          carry = { ...use, tx: use.tx * 0.5, ty: use.ty * 0.5, rot: use.rot * 0.5 };
          dx[i] = dx[i - 1] + use.tx / w;
          dy[i] = dy[i - 1] + use.ty / w;
          rot[i] = rot[i - 1] + use.rot;
        }
        previous = grey;
      } else if (i > 0) {
        dx[i] = dx[i - 1];
        dy[i] = dy[i - 1];
        rot[i] = rot[i - 1];
      }
      i++;
      if (i % 15 === 0) post({ id: req.id, type: "progress", stage: "frames", done: i, total: stamps.length });
    }
    const seconds = (performance.now() - t0) / 1000;
    post({ id: req.id, type: "camera", path: { fps, start: req.from, dx, dy, rot }, seconds });
    post({ id: req.id, type: "done", seconds, frames: i });
  } finally {
    src.input.dispose();
  }
}

// ---------------------------------------------------------------- people

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const PERSON = 1;
const DETECT_FPS = 5;

async function runSubject(req: Extract<Job, { kind: "subject" }>, check: () => void): Promise<void> {
  const t0 = performance.now();
  post({ id: req.id, type: "progress", stage: "model", done: 0, total: 1, label: MODELS.detector.name });
  const [ort, net] = await Promise.all([
    import("onnxruntime-web"),
    session("detector", (done, total) => post({ id: req.id, type: "progress", stage: "model", done, total, label: MODELS.detector.name })),
  ]);
  check();
  const src = await open(req.url);
  try {
    const upright = swaps(src.rotation) ? { w: src.height, h: src.width } : { w: src.width, h: src.height };
    const ih = 320, iw = Math.min(640, round((ih * upright.w) / upright.h, 16));
    const canvas = new OffscreenCanvas(iw, ih);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const planes = new Float32Array(3 * iw * ih);
    const stamps = times(req.from, req.to, DETECT_FPS);
    const found: SubjectSample[] = [];
    let seen = 0;
    let previous: SubjectSample | null = null;
    let i = 0;
    for await (const sample of src.sink.samplesAtTimestamps(stamps)) {
      check();
      const at = stamps[i++];
      if (sample) {
        const frame = sample.toVideoFrame();
        drawUpright(ctx, frame, src.rotation, iw, ih);
        frame.close();
        sample.close();
        const px = ctx.getImageData(0, 0, iw, ih).data;
        const n = iw * ih;
        for (let p = 0, o = 0; p < n; p++, o += 4) for (let c = 0; c < 3; c++) planes[c * n + p] = (px[o + c] / 255 - MEAN[c]) / STD[c];
        const out = await net.run({ pixel_values: new ort.Tensor("float32", planes, [1, 3, ih, iw]) });
        const people = findPeople(out.logits.data as Float32Array, out.pred_boxes.data as Float32Array, out.logits.dims[1], out.logits.dims[2]);
        const pick = chooseSubject(people, previous);
        if (pick) {
          seen++;
          previous = { t: at, x: pick.x, y: pick.y, h: pick.h };
        }
      }
      // a missed detection holds the last known place, so the camera does not lurch to the middle
      if (previous) found.push({ ...previous, t: at });
      if (i % 5 === 0) post({ id: req.id, type: "progress", stage: "inference", done: i, total: stamps.length });
    }
    post({ id: req.id, type: "subject", samples: found, found: seen, seconds: (performance.now() - t0) / 1000 });
    post({ id: req.id, type: "done", seconds: (performance.now() - t0) / 1000, frames: i });
  } finally {
    src.input.dispose();
  }
}

interface Person {
  x: number;
  y: number;
  w: number;
  h: number;
  p: number;
}

function findPeople(logits: Float32Array, boxes: Float32Array, queries: number, classes: number): Person[] {
  const out: Person[] = [];
  for (let q = 0; q < queries; q++) {
    const row = logits.subarray(q * classes, (q + 1) * classes);
    let max = -Infinity;
    for (const v of row) max = Math.max(max, v);
    let sum = 0;
    for (const v of row) sum += Math.exp(v - max);
    const p = Math.exp(row[PERSON] - max) / sum;
    if (p > 0.55) out.push({ x: boxes[q * 4], y: boxes[q * 4 + 1], w: boxes[q * 4 + 2], h: boxes[q * 4 + 3], p });
  }
  return out;
}

/** The biggest person, unless one near where the last subject was is almost as big. */
function chooseSubject(people: Person[], previous: SubjectSample | null): { x: number; y: number; h: number } | null {
  let best: Person | null = null;
  let bestScore = -Infinity;
  for (const p of people) {
    const near = previous ? 1 - Math.min(1, Math.hypot(p.x - previous.x, p.y - previous.y) * 2) : 0;
    const score = p.w * p.h * (1 + near) * p.p;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  // aim at the upper body, where faces are, rather than the middle of a long box
  return best ? { x: best.x, y: Math.max(0, best.y - best.h * 0.12), h: best.h } : null;
}

// ---------------------------------------------------------------- enhance one frame

async function runEnhance(req: Extract<Job, { kind: "enhance-frame" }>, check: () => void): Promise<void> {
  const t0 = performance.now();
  post({ id: req.id, type: "progress", stage: "model", done: 0, total: 1, label: MODELS.superres.name });
  await session("superres", (done, total) => post({ id: req.id, type: "progress", stage: "model", done, total, label: MODELS.superres.name }));
  check();
  const src = await open(req.url);
  try {
    const stream = src.sink.samplesAtTimestamps([req.at]);
    const first = await stream.next();
    const sample = first.value;
    if (!sample) throw new Error("There is no picture at this moment.");
    const frame = sample.toVideoFrame();
    // a window from the middle of the picture: enough to judge the result, quick enough to wait for
    const cw = Math.min(frame.codedWidth, 288), ch = Math.min(frame.codedHeight, 192);
    const sx = Math.round((frame.codedWidth - cw) / 2), sy = Math.round((frame.codedHeight - ch) / 2);
    const crop = new OffscreenCanvas(cw, ch);
    const cctx = crop.getContext("2d", { willReadFrequently: true })!;
    cctx.drawImage(frame, sx, sy, cw, ch, 0, 0, cw, ch);
    frame.close();
    sample.close();
    const pixels = cctx.getImageData(0, 0, cw, ch);
    const big = await upscale({ width: cw, height: ch, data: pixels.data }, (done, total) => post({ id: req.id, type: "progress", stage: "inference", done, total }), () => cancelled.has(req.id));
    check();
    const after = await createImageBitmap(new ImageData(big.data, big.width, big.height));
    // the plain way of making the picture larger, for the other half of the split
    const plain = new OffscreenCanvas(big.width, big.height);
    const pctx = plain.getContext("2d")!;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(crop, 0, 0, big.width, big.height);
    const before = await createImageBitmap(plain);
    post({ id: req.id, type: "enhanced", before, after, seconds: (performance.now() - t0) / 1000 }, [before, after]);
    post({ id: req.id, type: "done", seconds: (performance.now() - t0) / 1000, frames: 1 });
  } finally {
    src.input.dispose();
  }
}
