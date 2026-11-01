// Editing operations. Each takes a project and returns a new one; the input is never
// touched, so the old object can sit on the undo stack as is. Operations that cannot
// apply (an id that is gone, a split outside an item) return the same object, which
// callers use to tell "nothing happened" apart from a real edit.

import {
  type Item,
  type MediaItem,
  type MediaRef,
  type Micros,
  type Project,
  type Track,
  type TrackKind,
  IDENTITY,
  findItem,
  itemEnd,
  newId,
  sourceSpan,
} from "./project";

/** Smallest item we allow after a trim, so a clip never collapses to nothing. */
export const MIN_ITEM: Micros = 100_000;

export function draft(p: Project): Project {
  const next = structuredClone(p);
  next.modified = Date.now();
  return next;
}

/** Pack the main track: items keep their order and sit edge to edge from zero. */
export function packMain(track: Track): void {
  if (!track.main) return;
  track.items.sort((a, b) => a.start - b.start);
  let t = 0;
  for (const item of track.items) {
    item.start = t;
    t += item.duration;
  }
}

export function sortTrack(track: Track): void {
  track.items.sort((a, b) => a.start - b.start);
}

function overlaps(track: Track, start: Micros, end: Micros, ignore?: string): boolean {
  return track.items.some(i => i.id !== ignore && i.start < end && itemEnd(i) > start);
}

function trackKindFor(item: Item, p: Project): TrackKind {
  if (item.type === "text" || item.type === "caption") return "text";
  if (item.type === "media") {
    const m = p.media[item.mediaId];
    if (m && m.kind === "audio") return "audio";
  }
  return "video";
}

/**
 * Find a track of the right kind where [start, end) is free, preferring the one asked
 * for, then the nearest ones above it. Creates a new track when every lane is busy,
 * which is what people expect when they drop a clip onto something.
 */
export function freeTrack(p: Project, kind: TrackKind, start: Micros, end: Micros, preferId?: string, ignore?: string): Track {
  const preferred = p.tracks.find(t => t.id === preferId);
  if (preferred && preferred.kind === kind && !preferred.main && !overlaps(preferred, start, end, ignore)) return preferred;
  const candidates = p.tracks.filter(t => t.kind === kind && !t.main && !t.locked);
  for (const t of candidates) if (!overlaps(t, start, end, ignore)) return t;
  const track: Track = { id: newId("t"), kind, name: nameForNewTrack(p, kind), items: [] };
  // Video and text tracks stack above the main track, audio below it.
  const mainIndex = p.tracks.findIndex(t => t.main);
  if (kind === "audio") p.tracks.push(track);
  else p.tracks.splice(Math.max(0, mainIndex), 0, track);
  return track;
}

function nameForNewTrack(p: Project, kind: TrackKind): string {
  const base = kind === "audio" ? "Audio" : kind === "text" ? "Text" : "Overlay";
  const n = p.tracks.filter(t => t.kind === kind && !t.main).length + 1;
  return n === 1 ? base : `${base} ${n}`;
}

export function addMedia(p: Project, refs: MediaRef[]): Project {
  const fresh = refs.filter(r => !p.media[r.id]);
  if (!fresh.length) return p;
  const next = draft(p);
  for (const r of fresh) next.media[r.id] = r;
  return next;
}

export function mediaItem(ref: MediaRef, start: Micros): MediaItem {
  return {
    id: newId("i"),
    type: "media",
    mediaId: ref.id,
    start,
    duration: ref.kind === "image" ? 5_000_000 : ref.duration,
    in: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...IDENTITY },
    name: ref.name,
  };
}

export interface InsertOptions {
  trackId?: string;
  /** For the main track: put the item at this index instead of by time. */
  index?: number;
}

/**
 * Put new items on the timeline. Video and images go to the main track when no track
 * is named; audio goes to the first free audio lane.
 */
