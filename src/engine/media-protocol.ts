export const THUMB_H = 72;
export const PEAKS_PER_SECOND = 100;

export type MediaJob =
  | { id: string; kind: "filmstrip"; url: string }
  | { id: string; kind: "peaks"; url: string };

export type MediaJobResult =
  | { id: string; kind: "filmstrip"; sheet: ImageBitmap; frameWidth: number; frameHeight: number; step: number; count: number; final: boolean; jpeg?: Uint8Array }
  | { id: string; kind: "peaks"; peaks: Uint8Array; final: boolean }
  | { id: string; kind: "error"; message: string };
