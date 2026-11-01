// Keyframe edits as pure functions on an item's KeyframeMap. Times are relative to the
// item start, the same space `valueAt` reads in.

import type { Easing, Item, Keyframe, KeyframeMap, Micros } from "../project";

/** Two keys closer than this are the same key. Under half a frame at any sane rate. */
export const KEY_EPS: Micros = 8_000;

export const EASINGS: { value: Easing; label: string }[] = [
  { value: "ease", label: "Smooth" },
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease in" },
  { value: "easeOut", label: "Ease out" },
  { value: "hold", label: "Hold" },
];

export function keyIndexAt(keys: Keyframe[] | undefined, t: Micros): number {
  if (!keys) return -1;
  return keys.findIndex(k => Math.abs(k.t - t) <= KEY_EPS);
}

export function isAnimated(item: Item, path: string): boolean {
  return !!item.keyframes?.[path]?.length;
}

function put(map: KeyframeMap | undefined, path: string, keys: Keyframe[]): KeyframeMap | undefined {
  const next: KeyframeMap = { ...(map ?? {}) };
  if (keys.length) next[path] = keys;
  else delete next[path];
  return Object.keys(next).length ? next : undefined;
}

/** Add or overwrite the key at `t`. An existing key keeps its easing. */
export function setKey(map: KeyframeMap | undefined, path: string, t: Micros, v: number, ease: Easing = "ease"): KeyframeMap | undefined {
  const keys = map?.[path] ?? [];
  const at = keyIndexAt(keys, t);
  const kept = at >= 0 ? keys[at].ease : ease;
  const out = keys.filter((_, i) => i !== at);
  out.push({ t: at >= 0 ? keys[at].t : t, v, ease: kept });
  out.sort((a, b) => a.t - b.t);
  return put(map, path, out);
}

export function removeKey(map: KeyframeMap | undefined, path: string, t: Micros): KeyframeMap | undefined {
  const keys = map?.[path];
  const at = keyIndexAt(keys, t);
  if (!keys || at < 0) return map;
  return put(map, path, keys.filter((_, i) => i !== at));
}

export function setEase(map: KeyframeMap | undefined, path: string, t: Micros, ease: Easing): KeyframeMap | undefined {
  const keys = map?.[path];
  const at = keyIndexAt(keys, t);
  if (!keys || at < 0) return map;
  return put(map, path, keys.map((k, i) => (i === at ? { ...k, ease } : k)));
}

/** Toggle the diamond: remove the key under the playhead, or add one holding `current`. */
export function toggleKey(map: KeyframeMap | undefined, path: string, t: Micros, current: number): KeyframeMap | undefined {
  return keyIndexAt(map?.[path], t) >= 0 ? removeKey(map, path, t) : setKey(map, path, t, current);
}

/** Sorted times, each listed once, of every key on the item, optionally limited to some paths. */
export function keyTimes(map: KeyframeMap | undefined, only?: (path: string) => boolean): Micros[] {
  const all: Micros[] = [];
  for (const [path, keys] of Object.entries(map ?? {})) if (!only || only(path)) for (const k of keys) all.push(k.t);
  all.sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1] > KEY_EPS);
}

export function neighbourKey(map: KeyframeMap | undefined, t: Micros, dir: -1 | 1): Micros | null {
  const times = keyTimes(map);
  if (dir > 0) return times.find(k => k > t + KEY_EPS) ?? null;
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < t - KEY_EPS) return times[i];
  return null;
}