export function insertItems(p: Project, items: Item[], opts: InsertOptions = {}): Project {
  if (!items.length) return p;
  const next = draft(p);
  const main = next.tracks.find(t => t.main);
  for (const item of items) {
    const kind = trackKindFor(item, next);
    const named = opts.trackId ? next.tracks.find(t => t.id === opts.trackId) : undefined;
    const target = named ?? (kind === "video" ? main : undefined);
    if (target && target.main && kind === "video") {
      const index = opts.index ?? indexAtTime(target, item.start);
      target.items.splice(index, 0, item);
      packInOrder(target);
      if (opts.index !== undefined) opts.index++;
    } else {
      const track = freeTrack(next, kind, item.start, itemEnd(item), target?.id);
      track.items.push(item);
      sortTrack(track);
    }
  }
  return next;
}

function indexAtTime(track: Track, t: Micros): number {
  // Dropping in the first half of an item lands before it, second half after it.
  for (let i = 0; i < track.items.length; i++) {
    const it = track.items[i];
    if (t < it.start + it.duration / 2) return i;
  }
  return track.items.length;
}

/** Like packMain, but trusts the array order instead of sorting by start. */
function packInOrder(track: Track): void {
  let t = 0;
  for (const it of track.items) {
    it.start = t;
    t += it.duration;
  }
}

export interface MoveTarget {
  trackId: string;
  start: Micros;
}

/**
 * Move one item. On the main track, `start` picks a slot and the track re-packs.
 * Elsewhere the item goes exactly where it was dropped, or onto a fresh lane if that
 * spot is taken.
 */
export function moveItem(p: Project, id: string, to: MoveTarget): Project {
  const found = findItem(p, id);
  if (!found) return p;
  const next = draft(p);
  const src = findItem(next, id)!;
  const item = src.item;
  src.track.items.splice(src.index, 1);
  if (src.track.main) packMain(src.track);

  const dest = next.tracks.find(t => t.id === to.trackId) ?? src.track;
  const kind = trackKindFor(item, next);
  if (dest.main && kind === "video") {
    const index = indexAtTime(dest, to.start);
    dest.items.splice(index, 0, item);
    packInOrder(dest);
  } else {
    item.start = Math.max(0, to.start);
    const kindOk = dest.kind === kind && !dest.main;
    const track = kindOk && !overlaps(dest, item.start, itemEnd(item)) ? dest : freeTrack(next, kind, item.start, itemEnd(item), kindOk ? dest.id : undefined);
    track.items.push(item);
    sortTrack(track);
  }
  dropEmptyTracks(next);
  return next;
}

/** Remove non main tracks that have become empty, so lanes never pile up. */
function dropEmptyTracks(p: Project): void {
  const kinds = new Set<TrackKind>();
  p.tracks = p.tracks.filter(t => {
    if (t.main || t.items.length) return true;
    // keep one empty audio lane so there is always somewhere to drop music
    if (t.kind === "audio" && !kinds.has("audio") && !p.tracks.some(o => o !== t && o.kind === "audio")) {
      kinds.add("audio");
      return true;
    }
    return false;
  });
}

/** Split every unlocked item under `t`, or only the given ones. Returns the new project. */
export function split(p: Project, t: Micros, ids?: string[]): Project {
  const targets: string[] = [];
  for (const track of p.tracks) {
    if (track.locked) continue;
    for (const item of track.items) {
      if (ids && !ids.includes(item.id)) continue;
      if (t > item.start + MIN_ITEM / 2 && t < itemEnd(item) - MIN_ITEM / 2) targets.push(item.id);
    }
  }
  if (!targets.length) return p;
  const next = draft(p);
  for (const id of targets) {
    const { track, item, index } = findItem(next, id)!;
    const cut = t - item.start;
    const right = structuredClone(item) as Item;
    right.id = newId("i");
    right.start = t;
    right.duration = item.duration - cut;
    item.duration = cut;
    delete right.transitionIn;
    if (item.type === "media" && right.type === "media") {
      if (item.reversed) {
        // reversed: the left half shows the end of the source span
        right.in = item.in;
        item.in = item.in + sourceSpan(right);
      } else {
        right.in = item.in + Math.round(cut * item.speed);
      }
      right.fadeIn = 0;
      item.fadeOut = 0;
    }
    if (item.type === "caption" && right.type === "caption") {
      right.words = item.words.filter(w => w.end > cut).map(w => ({ ...w, start: Math.max(0, w.start - cut), end: w.end - cut }));
      item.words = item.words.filter(w => w.start < cut).map(w => ({ ...w, end: Math.min(w.end, cut) }));
    }
    splitKeyframes(item, right, cut);
    track.items.splice(index + 1, 0, right);
  }
  return next;
}

