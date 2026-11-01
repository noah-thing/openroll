// Shuttle and range playback. The audio clock only runs at normal speed, so faster and
// backwards travel steps the playhead frame by frame from a timer instead. That keeps
// the picture smooth and is silent, like the shuttle on a tape deck with the sound down.

import { SECOND, type Micros } from "../../core/project";
import type { Editor } from "./editor";

interface Run {
  raf: number;
  rate: number;
  last: number;
}

const runs = new WeakMap<Editor, Run>();
const watchers = new WeakMap<Editor, number>();

const MAX_RATE = 8;

function stopStepping(editor: Editor): void {
  const r = runs.get(editor);
  if (r) cancelAnimationFrame(r.raf);
  runs.delete(editor);
}

function stopWatching(editor: Editor): void {
  const w = watchers.get(editor);
  if (w) cancelAnimationFrame(w);
  watchers.delete(editor);
}

/** Stop anything this module started. Safe to call when nothing is running. */
export function stopTransport(editor: Editor): void {
  stopStepping(editor);
  stopWatching(editor);
  editor.setShuttle(0, false);
}

function currentRate(editor: Editor): number {
  const r = runs.get(editor);
  if (r) return r.rate;
  return editor.player?.playing ? 1 : 0;
}

function startStepping(editor: Editor, rate: number): void {
  stopWatching(editor);
  editor.player?.pause();
  stopStepping(editor);
  const run: Run = { raf: 0, rate, last: performance.now() };
  runs.set(editor, run);
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - run.last) / 1000);
    run.last = now;
    const end = editor.player?.duration ?? 0;
    const t = editor.time + dt * run.rate * SECOND;
    if (t <= 0 || t >= end) {
      editor.seek(Math.max(0, Math.min(end, t)));
      stopTransport(editor);
      return;
    }
    editor.seek(t);
    run.raf = requestAnimationFrame(tick);
  };
  run.raf = requestAnimationFrame(tick);
  editor.setShuttle(rate, false);
}

/** L steps forward, doubling each press up to 8x. J does the same backwards. */
export function shuttle(editor: Editor, dir: 1 | -1): void {
  const cur = currentRate(editor);
  let next: number;
  if (cur === 0 || Math.sign(cur) !== dir) next = dir;
  else next = Math.min(MAX_RATE, Math.abs(cur) * 2) * dir;

  if (next === 1) {
    stopStepping(editor);
    stopWatching(editor);
    editor.setShuttle(0, false);
    void editor.player?.play();
    return;
  }
  startStepping(editor, next);
}

export function shuttleStop(editor: Editor): void {
  stopTransport(editor);
  editor.player?.pause();
}

export function togglePlay(editor: Editor): void {
  if (runs.has(editor) || editor.looping) {
    shuttleStop(editor);
    return;
  }
  editor.player?.toggle();
}

interface Stretch {
  from: Micros;
  to: Micros;
  loop: boolean;
  returnTo?: Micros;
}

function playStretch(editor: Editor, w: Stretch): void {
  stopTransport(editor);
  const player = editor.player;
  if (!player || w.to - w.from < 50_000) return;
  player.seek(w.from);
  void player.play();
  editor.setShuttle(0, true);
  let idle = 0;
  const watch = () => {
    const p = editor.player;
    // A seek while playing restarts the audio, which reads as stopped for a frame or two.
    idle = p?.playing ? 0 : idle + 1;
    if (!p || idle > 10) {
      stopTransport(editor);
      return;
    }
    if (p.playing && p.time >= w.to) {
      if (w.loop) p.seek(w.from);
      else {
        p.pause();
        p.seek(w.returnTo ?? w.to);
        stopTransport(editor);
        return;
      }
    }
    watchers.set(editor, requestAnimationFrame(watch));
  };
  // play() resolves a moment later; start asking whether it is running only after that.
  watchers.set(editor, requestAnimationFrame(() => setTimeout(() => watchers.set(editor, requestAnimationFrame(watch)), 200)));
}

/** Shift+Space: loop between the in and out points. A missing end falls back to the project end. */
export function playRange(editor: Editor): void {
  const end = editor.player?.duration ?? 0;
  const from = editor.range.in ?? 0;
  const to = editor.range.out ?? end;
  if (to <= from) {
    editor.toast("Set the in point before the out point");
    return;
  }
  playStretch(editor, { from, to, loop: true });
}

/** Shift+/: two seconds either side of the playhead, then back to where you were. */
export function playAround(editor: Editor): void {
  const t = editor.time;
  const end = editor.player?.duration ?? 0;
  playStretch(editor, { from: Math.max(0, t - 2 * SECOND), to: Math.min(end, t + 2 * SECOND), loop: false, returnTo: t });
}

export function setIn(editor: Editor): void {
  const t = editor.time;
  const out = editor.range.out;
  editor.setRange({ in: t, out: out !== null && out <= t ? null : out });
}

export function setOut(editor: Editor): void {
  const t = editor.time;
  const inn = editor.range.in;
  editor.setRange({ in: inn !== null && inn >= t ? null : inn, out: t });
}

export function clearRange(editor: Editor): void {
  if (editor.range.in === null && editor.range.out === null) return;
  editor.setRange({ in: null, out: null });
}
