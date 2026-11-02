// A test clip whose every frame and second can be told apart again after an export.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
export const bin = name => process.env[name.toUpperCase()] ?? join("resources/ffmpeg", `${os}-${process.arch}`, process.platform === "win32" ? `${name}.exe` : name);

/** Ten black and white blocks across the picture spell the frame number in binary; a click opens every second. */
export function makeClip(file, seconds) {
  const r = spawnSync(bin("ffmpeg"), [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=320x180:r=30:d=${seconds},format=yuv420p,geq=lum='16+219*mod(floor(N/pow(2,floor(X/32))),2)':cb=128:cr=128`,
    "-f", "lavfi", "-i", `aevalsrc='if(lt(mod(t,1),0.02),0.8*sin(2*PI*1000*t),0)':s=48000:d=${seconds}`,
    "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", file,
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

/** The frame number each picture of the file shows, in order. */
export function frameNumbers(file) {
  const r = spawnSync(bin("ffmpeg"), ["-v", "error", "-i", file, "-an", "-vf", "scale=10:1:flags=area,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const out = [];
  for (let i = 0; i + 10 <= r.stdout.length; i += 10) {
    let n = 0;
    for (let k = 0; k < 10; k++) if (r.stdout[i + k] > 127) n |= 1 << k;
    out.push(n);
  }
  return out;
}

/** Seconds at which a click begins in the file's sound. */
export function clickTimes(file) {
  const r = spawnSync(bin("ffmpeg"), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const out = [];
  let last = -1e9;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 0.2 && i - last > 24_000) out.push(i / 48_000);
    if (Math.abs(samples[i]) > 0.2) last = i;
  }
  return out;
}
