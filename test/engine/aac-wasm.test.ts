// The fallback AAC encoder, forced on, writing a real file that the bundled ffprobe reads back.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output } from "mediabunny";
import { describe, expect, it } from "vitest";

const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? "";
const ffprobe = join(__dirname, "../../resources/ffmpeg", `${os}-${process.arch}`, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

describe.skipIf(!existsSync(ffprobe))("wasm aac", { timeout: 60_000 }, () => {
  it("encodes a second of stereo into an m4a", async () => {
    registerAacEncoder();
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new AudioSampleSource({ codec: "aac", bitrate: 192_000 });
    output.addAudioTrack(source);
    await output.start();
    const data = new Float32Array(48000 * 2);
    for (let i = 0; i < 48000; i++) data[i] = data[48000 + i] = Math.sin(i / 20) * 0.3;
    const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: 48000, timestamp: 0 });
    await source.add(sample);
    sample.close();
    await output.finalize();

    const dir = mkdtempSync(join(tmpdir(), "openroll-aac-"));
    const file = join(dir, "tone.m4a");
    writeFileSync(file, new Uint8Array(target.buffer!));
    const probe = JSON.parse(spawnSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" }).stdout);
    rmSync(dir, { recursive: true, force: true });
    expect(probe.streams[0]).toMatchObject({ codec_name: "aac", channels: 2, sample_rate: "48000" });
    expect(Number(probe.streams[0].duration)).toBeGreaterThan(0.9);
  });
});
