import type { Project } from "../core/project";
import type { AiSync } from "./ai/protocol";

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  codec: "avc" | "hevc";
  bitrate: number;
  hardware: boolean;
  audio: boolean;
}

export type ExportIn =
  | { type: "start"; project: Project; urls: Record<string, string>; settings: ExportSettings; ai?: AiSync[] }
  | { type: "cancel" }
  | { type: "written"; req: number }
  | { type: "audio"; req: number; planes: Float32Array[] | null; frames: number };

export type ExportOut =
  | { type: "write"; req: number; position: number; data: Uint8Array }
  | { type: "need-audio"; req: number; from: number; seconds: number }
  | { type: "progress"; frame: number; frames: number; elapsed: number; bytes: number }
  | { type: "done"; bytes: number; seconds: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };
