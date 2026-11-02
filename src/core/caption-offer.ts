import { allCaptions } from "./captions";
import { itemEnd, sourceSpan, type MediaItem, type MediaRef, type Micros, type Project } from "./project";

/** Less talking than this, or a smaller share of the clip, is background chatter rather than something to caption. */
export const MIN_SPEECH: Micros = 3_000_000;
export const MIN_SHARE = 0.2;

/** How much of the part of the file a clip shows has speech in it. */
export function speechInClip(media: MediaRef, item: MediaItem): { total: Micros; share: number } {
  const from = item.in;
  const to = item.in + sourceSpan(item);
  let total = 0;
  const ranges = media.speech ?? [];
  for (let i = 0; i + 1 < ranges.length; i += 2) total += Math.max(0, Math.min(to, ranges[i + 1]) - Math.max(from, ranges[i]));
  return { total, share: to > from ? total / (to - from) : 0 };
}

export interface CaptionOffer {
  item: MediaItem;
  media: MediaRef;
}

/**
 * Clips worth asking about, in timeline order: measured to have real speech, not asked
 * about before, and with no captions already under them. `arrived` limits this to files
 * brought in during this session, so opening an older project does not start asking about
 * its footage.
 */
export function captionOffers(project: Project, arrived: ReadonlySet<string>): CaptionOffer[] {
  const captions = allCaptions(project);
  const out: CaptionOffer[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === "text") continue;
    for (const item of track.items) {
      if (item.type !== "media" || item.reversed || item.freeze || !arrived.has(item.mediaId)) continue;
      const media = project.media[item.mediaId];
      if (!media?.hasAudio || !media.speech || media.captionsAsked) continue;
      const { total, share } = speechInClip(media, item);
      if (total < MIN_SPEECH || share < MIN_SHARE) continue;
      if (captions.some(c => c.start < itemEnd(item) && itemEnd(c) > item.start)) continue;
      out.push({ item, media });
    }
  }
  return out.sort((a, b) => a.item.start - b.item.start);
}
