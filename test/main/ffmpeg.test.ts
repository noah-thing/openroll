import { describe, expect, it } from "vitest";
import { cacheKey, parseEncoders, pickH264, prepareArgs, proxyArgs } from "../../src/main/ffmpeg-args";
import { pipeArgs } from "../../src/main/ffmpeg-export-args";
import { failureReason, fraction, parseClock, parseDuration, ProgressParser } from "../../src/main/ffmpeg-progress";
import { keyframeInterval, parseProbe, snapRate } from "../../src/main/ffmpeg-probe";
import { CancelledError, JobQueue } from "../../src/main/ffmpeg-queue";
import type { StreamSummary } from "../../src/shared/derived";
import type { PipeSpec } from "../../src/shared/ffexport";

describe("progress parsing", () => {
  it("reads blocks split across chunks", () => {
    const p = new ProgressParser();
    expect(p.push("frame=10\nfps=24.5\nout_time_us=416")).toEqual([]);
    const out = p.push("666\nspeed=1.8x\nprogress=continue\nframe=20\nout_time_us=833333\nspeed=2x\nprogress=end\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ frame: 10, fps: 24.5, speed: 1.8, done: false });
    expect(out[0].time).toBeCloseTo(0.416666, 5);
    expect(out[1]).toMatchObject({ done: true, speed: 2 });
  });

  it("copes with N/A values and windows line endings", () => {
    const out = new ProgressParser().push("frame=0\r\nout_time_us=N/A\r\nout_time=N/A\r\nspeed=N/A\r\nprogress=continue\r\n");
    expect(out[0]).toMatchObject({ time: 0, speed: 0, done: false });
  });

  it("parses clocks, durations and fractions", () => {
    expect(parseClock("01:02:03.5")).toBeCloseTo(3723.5);
    expect(parseClock("N/A")).toBe(0);
    expect(parseDuration("  Duration: 00:00:12.50, start: 0.000000, bitrate: 1000 kb/s")).toBe(12.5);
    expect(fraction(5, 10)).toBe(0.5);
    expect(fraction(50, 10)).toBe(1);
    expect(fraction(1, 0)).toBe(0);
  });

  it("keeps the useful end of a failure", () => {
    const err = "ffmpeg version 9.0.2\nbuilt with clang\n  libavutil 60. 1\nInput #0, foo\nUnknown encoder 'libx264'\nError opening output file";
    expect(failureReason(err)).toBe("Input #0, foo Unknown encoder 'libx264' Error opening output file");
  });
});

describe("probe summary", () => {
  it("applies rotation, snaps the rate and finds alpha", () => {
    const s = parseProbe(
      [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':",
        "  Metadata:",
        "    major_brand     : qt  ",
        "  Duration: 00:00:10.00, start: 0.000000, bitrate: 39827 kb/s",
        "  Stream #0:0[0x1]: Video: prores (4444) (ap4h / 0x68347061), yuva444p10le(tv, bt709, progressive), 1920x1080, 39628 kb/s, SAR 1:1 DAR 16:9, 29.97 fps, 29.97 tbr, 30k tbn (default)",
        "    Metadata:",
        "    Side data:",
        "      Display Matrix: rotation of -90.00 degrees",
        "  Stream #0:1[0x2]: Audio: ac3 (ac-3 / 0x332D6361), 48000 Hz, 5.1(side), fltp, 192 kb/s (default)",
      ].join("\n"),
    );
    expect(s.video).toMatchObject({ width: 1080, height: 1920, fps: 29.97, hasAlpha: true, interlaced: false });
    expect(s.audio).toMatchObject({ codec: "ac3", channels: 6 });
    expect(s.duration).toBe(10);
  });

  it("reads the Windows build's output, whose lines end in \\r\\n", () => {
    const s = parseProbe(
      [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\clips\\a.mov':",
        "  Duration: 00:00:05.00, start: 0.000000, bitrate: 39827 kb/s",
        "  Stream #0:0[0x1](und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt709, progressive), 1280x720, 25 fps, 25 tbr, 12800 tbn (default)",
        "  Stream #0:1[0x2](und): Audio: ac3 (ac-3 / 0x332D6361), 48000 Hz, stereo, fltp, 192 kb/s (default)",
        "",
      ].join("\r\n"),
    );
    expect(s.video).toMatchObject({ codec: "prores", width: 1280, height: 720, fps: 25 });
    expect(s.audio).toMatchObject({ codec: "ac3", channels: 2, sampleRate: 48000 });
  });

  it("ignores cover art and snaps near rates", () => {
    const s = parseProbe(
      [
        "  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s",
        "  Stream #0:1: Video: mjpeg (Baseline), yuvj444p(pc, bt470bg/unknown/unknown), 300x300 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)",
      ].join("\n"),
    );
    expect(s.video).toBeNull();
    expect(s.audio).toMatchObject({ codec: "mp3", channels: 1, sampleRate: 44100 });
    expect(snapRate(29.9)).toBe(29.97);
    expect(snapRate(15)).toBe(15);
    expect(snapRate(0)).toBe(30);
  });

  it("reads interlacing, bare pixel formats and tbr only rates", () => {
    const s = parseProbe(
      [
        "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(top first), 640x360 [SAR 1:1 DAR 16:9], 664 kb/s, 25 tbr, 15k tbn (default)",
        "  Stream #0:1: Audio: mp2 (mp3float) ([3][0][0][0] / 0x0003), 44100 Hz, 6 channels, fltp, 384 kb/s",
      ].join("\n"),
    );
    expect(s.video).toMatchObject({ codec: "h264", interlaced: true, pixFmt: "yuv420p", fps: 25 });
    expect(s.audio?.channels).toBe(6);
    const bare = parseProbe("  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 600 kb/s, 29.97 fps, 29.97 tbr, 29.97 tbn");
    expect(bare.video).toMatchObject({ pixFmt: "yuv420p", interlaced: false, fps: 29.97 });
  });

  it("takes the old rotate tag and the longer stream duration", () => {
    const s = parseProbe(
      [
        "  Duration: 00:00:02.00, start: 0.000000, bitrate: 1 kb/s",
        "  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps",
        "    Metadata:",
        "      rotate          : 90",
        "      DURATION        : 00:00:02.002000000",
      ].join("\n"),
    );
    expect(s.video).toMatchObject({ width: 1080, height: 1920 });
    expect(s.duration).toBeCloseTo(2.002);
  });

  it("does not believe a tag that looks like a stream line", () => {
    const s = parseProbe(
      [
        "  Metadata:",
        "    title           : x",
        "                    :   Stream #0:0: Video: fake, 1x1, 1 fps",
        "  Stream #0:0: Audio: aac (LC), 44100 Hz, stereo, fltp",
        "    Metadata:",
        "      name            : Stream #0:9: Video: evil, 8000x8000, 1 fps",
      ].join("\n"),
    );
    expect(s.video).toBeNull();
    expect(s.audio).toMatchObject({ channels: 2 });
  });

  it("measures the keyframe gap", () => {
    expect(keyframeInterval([0, 2, 4, 6, 8, 10], 30)).toBe(2);
    expect(keyframeInterval([0], 5)).toBeNull();
    expect(keyframeInterval([0], 30)).toBe(30);
    expect(keyframeInterval([], 30)).toBeNull();
  });
});

const info = (over: Partial<StreamSummary> = {}): StreamSummary => ({
  duration: 10,
  video: { codec: "prores", width: 1920, height: 1080, fps: 25, interlaced: false, pixFmt: "yuv422p10le", hasAlpha: false },
  audio: { codec: "ac3", channels: 6, sampleRate: 48000 },
  ...over,
});
const encoders = new Set(["libx264", "h264_videotoolbox", "aac"]);

describe("conversion arguments", () => {
  it("parses an encoder listing", () => {
    const set = parseEncoders(" V....D libx264              libx264 H.264\n A....D aac                  AAC\n ------\n VFS..D prores_ks");
    expect([...set].sort()).toEqual(["aac", "libx264", "prores_ks"]);
  });

  it("prepares unreadable video as short GOP H.264 with stereo AAC", () => {
    const a = prepareArgs("/in/a.mov", "/out/a.part", info(), { encoders });
    expect(a).toContain("libx264");
    expect(a.join(" ")).toContain("-g 12 -bf 0");
    expect(a.join(" ")).toContain("-fps_mode cfr -r 25");
    expect(a.join(" ")).toContain("-ac 2");
    expect(a.at(-1)).toBe("/out/a.part");
  });

  it("makes odd sizes even and removes interlacing", () => {
    const a = prepareArgs("a", "b", info({ video: { ...info().video!, width: 1919, interlaced: true } }), { encoders }).join(" ");
    expect(a).toContain("yadif");
    expect(a).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  });

  it("copies decodable video when only the audio is the problem", () => {
    const a = prepareArgs("a", "b", info({ video: { ...info().video!, codec: "h264" } }), { encoders }, { videoDecodable: true }).join(" ");
    expect(a).toContain("-c:v copy");
    expect(a).toContain("-c:a aac");
  });

  it("turns audio only files into AAC without video", () => {
    const a = prepareArgs("a.ac3", "b", info({ video: null }), { encoders }).join(" ");
    expect(a).toContain("-vn");
    expect(a).not.toContain("libx264");
  });

  it("falls back across H.264 encoders and fails clearly with none", () => {
    expect(pickH264(new Set(["h264_videotoolbox"]), "quality")).toBe("h264_videotoolbox");
    expect(pickH264(encoders, "speed")).toBe("h264_videotoolbox");
    expect(() => prepareArgs("a", "b", info(), { encoders: new Set() })).toThrow(/H.264/);
  });

  it("makes a 960 short side proxy that keeps timestamps and audio", () => {
    const a = proxyArgs("a", "b", info({ video: { ...info().video!, codec: "hevc", width: 3840, height: 2160 }, audio: { codec: "aac", channels: 2, sampleRate: 48000 } }), { encoders: new Set(["libx264"]) }).join(" ");
    expect(a).toContain("scale=1706:960");
    expect(a).toContain("-fps_mode passthrough");
    expect(a).toContain("-c:a copy");
  });

  it("limits threads while playing", () => {
    expect(prepareArgs("a", "b", info(), { encoders, threads: 2 }).join(" ")).toContain("-threads 2");
  });

  it("keys the cache by path, size, mtime and kind", () => {
    const k = cacheKey("/a.mov", 10, 5, "prepare");
    expect(k).toHaveLength(20);
    expect(cacheKey("/a.mov", 11, 5, "prepare")).not.toBe(k);
    expect(cacheKey("/a.mov", 10, 6, "prepare")).not.toBe(k);
    expect(cacheKey("/a.mov", 10, 5, "proxy")).not.toBe(k);
    expect(cacheKey("C:\\Users\\me\\My Clips\\a.mov", 10, 5, "prepare")).toHaveLength(20);
  });
});

const spec = (over: Partial<PipeSpec> = {}): PipeSpec => ({ format: "prores4444", width: 640, height: 360, fps: 30, transparent: true, bitrate: 4_000_000, hasAudio: false, ...over });

describe("piped export arguments", () => {
  it("straightens premultiplied frames for ProRes 4444 with alpha", () => {
    const { main, twoPass } = pipeArgs(spec(), "pipe:0", null, "out.mov", "p.png");
    expect(twoPass).toBe(false);
    expect(main.join(" ")).toContain("vflip,unpremultiply=inplace=1,format=yuva444p10le");
    expect(main).toContain("-an");
  });

  it("uses an opaque pixel format when nothing is transparent", () => {
    expect(pipeArgs(spec({ transparent: false }), "pipe:0", null, "o", "p").main.join(" ")).toContain("vflip,format=yuv444p10le");
  });

  it("adds staged audio with a matching codec", () => {
    const m = pipeArgs(spec({ format: "prores422", hasAudio: true }), "pipe:0", "/tmp/a.f32", "o", "p").main.join(" ");
    expect(m).toContain("-f f32le -ar 48000 -ac 2 -i /tmp/a.f32");
    expect(m).toContain("-c:a pcm_s16le");
  });

  it("builds GIF as two passes over a staged file", () => {
    const a = pipeArgs(spec({ format: "gif", transparent: false }), "/tmp/f.rgba", null, "o.gif", "/tmp/p.png");
    expect(a.twoPass).toBe(true);
    expect(a.palette!.join(" ")).toContain("palettegen");
    expect(a.main.join(" ")).toContain("paletteuse");
  });

  it("keeps Windows paths with spaces as single arguments", () => {
    const out = "C:\\Users\\Ana Lopez\\Videos\\my clip.mov.openroll-part";
    expect(pipeArgs(spec(), "pipe:0", null, out, "p").main).toContain(out);
  });
});

describe("job queue", () => {
  const job = (id: string, heavy: boolean, priority: number, log: string[], gate: Promise<void>) => ({
    id,
    heavy,
    priority,
    run: async () => {
      log.push(`start ${id}`);
      await gate;
      log.push(`end ${id}`);
    },
  });
  const tick = () => new Promise(r => setTimeout(r, 5));

  it("runs one heavy job at a time while playing and two when idle", async () => {
    const q = new JobQueue(8);
    let open!: () => void;
    const gate = new Promise<void>(r => (open = r));
    const log: string[] = [];
    q.setPlayback(true);
    const all = [q.add(job("a", true, 1, log, gate)), q.add(job("b", true, 1, log, gate))];
    await tick();
    expect(log).toEqual(["start a"]);
    q.setPlayback(false);
    await tick();
    expect(log).toEqual(["start a", "start b"]);
    open();
    await Promise.all(all);
  });

  it("starts higher priority first and lets light jobs run beside heavy ones", async () => {
    const q = new JobQueue(4);
    let open!: () => void;
    const gate = new Promise<void>(r => (open = r));
    const log: string[] = [];
    const all = [q.add(job("slow", true, 1, log, gate)), q.add(job("low", true, 1, log, gate)), q.add(job("urgent", true, 9, log, gate)), q.add(job("probe", false, 0, log, gate))];
    await tick();
    expect(log).toEqual(["start slow", "start probe"]);
    open();
    await Promise.all(all);
    expect(log.indexOf("start urgent")).toBeLessThan(log.indexOf("start low"));
  });

  it("holds new heavy work while an export runs and cancels queued jobs", async () => {
    const q = new JobQueue(8);
    const log: string[] = [];
    const gate = Promise.resolve();
    q.hold("export");
    const queued = q.add(job("x", true, 1, log, gate));
    const caught = queued.catch(e => e);
    await tick();
    expect(log).toEqual([]);
    q.cancel("x");
    expect(await caught).toBeInstanceOf(CancelledError);
    q.release("export");
    await q.add(job("y", true, 1, log, gate));
    expect(log).toEqual(["start y", "end y"]);
  });

  it("aborts a running job through its signal", async () => {
    const q = new JobQueue(4);
    const p = q.add({ id: "r", heavy: true, priority: 1, run: ({ signal }) => new Promise<void>((_, rej) => signal.addEventListener("abort", () => rej(new Error("killed")))) });
    await tick();
    q.cancel("r");
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });
});
