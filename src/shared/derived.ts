// Types shared by the main process (which runs ffmpeg) and the page (which shows the state).

export interface VideoInfo {
  codec: string;
  /** Upright size: rotation metadata is already applied. */
  width: number;
  height: number;
  fps: number;
  interlaced: boolean;
  pixFmt: string;
  hasAlpha: boolean;
}

export interface AudioInfo {
  codec: string;
  channels: number;
  sampleRate: number;
}

export interface StreamSummary {
  /** Seconds. */
  duration: number;
  video: VideoInfo | null;
  audio: AudioInfo | null;
}

export type InspectResult = StreamSummary;

/** A prepared copy stands in for a file the page cannot decode. A proxy only speeds up the preview. */
export type DerivedKind = "prepare" | "proxy";

export interface DerivedState {
  kind: DerivedKind;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  /** 0 to 1. */
  progress: number;
  /** Cached file, once ready. */
  file?: string;
  error?: string;
  reason?: string;
}

export interface ProxyRequest {
  mode: "auto" | "always";
  /** The preview measured slow decoding for this file. */
  slow?: boolean;
}
