export type ProxyMode = "off" | "auto" | "always";

/** Short side of a proxy in pixels. */
export const PROXY_SHORT_SIDE = 960;

/** A keyframe gap above this makes every seek decode a long run of frames. */
export const LONG_GOP_SECONDS = 1.1;

export interface ProxyFacts {
  hasVideo: boolean;
  /** Upright size. */
  width: number;
  height: number;
  /** Seconds between keyframes, null when it could not be measured. */
  keyframeInterval: number | null;
  /** The preview measured this file decoding slower than it plays. */
  slowDecode?: boolean;
}

export type ProxyReason = "always" | "long-gop" | "slow-decode";

/** A proxy only helps when it is smaller than the source. */
export function proxyShrinks(width: number, height: number): boolean {
  return Math.min(width, height) > PROXY_SHORT_SIDE;
}

/**
 * Whether a source should get a proxy. Auto means the cases where editing actually hurts:
 * long GOP footage above 1080p, where each seek decodes seconds of frames, and anything
 * the preview measured as slower than real time.
 */
export function proxyReason(mode: ProxyMode, f: ProxyFacts): ProxyReason | null {
  if (mode === "off" || !f.hasVideo || !proxyShrinks(f.width, f.height)) return null;
  if (mode === "always") return "always";
  if (f.slowDecode) return "slow-decode";
  const above1080 = Math.min(f.width, f.height) > 1080;
  if (above1080 && f.keyframeInterval !== null && f.keyframeInterval > LONG_GOP_SECONDS) return "long-gop";
  return null;
}

export function proxySize(width: number, height: number): { width: number; height: number } {
  const k = PROXY_SHORT_SIDE / Math.min(width, height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return width <= height ? { width: PROXY_SHORT_SIDE, height: even(height * k) } : { width: even(width * k), height: PROXY_SHORT_SIDE };
}

/** Frames drawn late while playing, as a share. Past this the decoder is not keeping up. */
export const SLOW_LATE_SHARE = 0.2;
export const SLOW_MIN_FRAMES = 45;

export function decodesTooSlowly(played: number, late: number): boolean {
  return played >= SLOW_MIN_FRAMES && late / played > SLOW_LATE_SHARE;
}
