export interface FfmpegProgress {
  /** Seconds of output written so far. */
  time: number;
  frame: number;
  fps: number;
  /** Encoding speed as a multiple of real time, 0 when ffmpeg has not reported one yet. */
  speed: number;
  done: boolean;
}

/**
 * Reads the key=value blocks that `-progress pipe:1` prints. A block ends with a
 * `progress=` line, and chunks from a pipe can split anywhere, so partial lines wait.
 */
export class ProgressParser {
  private rest = "";
  private block: Record<string, string> = {};

  push(chunk: string): FfmpegProgress[] {
    const out: FfmpegProgress[] = [];
    const lines = (this.rest + chunk).split(/\r?\n/);
    this.rest = lines.pop() ?? "";
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      this.block[key] = value;
      if (key === "progress") {
        out.push(toProgress(this.block));
        this.block = {};
      }
    }
    return out;
  }
}

function toProgress(b: Record<string, string>): FfmpegProgress {
  // out_time_us is exact; out_time_ms is also microseconds despite its name.
  const us = Number(b.out_time_us ?? b.out_time_ms);
  const time = Number.isFinite(us) && us > 0 ? us / 1e6 : parseClock(b.out_time ?? "");
  const speed = Number.parseFloat((b.speed ?? "").replace("x", ""));
  return {
    time,
    frame: Number(b.frame) || 0,
    fps: Number(b.fps) || 0,
    speed: Number.isFinite(speed) ? speed : 0,
    done: b.progress === "end",
  };
}

/** "00:01:23.450000" to seconds. Returns 0 for "N/A" and anything else unreadable. */
export function parseClock(text: string): number {
  const m = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text.trim());
  if (!m || m[1]) return 0;
  return Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** The input duration ffmpeg prints on stderr before it starts, for files whose length we do not already know. */
export function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(stderr);
  return m ? parseClock(m[1]) : null;
}

export function fraction(time: number, duration: number): number {
  return duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
}

/** The last few lines of stderr that say why ffmpeg stopped, without the banner. */
export function failureReason(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^(ffmpeg version|built with|configuration:|lib\w+\s+\d)/.test(l));
  return lines.slice(-3).join(" ").slice(0, 400);
}
