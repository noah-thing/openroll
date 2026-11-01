// Exports that ffmpeg encodes. The page renders frames and pipes them in as raw RGBA.

// m4a-aac carries no picture: it is the fallback where Chromium ships without an AAC encoder.
export type PipeFormat = "prores422" | "prores4444" | "gif" | "mp4-x264" | "mp4-x265" | "webm-vp9" | "m4a-aac";

export interface PipeSpec {
  format: PipeFormat;
  width: number;
  height: number;
  fps: number;
  /** Keep the alpha channel. Frames then arrive premultiplied and the converter straightens them. */
  transparent: boolean;
  /** Bits per second for the lossy video formats. */
  bitrate: number;
  /** An audio file was written first with ffexport.audio. */
  hasAudio: boolean;
}

export const PIPE_EXTENSION: Record<PipeFormat, string> = {
  prores422: "mov",
  prores4444: "mov",
  gif: "gif",
  "mp4-x264": "mp4",
  "mp4-x265": "mp4",
  "webm-vp9": "webm",
  "m4a-aac": "m4a",
};
