// "Cut to the beat": lay clips end to end so every cut lands on a beat of the music.
// The planning is pure; applying it swaps the chosen clips for the new pieces.

import { deleteItems, insertItems, MIN_ITEM } from "./edit";
import { localAtPlayed } from "./speed";
import { findItem, itemEnd, newId, sourceSpan, type MediaItem, type Micros, type Project } from "./project";

export type Density = 1 | 2 | 4;

export interface PlanClip {
  id: string;
  /** Source time where the clip begins and how much of it is there. */
  in: Micros;
  available: Micros;
  /** Pictures have no end to run out of. */
  endless: boolean;
}

export interface Piece {
  clipId: string;
  in: Micros;
  start: Micros;
  duration: Micros;
  speed: number;
}

/** The slowest a piece may run to fill its beat when the source is too short. */
const MIN_SPEED = 0.5;
/** A first piece shorter than this is folded into the next one. */
const MIN_FIRST: Micros = 300_000;

/** Timeline times of the cuts: every nth beat inside [from, to), starting from the first beat. */
export function cutTimes(beats: Micros[], density: Density, from: Micros, to: Micros): Micros[] {
  const inside = beats.filter(b => b >= from && b < to).sort((a, b) => a - b);
  const cuts = inside.filter((_, i) => i % density === 0);
  if (cuts.length && cuts[0] - from < MIN_FIRST) cuts.shift();
  return cuts;
}

/**
 * Pieces for the clips, in order, cycling when there are more beats than clips. Each clip
 * hands out its footage from the front, so a second visit shows new material, and wraps
 * to its start when it runs dry.
 */
export function planBeatEdit(clips: PlanClip[], beats: Micros[], density: Density, from: Micros, to: Micros): Piece[] {
  if (!clips.length) return [];
  const cuts = cutTimes(beats, density, from, to);
  if (!cuts.length) return [];
  const edges = [from, ...cuts, to];
  const cursor = new Map(clips.map(c => [c.id, 0]));
  const pieces: Piece[] = [];
  let turn = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const length = edges[i + 1] - edges[i];
    if (length < MIN_ITEM) continue;
    const left = (c: PlanClip) => (c.endless ? Infinity : c.available - (cursor.get(c.id) ?? 0));
    // The next clip in the cycle with enough footage left, else the one with the most.
    let pick: PlanClip | undefined;
    for (let k = 0; k < clips.length && !pick; k++) {
      const c = clips[(turn + k) % clips.length];
      if (left(c) >= length) pick = c;
    }
    pick ??= clips.reduce((best, c) => (left(c) > left(best) ? c : best));
    turn++;
    // Out of footage: start the clip over, and slow it a little if it is still too short.
    const used = left(pick) >= length ? cursor.get(pick.id) ?? 0 : 0;
    const speed = pick.endless || pick.available >= length ? 1 : Math.max(MIN_SPEED, pick.available / length);
    const take = pick.endless ? 0 : Math.round(length * speed);
    pieces.push({ clipId: pick.id, in: pick.in + used, start: edges[i], duration: length, speed });
    cursor.set(pick.id, used + take);
  }
  return pieces;
}

/** Beats are stored in source time; this is where they sound on the timeline. */
export function beatsOnTimeline(music: MediaItem, beats: Micros[]): Micros[] {
  return beats.map(b => music.start + Math.round(localAtPlayed(music, b - music.in))).filter(t => t >= music.start && t < itemEnd(music));
}

export interface BeatEditResult {
  project: Project;
  pieces: number;
}

/**
 * Replace the clips with beat sized pieces laid on the main track, as long as the music.
 * Clips keep their look; their own sound goes quiet so the music carries.
 */
export function cutToBeat(p: Project, clipIds: string[], musicId: string, density: Density, muteClips = true): BeatEditResult {
  const music = findItem(p, musicId);
  if (!music || music.item.type !== "media") return { project: p, pieces: 0 };
  const media = p.media[music.item.mediaId];
  const beats = media?.beats ?? [];
  const clips = clipIds
    .map(id => findItem(p, id))
    .filter((f): f is NonNullable<typeof f> => !!f && f.item.type === "media" && f.item.id !== musicId && p.media[f.item.mediaId]?.kind !== "audio")
    .sort((a, b) => a.item.start - b.item.start);
  if (!clips.length || !beats.length) return { project: p, pieces: 0 };

  const m = music.item;
  const onTimeline = beatsOnTimeline(m, beats);
  const from = Math.min(...clips.map(c => c.item.start));
  const plan = planBeatEdit(
    clips.map(c => {
      const item = c.item as MediaItem;
      const ref = p.media[item.mediaId];
      return { id: item.id, in: item.in, available: Math.max(MIN_ITEM, sourceSpan(item)), endless: ref.kind === "image" };
    }),
    onTimeline,
    density,
    from,
    itemEnd(m),
  );
  if (!plan.length) return { project: p, pieces: 0 };

  const byId = new Map(clips.map(c => [c.item.id, c.item as MediaItem]));
  const items: MediaItem[] = plan.map(piece => {
    const src = structuredClone(byId.get(piece.clipId)!);
    return { ...src, id: newId("i"), start: piece.start, duration: piece.duration, in: piece.in, speed: piece.speed, volume: muteClips ? 0 : src.volume, fadeIn: 0, fadeOut: 0, transitionIn: undefined, keyframes: undefined, link: undefined, ramp: undefined };
  });
  for (const i of items) {
    if (i.transitionIn === undefined) delete i.transitionIn;
    if (i.keyframes === undefined) delete i.keyframes;
    if (i.link === undefined) delete i.link;
  }
  const trackId = clips[0].track.id;
  const index = clips[0].index;
  const removed = deleteItems(p, clips.map(c => c.item.id));
  return { project: insertItems(removed, items, { trackId, index }), pieces: items.length };
}
