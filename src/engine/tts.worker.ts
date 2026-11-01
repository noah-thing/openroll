/// <reference lib="webworker" />
// Local text to speech with Kokoro (Apache 2.0). The model is fetched from Hugging Face
// the first time it is needed and kept by the browser cache after that.

import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import wasmUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import loaderUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import type { TtsIn, TtsOut } from "./tts-protocol";

declare const self: DedicatedWorkerGlobalScope;

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

env.backends.onnx.wasm!.wasmPaths = { mjs: new URL(loaderUrl, self.location.href).href, wasm: new URL(wasmUrl, self.location.href).href };
env.backends.onnx.wasm!.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1));

let model: Promise<KokoroTTS> | null = null;
let current = 0;

function post(m: TtsOut, transfer: Transferable[] = []): void {
  self.postMessage(m, transfer);
}

function load(): Promise<KokoroTTS> {
  model ??= KokoroTTS.from_pretrained(MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      sizes.set(p.file, [p.loaded ?? 0, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of sizes.values()) {
        loaded += l;
        total += t;
      }
      post({ type: "progress", id: current, stage: "download", fraction: total ? loaded / total : 0 });
    },
  }).catch(err => {
    model = null;
    throw err;
  });
  return model;
}

const sizes = new Map<string, [number, number]>();

/** Kokoro reads a few hundred characters at a time, so cut on sentence ends. */
function sentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const out: string[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.length + part.length < 200) out[out.length - 1] = last + part;
    else out.push(part);
  }
  return out;
}

self.onmessage = async (e: MessageEvent<TtsIn>) => {
  const m = e.data;
  current = m.id;
  try {
    const tts = await load();
    const chunks = sentences(m.text);
    const rendered: Float32Array[] = [];
    let rate = 24_000;
    for (let i = 0; i < chunks.length; i++) {
      post({ type: "progress", id: m.id, stage: "speak", fraction: i / chunks.length });
      const out = await tts.generate(chunks[i], { voice: m.voice as never });
      rate = out.sampling_rate;
      rendered.push(out.audio);
    }
    const gap = Math.round(rate * 0.12);
    const total = rendered.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, rendered.length - 1);
    const samples = new Float32Array(total);
    let at = 0;
    for (const c of rendered) {
      samples.set(c, at);
      at += c.length + gap;
    }
    post({ type: "done", id: m.id, samples, rate }, [samples.buffer]);
  } catch (err) {
    post({ type: "error", id: m.id, message: (err as Error).message });
  }
};
