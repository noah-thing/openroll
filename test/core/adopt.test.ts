import { describe, expect, it } from "vitest";
import { createProject, type MediaRef } from "../../src/core/project";
import { adoptFirstClip } from "../../src/renderer/state/importer";

const ref = (w: number, h: number, extra: Partial<MediaRef> = {}): MediaRef => ({
  id: "m", kind: "video", path: "/x.mov", name: "x.mov", size: 1, mtime: 0, duration: 1e6, hasAudio: true, hasVideo: true, width: w, height: h, ...extra,
});

describe("adoptFirstClip", () => {
  it("makes a vertical project from a vertical phone clip", () => {
    const p = adoptFirstClip(createProject(), [ref(1080, 1920, { fps: 29.98 })]);
    expect(p.settings).toMatchObject({ width: 1080, height: 1920, fps: { num: 30000, den: 1001 } });
  });

  it("honours rotation metadata", () => {
    const p = adoptFirstClip(createProject(), [ref(1920, 1080, { rotation: 90, fps: 60 })]);
    expect([p.settings.width, p.settings.height]).toEqual([1080, 1920]);
    expect(p.settings.fps).toEqual({ num: 60, den: 1 });
  });

  it("caps huge sources at 4K and ignores audio", () => {
    const p = adoptFirstClip(createProject(), [ref(0, 0, { kind: "audio" }), ref(7680, 4320, { fps: 24 })]);
    expect([p.settings.width, p.settings.height]).toEqual([3840, 2160]);
  });
});
