import { loadWorklet } from "../../engine/audio-graph";
import type { Editor } from "./editor";
import { addMadeSound, saveWavRecording } from "./sounds";

/** Records the microphone untouched; cleanup is a setting on the clip, not baked in. */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scratch = new Float32Array(1024);
  private chunks: Float32Array[] = [];
  private recording = false;

  async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.ctx = new AudioContext({ sampleRate: 48_000 });
    await Promise.all([loadWorklet(this.ctx), this.ctx.resume()]);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    // Raw samples, not MediaRecorder: exact length, no codec, no container to decode later.
    const capture = new AudioWorkletNode(this.ctx, "openroll-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
    capture.port.onmessage = e => this.recording && this.chunks.push(e.data as Float32Array);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(capture).connect(mute).connect(this.ctx.destination);
  }

  /** Current input level, 0 to 1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.scratch);
    let sum = 0;
    for (const v of this.scratch) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / this.scratch.length) + 1e-6);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }

  start(): void {
    this.recording = true;
  }

  async stop(): Promise<{ samples: Float32Array; rate: number }> {
    this.recording = false;
    const rate = this.ctx!.sampleRate;
    this.close();
    const samples = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    return { samples, rate };
  }

  close(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}

export async function placeRecording(editor: Editor, rec: { samples: Float32Array; rate: number }, at: number): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const file = await saveWavRecording(`Voiceover ${stamp}`, [rec.samples], rec.rate);
  if (!file) {
    editor.toast("The recording could not be saved", { tone: "error" });
    return;
  }
  await addMadeSound(editor, file, "recording", at, "Record voiceover");
}
