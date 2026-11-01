import type { Project } from "../core/project";
import type { AiSync } from "./ai/protocol";

export type ExportFormat = "mp4" | "webm" | "prores422" | "prores4444" | "gif" | "m4a" | "wav" | "png";

/** One rung of the retry ladder: the encoder the hardware offers, WebCodecs in software, then ffmpeg. */
export type EncoderRung = "hardware" | "software" | "ffmpeg";

export interface ExportSettings {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  codec: "avc" | "hevc" | "vp9";
  bitrate: number;
  encoder: EncoderRung;
  audio: boolean;
  /** Keep the alpha channel, for formats that can hold it. */
  transparent: boolean;
  /** Time of the still frame, in microseconds. */
  at: number;
}

export type ExportIn =
  | { type: "start"; project: Project; urls: Record<string, string>; settings: ExportSettings; ai?: AiSync[] }
  | { type: "cancel" }
  | { type: "written"; req: number }
  | { type: "audio"; req: number; planes: Float32Array[] | null; frames: number };

export type ExportOut =
  | { type: "write"; req: number; position: number; data: Uint8Array }
  /** A raw RGBA frame for ffmpeg, rows bottom up. Acknowledged with `written`. */
  | { type: "frame"; req: number; data: Uint8Array }
  | { type: "need-audio"; req: number; from: number; seconds: number }
  | { type: "progress"; frame: number; frames: number; elapsed: number; bytes: number }
  | { type: "done"; bytes: number; seconds: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };
