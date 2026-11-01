import { describe, expect, it } from "vitest";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { applyLayout, partnerOf, placeIn } from "../../src/core/layouts";
import { createProject, findItem, mainTrack, type MediaItem, type MediaRef } from "../../src/core/project";
import { fitSize } from "../../src/core/scene";
import { GUIDES, covered, guideById } from "../../src/core/safe-zones";
import { buildShort, coverScale, panKeyframes, SHORT_HEIGHT, SHORT_WIDTH } from "../../src/core/shorts";
import { STICKERS, STICKER_GROUPS, stickerById, stickerSvg } from "../../src/core/stickers";
import { newShape, placeOverlay } from "../../src/core/shapes";
import { buildScene } from "../../src/core/scene";
import type { TimedWord } from "../../src/core/captions";

const S = 1_000_000;
const media = (id: string, w = 1920, h = 1080, duration = 120): MediaRef => ({ id, kind: "video", path: `/${id}.mp4`, name: id, size: 1, mtime: 1, duration: duration * S, hasAudio: true, hasVideo: true, width: w, height: h });

describe("layouts", () => {
  const p = createProject();
  const m = media("a");

  it("puts a corner picture inside the frame with a margin", () => {
    const at = placeIn(p, m, "pip-br");
    const fit = fitSize(p, m);
    const w = fit.width * at.scale, h = fit.height * at.scale;
    expect(at.x + w / 2).toBeLessThan(p.settings.width / 2);
    expect(at.y + h / 2).toBeLessThan(p.settings.height / 2);
    expect(at.x).toBeGreaterThan(0);
    expect(at.y).toBeGreaterThan(0);
    expect(placeIn(p, m, "pip-tl").x).toBe(-at.x);
    expect(at.crop).toBeUndefined();
  });

  it("fills the top half exactly: covered box minus crop equals the region", () => {
    const at = placeIn(p, m, "top");
    const fit = fitSize(p, m);
    const crop = at.crop!;
    const shownW = fit.width * at.scale * (1 - crop.left - crop.right);
    const shownH = fit.height * at.scale * (1 - crop.top - crop.bottom);
    expect(shownW).toBeCloseTo(p.settings.width, 3);
    expect(shownH).toBeCloseTo(p.settings.height / 2, 3);
    expect(at.y).toBe(-p.settings.height / 4);
  });

  it("covers a half for a portrait source without letting it spill", () => {
    const at = placeIn(p, media("v", 1080, 1920), "left");
    const fit = fitSize(p, media("v", 1080, 1920));
    const c = at.crop!;
    expect(fit.width * at.scale * (1 - c.left - c.right)).toBeCloseTo(p.settings.width / 2, 3);
    expect(fit.height * at.scale * (1 - c.top - c.bottom)).toBeCloseTo(p.settings.height, 3);
  });

  function two() {
    let q = addMedia(createProject(), [media("a"), media("b")]);
    const a = mediaItem(q.media.a, 0), b = mediaItem(q.media.b, 0);
    q = insertItems(q, [a]);
    // The second clip goes on an overlay lane, over the same time.
    q = insertItems(q, [b], { trackId: undefined });
    return { q, a, b };
  }

  it("applies a layout to the clip and keeps its other settings", () => {
    const { q, a } = two();
    const r = applyLayout(q, a.id, "pip-tr");
    const item = findItem(r, a.id)!.item as MediaItem;
    expect(item.transform.scale).toBeLessThan(0.5);
    expect(item.transform.opacity).toBe(1);
    expect(r).not.toBe(q);
    expect(findItem(q, a.id)!.item.transform.scale).toBe(1);
  });

  it("full frame clears a crop and the keyframes on the transform", () => {
    const { q, a } = two();
    const split = applyLayout(q, a.id, "top");
    const item = findItem(split, a.id)!.item as MediaItem;
    item.keyframes = { "transform.x": [{ t: 0, v: 5, ease: "linear" }], "adjust.exposure": [{ t: 0, v: 1, ease: "linear" }] };
    const back = applyLayout(split, a.id, "full");
    const out = findItem(back, a.id)!.item as MediaItem;
    expect(out.crop).toBeUndefined();
    expect(out.transform.scale).toBe(1);
    expect(Object.keys(out.keyframes ?? {})).toEqual(["adjust.exposure"]);
  });

  it("finds the clip on another track as the partner of a split", () => {
    let q = addMedia(createProject(), [media("a"), media("b")]);
    const a = mediaItem(q.media.a, 0), b = mediaItem(q.media.b, 2 * S);
    q = insertItems(q, [a]);
    q = { ...q, tracks: [{ id: "over", kind: "video", name: "Overlay", items: [b] }, ...q.tracks] };
    expect(partnerOf(q, a.id)?.id).toBe(b.id);
    const r = applyLayout(q, a.id, "top");
    expect((findItem(r, b.id)!.item as MediaItem).transform.y).toBe(q.settings.height / 4);
  });

  it("does nothing for audio and unknown ids", () => {
    const q = createProject();
    expect(applyLayout(q, "nope", "top")).toBe(q);
  });
});

