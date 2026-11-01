// The models the AI visual features use, and how they get onto this computer. Each is a
// single ONNX file fetched once from Hugging Face and kept in the browser cache; after that
// nothing leaves the machine. Only models whose licence allows free redistribution in a
// GPL app are listed.

export interface ModelSpec {
  id: string;
  name: string;
  url: string;
  bytes: number;
  licence: string;
  note: string;
}

export const MODELS = {
  matting: {
    id: "rvm-mobilenetv3",
    name: "Robust Video Matting, MobileNetV3",
    url: "https://huggingface.co/LPDoctor/video_matting/resolve/main/rvm_mobilenetv3_fp32.onnx",
    bytes: 14_975_696,
    licence: "GPL 3.0",
    note: "Peter Lin and others, ONNX export of the official weights.",
  },
  detector: {
    id: "yolos-tiny",
    name: "YOLOS tiny",
    url: "https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model.onnx",
    bytes: 26_227_993,
    licence: "Apache 2.0",
    note: "Hustvl, ONNX export by Xenova. Used to find people.",
  },
  superres: {
    id: "realesr-general-x4v3",
    name: "Real ESRGAN general x4 v3",
    url: "https://huggingface.co/tamnvcc/Real-ESRGAN-General-x4v3_float/resolve/main/onnx/model.onnx",
    bytes: 4_876_654,
    licence: "BSD 3 clause",
    note: "Xintao Wang, the compact general purpose network.",
  },
} as const satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

const CACHE = "openroll-models";

/** Bytes of a model, from the browser cache when it was fetched before. */
export async function modelBytes(spec: ModelSpec, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(spec.url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(spec.url);
  if (!res.ok || !res.body) throw new Error(`Could not download ${spec.name} (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || spec.bytes;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parts.push(r.value);
    done += r.value.byteLength;
    onProgress?.(done, total);
  }
  const bytes = new Uint8Array(done);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  await cache?.put(spec.url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

type Ort = typeof import("onnxruntime-web");
let ortPromise: Promise<Ort> | null = null;

/**
 * The ONNX runtime, on WASM with one thread. Several threads in one worker crashed the
 * renderer in Electron 45, and these networks are small enough that one is fast.
 */
export function loadOrt(): Promise<Ort> {
  ortPromise ??= import("onnxruntime-web").then(ort => {
    ort.env.wasm.wasmPaths = {
      mjs: new URL("../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
      wasm: new URL("../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
    };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    return ort;
  });
  return ortPromise;
}

const sessions = new Map<string, Promise<import("onnxruntime-web").InferenceSession>>();

export async function session(key: ModelKey, onProgress?: (done: number, total: number) => void) {
  let s = sessions.get(key);
  if (!s) {
    s = (async () => {
      const [ort, bytes] = await Promise.all([loadOrt(), modelBytes(MODELS[key], onProgress)]);
      return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    })();
    sessions.set(key, s);
    s.catch(() => sessions.delete(key));
  }
  return s;
}

export function dropSession(key: ModelKey): void {
  const s = sessions.get(key);
  sessions.delete(key);
  void s?.then(x => x.release()).catch(() => {});
}
