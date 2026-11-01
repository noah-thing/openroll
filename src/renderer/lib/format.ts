import type { Micros } from "../../core/project";

export function timecode(t: Micros, fps = 30): string {
  const total = Math.max(0, t) / 1e6;
  const f = Math.floor((total % 1) * fps);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}:${two(f)}`;
}

export function shortTime(t: Micros): string {
  const total = Math.max(0, t) / 1e6;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3.2s" for short spans, "1:04" for longer ones. */
export function span(t: Micros): string {
  const s = t / 1e6;
  return s < 10 ? `${s.toFixed(1)}s` : shortTime(t);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