describe("safe zones", () => {
  it("has the three apps plus title and action safe", () => {
    expect(GUIDES.map(g => g.id)).toEqual(["tiktok", "shorts", "reels", "title", "action"]);
  });
  it("covers the side buttons and the bottom caption but not the middle", () => {
    for (const id of ["tiktok", "shorts", "reels"] as const) {
      const g = guideById(id);
      expect(covered(g, 0.95, 0.6)).toBe(true);
      expect(covered(g, 0.3, 0.92)).toBe(true);
      expect(covered(g, 0.4, 0.4)).toBe(false);
    }
  });
  it("keeps every zone inside the frame", () => {
    for (const g of GUIDES) for (const z of g.covered) expect(z.x + z.w).toBeLessThanOrEqual(1.0001), expect(z.y + z.h).toBeLessThanOrEqual(1.0001);
  });
});

describe("stickers and shapes", () => {
  it("has about thirty, each with a unique id and some drawing", () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(STICKERS.map(s => s.id)).size).toBe(STICKERS.length);
    for (const s of STICKERS) expect(s.paths.length).toBeGreaterThan(0);
    for (const g of STICKER_GROUPS) expect(STICKERS.some(s => s.group === g)).toBe(true);
  });

  it("only uses path commands the canvas understands, with finite numbers", () => {
    for (const s of STICKERS) for (const p of s.paths) {
      expect(p.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/);
      for (const n of p.d.match(/-?\d+\.?\d*/g) ?? []) expect(Number.isFinite(Number(n))).toBe(true);
    }
  });

  it("renders SVG with the chosen colour", () => {
    expect(stickerSvg(stickerById("check")!, "#123456")).toContain("#123456");
  });

  it("makes a shape item the compositor can draw", () => {
    const p = createProject();
    const item = newShape(p, 0, { kind: "sticker", sticker: "heart" });
    expect(item.shape.color).toBe("#e2674f");
    expect(item.width).toBeGreaterThan(0);
    const q = placeOverlay(p, item);
    expect(mainTrack(q).items).toHaveLength(0);
    const nodes = buildScene(q, 1000);
    expect(nodes.some(n => n.kind === "visual" && n.visual.kind === "shape")).toBe(true);
    const rect = newShape(p, 0, { kind: "rect" });
    expect(rect.shape.radius).toBe(24);
  });
});

describe("buildShort", () => {
  const source = (() => {
    let p = createProject("Long talk");
    const m = media("talk", 1920, 1080, 600);
    p = addMedia(p, [m]);
    p = insertItems(p, [mediaItem(m, 0)]);
    return p;
  })();
  const clip = mainTrack(source).items[0] as MediaItem;
  const words: TimedWord[] = "Here is the one thing that changes everything for you, so listen closely now.".split(" ").map((t, i) => ({ text: t, start: 100 * S + i * 400_000, end: 100 * S + i * 400_000 + 350_000 }));

  it("makes a tall project with just the stretch", () => {
    const short = buildShort({ source, clip, from: 98 * S, to: 130 * S, words });
    expect(short.settings.width).toBe(SHORT_WIDTH);
    expect(short.settings.height).toBe(SHORT_HEIGHT);
    expect(short.id).not.toBe(source.id);
    const item = mainTrack(short).items[0] as MediaItem;
    expect(item.in).toBe(98 * S);
    expect(item.duration).toBe(32 * S);
    expect(item.start).toBe(0);
    expect(short.media.talk).toBeDefined();
  });

  it("fills the frame from the centre", () => {
    const short = buildShort({ source, clip, from: 0, to: 20 * S, words: [] });
    const item = mainTrack(short).items[0] as MediaItem;
    expect(item.transform.scale).toBeCloseTo(coverScale(short, short.media.talk));
    expect(item.transform.x).toBe(0);
    const fit = fitSize(short, short.media.talk);
    expect(fit.height * item.transform.scale).toBeCloseTo(SHORT_HEIGHT, 3);
  });

  it("puts the words of the stretch on a caption track, retimed to the start", () => {
    const short = buildShort({ source, clip, from: 99 * S, to: 125 * S, words });
    const track = short.tracks.find(t => t.name === "Captions")!;
    expect(track).toBeDefined();
    expect(track.items.length).toBeGreaterThan(0);
    expect(track.items[0].start).toBe(1 * S);
  });

  it("leaves captions off when asked", () => {
    const short = buildShort({ source, clip, from: 99 * S, to: 125 * S, words, captions: null });
    expect(short.tracks.find(t => t.name === "Captions")).toBeUndefined();
  });

  it("accepts a subject track and pans inside the slack the crop leaves", () => {
    const short = buildShort({ source, clip, from: 0, to: 20 * S, words: [], reframe: { points: [{ t: 0, x: 0.5 }, { t: 5 * S, x: 0.9 }, { t: 9 * S, x: 0 }] } });
    const item = mainTrack(short).items[0] as MediaItem;
    const keys = item.keyframes!["transform.x"];
    expect(keys[0].v).toBe(0);
    const shown = fitSize(short, short.media.talk).width * item.transform.scale;
    const slack = (shown - SHORT_WIDTH) / 2;
    expect(keys[1].v).toBeLessThan(0);
    expect(Math.abs(keys[2].v)).toBeLessThanOrEqual(Math.ceil(slack));
  });

  it("panKeyframes never pans past the edge of the picture", () => {
    const p = createProject("x", { width: 1080, height: 1920 });
    const m = media("a");
    const s = coverScale(p, m);
    const k = panKeyframes(p, m, s, { points: [{ t: 0, x: -3 }, { t: 1, x: 4 }] });
    const slack = (fitSize(p, m).width * s - 1080) / 2;
    expect(Math.abs(k[0].v)).toBeLessThanOrEqual(Math.ceil(slack));
    expect(Math.abs(k[1].v)).toBeLessThanOrEqual(Math.ceil(slack));
  });
});
