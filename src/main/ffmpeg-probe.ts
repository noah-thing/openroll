import type { StreamSummary, VideoInfo } from "../shared/derived";

export type { StreamSummary };

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  field_order?: string;
  pix_fmt?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

export function parseRate(text: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(text ?? "");
  if (!m) return 0;
  const den = Number(m[2]);
  return den > 0 ? Number(m[1]) / den : 0;
}

/** Snap to a broadcast rate when close, so 29.97 stays 29.97 and a wobbly 29.9 average becomes it too. */
export function snapRate(fps: number): number {
  if (!(fps > 0)) return 30;
  const near = COMMON_RATES.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
  if (Math.abs(near - fps) / near < 0.02) return near;
  return Math.round(Math.min(fps, 120) * 100) / 100;
}

export function parseProbe(json: unknown): StreamSummary {
  const doc = (json ?? {}) as { streams?: RawStream[]; format?: { duration?: string } };
  const streams = doc.streams ?? [];
  const v = streams.find(s => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = streams.find(s => s.codec_type === "audio");
  const durations = [doc.format?.duration, v?.duration, a?.duration].map(Number).filter(n => Number.isFinite(n) && n > 0);

  let video: VideoInfo | null = null;
  if (v && v.width && v.height) {
    const rotation = Math.abs(Math.round(v.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? Number(v.tags?.rotate ?? 0))) % 360;
    const turned = rotation === 90 || rotation === 270;
    const rate = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate);
    video = {
      codec: v.codec_name ?? "unknown",
      width: turned ? v.height : v.width,
      height: turned ? v.width : v.height,
      fps: snapRate(rate),
      interlaced: !!v.field_order && !["progressive", "unknown"].includes(v.field_order),
      pixFmt: v.pix_fmt ?? "",
      hasAlpha: /^(yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(v.pix_fmt ?? ""),
    };
  }
  const audio = a ? { codec: a.codec_name ?? "unknown", channels: a.channels ?? 2, sampleRate: Number(a.sample_rate) || 48_000 } : null;
  return { duration: durations.length ? Math.max(...durations) : 0, video, audio };
}

/** Typical gap between keyframes in a ffprobe packet listing, in seconds. Null when the sample says too little. */
export function keyframeInterval(packets: { flags?: string; pts_time?: string }[]): number | null {
  const times = packets.map(p => Number(p.pts_time)).filter(Number.isFinite);
  const keys = packets.filter(p => p.flags?.startsWith("K")).map(p => Number(p.pts_time)).filter(Number.isFinite).sort((a, b) => a - b);
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  // A single keyframe across a long sample means the real gap is at least that long.
  if (keys.length === 1) return span >= 10 ? span : null;
  if (keys.length < 2) return null;
  const gaps = keys.slice(1).map((t, i) => t - keys[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
