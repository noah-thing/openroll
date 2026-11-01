/// <reference lib="webworker" />
// Speech to text with word timing, on this computer. Whisper runs through transformers.js,
// on WASM, or WebGPU when asked for. The model is fetched once from
// Hugging Face and kept in the browser cache; after that nothing leaves the machine.
//
// A long clip is cut into pieces of under 30 seconds at its quietest moments. That gives
// real progress and a prompt cancel, and Whisper never sees a stretch of silence long
// enough to make something up.

import { env, pipeline, Tensor } from "@huggingface/transformers";
import { ALL_FORMATS, AudioSampleSink, Input, UrlSource } from "mediabunny";
import { SPEECH_MODELS, type SpeechDevice, type SpeechEvent, type SpeechModel, type SpeechRequest, type SpokenWord } from "./speech-protocol";

declare const self: DedicatedWorkerGlobalScope;

// The runtime ships with the app, so the first run only has to fetch the model.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
  wasm: new URL("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
};
env.backends.onnx.wasm!.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency ?? 4) - 1));
env.allowLocalModels = false;
env.useBrowserCache = true;
// The app scheme cannot be put in the Cache API, and the runtime is local anyway.
env.useWasmCache = false;

const RATE = 16_000;
const FRAME = 320; // 20 ms
const FRAMES_PER_SECOND = RATE / FRAME;
const MAX_PIECE = 28 * RATE;
const MIN_CUT_SEARCH = 16 * RATE;

type Recogniser = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

interface Whisper {
  (audio: Float32Array, options: Record<string, unknown>): ReturnType<Recogniser>;
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>) & { generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> } };
}

let loaded: { key: string; run: Whisper; device: "webgpu" | "wasm" } | null = null;
const cancelled = new Set<number>();

self.onmessage = (e: MessageEvent<SpeechRequest>) => {
  const req = e.data;
  if (req.kind === "cancel") cancelled.add(req.id);
  else void job(req);
};

function post(ev: SpeechEvent): void {
  self.postMessage(ev);
}

class Cancelled extends Error {}

async function job(req: Extract<SpeechRequest, { kind: "run" }>): Promise<void> {
  const check = () => {
    if (cancelled.has(req.id)) throw new Cancelled();
  };
  try {
    const t0 = performance.now();
    const model = await loadModel(req, req.model, req.device);
    check();
    const t1 = performance.now();

    const pcm = await decode(req, check);
    const t2 = performance.now();

    const { words, language } = await listen(req, model, pcm, check);
    post({
      id: req.id,
      kind: "done",
      words,
      language,
      device: model.device,
      audioSeconds: pcm.length / RATE,
      timings: { modelMs: t1 - t0, decodeMs: t2 - t1, listenMs: performance.now() - t2 },
    });
  } catch (err) {
    if (err instanceof Cancelled) post({ id: req.id, kind: "cancelled" });
    else post({ id: req.id, kind: "error", message: (err as Error).message ?? String(err) });
  } finally {
    cancelled.delete(req.id);
  }
}

// ---------------------------------------------------------------- model

async function loadModel(req: { id: number }, model: SpeechModel, wanted: SpeechDevice) {
  // WebGPU measured the same speed as WASM with the base model (7.7 against 7.1 times real time on ten
  // minutes) and took the renderer down with the small one, so it is opt in.
  const device: "webgpu" | "wasm" = wanted === "webgpu" ? "webgpu" : "wasm";
  const key = `${model}:${device}`;
  if (loaded?.key === key) return loaded;
  loaded = null;

  // Progress events also fire when files come out of the cache; only say "downloading" when they do not.
  const fresh = !(await caches
    .open("transformers-cache")
    .then(c => c.keys())
    .then(keys => keys.some(r => r.url.includes(SPEECH_MODELS[model].repo) && r.url.endsWith(".onnx")))
    .catch(() => false));
  const files = new Map<string, { loaded: number; total: number }>();
  let best = 0;
  let downloading = false;
  const onProgress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (!p.file) return;
    if (p.status === "progress" && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      if (fresh && p.total > 2_000_000 && (p.loaded ?? 0) < p.total) downloading = true;
    } else if (p.status === "done") {
      const f = files.get(p.file);
      if (f) f.loaded = f.total;
    }
    let l = 0, t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    best = Math.max(best, t ? l / t : 0);
    post({ id: req.id, kind: "progress", stage: "model", fraction: best, downloading });
  };

  const repo = SPEECH_MODELS[model].repo;
  const build = async (d: "webgpu" | "wasm") => {
    // The encoder is the part that suffers from low precision on GPU, so it stays full size there.
    const dtype = d === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
    return (await pipeline("automatic-speech-recognition", repo, { device: d, dtype, progress_callback: onProgress } as never)) as unknown as Whisper;
  };

  let run: Whisper;
  let used = device;
  try {
    run = await build(device);
  } catch (err) {
    if (device === "wasm") throw err;
    // WebGPU can fail on drivers that report an adapter and then cannot run the graph.
    used = "wasm";
    run = await build("wasm");
  }
  loaded = { key: `${model}:${used}`, run, device: used };
  return loaded;
}

