// Timeline editing beyond the basics in edit.ts: clipboard, group moves, ripple, roll and
// slip trims, freeze frames, gaps, markers and track management. Same contract as edit.ts:
// pure functions, the input is never touched, an unchanged project comes back as is.

import {
  MIN_ITEM,
  addMedia,
  dropEmptyTracks,
  draft,
  freeTrack,
  indexAtTime,
  insertItems,
  isMagnetic,
  nameForNewTrack,
  overlaps,
  packInOrder,
  packMain,
  pruneTransitions,
  setSpeed,
  sortTrack,
  split,
  trackKindFor,
  trim,
  type Edge,
} from "./edit";
import {
  SECOND,
  findItem,
  itemEnd,
  newId,
  sourceSpan,
  sourceTime,
  type Item,
  type MediaItem,
  type MediaRef,
  type Micros,
  type Project,
  type Track,
  type TrackKind,
} from "./project";

/** Items that end after `t`, optionally on one track: "select forward from the playhead". */
export function itemsFrom(p: Project, t: Micros, trackId?: string): string[] {
  const out: string[] = [];
  for (const track of p.tracks) {
    if (trackId && track.id !== trackId) continue;
    for (const i of track.items) if (itemEnd(i) > t) out.push(i.id);
  }
  return out;
}

export function trackItemIds(p: Project, trackId: string): string[] {
  return p.tracks.find(t => t.id === trackId)?.items.map(i => i.id) ?? [];
}

export interface ClipEntry {
  item: Item;
  kind: TrackKind;
  trackId: string;
  /** Came from a magnetic main track, so it pastes into the sequence rather than at a time. */
  packed: boolean;
  /** Distance from the earliest copied item. */
  offset: Micros;
  media?: MediaRef;
}

export interface Clip {
  entries: ClipEntry[];
  span: Micros;
}

export function copyItems(p: Project, ids: string[]): Clip | null {
  const found = ids.map(id => findItem(p, id)).filter((f): f is NonNullable<typeof f> => !!f);
  if (!found.length) return null;
  const first = Math.min(...found.map(f => f.item.start));
  const last = Math.max(...found.map(f => itemEnd(f.item)));
  const entries = found
    .map(f => ({
      item: structuredClone(f.item),
      kind: f.track.kind,
      trackId: f.track.id,
      packed: isMagnetic(f.track),
      offset: f.item.start - first,
      media: f.item.type === "media" ? structuredClone(p.media[f.item.mediaId]) : undefined,
    }))
    .sort((a, b) => a.offset - b.offset);
  return { entries, span: last - first };
}

/**
 * Paste at `t`. Each item goes back to the track it came from when that track still
 * exists and is open, otherwise to a free track of the same kind. Returns the new ids so
 * the caller can select them.
 */
export function pasteItems(p: Project, clip: Clip, t: Micros, opts: { trackId?: string } = {}): { project: Project; ids: string[] } {
  if (!clip.entries.length) return { project: p, ids: [] };
  let next = addMedia(p, clip.entries.flatMap(e => (e.media ? [e.media] : [])));
  const base = next;
  const fresh = clip.entries.map(e => {
    const item = structuredClone(e.item);
    item.id = newId("i");
    item.start = Math.max(0, t + e.offset);
    delete item.transitionIn;
    return { e, item };
  });

  const chosen = (e: ClipEntry): Track | undefined => {
    const own = base.tracks.find(x => x.id === e.trackId);
    if (own && own.kind === e.kind && !own.locked) return own;
    const hint = opts.trackId ? base.tracks.find(x => x.id === opts.trackId) : undefined;
    if (hint && hint.kind === e.kind && !hint.locked) return hint;
    return undefined;
  };

  const packedRun = fresh.filter(f => {
    const tr = chosen(f.e);
    return tr && isMagnetic(tr);
  });
  if (packedRun.length) {
    const main = chosen(packedRun[0].e)!;
    next = insertItems(next, packedRun.map(f => f.item), { trackId: main.id, index: indexAtTime(main, t) });
  }
  for (const f of fresh) if (!packedRun.includes(f)) next = insertItems(next, [f.item], { trackId: chosen(f.e)?.id });
  return { project: next, ids: fresh.map(f => f.item.id) };
}

const MEDIA_LOOK = ["blend", "adjust", "filter", "effects", "crop", "mask", "chroma", "cutout", "audio"] as const;

/**
 * Copy the look of `source` onto other items: transform, colour, effects, masks and
 * speed for media; text style without the words for text. Timing stays as it is,
 * except that speed changes length.
 */
