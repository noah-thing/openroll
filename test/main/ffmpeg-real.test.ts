// Runs the real bundled binaries. Skipped where `node scripts/fetch-ffmpeg.mjs` has not been run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseEncoders, prepareArgs, proxyArgs } from "../../src/main/ffmpeg-args";
import { pipeArgs } from "../../src/main/ffmpeg-export-args";
import { parseProbe } from "../../src/main/ffmpeg-probe";
import type { PipeFormat, PipeSpec } from "../../src/shared/ffexport";

const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? "";
const dir = join(__dirname, "../../resources/ffmpeg", `${os}-${process.arch}`);
const ffmpeg = join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const have = existsSync(ffmpeg) && existsSync(ffprobe);

const tmp = mkdtempSync(join(tmpdir(), "openroll-ffreal-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const run = (args: string[]) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-y", "-nostdin", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr.slice(-600));
};
const probe = (file: string) => {
  const r = spawnSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" });
  return parseProbe(JSON.parse(r.stdout)) as ReturnType<typeof parseProbe> & { raw: { streams: { codec_name: string; pix_fmt?: string }[] } };
};
const streams = (file: string) => JSON.parse(spawnSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" }).stdout).streams as { codec_name: string; pix_fmt?: string; width?: number; nb_frames?: string }[];

describe.skipIf(!have)("real ffmpeg", { timeout: 120_000 }, () => {
  const W = 320, H = 180;
  const raw = join(tmp, "frames.rgba");
  const audio = join(tmp, "audio.f32");

  it("renders raw premultiplied frames to test with", () => {
    // Left half opaque, right half fully transparent.
    run(["-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:r=30:d=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,${W / 2}),255,0)'`, "-f", "rawvideo", "-pix_fmt", "rgba", raw]);
    writeFileSync(audio, Buffer.alloc(48000 * 2 * 4));
    expect(existsSync(raw)).toBe(true);
  });

  const spec = (format: PipeFormat, over: Partial<PipeSpec> = {}): PipeSpec => ({ format, width: W, height: H, fps: 30, transparent: false, bitrate: 1_000_000, hasAudio: false, ...over });
  const encode = (s: PipeSpec, name: string) => {
    const out = join(tmp, name);
    const a = pipeArgs(s, raw, s.hasAudio ? audio : null, out, join(tmp, `${name}.png`));
    if (a.twoPass) run(a.palette!);
    run(a.main);
    return out;
  };

  it("writes ProRes 422 with audio", () => {
    const f = encode(spec("prores422", { hasAudio: true }), "p422.mov");
    const s = streams(f);
    expect(s.find(x => x.codec_name === "prores")?.pix_fmt).toBe("yuv422p10le");
    expect(s.some(x => x.codec_name === "pcm_s16le")).toBe(true);
    expect(s.find(x => x.codec_name === "prores")?.nb_frames).toBe("30");
  });

  it("keeps the last picture when the sound ends part way through it", () => {
    const frames = join(tmp, "frames31.rgba");
    run(["-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:r=30:d=1.0333334,format=rgba`, "-f", "rawvideo", "-pix_fmt", "rgba", frames]);
    const short = join(tmp, "audio1010.f32");
    writeFileSync(short, Buffer.alloc(Math.round(48000 * 1.01) * 2 * 4));
    for (const format of ["prores422", "mp4-x264", "webm-vp9"] as const) {
      const out = join(tmp, `short-${format}.out`);
      const a = pipeArgs(spec(format, { hasAudio: true }), frames, short, out, join(tmp, "p.png"));
      run(a.main);
      const read = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
      expect(read.stdout.trim(), format).toBe("31");
    }
  });

  it("writes ProRes 4444 with a real alpha channel", () => {
    const f = encode(spec("prores4444", { transparent: true }), "p4444.mov");
    expect(streams(f)[0]).toMatchObject({ codec_name: "prores", pix_fmt: "yuva444p12le" });
    // Decode back: the right side must still be transparent and the left opaque.
    const out = spawnSync(ffmpeg, ["-v", "error", "-i", f, "-vf", `crop=1:1:${W - 4}:10,format=rgba`, "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: "buffer" }).stdout;
    const left = spawnSync(ffmpeg, ["-v", "error", "-i", f, "-vf", "crop=1:1:4:10,format=rgba", "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: "buffer" }).stdout;
    expect(out[3]).toBe(0);
    expect(left[3]).toBe(255);
  });

  it("writes an opaque ProRes 4444 when nothing is transparent", () => {
    expect(streams(encode(spec("prores4444"), "p4444o.mov"))[0].pix_fmt).toMatch(/^yuv444p/);
  });

  it("writes a GIF with the right size and frame count", () => {
    const f = encode(spec("gif"), "a.gif");
    expect(streams(f)[0]).toMatchObject({ codec_name: "gif", width: W, nb_frames: "30" });
  });

  it("writes a transparent GIF", () => {
    const f = encode(spec("gif", { transparent: true }), "t.gif");
    expect(streams(f)[0].codec_name).toBe("gif");
  });

  it("writes VP9 WebM with alpha and x264 and x265 MP4s", () => {
    expect(streams(encode(spec("webm-vp9", { transparent: true }), "a.webm"))[0].codec_name).toBe("vp9");
    expect(streams(encode(spec("mp4-x264", { hasAudio: true }), "x264.mp4")).map(s => s.codec_name).sort()).toEqual(["aac", "h264"]);
    expect(streams(encode(spec("mp4-x265"), "x265.mp4"))[0].codec_name).toBe("hevc");
  });

  it("prepares ProRes with AC-3 audio into H.264 and AAC, and builds a proxy", () => {
    const src = join(tmp, "src.mov");
    run(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "prores_ks", "-profile:v", "3", "-c:a", "ac3", "-ac", "6", src]);
    const info = probe(src);
    const encoders = parseEncoders(spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout);
    expect(info.video?.codec).toBe("prores");
    const out = join(tmp, "prepared.mp4");
    run(prepareArgs(src, out, info, { encoders }).slice(0, -1).concat(["-f", "mp4", out]));
    const s = streams(out);
    expect(s.map(x => x.codec_name).sort()).toEqual(["aac", "h264"]);
    expect(s.find(x => x.codec_name === "h264")).toMatchObject({ width: 1280, pix_fmt: "yuv420p", nb_frames: "50" });

    const big = join(tmp, "big.mp4");
    run(["-f", "lavfi", "-i", "testsrc2=s=2560x1440:r=30:d=2", "-c:v", "libx264", "-g", "120", big]);
    const proxy = join(tmp, "proxy.mp4");
    run(proxyArgs(big, proxy, probe(big), { encoders }).slice(0, -1).concat(["-f", "mp4", proxy]));
    expect(streams(proxy)[0]).toMatchObject({ codec_name: "h264", width: 1706, nb_frames: "60" });
  });
  it("encodes an audio only m4a from the staged mix, for Chromium builds with no AAC encoder", () => {
    const spec: PipeSpec = { format: "m4a-aac", width: W, height: H, fps: 30, transparent: false, bitrate: 0, hasAudio: true };
    const out = join(tmp, "sound.m4a");
    run(pipeArgs(spec, "pipe:0", audio, out, "").main);
    const s = streams(out);
    expect(s.map(x => x.codec_name)).toEqual(["aac"]);
  });
});