// ---------------------------------------------------------------- audio

/** Decode the range to mono 16 kHz. Workers have no AudioBuffer, so planes are read directly. */
async function decode(req: Extract<SpeechRequest, { kind: "run" }>, check: () => void): Promise<Float32Array> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(req.url) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("This clip has no sound to listen to.");
    const total = Math.max(1, Math.round((req.to - req.from) * RATE));
    const sum = new Float32Array(total);
    const count = new Uint16Array(total);
    const sink = new AudioSampleSink(track);
    let plane = new Float32Array(0);
    let mono = new Float32Array(0);
    let lastPost = 0;
    for await (const sample of sink.samples(req.from, req.to)) {
      check();
      const n = sample.numberOfFrames;
      if (plane.length < n) {
        plane = new Float32Array(n);
        mono = new Float32Array(n);
      }
      mono.fill(0, 0, n);
      const channels = sample.numberOfChannels;
      for (let c = 0; c < channels; c++) {
        sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        for (let i = 0; i < n; i++) mono[i] += plane[i];
      }
      const first = Math.round((sample.timestamp - req.from) * sample.sampleRate);
      const step = RATE / sample.sampleRate;
      // Averaging the input frames that land on each output frame is a box filter: crude, but plenty for speech.
      for (let i = 0; i < n; i++) {
        const k = Math.floor((first + i) * step);
        if (k < 0 || k >= total) continue;
        sum[k] += mono[i] / channels;
        count[k]++;
      }
      const rate = sample.sampleRate;
      sample.close();
      const now = performance.now();
      if (now - lastPost > 200) {
        lastPost = now;
        post({ id: req.id, kind: "progress", stage: "decode", fraction: Math.min(1, (first / rate) / (req.to - req.from)) });
      }
    }
    for (let k = 0; k < total; k++) if (count[k]) sum[k] /= count[k];
    return sum;
  } finally {
    input.dispose();
  }
}

// ---------------------------------------------------------------- listening

function frameLevels(pcm: Float32Array): Float32Array {
  const frames = Math.ceil(pcm.length / FRAME);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const end = Math.min(pcm.length, (f + 1) * FRAME);
    for (let i = f * FRAME; i < end; i++) e += pcm[i] * pcm[i];
    out[f] = Math.sqrt(e / Math.max(1, end - f * FRAME));
  }
  return out;
}

function percentile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

/** Pieces of at most MAX_PIECE samples, cut where the level is lowest near the limit. */
function planPieces(levels: Float32Array, samples: number): [number, number][] {
  const pieces: [number, number][] = [];
  let start = 0;
  while (start < samples) {
    let end = Math.min(samples, start + MAX_PIECE);
    if (end < samples) {
      let best = Infinity;
      let at = end;
      for (let s = start + MIN_CUT_SEARCH; s < end; s += FRAME) {
        const f = Math.floor(s / FRAME);
        const level = Math.max(levels[f - 1] ?? 0, levels[f] ?? 0, levels[f + 1] ?? 0);
        if (level < best) {
          best = level;
          at = s;
        }
      }
      end = at;
    }
    pieces.push([start, end]);
    start = end;
  }
  return pieces;
}

