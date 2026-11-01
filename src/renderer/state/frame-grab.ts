import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from "mediabunny";
import type { MediaRef } from "../../core/project";
import { derived } from "./derived-media";

export const GRAB_W = 480;
export const GRAB_H = 270;

interface Opened {
  sink: Promise<VideoSampleSink | null>;
}

const opened = new Map<string, Opened>();
const stills = new Map<string, Promise<ImageBitmap | null>>();

function sinkFor(media: MediaRef): Promise<VideoSampleSink | null> {
  let o = opened.get(media.id);
  if (!o) {
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(derived.decodeUrl(media)) });
    o = { sink: input.getPrimaryVideoTrack().then(t => (t ? new VideoSampleSink(t) : null)).catch(() => null) };
    opened.set(media.id, o);
  }
  return o.sink;
}

/**
 * A 16:9 still of the user's own footage, for filter and effect cards. Decoded straight
 * from the file, so it never carries a look the clip already has.
 */
export async function grabFrame(media: MediaRef, seconds: number): Promise<OffscreenCanvas | null> {
  const out = new OffscreenCanvas(GRAB_W, GRAB_H);
  const g = out.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, GRAB_W, GRAB_H);
  if (media.kind === "image") {
    let p = stills.get(media.id);
    if (!p) {
      p = fetch(derived.decodeUrl(media))
        .then(r => r.blob())
        .then(b => createImageBitmap(b, { imageOrientation: "from-image" }))
        .catch(() => null);
      stills.set(media.id, p);
    }
    const bmp = await p;
    if (!bmp) return null;
    const k = Math.max(GRAB_W / bmp.width, GRAB_H / bmp.height);
    g.drawImage(bmp, (GRAB_W - bmp.width * k) / 2, (GRAB_H - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    return out;
  }
  if (media.kind !== "video") return null;
  const sink = await sinkFor(media);
  if (!sink) return null;
  try {
    const sample = await sink.getSample(Math.max(0, Math.min(seconds, media.duration / 1e6 - 0.05)));
    if (!sample) return null;
    sample.drawWithFit(g, { fit: "cover" });
    sample.close();
    return out;
  } catch {
    return null;
  }
}
