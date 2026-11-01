import type { Project } from "../core/project";

export type PreviewIn =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "project"; project: Project; urls: Record<string, string> }
  | { type: "size"; width: number; height: number }
  | { type: "decode"; hardware: boolean }
  /** `at` is wall time in ms (timeOrigin + now) when the timeline was at `t` microseconds. */
  | { type: "clock"; playing: boolean; t: number; at: number; rate: number }
  | { type: "snapshot"; id: number; t: number };

export type PreviewOut =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "stats"; fps: number; late: number; worstMs: number; readers: number; seekMs: number; seekP95: number; seeks: number }
  | { type: "snapshot"; id: number; image: ImageData };
