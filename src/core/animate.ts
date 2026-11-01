import type { Easing, Item, Keyframe, Micros } from "./project";

const EASE: Record<Easing, (x: number) => number> = {
  linear: x => x,
  ease: x => x * x * (3 - 2 * x),
  easeIn: x => x * x * x,
  easeOut: x => 1 - (1 - x) ** 3,
  hold: () => 0,
};

export function sample(keys: Keyframe[], t: Micros): number {
  if (!keys.length) return NaN;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  const x = (t - a.t) / (b.t - a.t || 1);
  return a.v + (b.v - a.v) * EASE[a.ease](x);
}

/** Read a numeric property, animated if it has keyframes. `path` is like "transform.scale". */
export function valueAt(item: Item, path: string, local: Micros): number {
  const keys = item.keyframes?.[path];
  if (keys?.length) return sample(keys, local);
  let v: unknown = item;
  for (const part of path.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === "number" ? v : 0;
}

