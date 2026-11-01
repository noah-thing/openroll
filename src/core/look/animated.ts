// Reading and writing one numeric property of an item by path, so the inspector can treat
// scale, an adjust slider and an effect amount the same way, with or without keyframes.

import { sample } from "../animate";
import { findItem, type Item, type Micros, type Project } from "../project";
import { isAnimated, setKey, toggleKey } from "./keyframes";

export const effectPath = (id: string) => `fx:${id}:amount`;

const FX = /^fx:([^:]+):amount$/;

export function readBase(item: Item, path: string): number {
  const fx = FX.exec(path);
  if (fx) return (item.type === "media" && item.effects?.find(e => e.id === fx[1])?.amount) || 0;
  let v: unknown = item;
  for (const part of path.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === "number" ? v : 0;
}

/** The value at `local`: along the keyframes when the property is animated, else the stored one. */
export function readAt(item: Item, path: string, local: Micros): number {
  const keys = item.keyframes?.[path];
  return keys?.length ? sample(keys, local) : readBase(item, path);
}

function writeBase(item: Item, path: string, v: number): void {
  const fx = FX.exec(path);
  if (fx) {
    const e = item.type === "media" ? item.effects?.find(x => x.id === fx[1]) : undefined;
    if (e) e.amount = v;
    return;
  }
  const parts = path.split(".");
  let o = item as unknown as Record<string, Record<string, unknown>>;
  for (let i = 0; i < parts.length - 1; i++) {
    o[parts[i]] ??= {};
    o = o[parts[i]] as Record<string, Record<string, unknown>>;
  }
  (o as unknown as Record<string, number>)[parts[parts.length - 1]] = v;
}

function change(p: Project, id: string, fn: (item: Item) => void): Project {
  if (!findItem(p, id)) return p;
  const next = structuredClone(p);
  fn(findItem(next, id)!.item);
  return next;
}

/** Slider edit: a keyframe at the playhead when the property is animated, otherwise the plain value. */
export function setAnimated(p: Project, id: string, path: string, local: Micros, v: number): Project {
  return change(p, id, item => {
    if (isAnimated(item, path)) item.keyframes = setKey(item.keyframes, path, local, v);
    else writeBase(item, path, v);
  });
}

/** The diamond. Removing the last key leaves the property at that key's value, so nothing jumps. */
export function toggleDiamond(p: Project, id: string, path: string, local: Micros): Project {
  return change(p, id, item => {
    const current = readAt(item, path, local);
    const next = toggleKey(item.keyframes, path, local, current);
    if (!next?.[path]?.length) writeBase(item, path, current);
    if (next) item.keyframes = next;
    else delete item.keyframes;
  });
}