export function pasteStyle(p: Project, source: Item, ids: string[]): Project {
  const targets = ids.filter(id => id !== source.id && findItem(p, id));
  if (!targets.length) return p;
  let next = draft(p);
  let changed = false;
  for (const id of targets) {
    const { item } = findItem(next, id)!;
    if (source.type === "media" && item.type === "media") {
      const m = item as unknown as Record<string, unknown>;
      const s = source as unknown as Record<string, unknown>;
      for (const key of MEDIA_LOOK) {
        if (s[key] === undefined) delete m[key];
        else m[key] = structuredClone(s[key]);
      }
      if (item.effects) item.effects = item.effects.map(e => ({ ...e, id: newId("fx") }));
      item.volume = source.volume;
      changed = true;
    } else if ((source.type === "text" || source.type === "caption") && (item.type === "text" || item.type === "caption")) {
      item.style = { ...structuredClone(source.style), text: item.style.text };
      changed = true;
    } else continue;
    item.transform = structuredClone(source.transform);
    if (source.animationIn) item.animationIn = structuredClone(source.animationIn);
    else delete item.animationIn;
    if (source.animationOut) item.animationOut = structuredClone(source.animationOut);
    else delete item.animationOut;
  }
  if (!changed) return p;
  if (source.type === "media") {
    for (const id of targets) {
      const f = findItem(next, id);
      if (f && f.item.type === "media" && f.item.speed !== source.speed) next = setSpeed(next, id, source.speed);
    }
  }
  return next;
}

/** Delete items and pull later items on the same track left by the same amount. */
export function rippleDeleteItems(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  if (!p.tracks.some(t => !t.locked && t.items.some(i => set.has(i.id)))) return p;
  const next = draft(p);
  for (const t of next.tracks) {
    if (t.locked) continue;
    const gone = t.items.filter(i => set.has(i.id)).sort((a, b) => b.start - a.start);
    if (!gone.length) continue;
    t.items = t.items.filter(i => !set.has(i.id));
    for (const g of gone) for (const i of t.items) if (i.start >= itemEnd(g)) i.start -= g.duration;
    packMain(t);
  }
  dropEmptyTracks(next);
  pruneTransitions(next);
  return next;
}

export function reverseItems(p: Project, ids: string[]): Project {
  const hit = ids.filter(id => {
    const f = findItem(p, id);
    return f && f.item.type === "media" && p.media[f.item.mediaId]?.kind !== "image" && !f.item.freeze;
  });
  if (!hit.length) return p;
  const next = draft(p);
  for (const id of hit) {
    const item = findItem(next, id)!.item as MediaItem;
    item.reversed = !item.reversed;
    if (!item.reversed) delete item.reversed;
  }
  return next;
}

export interface FreezeOptions {
  duration?: Micros;
  id?: string;
}

/** Split at `t` and put a still of that frame between the halves; later items move right. */
export function freezeFrame(p: Project, id: string, t: Micros, opts: FreezeOptions = {}): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media" || found.track.locked) return p;
  const media = p.media[found.item.mediaId];
  if (!media || media.kind === "image" || !media.hasVideo) return p;
  const orig = found.item;
  const length = opts.duration ?? 2 * SECOND;
  const edge = MIN_ITEM / 2;
  const at = Math.min(itemEnd(orig), Math.max(orig.start, t));
  const inside = at > orig.start + edge && at < itemEnd(orig) - edge;
  const base = inside ? split(p, at, [id]) : p;
  const still = sourceTime(orig, at, media.duration);
  const insertAt = inside ? at : at <= orig.start + edge ? orig.start : itemEnd(orig);

  const next = draft(base);
  const { track, item } = findItem(next, id)!;
  const freeze: MediaItem = {
    ...(structuredClone(item) as MediaItem),
    id: opts.id ?? newId("i"),
    start: insertAt,
    duration: length,
    in: still,
    speed: 1,
    freeze: true,
    fadeIn: 0,
    fadeOut: 0,
  };
  delete freeze.reversed;
  delete freeze.transitionIn;
  delete freeze.keyframes;
  if (isMagnetic(track)) {
    track.items.sort((a, b) => a.start - b.start);
    const index = track.items.findIndex(i => i.start >= insertAt);
    track.items.splice(index < 0 ? track.items.length : index, 0, freeze);
    packInOrder(track);
  } else {
    for (const i of track.items) if (i.start >= insertAt) i.start += length;
    track.items.push(freeze);
    sortTrack(track);
  }
  pruneTransitions(next);
  return next;
}

