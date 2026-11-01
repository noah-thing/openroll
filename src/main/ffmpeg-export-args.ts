import type { PipeSpec } from "../shared/ffexport";

const MUXER: Record<PipeSpec["format"], string> = {
  prores422: "mov",
  prores4444: "mov",
  gif: "gif",
  "mp4-x264": "mp4",
  "mp4-x265": "mp4",
  "webm-vp9": "webm",
  "m4a-aac": "ipod",
};

/** Raw frames in, from a pipe or from a file the page filled first. */
function rawInput(spec: PipeSpec, source: string): string[] {
  return ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${spec.width}x${spec.height}`, "-framerate", String(spec.fps), "-i", source];
}

/** GL reads rows bottom up. Transparent frames come out premultiplied and need straightening. */
function head(spec: PipeSpec): string {
  return spec.transparent ? "vflip,unpremultiply=inplace=1" : "vflip";
}

function audioInput(audioFile: string): string[] {
  return ["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", audioFile];
}

export interface PipeArgs {
  /** The encode. For a GIF this is the second pass and `palette` runs first. */
  main: string[];
  palette?: string[];
  /** The frames must be staged in a file because the format needs two passes over them. */
  twoPass: boolean;
}

/**
 * Arguments for each piped format. `source` is `pipe:0` for a live pipe or a raw file for
 * two pass formats, `output` is the file to write and `audioFile` the staged mix.
 */
export function pipeArgs(spec: PipeSpec, source: string, audioFile: string | null, output: string, paletteFile: string): PipeArgs {
  if (spec.format === "m4a-aac") {
    if (!audioFile) throw new Error("an audio export needs the staged mix");
    return { twoPass: false, main: ["-nostdin", ...audioInput(audioFile), "-c:a", "aac", "-b:a", "256k", "-f", MUXER[spec.format], output] };
  }
  const audio = spec.hasAudio && audioFile ? audioInput(audioFile) : [];
  const out = (codecArgs: string[], audioCodec: string[]) => [
    ...rawInput(spec, source),
    ...audio,
    "-map", "0:v:0",
    ...(audio.length ? ["-map", "1:a:0"] : []),
    ...codecArgs,
    // Padded so the picture decides the length: audio that ends mid frame must not take the last frame with it.
    ...(audio.length ? ["-af", "apad", ...audioCodec, "-shortest"] : ["-an"]),
    "-f", MUXER[spec.format], output,
  ];

  switch (spec.format) {
    case "prores422":
      return { twoPass: false, main: out(["-vf", `${head(spec)},format=yuv422p10le`, "-c:v", "prores_ks", "-profile:v", "2", "-vendor", "apl0", "-bits_per_mb", "8000"], ["-c:a", "pcm_s16le"]) };
    case "prores4444":
      return {
        twoPass: false,
        main: out(
          spec.transparent
            ? ["-vf", `${head(spec)},format=yuva444p10le`, "-c:v", "prores_ks", "-profile:v", "4", "-vendor", "apl0", "-alpha_bits", "16"]
            : ["-vf", `${head(spec)},format=yuv444p10le`, "-c:v", "prores_ks", "-profile:v", "4", "-vendor", "apl0"],
          ["-c:a", "pcm_s16le"],
        ),
      };
    case "mp4-x264":
      return {
        twoPass: false,
        main: out(["-vf", `${head(spec)},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-b:v", String(spec.bitrate), "-maxrate", String(Math.round(spec.bitrate * 1.5)), "-bufsize", String(spec.bitrate * 2), "-movflags", "+faststart"], ["-c:a", "aac", "-b:a", "192k"]),
      };
    case "mp4-x265":
      return {
        twoPass: false,
        main: out(["-vf", `${head(spec)},format=yuv420p`, "-c:v", "libx265", "-preset", "medium", "-b:v", String(spec.bitrate), "-tag:v", "hvc1", "-movflags", "+faststart"], ["-c:a", "aac", "-b:a", "192k"]),
      };
    case "webm-vp9":
      return {
        twoPass: false,
        main: out(
          ["-vf", `${head(spec)},format=${spec.transparent ? "yuva420p" : "yuv420p"}`, "-c:v", "libvpx-vp9", "-b:v", String(spec.bitrate), "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-auto-alt-ref", "0"],
          ["-c:a", "libopus", "-b:a", "160k"],
        ),
      };
    case "gif": {
      const t = spec.transparent;
      const prefix = `${head(spec)},${t ? "format=rgba" : "format=rgb24"}`;
      return {
        twoPass: true,
        palette: [...rawInput(spec, source), "-vf", `${prefix},palettegen=stats_mode=diff${t ? ":reserve_transparent=1" : ""}`, "-frames:v", "1", "-update", "1", "-f", "image2", paletteFile],
        main: [...rawInput(spec, source), "-i", paletteFile, "-filter_complex", `[0:v]${prefix}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4${t ? ":alpha_threshold=128" : ""}`, "-loop", "0", "-f", "gif", output],
      };
    }
  }
}

