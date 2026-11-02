// The fallback AAC encoder, forced on, writing a real file that the bundled ffmpeg reads back.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output } from "mediabunny";
import { describe, expect, it } from "vitest";
import { parseProbe } from "../../src/main/ffmpeg-probe";

const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? "";
const ffmpeg = join(__dirname, "../../resources/ffmpeg", `${os}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

describe.skipIf(!existsSync(ffmpeg))("wasm aac", { timeout: 60_000 }, () => {
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
    const probe = parseProbe(spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr);
    rmSync(dir, { recursive: true, force: true });
    expect(probe.audio).toMatchObject({ codec: "aac", channels: 2, sampleRate: 48000 });
    expect(probe.duration).toBeGreaterThan(0.9);
  });
});