/** Point an item at another file, keeping where it sits and as much of its length as the file allows. */
export function replaceMedia(p: Project, id: string, ref: MediaRef): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media" || found.track.locked) return p;
  if ((found.track.kind === "audio") !== (ref.kind === "audio")) return p;
  if (found.item.mediaId === ref.id) return p;
  let next = addMedia(p, [ref]);
  next = next === p ? draft(p) : next;
  const { track, item } = findItem(next, id)! as { track: Track; item: MediaItem };
  const old = next.media[item.mediaId];
  if (!item.name || item.name === old?.name) item.name = ref.name;
  item.mediaId = ref.id;
  if (ref.kind === "image") {
    item.in = 0;
    delete item.freeze;
  } else if (!item.freeze) {
    item.in = Math.min(item.in, Math.max(0, ref.duration - MIN_ITEM));
    item.duration = Math.max(MIN_ITEM, Math.min(item.duration, Math.floor((ref.duration - item.in) / item.speed)));
  } else item.in = Math.min(item.in, Math.max(0, ref.duration - 1));
  packMain(track);
  return next;
}

export function setItemColor(p: Project, ids: string[], color: string | null): Project {
  const hit = ids.filter(id => {
    const f = findItem(p, id);
    return f && f.item.color !== (color ?? undefined);
  });
  if (!hit.length) return p;
  const next = draft(p);
  for (const id of hit) {
    const { item } = findItem(next, id)!;
    if (color) item.color = color;
    else delete item.color;
  }
  return next;
}

export interface Gap {
  start: Micros;
  end: Micros;
}

/** The empty stretch of a track around `t`, or null when `t` is over an item or past the last one. */
export function gapAt(track: Track, t: Micros): Gap | null {
  const items = [...track.items].sort((a, b) => a.start - b.start);
  let prevEnd = 0;
  for (const i of items) {
    if (t >= prevEnd && t < i.start) return { start: prevEnd, end: i.start };
    prevEnd = Math.max(prevEnd, itemEnd(i));
    if (t < prevEnd) return null;
  }
  return null;
}

export function closeGap(p: Project, trackId: string, t: Micros): Project {
  const track = p.tracks.find(x => x.id === trackId);
  const gap = track && !track.locked ? gapAt(track, t) : null;
  if (!gap) return p;
  const next = draft(p);
  const size = gap.end - gap.start;
  for (const i of next.tracks.find(x => x.id === trackId)!.items) if (i.start >= gap.end) i.start -= size;
  pruneTransitions(next);
  return next;
}

/** Remove every gap between items on a track. The first item keeps its place. */
export function closeAllGaps(p: Project, trackId: string): Project {
  const track = p.tracks.find(x => x.id === trackId);
  if (!track || track.locked || isMagnetic(track) || track.items.length < 2) return p;
  const sorted = [...track.items].sort((a, b) => a.start - b.start);
  if (sorted.every((it, i) => i === 0 || it.start <= itemEnd(sorted[i - 1]))) return p;
  const next = draft(p);
  const tr = next.tracks.find(x => x.id === trackId)!;
  sortTrack(tr);
  let end = tr.items[0].start;
  for (const i of tr.items) {
    i.start = Math.min(i.start, end);
    end = itemEnd(i);
  }
  pruneTransitions(next);
  return next;
}

export interface GroupMove {
  /** How far the dragged item moved, applied to every free item of the group. */
  dt: Micros;
  /** For selected main track items: the time under the pointer, which picks the slot. */
  slotTime?: Micros;
}

/**
 * Move several items together. Free items keep their offsets and lanes (and hop to a
 * free lane when something is in the way); selected main track items travel as one block
 * in their own order and land in the slot under the pointer.
 */
