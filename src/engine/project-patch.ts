import type { MediaRef, Project, Track } from "../core/project";

/**
 * What changed between two projects, found by reference: edits copy only the parts
 * they touch, so the rest of the project never has to cross to the worker again.
 */
export interface ProjectPatch {
  /** Top level fields other than tracks and media that changed, whole. */
  fields: Partial<Project>;
  removed: string[];
  media: { set: Record<string, MediaRef>; remove: string[] };
  /** Track ids in order. */
  order: string[];
  /** Tracks that are new or changed. */
  tracks: Track[];
}

const OWN = new Set(["tracks", "media"]);

/** Null when the tracks cannot be told apart by id, in which case the whole project should be sent. */
export function diffProject(prev: Project, next: Project): ProjectPatch | null {
  const order = next.tracks.map(t => t.id);
  if (new Set(order).size !== order.length) return null;
  const before = new Map(prev.tracks.map(t => [t.id, t]));

  const fields: Record<string, unknown> = {};
  const record = next as unknown as Record<string, unknown>;
  const was = prev as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!OWN.has(key) && record[key] !== was[key]) fields[key] = record[key];
  const removed = Object.keys(was).filter(key => !OWN.has(key) && !(key in record));

  const set: Record<string, MediaRef> = {};
  for (const [id, m] of Object.entries(next.media)) if (prev.media[id] !== m) set[id] = m;
  const remove = Object.keys(prev.media).filter(id => !(id in next.media));

  return {
    fields: fields as Partial<Project>,
    removed,
    media: { set, remove },
    order,
    tracks: next.tracks.filter(t => before.get(t.id) !== t),
  };
}

export function applyPatch(prev: Project, patch: ProjectPatch): Project {
  const tracks = new Map(prev.tracks.map(t => [t.id, t]));
  for (const t of patch.tracks) tracks.set(t.id, t);
  const media = { ...prev.media, ...patch.media.set };
  for (const id of patch.media.remove) delete media[id];
  const out = { ...prev, ...patch.fields, media, tracks: patch.order.map(id => tracks.get(id)!) } as unknown as Record<string, unknown>;
  for (const key of patch.removed) delete out[key];
  return out as unknown as Project;
}
