import { describe, expect, it } from "vitest";
import { readProject } from "../../src/core/load";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { createProject, mainTrack, type MediaRef } from "../../src/core/project";

const clip: MediaRef = { id: "m1", kind: "video", path: "/v/a.mp4", name: "a.mp4", size: 10, mtime: 5, duration: 2_000_000, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true };

function sample() {
  let p = addMedia(createProject("Trip"), [clip]);
  p = insertItems(p, [mediaItem(clip, 0)], { trackId: mainTrack(p).id });
  return p;
}

const load = (v: unknown) => readProject(typeof v === "string" ? v : JSON.stringify(v));

describe("readProject", () => {
  it("passes a healthy project through untouched", () => {
    const p = sample();
    const r = load(p);
    expect(r.ok && r.repairs).toEqual([]);
    expect(r.ok && r.project).toEqual(p);
  });

  it("refuses empty, truncated and foreign files with a reason", () => {
    expect(load("")).toMatchObject({ ok: false, error: expect.stringContaining("empty") });
    const text = JSON.stringify(sample());
    expect(load(text.slice(0, text.length - 40))).toMatchObject({ ok: false, error: expect.stringContaining("damaged") });
    expect(load({ hello: 1 })).toMatchObject({ ok: false, error: expect.stringContaining("not an OpenRoll") });
    expect(load("[1,2]")).toMatchObject({ ok: false });
    expect(load("null")).toMatchObject({ ok: false });
  });

  it("refuses a project from a newer version instead of guessing", () => {
    const r = load({ ...sample(), version: 2 });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("newer version") });
  });

  it("accepts a byte order mark and a missing version", () => {
    const { version: _v, ...rest } = sample();
    const r = load("﻿" + JSON.stringify(rest));
    expect(r.ok && r.project.version).toBe(1);
    expect(r.ok && r.repairs).toContain("version");
  });

  it("fills in what a hand edit removed", () => {
    const r = load({ format: "openroll", version: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.tracks.some(t => t.main)).toBe(true);
    expect(r.project.settings.width).toBe(1920);
    expect(r.project.markers).toEqual([]);
    expect(r.project.media).toEqual({});
    expect(r.project.id).toMatch(/^p/);
  });

  it("repairs broken settings and numbers", () => {
    const p = sample();
    const r = load({ ...p, settings: { ...p.settings, width: -4, fps: { num: 0, den: 0 }, background: "red" } });
    expect(r.ok && r.project.settings).toMatchObject({ width: 1920, fps: { num: 30, den: 1 }, background: "#000000" });
  });

  it("drops only the clips that cannot play and keeps the rest", () => {
    const p = sample();
    const good = p.tracks[0].items[0];
    const bad = [{ ...good, id: "x1", mediaId: "gone" }, { ...good, id: "x2", duration: "long" }, null, 7];
    const r = load({ ...p, tracks: [{ ...p.tracks[0], items: [good, ...bad] }, p.tracks[1]] });
    expect(r.ok && r.project.tracks[0].items.map(i => i.id)).toEqual([good.id]);
    expect(r.ok && r.repairs).toContain("clip dropped");
  });

  it("gives duplicate ids new ones and restores a missing main track", () => {
    const p = sample();
    const dupe = { ...p.tracks[0].items[0] };
    const tracks = [{ ...p.tracks[0], main: undefined, items: [p.tracks[0].items[0], dupe] }];
    const r = load({ ...p, tracks });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.project.tracks.flatMap(t => t.items.map(i => i.id));
    expect(new Set(ids).size).toBe(2);
    expect(r.project.tracks.filter(t => t.main)).toHaveLength(1);
  });

  it("keeps media entries that lost fields, so they can be relinked", () => {
    const p = sample();
    const r = load({ ...p, media: { m1: { path: "/v/a.mp4" }, m2: "junk" } });
    expect(r.ok && r.project.media.m1).toMatchObject({ id: "m1", path: "/v/a.mp4", kind: "video", duration: 0 });
    expect(r.ok && Object.keys(r.project.media)).toEqual(["m1"]);
  });

  it("keeps fields it does not know about", () => {
    const r = load({ ...sample(), future: { a: 1 } });
    expect(r.ok && (r.project as unknown as Record<string, unknown>).future).toEqual({ a: 1 });
  });

  it("does not let a media id swap the map's prototype", () => {
    const base = JSON.stringify(sample());
    const text = base.replace('"media":{', '"media":{"__proto__":{"path":"/etc/hosts","kind":"video"},');
    const r = load(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.getPrototypeOf(r.project.media)).toBe(Object.prototype);
    expect(Object.keys(r.project.media)).toEqual(["m1"]);
  });

  it("replaces a project id that would name a parent folder", () => {
    for (const id of ["..", ".", "../x", ".hidden"]) {
      const r = load({ ...sample(), id });
      expect(r.ok && r.project.id).not.toBe(id);
      expect(r.ok && r.repairs).toContain("id");
    }
  });

  it("drops clips that point at names inherited from Object", () => {
    const p = sample();
    const item = p.tracks[0].items[0];
    for (const mediaId of ["constructor", "toString", "hasOwnProperty"]) {
      const r = load({ ...p, tracks: [{ ...p.tracks[0], items: [{ ...item, mediaId }] }] });
      expect(r.ok && r.project.tracks[0].items).toEqual([]);
    }
  });

  it("caps times that no real edit reaches", () => {
    const p = sample();
    const item = p.tracks[0].items[0];
    const r = load({ ...p, media: { m1: { ...clip, duration: 1e300 } }, tracks: [{ ...p.tracks[0], items: [{ ...item, start: 1e300, duration: 1e300, in: 1e300 }] }] });
    expect(r.ok && r.project.media.m1.duration).toBe(1e12);
    expect(r.ok && r.project.tracks[0].items).toEqual([]);
  });

  describe("damage that used to get through", () => {
    const base = () => {
      const p = sample();
      return { p, item: p.tracks[0].items[0] as unknown as Record<string, unknown> };
    };
    const first = (r: ReturnType<typeof load>) => (r.ok ? (r.project.tracks[0].items[0] as unknown as Record<string, any>) : undefined);

    it("repairs keyframes with an unknown ease, bad entries or the wrong order", () => {
      const { p, item } = base();
      const keyframes = { "transform.scale": [{ t: 500, v: 2, ease: "bounce" }, { t: 0, v: 1, ease: "linear" }, { t: "x", v: 1 }, null], "transform.x": "no", "adjust.exposure": [] };
      const r = load({ ...p, tracks: [{ ...p.tracks[0], items: [{ ...item, keyframes }] }, p.tracks[1]] });
      expect(first(r)?.keyframes).toEqual({ "transform.scale": [{ t: 0, v: 1, ease: "linear" }, { t: 500, v: 2, ease: "linear" }] });
    });

    it("sorts a track, moves overlapping clips to their own lane and keeps every clip", () => {
      const { p, item } = base();
      const mk = (id: string, start: number) => ({ ...item, id, start, duration: 1_000_000 });
      const audio = { ...p.tracks[1], items: [mk("c", 3_000_000), mk("a", 0), mk("b", 500_000)] };
      const r = load({ ...p, tracks: [p.tracks[0], audio] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.project.tracks.slice(1).map(t => t.items.map(i => i.id))).toEqual([["a", "c"], ["b"]]);
      expect(r.project.tracks.filter(t => t.main)).toHaveLength(1);
    });

    it("packs a main track whose clips overlap or start late", () => {
      const { p, item } = base();
      const mk = (id: string, start: number) => ({ ...item, id, start, duration: 1_000_000 });
      const r = load({ ...p, tracks: [{ ...p.tracks[0], items: [mk("a", 0), mk("b", 200_000), mk("c", 9_000_000)] }, p.tracks[1]] });
      expect(r.ok && r.project.tracks[0].items.map(i => i.start)).toEqual([0, 1_000_000, 2_000_000]);
    });

    it("shortens a transition that is longer than the clips", () => {
      const { p, item } = base();
      const mk = (id: string, start: number, transitionIn?: unknown) => ({ ...item, id, start, duration: 400_000, ...(transitionIn ? { transitionIn } : {}) });
      const items = [mk("a", 0, { kind: "dissolve", duration: 300_000 }), mk("b", 400_000, { kind: "dissolve", duration: 5_000_000 })];
      const r = load({ ...p, tracks: [{ ...p.tracks[0], items }, p.tracks[1]] });
      expect(r.ok && r.project.tracks[0].items.map(i => i.transitionIn)).toEqual([undefined, { kind: "dissolve", duration: 200_000 }]);
    });

    it("replaces a frame rate that would make the frame length zero", () => {
      const p = sample();
      for (const fps of [{ num: 1e9, den: 1 }, { num: 1, den: 1e9 }]) {
        const r = load({ ...p, settings: { ...p.settings, fps } });
        expect(r.ok && r.project.settings.fps).toEqual({ num: 30, den: 1 });
      }
    });

    it("cleans text style, caption words and look fields", () => {
      const { p, item } = base();
      const caption = { id: "cap", type: "caption", start: 0, duration: 1_000_000, style: { text: "hi", size: "big" }, words: [{ text: "b", start: 900_000, end: 5_000_000 }, { text: "a", start: 100_000, end: 50_000 }, { text: 3 }] };
      const media = { ...item, mask: { shape: "star" }, crop: { left: "x" }, effects: [{ id: "e", kind: "blur", amount: "high" }], blend: "burn", adjust: { exposure: 1, grain: "lots" } };
      const r = load({ ...p, tracks: [{ ...p.tracks[0], items: [media] }, { ...p.tracks[1], id: "tx", kind: "text", items: [caption] }] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const m = r.project.tracks[0].items[0] as unknown as Record<string, unknown>;
      for (const k of ["mask", "crop", "effects", "blend"]) expect(m).not.toHaveProperty(k);
      expect(m.adjust).toEqual({ exposure: 1 });
      const c = r.project.tracks[1].items[0] as unknown as Record<string, any>;
      expect(c.style.size).toBe(96);
      expect(c.words).toEqual([{ text: "a", start: 100_000, end: 100_000 }, { text: "b", start: 900_000, end: 1_000_000 }]);
    });

    it("handles a track with thousands of clips quickly and ignores a __proto__ media entry", () => {
      const { p, item } = base();
      const items = Array.from({ length: 20_000 }, (_, i) => ({ ...item, id: "i" + i, start: i * 1_000_000, duration: 1_000_000 }));
      const text = JSON.stringify({ ...p, tracks: [{ ...p.tracks[0], items }, p.tracks[1]] }).replace('"media":{', '"media":{"__proto__":{"id":"x"},');
      const t0 = Date.now();
      const r = load(text);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(r.ok && r.project.tracks[0].items).toHaveLength(20_000);
      expect(r.ok && Object.keys(r.project.media)).toEqual(["m1"]);
    });
  });
});
