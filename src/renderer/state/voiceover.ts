import type { Editor } from "./editor";
import { addMadeSound, saveWavRecording } from "./sounds";

/** Records the microphone untouched; cleanup is a setting on the clip, not baked in. */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scratch = new Float32Array(1024);

  async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
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
    this.recorder = new MediaRecorder(this.stream!);
    this.recorder.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
  }

  async stop(): Promise<{ samples: Float32Array; rate: number }> {
    const recorder = this.recorder!;
    const stopped = new Promise<void>(r => (recorder.onstop = () => r()));
    recorder.stop();
    await stopped;
    this.close();
    const bytes = await new Blob(this.chunks).arrayBuffer();
    const decoded = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes);
    return { samples: decoded.getChannelData(0), rate: decoded.sampleRate };
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
