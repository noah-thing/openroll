import { registerAacEncoder } from "@mediabunny/aac-encoder";
import { canEncodeAudio } from "mediabunny";

let ready: Promise<void> | null = null;

/**
 * Chromium on Linux, and Windows without Media Foundation, cannot encode AAC. Those get a
 * WASM build of ffmpeg's encoder instead; everywhere else the system one stays in charge.
 */
export function ensureAac(): Promise<void> {
  return (ready ??= canEncodeAudio("aac").then(ok => {
    if (!ok) registerAacEncoder();
  }));
}
