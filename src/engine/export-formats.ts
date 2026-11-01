import type { PipeFormat } from "../shared/ffexport";
import type { EncoderRung, ExportFormat, ExportSettings } from "./export-protocol";

export interface FormatInfo {
  id: ExportFormat;
  label: string;
  extension: string;
  /** Needs the bundled ffmpeg. */
  needsFfmpeg: boolean;
  video: boolean;
  /** Can hold a transparent background. */
  alpha: boolean;
  /** Bitrate matters (lossy video). */
  lossy: boolean;
}

export const FORMATS: FormatInfo[] = [
  { id: "mp4", label: "MP4", extension: "mp4", needsFfmpeg: false, video: true, alpha: false, lossy: true },
  { id: "webm", label: "WebM VP9", extension: "webm", needsFfmpeg: false, video: true, alpha: true, lossy: true },
  { id: "prores422", label: "ProRes 422", extension: "mov", needsFfmpeg: true, video: true, alpha: false, lossy: false },
  { id: "prores4444", label: "ProRes 4444", extension: "mov", needsFfmpeg: true, video: true, alpha: true, lossy: false },
  { id: "gif", label: "GIF", extension: "gif", needsFfmpeg: true, video: true, alpha: true, lossy: false },
  { id: "m4a", label: "Audio, M4A", extension: "m4a", needsFfmpeg: false, video: false, alpha: false, lossy: false },
  { id: "wav", label: "Audio, WAV", extension: "wav", needsFfmpeg: false, video: false, alpha: false, lossy: false },
  { id: "png", label: "Still, PNG", extension: "png", needsFfmpeg: false, video: false, alpha: true, lossy: false },
];

export const formatInfo = (id: ExportFormat): FormatInfo => FORMATS.find(f => f.id === id)!;

/** A file named .webm that holds MP4 data will not open, so a chosen path has to match what is written. */
export const hasExtension = (path: string, extension: string): boolean => path.toLowerCase().endsWith(`.${extension}`);

/** The project has no background colour, so the picture keeps its transparency where the format can hold it. */
export const hasNoBackground = (background: string): boolean => background === "none";

/**
 * Encoders to try in order. A hardware encoder that fails (out of memory, a driver that
 * refuses a size) is retried in software, then through ffmpeg, before the person hears about it.
 */
export function ladder(s: Pick<ExportSettings, "format" | "transparent">, ffmpeg: boolean): EncoderRung[] {
  if (s.format === "prores422" || s.format === "prores4444" || s.format === "gif") return ffmpeg ? ["ffmpeg"] : [];
  // Chromium on Linux, and Windows without Media Foundation, has no AAC encoder.
  if (s.format === "m4a") return ["software", ...(ffmpeg ? (["ffmpeg"] as const) : [])];
  if (s.format === "wav" || s.format === "png") return ["software"];
  // WebCodecs cannot write alpha into VP9 reliably, so transparent WebM goes straight to ffmpeg.
  if (s.format === "webm" && s.transparent) return ffmpeg ? ["ffmpeg"] : [];
  return ["hardware", "software", ...(ffmpeg ? (["ffmpeg"] as const) : [])];
}

export function pipeFormat(s: Pick<ExportSettings, "format" | "codec">): PipeFormat {
  if (s.format === "m4a") return "m4a-aac";
  if (s.format === "mp4") return s.codec === "hevc" ? "mp4-x265" : "mp4-x264";
  if (s.format === "webm") return "webm-vp9";
  if (s.format === "prores422" || s.format === "prores4444" || s.format === "gif") return s.format;
  throw new Error(`${s.format} is not encoded by ffmpeg`);
}

/** GIFs balloon fast, so they are capped to a size and rate people can actually share. */
export function gifFrame(width: number, height: number, fps: number): { width: number; height: number; fps: number } {
  const k = Math.min(1, 640 / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * k), height: even(height * k), fps: Math.min(fps, 15) };
}

export function estimateBytes(s: Pick<ExportSettings, "format" | "width" | "height" | "fps" | "bitrate">, seconds: number, transparent: boolean): number {
  switch (s.format) {
    case "prores422": return s.width * s.height * s.fps * 0.3 * seconds;
    case "prores4444": return s.width * s.height * s.fps * (transparent ? 0.55 : 0.45) * seconds;
    case "gif": return s.width * s.height * s.fps * 0.12 * seconds;
    case "wav": return 48_000 * 4 * seconds;
    case "m4a": return (192_000 / 8) * seconds;
    case "png": return s.width * s.height * 1.5;
    default: return ((s.bitrate + 192_000) / 8) * seconds;
  }
}
