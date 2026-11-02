import { describe, expect, it } from "vitest";
import { captionOffers, speechInClip } from "../../src/core/caption-offer";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { sanitizeSettings, DEFAULT_SETTINGS } from "../../src/shared/settings";
import { createProject, IDENTITY, mainTrack, type CaptionItem, type MediaItem, type MediaRef, type Project } from "../../src/core/project";

const S = 1_000_000;
const clip = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: "m1", kind: "video", path: "/v/a.mp4", name: "a.mp4", size: 1, mtime: 0, duration: 20 * S, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true,
  speech: [2 * S, 12 * S], ...over,
});

function projectWith(media: MediaRef): { p: Project; item: MediaItem } {
  let p = addMedia(createProject("t"), [media]);
  const item = mediaItem(media, 0);
  p = insertItems(p, [item], { trackId: mainTrack(p).id });
  return { p, item };
}

const arrived = new Set(["m1"]);

describe("captionOffers", () => {
  it("offers a clip that was just brought in and has plenty of speech", () => {
    const { p, item } = projectWith(clip());
    expect(captionOffers(p, arrived).map(o => o.item.id)).toEqual([item.id]);
  });

  it("waits until speech has been measured", () => {
    const { p } = projectWith(clip({ speech: undefined }));
    expect(captionOffers(p, arrived)).toEqual([]);
  });

  it("skips footage from before this session", () => {
    const { p } = projectWith(clip());
    expect(captionOffers(p, new Set())).toEqual([]);
  });

  it("asks once per file", () => {
    const { p } = projectWith(clip({ captionsAsked: true }));
    expect(captionOffers(p, arrived)).toEqual([]);
  });

  it("skips a tiny amount of speech", () => {
    expect(captionOffers(projectWith(clip({ speech: [S, 2 * S] })).p, arrived)).toEqual([]);
    expect(captionOffers(projectWith(clip({ duration: 600 * S, speech: [0, 5 * S] })).p, arrived)).toEqual([]);
    expect(captionOffers(projectWith(clip({ speech: [] })).p, arrived)).toEqual([]);
  });

  it("only counts the part of the file the clip shows", () => {
    const { item, p } = projectWith(clip());
    const trimmed = { ...item, in: 14 * S, duration: 6 * S };
    expect(speechInClip(p.media.m1, trimmed).total).toBe(0);
  });

  it("skips clips with captions already under them", () => {
    const { p, item } = projectWith(clip());
    const caption: CaptionItem = {
      id: "c1", type: "caption", start: item.start + S, duration: 2 * S, transform: { ...IDENTITY },
      style: { text: "", font: "Inter", size: 60, weight: 600, color: "#fff", align: "center", lineHeight: 1.1, letterSpacing: 0 }, words: [],
    };
    const withCaption = insertItems(p, [caption], {});
    expect(captionOffers(withCaption, arrived)).toEqual([]);
  });

  it("skips muted tracks and reversed clips", () => {
    const { p, item } = projectWith(clip());
    const muted = { ...p, tracks: p.tracks.map(t => ({ ...t, muted: true })) };
    expect(captionOffers(muted, arrived)).toEqual([]);
    const reversed = { ...p, tracks: p.tracks.map(t => ({ ...t, items: t.items.map(i => (i.id === item.id ? { ...i, reversed: true } : i)) })) };
    expect(captionOffers(reversed, arrived)).toEqual([]);
  });

  it("lists several clips in timeline order for one question", () => {
    const a = clip({ id: "m1" });
    const b = clip({ id: "m2", path: "/v/b.mp4" });
    let p = addMedia(createProject("t"), [a, b]);
    p = insertItems(p, [mediaItem(b, 0), mediaItem(a, 20 * S)], { trackId: mainTrack(p).id });
    expect(captionOffers(p, new Set(["m1", "m2"])).map(o => o.media.id)).toEqual(["m2", "m1"]);
  });
});

describe("the setting", () => {
  it("is on by default and survives a hand edited file", () => {
    expect(DEFAULT_SETTINGS.offerCaptions).toBe(true);
    expect(sanitizeSettings({}).offerCaptions).toBe(true);
    expect(sanitizeSettings({ offerCaptions: false }).offerCaptions).toBe(false);
    expect(sanitizeSettings({ offerCaptions: "no" }).offerCaptions).toBe(true);
  });
});
