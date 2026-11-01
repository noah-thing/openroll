// Audio worklet processors that Web Audio has no built in node for: RNNoise noise
// suppression and a granular pitch shifter. The same module is loaded by the live
// AudioContext and by every OfflineAudioContext the exporter creates.

import "./env-shim";
import createRnnoise from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void;

const FRAME = 480;
/** RNNoise takes 16 bit range floats. */
const SCALE = 32768;

type Rnnoise = ReturnType<typeof createRnnoise>;
let wasm: Rnnoise | null = null;

class Lane {
  private state: number;
  private buf: number;
  private inFrame = new Float32Array(FRAME);
  private filled = 0;
  private wet = new Float32Array(FRAME * 4);
  private dry = new Float32Array(FRAME * 4);
  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(private m: Rnnoise) {
    this.state = m._rnnoise_create();
    this.buf = m._malloc(FRAME * 4);
    // One frame of silence in front keeps output ahead of input; dry gets the same delay.
    this.size = FRAME;
    this.tail = FRAME;
  }

  run(input: Float32Array, output: Float32Array, amount: number): void {
    for (let i = 0; i < input.length; i++) {
      this.inFrame[this.filled++] = input[i];
      if (this.filled === FRAME) this.flush();
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.size > 0 ? this.dry[this.head] * (1 - amount) + this.wet[this.head] * amount : 0;
      if (this.size > 0) {
        this.head = (this.head + 1) % this.wet.length;
        this.size--;
      }
    }
  }

  private flush(): void {
    const heap = this.m.HEAPF32;
    const at = this.buf >> 2;
    for (let i = 0; i < FRAME; i++) heap[at + i] = this.inFrame[i] * SCALE;
    this.m._rnnoise_process_frame(this.state, this.buf, this.buf);
    const heapAfter = this.m.HEAPF32;
    for (let i = 0; i < FRAME; i++) {
      this.wet[this.tail] = heapAfter[at + i] / SCALE;
      this.dry[this.tail] = this.inFrame[i];
      this.tail = (this.tail + 1) % this.wet.length;
    }
    this.size += FRAME;
    this.filled = 0;
  }

  free(): void {
    this.m._rnnoise_destroy(this.state);
    this.m._free(this.buf);
  }
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  static parameterDescriptors = [{ name: "amount", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  private lanes: Lane[] = [];

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0], output = outputs[0];
    if (!input?.length) return true;
    wasm ??= createRnnoise();
    const amount = parameters.amount[0];
    for (let c = 0; c < output.length; c++) {
      const lane = (this.lanes[c] ??= new Lane(wasm));
      lane.run(input[Math.min(c, input.length - 1)], output[c], amount);
    }
    return true;
  }
}

const WINDOW = 2048;

class PitchProcessor extends AudioWorkletProcessor {
  static parameterDescriptors = [{ name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }];
  private bufs: Float32Array[] = [];
  private write = 0;
  private phase = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0], output = outputs[0];
    if (!input?.length) return true;
    const ratio = parameters.ratio[0];
    const size = WINDOW * 4;
    const n = output[0].length;
    for (let c = 0; c < output.length; c++) this.bufs[c] ??= new Float32Array(size);
    let phase = this.phase, write = this.write;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < output.length; c++) this.bufs[c][write] = input[Math.min(c, input.length - 1)][i];
      // Two read heads half a window apart sweep through the delay line, each faded in
      // and out so the jump when one wraps around is inaudible.
      const p2 = (phase + 0.5) % 1;
      const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      const g2 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p2);
      for (let c = 0; c < output.length; c++) {
        output[c][i] = g1 * tap(this.bufs[c], write - phase * WINDOW, size) + g2 * tap(this.bufs[c], write - p2 * WINDOW, size);
      }
      phase += (1 - ratio) / WINDOW;
      phase -= Math.floor(phase);
      write = (write + 1) % size;
    }
    this.phase = phase;
    this.write = write;
    return true;
  }
}

function tap(buf: Float32Array, pos: number, size: number): number {
  const p = ((pos % size) + size) % size;
  const i = Math.floor(p);
  const f = p - i;
  return buf[i] * (1 - f) + buf[(i + 1) % size] * f;
}

registerProcessor("openroll-rnnoise", RnnoiseProcessor);
registerProcessor("openroll-pitch", PitchProcessor);
