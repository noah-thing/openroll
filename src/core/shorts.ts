// Turning a highlight into a short: a new vertical project holding just that stretch of
// the clip, reframed to fill the tall frame, with captions from the words spoken in it.
//
// A short is its own project file rather than a second timeline in the source project.
// The file format has one timeline, a short has its own frame size, and keeping the long
// video untouched means the highlight list can be run again whenever the person likes.

import { captionsFromWords, placeCaptions, type TimedWord } from "./captions";
import { DEFAULT_CHOICE, templateFor, type CaptionChoice } from "./caption-styles";
import { mediaItem } from "./edit";
import { createProject, newId, type Keyframe, type MediaItem, type MediaRef, type Micros, type Project } from "./project";
import { fitSize } from "./scene";

export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

/**
 * Where the subject sits over time, for a smarter reframe than the centre. Each point is
 * a horizontal position as a fraction of the source width (0.5 is the middle) at a time
 * relative to the start of the short. A future subject tracker returns this; with none
 * registered, or when it returns null, the reframe stays on the centre.
 */
export interface ReframeTrack {
  points: { t: Micros; x: number }[];
}

export interface Reframer {
  track(media: MediaRef, from: Micros, to: Micros): Promise<ReframeTrack | null>;
}

export const reframeHook: { reframer?: Reframer } = {};

export interface ShortRequest {
  source: Project;
  clip: MediaItem;
  /** The stretch to keep, in the source timeline. */
  from: Micros;
  to: Micros;
  /** Words in the source timeline; those inside the stretch become captions. */
  words: TimedWord[];
  reframe?: ReframeTrack | null;
  captions?: CaptionChoice | null;
  name?: string;
}

/** Scale that makes a clip fill the tall frame, the way "fill" works on a phone. */
export function coverScale(p: Project, media: MediaRef): number {
  const fit = fitSize(p, media);
  return Math.max(p.settings.width / fit.width, p.settings.height / fit.height);
}

/** Horizontal offsets in project pixels that put the subject track in the middle of the frame. */
export function panKeyframes(p: Project, media: MediaRef, scale: number, track: ReframeTrack): Keyframe[] {
  const shown = fitSize(p, media).width * scale;
  const slack = Math.max(0, (shown - p.settings.width) / 2);
  return track.points.map(pt => ({ t: pt.t, v: Math.round(Math.max(-slack, Math.min(slack, (0.5 - pt.x) * shown))), ease: "ease" as const }));
}

export function buildShort(req: ShortRequest): Project {
  const { source, clip, from, to } = req;
  const media = source.media[clip.mediaId];
  const base = createProject(req.name ?? `${source.name}, short`, { width: SHORT_WIDTH, height: SHORT_HEIGHT, fps: source.settings.fps, sampleRate: source.settings.sampleRate, background: "#000000" });
  base.media[media.id] = media;

  const start = Math.max(clip.start, from);
  const stop = Math.min(clip.start + clip.duration, to);
  const item: MediaItem = {
    ...mediaItem(media, 0),
    id: newId("i"),
    in: Math.round(clip.in + (start - clip.start) * clip.speed),
    duration: stop - start,
    speed: clip.speed,
    volume: clip.volume,
    adjust: clip.adjust,
    filter: clip.filter,
    audio: clip.audio,
    fadeIn: 0,
    fadeOut: 150_000,
  };
  const scale = coverScale(base, media);
  item.transform = { ...item.transform, scale };
  if (req.reframe?.points.length) item.keyframes = { "transform.x": panKeyframes(base, media, scale, req.reframe) };
  for (const key of ["adjust", "filter", "audio"] as const) if (item[key] === undefined) delete item[key];
  base.tracks[0].items.push(item);

  let project = base;
  const inside = req.words.filter(w => w.start >= start && w.end <= stop + 200_000).map(w => ({ ...w, start: w.start - start, end: Math.min(w.end, stop) - start }));
  if (req.captions !== null && inside.length) {
    const template = templateFor(req.captions ?? DEFAULT_CHOICE, project);
    // Above the lower strip that phone apps cover with their own caption.
    template.y = Math.round(0.14 * project.settings.height);
    project = placeCaptions(project, captionsFromWords(inside, template));
  }
  return project;
}
