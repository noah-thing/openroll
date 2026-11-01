/// <reference lib="webworker" />
// Background work on media that the UI shows but playback does not need: filmstrip
// thumbnails and audio peaks. Kept off the preview worker so a long import never
// stutters playback.

import { ALL_FORMATS, AudioSampleSink, CanvasSink, Input, UrlSource } from "mediabunny";
import { PEAKS_PER_SECOND, THUMB_H, type MediaJob, type MediaJobResult } from "./media-protocol";

declare const self: DedicatedWorkerGlobalScope;

const queue: MediaJob[] = [];
let busy = false;

self.onmessage = (e: MessageEvent<MediaJob>) => {
  // Newest requests first: what the user just added is what they are looking at.
  queue.unshift(e.data);
  void drain();
};

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      if (job.kind === "filmstrip") await filmstrip(job);
      else await peaks(job);
    } catch (err) {
      post({ id: job.id, kind: "error", message: (err as Error).message });
    }
  }
  busy = false;
}

function post(r: MediaJobResult, transfer: Transferable[] = []): void {
  self.postMessage(r, transfer);
}

/**
 * One frame every `step` seconds, packed into a single strip image. Sent in a few
 * passes, coarse first, so a long clip shows something within a moment.
 */
async function filmstrip(job: Extract<MediaJob, { kind: "filmstrip" }>): Promise<void> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(job.url) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("no video track");
    const duration = await input.computeDuration();
    let w = track.displayWidth, h = track.displayHeight;
    const th = THUMB_H * 2;
    const tw = Math.max(8, Math.round((w / h) * th));
    w = tw;
    h = th;
    const step = duration <= 30 ? 0.5 : duration <= 600 ? 1 : duration / 600;
    const count = Math.max(1, Math.ceil(duration / step));
    const sheet = new OffscreenCanvas(tw * count, th);
    const g = sheet.getContext("2d")!;
    const sink = new CanvasSink(track, { width: w, height: h, fit: "cover", poolSize: 2 });

    // coarse pass every 8th frame, then fill the rest
    const order: number[] = [];
    for (const stride of [8, 1]) for (let i = 0; i < count; i += stride) if (stride === 8 || i % 8) order.push(i);
    let k = 0;
    let sinceSend = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(order.map(i => Math.min(duration - 0.01, i * step)))) {
      const i = order[k++];
      if (wrapped) g.drawImage(wrapped.canvas, i * tw, 0, tw, th);
      sinceSend++;
      if (sinceSend >= Math.max(6, count / 4)) {
        await send();
        sinceSend = 0;
      }
    }
    await send(true);

    async function send(final = false) {
      const bmp = sheet.transferToImageBitmap();
      // transferToImageBitmap clears the canvas; draw it back so later passes add to it
      g.drawImage(bmp, 0, 0);
      const copy = await createImageBitmap(bmp);
      post({ id: job.id, kind: "filmstrip", sheet: copy, frameWidth: tw / 2, frameHeight: th / 2, step, count, final, jpeg: final ? await jpegOf(bmp) : undefined }, [copy]);
      bmp.close();
    }
  } finally {
    input.dispose();
  }
}

async function jpegOf(bmp: ImageBitmap): Promise<Uint8Array> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.78 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function peaks(job: Extract<MediaJob, { kind: "peaks" }>): Promise<void> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(job.url) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("no audio track");
    const duration = await input.computeDuration();
    const bins = Math.max(1, Math.ceil(duration * PEAKS_PER_SECOND));
    const out = new Uint8Array(bins);
    // Workers have no AudioBuffer, so read raw planes instead.
    const sink = new AudioSampleSink(track);
    let lastSent = performance.now();
    let plane = new Float32Array(0);
    for await (const sample of sink.samples()) {
      const per = sample.sampleRate / PEAKS_PER_SECOND;
      const first = Math.floor(sample.timestamp * PEAKS_PER_SECOND);
      if (plane.length < sample.numberOfFrames) plane = new Float32Array(sample.numberOfFrames);
      for (let c = 0; c < sample.numberOfChannels; c++) {
        sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        for (let s = 0; s < sample.numberOfFrames; s += 4) {
          const bin = first + Math.floor(s / per);
          if (bin >= bins) break;
          const q = Math.min(255, Math.round(Math.sqrt(Math.abs(plane[s])) * 255));
          if (q > out[bin]) out[bin] = q;
        }
      }
      sample.close();
      if (performance.now() - lastSent > 400) {
        post({ id: job.id, kind: "peaks", peaks: out.slice(), final: false });
        lastSent = performance.now();
      }
    }
    post({ id: job.id, kind: "peaks", peaks: out, final: true });
  } finally {
    input.dispose();
  }
}
