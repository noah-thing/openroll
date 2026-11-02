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
    const r = parseProbe({ streams: [{ codec_type: "video", codec_name: "h264", width: 4_000_000_000, height: 1080 }], format: { duration: "1" } });
    expect(r.video).toBeNull();
  });

  it("caps a claimed duration", () => {
    const r = parseProbe({ streams: [{ codec_type: "audio", codec_name: "aac" }], format: { duration: "1e300" } });
    expect(r.duration).toBeLessThanOrEqual(360_000);
  });
});
