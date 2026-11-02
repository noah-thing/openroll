import type { AudioInfo, StreamSummary, VideoInfo } from "../shared/derived";

export type { StreamSummary };

const MAX_SECONDS = 360_000;
const MAX_SIDE = 32_768;
const sane = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_SIDE;

const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

/** Snap to a broadcast rate when close, so 29.97 stays 29.97 and a wobbly 29.9 average becomes it too. */
export function snapRate(fps: number): number {
  if (!(fps > 0)) return 30;
  const near = COMMON_RATES.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
  if (Math.abs(near - fps) / near < 0.02) return near;
  return Math.round(Math.min(fps, 120) * 100) / 100;
}

const clock = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

function seconds(text: string | undefined): number {
  const m = clock.exec(text ?? "");
  const n = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SECONDS) : 0;
}

/** Splits a stream description at the commas outside brackets: "yuv420p(tv, bt709)" is one field. */
function fields(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(text.slice(from).trim());
  return out;
}

/** Layouts print as a name ("stereo"), a count ("6 channels") or dotted speakers ("5.1(side)", "7.1.4"). */
function channelCount(layout: string | undefined): number {
  const named: Record<string, number> = { mono: 1, stereo: 2, downmix: 2, quad: 4, hexagonal: 6, octagonal: 8 };
  const word = /^[a-z]+/.exec(layout ?? "")?.[0] ?? "";
  if (named[word]) return named[word];
  const count = /^(\d+) channels?/.exec(layout ?? "");
  if (count) return Number(count[1]);
  const speakers = /^(\d+(?:\.\d+)+)/.exec(layout ?? "");
  const n = speakers ? speakers[1].split(".").reduce((a, b) => a + Number(b), 0) : 0;
  return n > 0 && n <= 64 ? n : 2;
}

interface Found {
  kind: string;
  fields: string[];
  attachedPic: boolean;
  rotation: number;
  duration: number;
}

/**
 * Reads what `ffmpeg -i file` prints about the container and its streams. Only lines at the
 * exact indentation ffmpeg uses for streams count, so a title tag that imitates one is ignored.
 */
export function parseProbe(text: string): StreamSummary {
  const streams: Found[] = [];
  let container = 0;
  // Windows builds of ffmpeg end lines with \r\n.
  for (const line of text.split(/\r?\n/)) {
    const stream = /^ {2}Stream #\d+:\d+(?:\[0x[0-9a-f]+\])?(?:\([^)]*\))?: (\w+): (.*)$/.exec(line);
    if (stream) {
      const body = stream[2];
      streams.push({ kind: stream[1], fields: fields(body), attachedPic: body.endsWith("(attached pic)"), rotation: 0, duration: 0 });
      continue;
    }
    if (/^ {2}Duration: /.test(line)) {
      container ||= seconds(line);
      continue;
    }
    const last = streams[streams.length - 1];
    if (!last || !line.startsWith("      ")) continue;
    const turn = /^ {6}(?:display ?matrix: rotation of (-?[\d.]+)|rotate\s*: (-?[\d.]+))/i.exec(line);
    if (turn) last.rotation = Number(turn[1] ?? turn[2]);
    else if (/^ {6}DURATION\s*:/.test(line)) last.duration = seconds(line);
  }

  const v = streams.find(s => s.kind === "Video" && !s.attachedPic);
  const a = streams.find(s => s.kind === "Audio");
  const duration = Math.max(container, v?.duration ?? 0, a?.duration ?? 0);

  let video: VideoInfo | null = null;
  if (v) {
    const size = v.fields.map(f => /^(\d+)x(\d+)/.exec(f)).find(Boolean);
    const width = Number(size?.[1]);
    const height = Number(size?.[2]);
    if (sane(width) && sane(height)) {
      const rotation = Math.abs(Math.round(v.rotation)) % 360;
      const turned = rotation === 90 || rotation === 270;
      const pix = /^([a-z0-9_]+)(?:\((.*)\))?$/.exec(v.fields[1] ?? "");
      const pixFmt = pix && !/^\d+x\d+$/.test(pix[1]) ? pix[1] : "";
      const rate = (unit: "fps" | "tbr") => {
        const m = v.fields.map(f => new RegExp(`^(\\d+(?:\\.\\d+)?)(k?) ${unit}$`).exec(f)).find(Boolean);
        return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0;
      };
      video = {
        codec: codecName(v.fields[0]),
        width: turned ? height : width,
        height: turned ? width : height,
        fps: snapRate(rate("fps") || rate("tbr")),
        interlaced: /\bfirst\b/.test(pix?.[2] ?? ""),
        pixFmt,
        hasAlpha: /^(yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(pixFmt),
      };
    }
  }

  let audio: AudioInfo | null = null;
  if (a) {
    const at = a.fields.findIndex(f => /^\d+ Hz$/.test(f));
    audio = { codec: codecName(a.fields[0]), channels: channelCount(a.fields[at + 1]), sampleRate: at < 0 ? 48_000 : Number.parseInt(a.fields[at], 10) || 48_000 };
  }
  return { duration, video, audio };
}

const codecName = (field: string | undefined) => {
  const name = /^[\w.-]+/.exec(field ?? "")?.[0] ?? "";
  return !name || name === "none" ? "unknown" : name;
};

/**
 * Typical gap between keyframes, in seconds, from their times within a sample of the given
 * length. Null when the sample says too little.
 */
export function keyframeInterval(keys: number[], sample: number): number | null {
  const times = keys.filter(Number.isFinite).sort((a, b) => a - b);
  // A single keyframe across a long sample means the real gap is at least that long.
  if (times.length === 1) return sample >= 10 ? sample : null;
  if (times.length < 2) return null;
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
