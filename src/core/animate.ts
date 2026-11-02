import { easeAt } from "./easing";
import type { Item, Keyframe, Micros } from "./project";

export function sample(keys: Keyframe[], t: Micros): number {
  if (!keys.length) return NaN;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  const x = (t - a.t) / (b.t - a.t || 1);
  // A held value changes at the next key, not a frame after it.
  if (a.ease === "hold") return x >= 1 ? b.v : a.v;
  return a.v + (b.v - a.v) * easeAt(a.ease, x);
}

/** Read a numeric property, animated if it has keyframes. `path` is like "transform.scale". */
export function valueAt(item: Item, path: string, local: Micros): number {
  const keys = item.keyframes?.[path];
  if (keys?.length) return sample(keys, local);
  let v: unknown = item;
  for (const part of path.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === "number" ? v : 0;
}