function splitKeyframes(left: Item, right: Item, cut: Micros): void {
  if (!left.keyframes) return;
  const l: typeof left.keyframes = {};
  const r: typeof left.keyframes = {};
  for (const [prop, keys] of Object.entries(left.keyframes)) {
    l[prop] = keys.filter(k => k.t <= cut);
    r[prop] = keys.filter(k => k.t >= cut).map(k => ({ ...k, t: k.t - cut }));
  }
  left.keyframes = l;
  right.keyframes = r;
}

/** Delete items. Gaps on the main track close; elsewhere they stay, like in every editor. */
export function deleteItems(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  let hit = false;
  for (const t of p.tracks) if (t.items.some(i => set.has(i.id))) hit = true;
  if (!hit) return p;
  const next = draft(p);
  for (const t of next.tracks) {
    if (t.locked) continue;
    t.items = t.items.filter(i => !set.has(i.id));
    if (t.main) packMain(t);
  }
  dropEmptyTracks(next);
  pruneTransitions(next);
  return next;
}

/** Delete everything between two times on unlocked tracks and pull the rest left. */
export function rippleDeleteRange(p: Project, from: Micros, to: Micros): Project {
  if (to <= from) return p;
  let next = split(p, from);
  next = split(next, to);
  if (next === p) next = draft(p);
  const gap = to - from;
  for (const t of next.tracks) {
    if (t.locked) continue;
    t.items = t.items.filter(i => !(i.start >= from && itemEnd(i) <= to));
    for (const i of t.items) if (i.start >= to) i.start -= gap;
    if (t.main) packMain(t);
  }
  dropEmptyTracks(next);
  return next;
}

export type Edge = "start" | "end";

/**
 * Trim one edge of an item by `delta`. Positive delta on the start edge eats into the
 * item; positive delta on the end edge makes it longer. Media items cannot grow past
 * their source. On the main track the following items follow (ripple).
 */
export function trim(p: Project, id: string, edge: Edge, delta: Micros): Project {
  const found = findItem(p, id);
  if (!found || delta === 0) return p;
  const next = draft(p);
  const { track, item } = findItem(next, id)!;
  const media = item.type === "media" ? next.media[item.mediaId] : undefined;
  const bounded = item.type === "media" && media && media.kind !== "image" && !item.freeze;

  if (edge === "end") {
    let dur = item.duration + delta;
    if (bounded) {
      const it = item as MediaItem;
      const room = it.reversed ? it.in : media!.duration - it.in;
      dur = Math.min(dur, Math.floor(room / it.speed));
    }
    item.duration = Math.max(MIN_ITEM, dur);
  } else {
    let d = delta;
    d = Math.min(d, item.duration - MIN_ITEM);
    if (bounded) {
      const it = item as MediaItem;
      if (!it.reversed) d = Math.max(d, -Math.floor(it.in / it.speed));
      else d = Math.max(d, -Math.floor((media!.duration - it.in - sourceSpan(it)) / it.speed));
    }
    if (!track.main) d = Math.max(d, -item.start);
    if (item.type === "media" && !item.freeze && !item.reversed) item.in += Math.round(d * item.speed);
    item.duration -= d;
    if (!track.main) item.start += d;
    shiftKeyframes(item, -d);
    if (item.type === "caption") item.words = item.words.map(w => ({ ...w, start: w.start - d, end: w.end - d })).filter(w => w.end > 0);
  }
  if (track.main) packMain(track);
  else resolveOverlap(next, track, item);
  return next;
}

function shiftKeyframes(item: Item, by: Micros): void {
  if (!item.keyframes || !by) return;
  for (const keys of Object.values(item.keyframes)) for (const k of keys) k.t += by;
}

/** After an edit on a free track, if the item now overlaps a neighbour, clamp it. */
function resolveOverlap(_p: Project, track: Track, item: Item): void {
  sortTrack(track);
  const i = track.items.indexOf(item);
  const prev = track.items[i - 1];
  const nextItem = track.items[i + 1];
  if (prev && itemEnd(prev) > item.start) {
    const cut = itemEnd(prev) - item.start;
    item.start += cut;
    item.duration = Math.max(MIN_ITEM, item.duration - cut);
    if (item.type === "media") item.in += Math.round(cut * item.speed);
  }
  if (nextItem && itemEnd(item) > nextItem.start) item.duration = Math.max(MIN_ITEM, nextItem.start - item.start);
}

