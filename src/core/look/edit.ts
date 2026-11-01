// Project edits for the look: filters, effect stacks, imported LUTs. Pure, like core/edit.

import { findItem, newId, type Effect, type MediaItem, type Project } from "../project";
import { newEffect } from "./effects";
import { LUT_PREFIX } from "./filters";
import { lutToBase64, type Lut } from "./lut";

function withMedia(p: Project, id: string, change: (item: MediaItem) => void): Project {
  if (!findItem(p, id) || findItem(p, id)!.item.type !== "media") return p;
  const next = structuredClone(p);
  change(findItem(next, id)!.item as MediaItem);
  return next;
}

function dropKey(item: MediaItem, path: string): void {
  if (!item.keyframes) return;
  delete item.keyframes[path];
  if (!Object.keys(item.keyframes).length) delete item.keyframes;
}

export function setFilter(p: Project, itemId: string, filterId: string | null, amount = 1): Project {
  return withMedia(p, itemId, item => {
    if (filterId) item.filter = { id: filterId, amount };
    else {
      delete item.filter;
      dropKey(item, "filter.amount");
    }
  });
}

export function addEffectTo(p: Project, itemId: string, kind: string): { project: Project; effect: Effect | null } {
  const fx = newEffect(kind);
  const project = withMedia(p, itemId, item => {
    item.effects = [...(item.effects ?? []), fx];
  });
  return { project, effect: project === p ? null : fx };
}

export function patchEffect(p: Project, itemId: string, effectId: string, patch: (e: Effect) => void): Project {
  return withMedia(p, itemId, item => {
    const e = item.effects?.find(x => x.id === effectId);
    if (e) patch(e);
  });
}

export function removeEffect(p: Project, itemId: string, effectId: string): Project {
  return withMedia(p, itemId, item => {
    item.effects = item.effects?.filter(e => e.id !== effectId);
    if (!item.effects?.length) delete item.effects;
    dropKey(item, `fx:${effectId}:amount`);
  });
}

export function moveEffect(p: Project, itemId: string, effectId: string, by: -1 | 1): Project {
  return withMedia(p, itemId, item => {
    const list = item.effects;
    const i = list?.findIndex(e => e.id === effectId) ?? -1;
    if (!list || i < 0 || i + by < 0 || i + by >= list.length) return;
    [list[i], list[i + by]] = [list[i + by], list[i]];
  });
}

/** Store a parsed LUT in the project and return the id filters refer to it by. */
export function addLut(p: Project, name: string, lut: Lut): { project: Project; id: string } {
  const id = LUT_PREFIX + newId().slice(0, 8);
  const project: Project = { ...p, luts: { ...(p.luts ?? {}), [id]: { name, size: lut.size, data: lutToBase64(lut) } } };
  return { project, id };
}

export function removeLut(p: Project, id: string): Project {
  if (!p.luts?.[id]) return p;
  const next = structuredClone(p);
  delete next.luts![id];
  if (!Object.keys(next.luts!).length) delete next.luts;
  for (const t of next.tracks) for (const i of t.items) if (i.type === "media" && i.filter?.id === id) delete i.filter;
  return next;
}