export function moveGroup(p: Project, ids: string[], move: GroupMove): Project {
  const set = new Set(ids);
  const next = draft(p);
  const free: { item: Item; track: Track }[] = [];
  const packed: Item[] = [];
  let main: Track | undefined;
  for (const track of next.tracks) {
    if (track.locked) continue;
    for (const item of track.items) {
      if (!set.has(item.id)) continue;
      if (isMagnetic(track)) {
        packed.push(item);
        main = track;
      } else free.push({ item, track });
    }
  }
  if (!free.length && !packed.length) return p;

  const dt = free.length ? Math.max(move.dt, -Math.min(...free.map(f => f.item.start))) : 0;
  const firstPacked = packed.length ? Math.min(...packed.map(i => i.start)) : 0;
  for (const track of next.tracks) if (!track.locked) track.items = track.items.filter(i => !set.has(i.id));

  for (const { item, track } of free) {
    item.start += dt;
    const dest = !overlaps(track, item.start, itemEnd(item)) ? track : freeTrack(next, trackKindFor(item, next), item.start, itemEnd(item));
    dest.items.push(item);
    sortTrack(dest);
  }
  if (main) {
    packed.sort((a, b) => a.start - b.start);
    let index = main.items.filter(i => i.start < firstPacked).length;
    if (move.slotTime !== undefined) {
      packInOrder(main);
      index = indexAtTime(main, move.slotTime);
    }
    main.items.splice(index, 0, ...packed);
    packInOrder(main);
  }
  dropEmptyTracks(next);
  pruneTransitions(next);
  return next;
}

function startRoom(item: MediaItem, media: MediaRef): number {
  if (media.kind === "image" || item.freeze) return Infinity;
  return item.reversed ? Math.floor((media.duration - item.in - sourceSpan(item)) / item.speed) : Math.floor(item.in / item.speed);
}

function endRoom(item: MediaItem, media: MediaRef): number {
  if (media.kind === "image" || item.freeze) return Infinity;
  return Math.floor((item.reversed ? item.in + sourceSpan(item) : media.duration - item.in) / item.speed) - item.duration;
}

/**
 * Trim an edge and close up behind it: later items on the track move by exactly the
 * length that was added or removed. On the main track plain trim already does this.
 */
export function rippleTrim(p: Project, id: string, edge: Edge, delta: Micros): Project {
  const found = findItem(p, id);
  if (!found || found.track.locked) return p;
  if (isMagnetic(found.track)) return trim(p, id, edge, delta);
  const trackId = found.track.id;
  const oldStart = found.item.start;
  const oldEnd = itemEnd(found.item);
  const held = structuredClone(found.track.items.filter(i => i.id !== id && i.start >= oldEnd - 1));
  const heldIds = new Set(held.map(i => i.id));

  // Trim with the later items out of the way so growing is never stopped by a neighbour.
  const bare = structuredClone(p);
  const bareTrack = bare.tracks.find(t => t.id === trackId)!;
  bareTrack.items = bareTrack.items.filter(i => !heldIds.has(i.id));
  const trimmed = trim(bare, id, edge, delta);
  if (trimmed === bare) return p;
  const tr = trimmed.tracks.find(t => t.id === trackId)!;
  const item = tr.items.find(i => i.id === id)!;
  const change = item.duration - found.item.duration;
  if (change === 0) return p;
  if (edge === "start") item.start = oldStart;
  for (const h of held) h.start += change;
  tr.items.push(...held);
  sortTrack(tr);
  pruneTransitions(trimmed);
  return trimmed;
}

/** Move the cut between two neighbours. Total length stays the same. */
export function rollTrim(p: Project, leftId: string, rightId: string, delta: Micros): Project {
  const l = findItem(p, leftId);
  const r = findItem(p, rightId);
  if (!l || !r || l.track.id !== r.track.id || l.track.locked || delta === 0) return p;
  if (itemEnd(l.item) !== r.item.start) return p;
  const lm = l.item.type === "media" ? p.media[l.item.mediaId] : undefined;
  const rm = r.item.type === "media" ? p.media[r.item.mediaId] : undefined;
  const maxForward = Math.min(r.item.duration - MIN_ITEM, l.item.type === "media" && lm ? endRoom(l.item, lm) : Infinity);
  const maxBack = Math.min(l.item.duration - MIN_ITEM, r.item.type === "media" && rm ? startRoom(r.item, rm) : Infinity);
  const d = Math.round(Math.max(-maxBack, Math.min(maxForward, delta)));
  if (d === 0) return p;
  const next = draft(p);
  const left = findItem(next, leftId)!.item;
  const right = findItem(next, rightId)!.item;
  if (left.type === "media" && left.reversed && !left.freeze) left.in -= Math.round(d * left.speed);
  left.duration += d;
  if (right.type === "media" && !right.freeze && !right.reversed) right.in += Math.round(d * right.speed);
  right.start += d;
  right.duration -= d;
  delete right.transitionIn;
  return next;
}