async function listen(req: Extract<SpeechRequest, { kind: "run" }>, model: NonNullable<typeof loaded>, pcm: Float32Array, check: () => void): Promise<{ words: SpokenWord[]; language: string | null }> {
  const levels = frameLevels(pcm);
  // Where speech sits relative to this recording's own floor and loudness.
  const threshold = Math.max(0.004, percentile(levels, 0.95) * 0.06, percentile(levels, 0.1) * 3);
  const active = (f: number) => Math.max(levels[f - 1] ?? 0, levels[f] ?? 0, levels[f + 1] ?? 0) >= threshold;

  const pieces = planPieces(levels, pcm.length);
  const words: SpokenWord[] = [];
  let language = req.language;
  let heard = 0;
  for (const [a, b] of pieces) {
    check();
    // Trim silence off both ends so the model starts on speech.
    let f0 = Math.floor(a / FRAME), f1 = Math.ceil(b / FRAME) - 1;
    while (f0 <= f1 && !active(f0)) f0++;
    while (f1 >= f0 && !active(f1)) f1--;
    const speechFrames = countActive(f0, f1, active);
    if (f1 < f0 || speechFrames < 5) {
      heard += b - a;
      post({ id: req.id, kind: "progress", stage: "listen", fraction: heard / pcm.length });
      continue;
    }
    const pad = 10;
    const s0 = Math.max(a, (f0 - pad) * FRAME);
    const s1 = Math.min(b, (f1 + 1 + pad) * FRAME);
    const offset = s0 / RATE;

    const audio = pcm.subarray(s0, s1);
    // Whisper would quietly assume English, so the language is read off the first stretch of speech.
    language ??= await detectLanguage(model.run, audio);
    const out = await model.run(audio, {
      language: language ?? undefined,
      task: "transcribe",
      return_timestamps: "word",
    });
    for (const c of out.chunks ?? []) {
      const text = c.text.trim();
      if (!text) continue;
      words.push({ text, start: offset + c.timestamp[0], end: offset + (c.timestamp[1] ?? c.timestamp[0] + 0.3) });
    }
    heard += b - a;
    post({ id: req.id, kind: "progress", stage: "listen", fraction: heard / pcm.length });
  }
  return { words: refine(words, active, pcm.length / RATE).map(w => ({ ...w, start: w.start + req.from, end: w.end + req.from })), language };
}

/** One step of the decoder, reading which language token the model finds most likely. */
async function detectLanguage(whisper: Whisper, audio: Float32Array): Promise<string | null> {
  try {
    const { input_features } = await whisper.processor(audio.subarray(0, 30 * RATE));
    const config = whisper.model.generation_config;
    const start = new Tensor("int64", BigInt64Array.of(BigInt(config.decoder_start_token_id)), [1, 1]);
    const { logits } = await whisper.model({ input_features, decoder_input_ids: start });
    let best = -Infinity;
    let token = "";
    for (const [name, id] of Object.entries(config.lang_to_id)) {
      if (logits.data[id] > best) {
        best = logits.data[id];
        token = name;
      }
    }
    return /^<\|(\w+)\|>$/.exec(token)?.[1] ?? null;
  } catch {
    return null;
  }
}

function countActive(a: number, b: number, active: (f: number) => boolean): number {
  let n = 0;
  for (let f = a; f <= b; f++) if (active(f)) n++;
  return n;
}

/**
 * Whisper's word ends run on into the next word, which hides every pause. Snap each word
 * to the sound that is actually there, and drop words sitting on silence, which is what
 * the model does when it hallucinates.
 */
function refine(words: SpokenWord[], active: (f: number) => boolean, length: number): SpokenWord[] {
  const out: SpokenWord[] = [];
  let floor = 0;
  for (const w of words) {
    const start = Math.max(floor, Math.min(length, w.start));
    const end = Math.max(start, Math.min(length, w.end));
    const f0 = Math.floor(start * FRAMES_PER_SECOND);
    const f1 = Math.max(f0, Math.ceil(end * FRAMES_PER_SECOND) - 1);
    let first = -1, last = -1;
    for (let f = f0; f <= f1; f++)
      if (active(f)) {
        if (first < 0) first = f;
        last = f;
      }
    if (first < 0) {
      if (f1 - f0 >= 2) continue;
      out.push({ ...w, start, end: Math.max(end, start + 0.05) });
    } else {
      const s = Math.max(start, first / FRAMES_PER_SECOND - 0.02);
      const e = Math.min(Math.max(end, s + 0.05), (last + 1) / FRAMES_PER_SECOND + 0.04);
      out.push({ ...w, start: s, end: Math.max(e, s + 0.05) });
    }
    floor = out[out.length - 1].end;
  }
  return out;
}
