// Test media for the QA scenarios, made on whatever machine runs them.
// usage: node qa/make-media.mjs <folder>   (needs ffmpeg on PATH or in OPENROLL_FFMPEG_DIR)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const out = process.argv[2];
if (!out) throw new Error("usage: node qa/make-media.mjs <folder>");
mkdirSync(out, { recursive: true });
const bin = name => (process.env.OPENROLL_FFMPEG_DIR ? join(process.env.OPENROLL_FFMPEG_DIR, process.platform === "win32" ? `${name}.exe` : name) : name);
const ff = (...args) => execFileSync(bin("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const make = (file, fn) => {
  if (existsSync(join(out, file))) return;
  fn(join(out, file));
  console.log("made", file);
};

make("h264_1080p30_60s.mp4", f => ff("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30,format=yuv420p", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "60", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "60", "-c:a", "aac", "-shortest", f));
make("portrait_1080x1920_20s.mp4", f => ff("-f", "lavfi", "-i", "mandelbrot=size=1080x1920:rate=30", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-t", "20", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f));
make("hevc_4k30_30s.mp4", f => ff("-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30,format=yuv420p", "-t", "10", "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1", f));
make("tone_90s.mp3", f => ff("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100", "-t", "90", "-c:a", "libmp3lame", f));
for (const [name, filter] of [["ferry.jpg", "gradients=size=1280x720:c0=0x4a7ab0:c1=0xe8c08a:seed=3"], ["forest.jpg", "gradients=size=1280x720:c0=0x2f4a2a:c1=0xc9d6a0:seed=7"], ["coffee.jpg", "gradients=size=1280x720:c0=0x4a2f1f:c1=0xf0e2c8:seed=11"]]) {
  make(name, f => ff("-f", "lavfi", "-i", filter, "-frames:v", "1", f));
}

// Speech from the system's own voice: say on macOS, SAPI on Windows, espeak-ng on Linux.
const LINES = "Hello and welcome to the show. Today we are going to talk about sailing around the islands. Um, it was a cold morning and, ah, we left the harbor early. The wind was strong, so we reached the main sail. I think it was, like, ten knots.";
make("speech_video_en.mp4", f => {
  const wav = join(tmpdir(), "openroll-speech.wav");
  if (process.platform === "darwin") execFileSync("say", ["-o", wav, "--data-format=LEI16@22050", LINES]);
  else if (process.platform === "win32") {
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wav}'); $s.Speak('${LINES.replace(/'/g, "''")}'); $s.Dispose()`;
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
  } else execFileSync("espeak-ng", ["-w", wav, LINES]);
  ff("-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30,format=yuv420p", "-i", wav, "-af", "apad=pad_dur=1", "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", f);
});
writeFileSync(join(out, ".made"), new Date().toISOString());