/** Slide the source under a fixed window. Positive `delta` shows later footage. */
export function slip(p: Project, id: string, delta: Micros): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media" || found.item.freeze || found.track.locked) return p;
  const media = p.media[found.item.mediaId];
  if (!media || media.kind === "image") return p;
  const span = sourceSpan(found.item);
  const want = found.item.in + Math.round(delta * found.item.speed);
  const clamped = Math.max(0, Math.min(media.duration - span, want));
  if (clamped === found.item.in) return p;
  const next = draft(p);
  (findItem(next, id)!.item as MediaItem).in = clamped;
  return next;
}

/** Trim the start or end of items under `t` so that edge lands on `t`. */
export function trimToTime(p: Project, t: Micros, edge: Edge, ids?: string[]): Project {
  const targets: string[] = [];
  for (const track of p.tracks) {
    if (track.locked) continue;
    for (const i of track.items) {
      if (ids && !ids.includes(i.id)) continue;
      if (t > i.start && t < itemEnd(i)) targets.push(i.id);
    }
  }
  let next = p;
  for (const id of targets) {
    const f = findItem(next, id);
    if (!f) continue;
    next = trim(next, id, edge, edge === "start" ? t - f.item.start : t - itemEnd(f.item));
  }
  return next;
}

export function updateMarker(p: Project, id: string, patch: { t?: Micros; label?: string; color?: string | null }): Project {
  if (!p.markers.some(x => x.id === id)) return p;
  const next = draft(p);
  const mk = next.markers.find(x => x.id === id)!;
  if (patch.t !== undefined) mk.t = Math.max(0, Math.round(patch.t));
  if (patch.label !== undefined) {
    if (patch.label.trim()) mk.label = patch.label.trim();
    else delete mk.label;
  }
  if (patch.color !== undefined) {
    if (patch.color) mk.color = patch.color;
    else delete mk.color;
  }
  next.markers.sort((a, b) => a.t - b.t);
  return next;
}

export function removeMarker(p: Project, id: string): Project {
  if (!p.markers.some(m => m.id === id)) return p;
  const next = draft(p);
  next.markers = next.markers.filter(m => m.id !== id);
  return next;
}

export function neighbourMarker(p: Project, t: Micros, dir: -1 | 1) {
  const eps = 1000;
  return dir > 0 ? p.markers.find(m => m.t > t + eps) : [...p.markers].reverse().find(m => m.t < t - eps);
}

export function addTrack(p: Project, kind: TrackKind, id = newId("t")): Project {
  const next = draft(p);
  const track: Track = { id, kind, name: nameForNewTrack(next, kind), items: [], pinned: true };
  const mainIndex = next.tracks.findIndex(t => t.main);
  if (kind === "audio") next.tracks.push(track);
  else next.tracks.splice(Math.max(0, mainIndex), 0, track);
  return next;
}

export function moveTrack(p: Project, id: string, toIndex: number): Project {
  const from = p.tracks.findIndex(t => t.id === id);
  const to = Math.max(0, Math.min(p.tracks.length - 1, toIndex));
  if (from < 0 || from === to) return p;
  const next = draft(p);
  const [t] = next.tracks.splice(from, 1);
  next.tracks.splice(to, 0, t);
  return next;
}

export function removeTrack(p: Project, id: string): Project {
  const t = p.tracks.find(x => x.id === id);
  if (!t || t.main) return p;
  const next = draft(p);
  next.tracks = next.tracks.filter(x => x.id !== id);
  return next;
}

export const MIN_TRACK_H = 28;
export const MAX_TRACK_H = 180;

export function setTrackHeight(p: Project, id: string, height: number): Project {
  const t = p.tracks.find(x => x.id === id);
  const h = Math.round(Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, height)));
  if (!t || t.height === h) return p;
  const next = draft(p);
  const tr = next.tracks.find(x => x.id === id)!;
  tr.height = h;
  tr.pinned = true;
  return next;
}

export function renameTrack(p: Project, id: string, name: string): Project {
  const clean = name.trim();
  const t = p.tracks.find(x => x.id === id);
  if (!t || !clean || clean === t.name) return p;
  const next = draft(p);
  const tr = next.tracks.find(x => x.id === id)!;
  tr.name = clean;
  tr.pinned = true;
  return next;
}

/** Turn magnetic packing of the main track on or off. Turning it off keeps every item where it is. */
export function setMagnetic(p: Project, id: string, on: boolean): Project {
  const t = p.tracks.find(x => x.id === id);
  if (!t || !t.main || (t.magnetic !== false) === on) return p;
  const next = draft(p);
  const tr = next.tracks.find(x => x.id === id)!;
  if (on) {
    delete tr.magnetic;
    packMain(tr);
  } else tr.magnetic = false;
  return next;
}
