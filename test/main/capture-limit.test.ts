import { describe, expect, it } from "vitest";
import { capture } from "../../src/main/ffmpeg-runner";
import { parseProbe } from "../../src/main/ffmpeg-probe";

describe("capture", () => {
  it("returns what a short command printed", async () => {
    const r = await capture(process.execPath, ["-e", "process.stdout.write('{\"ok\":1}')"]);
    expect(r).toMatchObject({ stdout: '{"ok":1}', code: 0 });
  });

  it("gives up on output that never ends instead of filling memory", async () => {
    const r = await capture(process.execPath, ["-e", "const b='x'.repeat(1<<20);setInterval(()=>process.stdout.write(b),1)"], 15_000);
    expect(r.code).toBeNull();
    expect(r.stdout).toBe("");
  }, 20_000);
});

describe("parseProbe limits", () => {
  it("ignores a video stream with absurd dimensions", () => {
    const r = parseProbe("  Duration: 00:00:01.00, start: 0.000000\n  Stream #0:0: Video: h264, yuv420p, 4000000000x1080, 25 fps\n");
    expect(r.video).toBeNull();
  });

  it("caps a claimed duration", () => {
    const r = parseProbe("  Duration: 99999999:00:00.00, start: 0.000000\n  Stream #0:0: Audio: aac, 44100 Hz, stereo\n");
    expect(r.duration).toBeLessThanOrEqual(360_000);
  });

  it("keeps the start of a long listing and drops the rest", async () => {
    const r = await capture(process.execPath, ["-e", "process.stderr.write('head'+'x'.repeat(1<<20))"], 15_000, "head");
    expect(r.stderr.startsWith("head")).toBe(true);
    expect(r.stderr.length).toBeLessThanOrEqual(256 * 1024);
  });

  it("keeps both ends of a listing that is mostly chapters", async () => {
    const script = "process.stderr.write('  Duration: 00:00:03.00\\n'+'c'.repeat(1<<20)+'\\n  Stream #0:0: Audio: aac, 44100 Hz, mono\\n')";
    const r = await capture(process.execPath, ["-e", script], 15_000, "ends");
    expect(r.stderr.length).toBeLessThan(140 * 1024);
    expect(parseProbe(r.stderr)).toMatchObject({ duration: 3, audio: { codec: "aac", channels: 1 } });
  });
});