/** Shallow merge of plain fields onto an item, e.g. { volume: 0.5 } or { transform: {...} }. */
export function updateItem(p: Project, id: string, patch: Partial<Item>): Project {
  if (!findItem(p, id)) return p;
  const next = draft(p);
  const { item } = findItem(next, id)!;
  Object.assign(item, structuredClone(patch));
  return next;
}

/** Change speed and keep the same source span, so the item gets longer or shorter. */
export function setSpeed(p: Project, id: string, speed: number): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media") return p;
  const s = Math.min(100, Math.max(0.1, speed));
  const next = draft(p);
  const { track, item } = findItem(next, id)! as { track: Track; item: MediaItem };
  const span = sourceSpan(item);
  item.speed = s;
  item.duration = Math.max(MIN_ITEM, Math.round(span / s));
  if (track.main) packMain(track);
  else resolveOverlap(next, track, item);
  return next;
}

export function duplicateItems(p: Project, ids: string[]): Project {
  const found = ids.map(id => findItem(p, id)).filter(Boolean);
  if (!found.length) return p;
  let next = p;
  for (const f of found) {
    const copy = structuredClone(f!.item);
    copy.id = newId("i");
    copy.start = itemEnd(f!.item);
    next = insertItems(next, [copy], f!.track.main ? { trackId: f!.track.id, index: f!.index + 1 } : { trackId: f!.track.id });
  }
  return next;
}

export function setTrack(p: Project, trackId: string, patch: Partial<Pick<Track, "muted" | "hidden" | "locked" | "name">>): Project {
  if (!p.tracks.some(t => t.id === trackId)) return p;
  const next = draft(p);
  Object.assign(next.tracks.find(t => t.id === trackId)!, patch);
  return next;
}

export function removeMedia(p: Project, mediaId: string): Project {
  if (!p.media[mediaId]) return p;
  const used = p.tracks.some(t => t.items.some(i => i.type === "media" && i.mediaId === mediaId));
  let next = used ? deleteItems(p, p.tracks.flatMap(t => t.items.filter(i => i.type === "media" && i.mediaId === mediaId).map(i => i.id))) : p;
  next = next === p ? draft(p) : next;
  delete next.media[mediaId];
  return next;
}

export function relinkMedia(p: Project, mediaId: string, path: string, size: number, mtime: number): Project {
  if (!p.media[mediaId]) return p;
  const next = draft(p);
  Object.assign(next.media[mediaId], { path, size, mtime, name: path.split(/[\\/]/).pop() });
  return next;
}

/** Transitions only make sense when the previous item ends exactly where this one starts. */
function pruneTransitions(p: Project): void {
  for (const t of p.tracks) {
    t.items.forEach((item, i) => {
      if (!item.transitionIn) return;
      const prev = t.items[i - 1];
      if (!prev || itemEnd(prev) !== item.start) delete item.transitionIn;
    });
  }
}

export function setTransition(p: Project, id: string, kind: string | null, duration: Micros): Project {
  const found = findItem(p, id);
  if (!found) return p;
  const prev = found.track.items[found.index - 1];
  if (kind && (!prev || itemEnd(prev) !== found.item.start)) return p;
  const next = draft(p);
  const { item } = findItem(next, id)!;
  const maxD = Math.min(found.item.duration, prev ? prev.duration : 0) / 2;
  if (kind) item.transitionIn = { kind, duration: Math.max(100_000, Math.min(duration, maxD)) };
  else delete item.transitionIn;
  return next;
}

export function addMarker(p: Project, t: Micros, label?: string): Project {
  if (p.markers.some(m => Math.abs(m.t - t) < 1000)) return p;
  const next = draft(p);
  next.markers.push({ id: newId("m"), t, label });
  next.markers.sort((a, b) => a.t - b.t);
  return next;
}

export function renameProject(p: Project, name: string): Project {
  const clean = name.trim();
  if (!clean || clean === p.name) return p;
  const next = draft(p);
  next.name = clean;
  return next;
}
