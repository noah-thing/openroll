import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import type { MediaKind, MediaRef } from "../core/project";
import { newId } from "../core/project";

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

export class UnsupportedMediaError extends Error {}

export interface ProbeTarget {
  path: string;
  name: string;
  size: number;
  mtime: number;
  url: string;
}

export async function probe(file: ProbeTarget): Promise<MediaRef> {
  if (IMAGE.test(file.name)) return probeImage(file);

  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(file.url) });
  try {
    if (!(await input.canRead())) throw new UnsupportedMediaError(`${file.name} is not a format OpenRoll can read yet.`);
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video && !audio) throw new UnsupportedMediaError(`${file.name} has no video or audio in it.`);

    const [canVideo, canAudio] = await Promise.all([video?.canDecode() ?? false, audio?.canDecode() ?? false]);
    if (video && !canVideo && !audio) throw new UnsupportedMediaError(`This computer cannot decode the video in ${file.name} (${video.codec ?? "unknown codec"}).`);

    const duration = Math.round((await input.computeDuration()) * 1e6);
    const kind: MediaKind = video && canVideo && !AUDIO.test(file.name) ? "video" : "audio";
    const ref: MediaRef = {
      id: newId("m"),
      kind,
      path: file.path,
      name: file.name,
      size: file.size,
      mtime: file.mtime,
      duration,
      hasVideo: kind === "video",
      hasAudio: !!audio && canAudio,
    };
    if (video && kind === "video") {
      ref.width = video.codedWidth;
      ref.height = video.codedHeight;
      ref.rotation = video.rotation as MediaRef["rotation"];
      ref.videoCodec = video.codec ?? undefined;
      const stats = await video.computePacketStats(120).catch(() => null);
      if (stats) ref.fps = Math.round(stats.averagePacketRate * 100) / 100;
    }
    if (audio && canAudio) {
      ref.audioCodec = audio.codec ?? undefined;
      ref.sampleRate = audio.sampleRate;
      ref.channels = audio.numberOfChannels;
    }
    return ref;
  } finally {
    input.dispose();
  }
}

async function probeImage(file: ProbeTarget): Promise<MediaRef> {
  const blob = await (await fetch(file.url)).blob();
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new UnsupportedMediaError(`${file.name} could not be opened as an image.`);
  }
  const ref: MediaRef = {
    id: newId("m"),
    kind: "image",
    path: file.path,
    name: file.name,
    size: file.size,
    mtime: file.mtime,
    duration: 5_000_000,
    width: bmp.width,
    height: bmp.height,
    hasAudio: false,
    hasVideo: true,
  };
  bmp.close();
  return ref;
}
