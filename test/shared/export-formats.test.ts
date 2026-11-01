import { describe, expect, it } from "vitest";
import { estimateBytes, gifFrame, hasExtension, hasNoBackground, ladder, pipeFormat } from "../../src/engine/export-formats";

describe("export retry ladder", () => {
  it("tries hardware, then software, then ffmpeg for MP4", () => {
    expect(ladder({ format: "mp4", transparent: false }, true)).toEqual(["hardware", "software", "ffmpeg"]);
    expect(ladder({ format: "mp4", transparent: false }, false)).toEqual(["hardware", "software"]);
  });

  it("sends ProRes and GIF only through ffmpeg, and has nothing without it", () => {
    expect(ladder({ format: "prores4444", transparent: true }, true)).toEqual(["ffmpeg"]);
    expect(ladder({ format: "gif", transparent: false }, false)).toEqual([]);
  });

  it("encodes transparent WebM with ffmpeg and opaque WebM with WebCodecs first", () => {
    expect(ladder({ format: "webm", transparent: true }, true)).toEqual(["ffmpeg"]);
    expect(ladder({ format: "webm", transparent: false }, true)[0]).toBe("hardware");
  });

  it("needs no retries for audio and stills", () => {
    expect(ladder({ format: "wav", transparent: false }, false)).toEqual(["software"]);
    expect(ladder({ format: "png", transparent: true }, false)).toEqual(["software"]);
  });
});

describe("export formats", () => {
  it("maps formats to ffmpeg encoders", () => {
    expect(pipeFormat({ format: "mp4", codec: "hevc" })).toBe("mp4-x265");
    expect(pipeFormat({ format: "mp4", codec: "avc" })).toBe("mp4-x264");
    expect(pipeFormat({ format: "webm", codec: "vp9" })).toBe("webm-vp9");
    expect(() => pipeFormat({ format: "wav", codec: "avc" })).toThrow();
  });

  it("caps GIFs to 640 pixels and 15 fps", () => {
    expect(gifFrame(1920, 1080, 30)).toEqual({ width: 640, height: 360, fps: 15 });
    expect(gifFrame(320, 240, 10)).toEqual({ width: 320, height: 240, fps: 10 });
  });

  it("knows a project with no background", () => {
    expect(hasNoBackground("none")).toBe(true);
    expect(hasNoBackground("#000000")).toBe(false);
  });

  it("estimates sizes", () => {
    expect(estimateBytes({ format: "wav", width: 0, height: 0, fps: 0, bitrate: 0 }, 10, false)).toBe(1_920_000);
  });
});

describe("output path check", () => {
  it("accepts only the extension the file will hold", () => {
    expect(hasExtension("/Users/a/clip.MP4", "mp4")).toBe(true);
    expect(hasExtension("/Users/a/clip.webm", "mp4")).toBe(false);
    expect(hasExtension("/Users/a/clip.mp4.mov", "mp4")).toBe(false);
    expect(hasExtension("/Users/a/mp4", "mp4")).toBe(false);
  });
});
