import { createHash } from "node:crypto";
import { proxySize } from "../engine/proxy-policy";
import type { StreamSummary } from "../shared/derived";

/** Names of the encoders this ffmpeg build has, read once from `ffmpeg -encoders`. */
export type Encoders = ReadonlySet<string>;

export function parseEncoders(listing: string): Set<string> {
  const names = new Set<string>();
  for (const line of listing.split(/\r?\n/)) {
    const m = /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Cached files are named by what they were made from, so an edited or replaced source gets a fresh one. */
export function cacheKey(path: string, size: number, mtime: number, variant: string): string {
  return createHash("sha1").update(`${variant}\0${path}\0${size}\0${mtime}`).digest("hex").slice(0, 20);
}

export interface PrepareHints {
  /** The page can already decode this video, so only the audio needs converting and the video can be copied. */
  videoDecodable?: boolean;
}

export interface BuildContext {
  encoders: Encoders;
  /** Fewer threads while the timeline is playing. */
  threads?: number;
}

function threads(ctx: BuildContext): string[] {
  return ctx.threads ? ["-threads", String(ctx.threads)] : [];
}

/** Picks the best H.264 encoder this build offers. Quality first for intermediates, speed first for proxies. */
export function pickH264(encoders: Encoders, prefer: "quality" | "speed"): "libx264" | "libopenh264" | "h264_videotoolbox" | "h264_mf" | null {
  const order = prefer === "quality" ? ["libx264", "libopenh264", "h264_videotoolbox", "h264_mf"] : ["h264_videotoolbox", "libx264", "libopenh264", "h264_mf"];
  return (order.find(e => encoders.has(e)) as ReturnType<typeof pickH264>) ?? null;
}

function h264Args(encoder: NonNullable<ReturnType<typeof pickH264>>, bitsPerSecond: number, crf: number): string[] {
  // Short GOP and no B frames: seeking back one frame never decodes more than a handful.
  const gop = ["-g", "12", "-bf", "0"];
  if (encoder === "libx264") return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode", "-crf", String(crf), ...gop];
  if (encoder === "h264_videotoolbox") return ["-c:v", encoder, "-b:v", String(bitsPerSecond), "-allow_sw", "1", ...gop];
  return ["-c:v", encoder, "-b:v", String(bitsPerSecond), ...gop];
}

/**
 * Edit friendly copy of a file the page cannot decode: H.264 with a short GOP and AAC in an
 * MP4, same size, frame rate conformed to constant. Audio only files become M4A.
 */
export function prepareArgs(input: string, output: string, info: StreamSummary, ctx: BuildContext, hints: PrepareHints = {}): string[] {
  const audio = info.audio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", String(Math.min(2, info.audio.channels))] : [];
  if (!info.video) return ["-i", input, "-vn", "-sn", "-dn", ...audio, ...threads(ctx), output];

  const v = info.video;
  const copy = hints.videoDecodable && (v.codec === "h264" || v.codec === "hevc");
  if (copy) {
    const tag = v.codec === "hevc" ? ["-tag:v", "hvc1"] : [];
    return ["-i", input, "-map", "0:v:0", "-c:v", "copy", ...tag, ...audio, "-sn", "-dn", "-movflags", "+faststart", ...threads(ctx), output];
  }
  const encoder = pickH264(ctx.encoders, "quality");
  if (!encoder) throw new Error("This copy of ffmpeg has no H.264 encoder.");

  const filters: string[] = [];
  if (v.interlaced) filters.push("yadif=mode=send_frame:deint=interlaced");
  if (v.width % 2 || v.height % 2) filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  filters.push("format=yuv420p");
  const fps = Math.min(v.fps, 60);
  const bitrate = Math.round(v.width * v.height * fps * 0.18);
  return [
    "-i", input,
    "-map", "0:v:0",
    "-vf", filters.join(","),
    "-fps_mode", "cfr", "-r", String(fps),
    ...h264Args(encoder, bitrate, 17),
    ...audio,
    "-sn", "-dn",
    "-movflags", "+faststart",
    ...threads(ctx),
    output,
  ];
}

/** 960p short GOP stand in used for the preview only. Audio rides along so the preview still has sound. */
export function proxyArgs(input: string, output: string, info: StreamSummary, ctx: BuildContext): string[] {
  const v = info.video;
  if (!v) throw new Error("no video to proxy");
  const encoder = pickH264(ctx.encoders, "speed");
  if (!encoder) throw new Error("This copy of ffmpeg has no H.264 encoder.");
  const size = proxySize(v.width, v.height);
  const filters = [v.interlaced ? "yadif=mode=send_frame:deint=interlaced" : "", `scale=${size.width}:${size.height}:flags=bicubic`, "format=yuv420p"].filter(Boolean);
  const bitrate = Math.round(size.width * size.height * Math.min(v.fps, 60) * 0.12);
  const keepAudio = info.audio && (info.audio.codec === "aac" || info.audio.codec === "mp3");
  const audio = !info.audio ? ["-an"] : keepAudio ? ["-map", "0:a:0", "-c:a", "copy"] : ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-ac", String(Math.min(2, info.audio.channels))];
  return [
    "-i", input,
    "-map", "0:v:0",
    "-vf", filters.join(","),
    // Timestamps stay exactly as the source has them so the proxy lines up frame for frame.
    "-fps_mode", "passthrough",
    ...h264Args(encoder, bitrate, 23),
    ...audio,
    "-sn", "-dn",
    "-movflags", "+faststart",
    ...threads(ctx),
    output,
  ];
}
