import type { AudioAnalysis } from "../core/analyze";

export const THUMB_H = 72;
/** A filmstrip holds at most this many frames, laid out this many to a row: canvases cannot be arbitrarily wide, and a long clip needs no more. */
export const STRIP_MAX_FRAMES = 240;
export const STRIP_COLUMNS = 16;
export const PEAKS_PER_SECOND = 100;

export type MediaJob =
  | { id: string; kind: "filmstrip"; url: string }
  | { id: string; kind: "peaks"; url: string }
  | { id: string; kind: "analyze"; url: string };

export type MediaJobResult =
  | { id: string; kind: "filmstrip"; sheet: ImageBitmap; frameWidth: number; frameHeight: number; step: number; count: number; cols: number; final: boolean; jpeg?: Uint8Array }
  | { id: string; kind: "peaks"; peaks: Uint8Array; final: boolean }
  | { id: string; kind: "analysis"; analysis: AudioAnalysis }
  | { id: string; kind: "error"; message: string };
