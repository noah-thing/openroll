// Edits that belong to sound: cleanup settings, detaching audio, voiceovers and beats.

import { addMedia, draft, freeTrack, insertItems, mediaItem, sortTrack } from "./edit";
import { findItem, itemEnd, newId, type AudioCleanup, type MediaItem, type MediaRef, type Micros, type Project, type VoiceFx } from "./project";

/** Merge cleanup settings onto an item, dropping any that are switched off. */
export function setCleanup(p: Project, id: string, patch: Partial<AudioCleanup>): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media") return p;
  const next = draft(p);
  const item = findItem(next, id)!.item as MediaItem;
  const merged: Record<string, unknown> = { ...item.audio, ...patch };
  for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k];
  item.audio = Object.keys(merged).length ? (merged as AudioCleanup) : undefined;
  return next;
}

export function setVoiceFx(p: Project, id: string, fx: VoiceFx | undefined): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media" || found.item.voiceFx === fx) return p;
  const next = draft(p);
  (findItem(next, id)!.item as MediaItem).voiceFx = fx;
  return next;
}

export function setAutoBeat(p: Project, on: boolean): Project {
  if (!!p.settings.autoBeat === on) return p;
  const next = draft(p);
  next.settings.autoBeat = on;
  return next;
}

/**
 * Move a video clip's sound onto its own audio lane. The video keeps playing but goes
 * quiet, and the new item carries the volume, fades, trim and cleanup the clip had.
 */
export function detachAudio(p: Project, id: string): Project {
  const found = findItem(p, id);
  if (!found || found.item.type !== "media") return p;
  const media = p.media[found.item.mediaId];
  if (!media || media.kind !== "video" || !media.hasAudio || found.item.muteAudio || found.item.reversed || found.item.freeze) return p;

  const next = draft(p);
  const video = findItem(next, id)!.item as MediaItem;
  const link = video.link ?? newId("l");
  const sound = mediaItem(media, video.start);
  Object.assign(sound, {
    duration: video.duration,
    in: video.in,
    speed: video.speed,
    volume: video.volume,
    fadeIn: video.fadeIn,
    fadeOut: video.fadeOut,
    audio: video.audio,
    voiceFx: video.voiceFx,
    link,
    name: `${media.name} audio`,
  });
  video.muteAudio = true;
  video.link = link;
  video.audio = undefined;
  video.voiceFx = undefined;
  const lane = freeTrack(next, "audio", sound.start, itemEnd(sound));
  lane.items.push(sound);
  sortTrack(lane);
  return next;
}

/** Put a sound that OpenRoll made (a recording, speech, an effect) on the timeline. */
export function placeSound(p: Project, ref: MediaRef, start: Micros): { project: Project; itemId: string } {
  const withMedia = addMedia(p, [ref]);
  const item = mediaItem(ref, start);
  return { project: insertItems(withMedia, [item]), itemId: item.id };
}

/** Timeline times of an item's beats, empty unless Auto beat is on. */
export function itemBeats(p: Project, item: MediaItem): Micros[] {
  if (!p.settings.autoBeat) return [];
  const beats = p.media[item.mediaId]?.beats;
  if (!beats?.length || item.reversed || item.freeze) return [];
  const out: Micros[] = [];
  const end = itemEnd(item);
  for (const b of beats) {
    const t = Math.round(item.start + (b - item.in) / item.speed);
    if (t >= item.start && t <= end) out.push(t);
  }
  return out;
}

export function allBeats(p: Project, exclude: Set<string>): Micros[] {
  const out: Micros[] = [];
  for (const track of p.tracks) {
    if (track.kind !== "audio") continue;
    for (const item of track.items) if (item.type === "media" && !exclude.has(item.id)) out.push(...itemBeats(p, item));
  }
  return out;
}
