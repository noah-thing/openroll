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
    const s = parseProbe({
      format: { duration: "10.0" },
      streams: [
        { codec_type: "video", codec_name: "prores", width: 1920, height: 1080, avg_frame_rate: "30000/1001", pix_fmt: "yuva444p10le", side_data_list: [{ rotation: -90 }], field_order: "progressive" },
        { codec_type: "audio", codec_name: "ac3", channels: 6, sample_rate: "48000" },
      ],
    });
    expect(s.video).toMatchObject({ width: 1080, height: 1920, fps: 29.97, hasAlpha: true, interlaced: false });
    expect(s.audio).toMatchObject({ codec: "ac3", channels: 6 });
    expect(s.duration).toBe(10);
  });

  it("ignores cover art and snaps near rates", () => {
    const s = parseProbe({ streams: [{ codec_type: "video", width: 500, height: 500, avg_frame_rate: "90000/1", disposition: { attached_pic: 1 } }, { codec_type: "audio", codec_name: "mp3" }] });
    expect(s.video).toBeNull();
    expect(snapRate(29.9)).toBe(29.97);
    expect(snapRate(15)).toBe(15);
    expect(snapRate(0)).toBe(30);
  });

  it("measures the keyframe gap", () => {
    const pk = (t: number, k: boolean) => ({ pts_time: String(t), flags: k ? "K__" : "___" });
    const every2 = Array.from({ length: 61 }, (_, i) => pk(i / 2, i % 4 === 0));
    expect(keyframeInterval(every2)).toBe(2);
    expect(keyframeInterval([pk(0, true), pk(1, false)])).toBeNull();
    expect(keyframeInterval([pk(0, true), pk(30, false)])).toBe(30);
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
