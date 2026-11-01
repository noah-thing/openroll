import type { Project } from "../core/project";
import type { AiSync } from "./ai/protocol";

export type PreviewIn =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "project"; project: Project; urls: Record<string, string> }
  | { type: "size"; width: number; height: number }
  | { type: "decode"; hardware: boolean }
  | { type: "ai"; sync: AiSync }
  /** `at` is wall time in ms (timeOrigin + now) when the timeline was at `t` microseconds. */
  | { type: "clock"; playing: boolean; t: number; at: number; rate: number }
  /** `bare` names an item to draw without its filter, effects, mask and key. */
  /** `settle` waits until every visible clip shows its exact frame; `width` renders at that size instead of the preview's. */
  | { type: "snapshot"; id: number; t: number; bare?: string; settle?: boolean; width?: number };

export type PreviewOut =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "stats"; fps: number; late: number; worstMs: number; readers: number; open: number; decoders: number; seekMs: number; seekP95: number; seeks: number }
  | { type: "snapshot"; id: number; image: ImageData }
  /** Playback drew many late frames from this source: it decodes slower than it plays. */
  | { type: "slow-decode"; mediaId: string };
