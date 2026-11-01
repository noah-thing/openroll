import { newId, type MediaRef } from "../../core/project";
import type { FileInfo } from "../../shared/api";
import { derived } from "./derived-media";

/**
 * Builds a media entry for a file the page cannot decode, from what the converter reads
 * out of it, and starts the background conversion. The entry exists straight away, so
 * the clip can be placed while it prepares; only the preview waits.
 */
export async function importViaConverter(file: FileInfo, hints: { videoDecodable: boolean }): Promise<MediaRef | null> {
  const status = await window.openroll.convert.status();
  if (!status.available) return null;
  const info = await window.openroll.convert.inspect(file.path);
  if (!info) return null;

  derived.start();
  const v = info.video;
  const ref: MediaRef = {
    id: newId("m"),
    kind: v ? "video" : "audio",
    path: file.path,
    name: file.name,
    size: file.size,
    mtime: file.mtime,
    duration: Math.round(info.duration * 1e6),
    hasVideo: !!v,
    hasAudio: !!info.audio,
    prepared: true,
  };
  if (v) {
    ref.width = v.width;
    ref.height = v.height;
    ref.rotation = 0;
    ref.fps = v.fps;
    ref.videoCodec = v.codec;
  }
  if (info.audio) {
    ref.audioCodec = info.audio.codec;
    // The prepared copy is 48 kHz stereo at most.
    ref.sampleRate = 48_000;
    ref.channels = Math.min(2, info.audio.channels);
  }
  const state = await window.openroll.convert.prepare(file.path, hints);
  if (state) derived.set(file.path, state);
  return ref;
}
