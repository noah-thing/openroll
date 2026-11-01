import type { CameraPath, SubjectSample } from "../../core/ai";

export type AiKind = "matte" | "stabilize" | "subject";

export interface MatteQuality {
  /** Model input size, long side. */
  input: number;
  /** RVM downsample ratio at that input. */
  ratio: number;
}

export const MATTE_QUALITY: Record<"fast" | "best", MatteQuality> = {
  fast: { input: 512, ratio: 0.5 },
  best: { input: 1024, ratio: 0.375 },
};

/** One matte per sampled source frame, stored small. The compositor stretches it to the picture. */
export interface MatteTrack {
  width: number;
  height: number;
  fps: number;
  /** Source seconds of sample 0. */
  start: number;
  count: number;
  /** Samples computed so far; the rest read as fully visible. */
  ready: number;
  data: Uint8Array;
}

export interface AiJobBase {
  id: number;
  /** URL the media protocol serves the file at. */
  url: string;
  mediaId: string;
  /** Samples per second of source. */
  fps: number;
  /** Source seconds to cover. */
  from: number;
  to: number;
}

export type AiRequest =
  | ({ kind: "matte"; quality: "fast" | "best"; /** A still picture: one frame, run a few times so the model settles. */ still?: boolean } & AiJobBase)
  | ({ kind: "stabilize" } & AiJobBase)
  | ({ kind: "subject" } & AiJobBase)
  | { kind: "enhance-frame"; id: number; url: string; at: number; scale: 2 | 4 }
  | { kind: "cancel"; id: number };

export type AiEvent =
  | { id: number; type: "progress"; stage: "model" | "frames" | "inference"; done: number; total: number; label?: string }
  | { id: number; type: "matte-info"; track: Omit<MatteTrack, "data"> }
  | { id: number; type: "matte-part"; from: number; bytes: Uint8Array }
  | { id: number; type: "camera"; path: CameraPath; seconds: number }
  | { id: number; type: "subject"; samples: SubjectSample[]; found: number; seconds: number }
  | { id: number; type: "enhanced"; before: ImageBitmap; after: ImageBitmap; seconds: number }
  | { id: number; type: "done"; seconds: number; frames: number; backend?: string }
  | { id: number; type: "cancelled" }
  | { id: number; type: "error"; message: string };

/** Everything the render workers need to know about analysed clips, sent as results arrive. */
export type AiSync =
  | { media: string; kind: "matte-info"; track: Omit<MatteTrack, "data"> }
  | { media: string; kind: "matte-part"; from: number; bytes: Uint8Array }
  | { media: string; kind: "camera"; path: CameraPath }
  | { media: string; kind: "clear"; what: "matte" | "camera" };
