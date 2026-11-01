import type { SpeechDevice, SpeechEvent, SpeechModel, SpokenWord } from "../../engine/speech-protocol";

export interface SpeechRun {
  url: string;
  from: number;
  to: number;
  model: SpeechModel;
  language: string | null;
  device?: SpeechDevice;
}

export interface SpeechResult {
  words: SpokenWord[];
  language: string | null;
  device: "webgpu" | "wasm";
  audioSeconds: number;
  timings: { modelMs: number; decodeMs: number; listenMs: number };
}

export class SpeechCancelled extends Error {}

type Progress = Extract<SpeechEvent, { kind: "progress" }>;

/**
 * One worker that holds the speech model. It is created on first use and dropped after a
 * quiet minute, because the model takes a few hundred megabytes of memory.
 */
export class SpeechClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private idleTimer = 0;
  private current: { id: number; listener(e: SpeechEvent): void } | null = null;

  run(job: SpeechRun, onProgress: (p: Progress) => void): { result: Promise<SpeechResult>; cancel(): void } {
    clearTimeout(this.idleTimer);
    const worker = this.ensure();
    const id = this.nextId++;
    const result = new Promise<SpeechResult>((resolve, reject) => {
      this.current = {
        id,
        listener: e => {
          if (e.kind === "progress") onProgress(e);
          else {
            this.current = null;
            this.idleTimer = window.setTimeout(() => this.dispose(), 60_000);
            if (e.kind === "done") resolve(e);
            else if (e.kind === "cancelled") reject(new SpeechCancelled());
            else reject(new Error(e.message));
          }
        },
      };
      worker.postMessage({ kind: "run", id, device: "auto", ...job });
    });
    return { result, cancel: () => this.worker?.postMessage({ kind: "cancel", id }) };
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("../../engine/speech.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SpeechEvent>) => {
      if (this.current && e.data.id === this.current.id) this.current.listener(e.data);
    };
    w.onerror = e => {
      const c = this.current;
      this.current = null;
      this.worker = null;
      w.terminate();
      c?.listener({ id: c.id, kind: "error", message: e.message || "The speech engine stopped unexpectedly." });
    };
    this.worker = w;
    return w;
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
  }
}
