import { app } from "electron";
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface Binaries {
  ffmpeg: string;
  ffprobe: string | null;
}

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

function targetDir(): string {
  const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? process.platform;
  return `${os}-${process.arch}`;
}

function candidates(): string[] {
  const dirs: string[] = [];
  if (process.env.OPENROLL_FFMPEG_DIR) dirs.push(process.env.OPENROLL_FFMPEG_DIR);
  // Packaged builds copy resources/ffmpeg/<os>-<arch> to Resources/ffmpeg.
  if (app.isPackaged) dirs.push(join(process.resourcesPath, "ffmpeg"));
  else dirs.push(join(app.getAppPath(), "resources", "ffmpeg", targetDir()));
  return dirs;
}

let cached: Binaries | null | undefined;

/** The bundled binaries, then a system install as a last resort in development. Null means ffmpeg is not available. */
export function findBinaries(): Binaries | null {
  if (cached !== undefined) return cached;
  for (const dir of candidates()) {
    const ffmpeg = join(dir, exe("ffmpeg"));
    if (!existsSync(ffmpeg)) continue;
    const ffprobe = join(dir, exe("ffprobe"));
    prepare(ffmpeg);
    if (existsSync(ffprobe)) prepare(ffprobe);
    cached = { ffmpeg, ffprobe: existsSync(ffprobe) ? ffprobe : null };
    return cached;
  }
  if (!app.isPackaged) {
    const system = onPath("ffmpeg");
    if (system) cached = { ffmpeg: system, ffprobe: onPath("ffprobe") };
  }
  cached ??= null;
  return cached;
}

/** Zips and installers can drop the executable bit, and a downloaded app carries a quarantine mark. */
function prepare(file: string): void {
  if (process.platform === "win32") return;
  try {
    accessSync(file, constants.X_OK);
  } catch {
    try {
      chmodSync(file, 0o755);
    } catch {
      /* a read only install has to ship them executable already */
    }
  }
  if (process.platform === "darwin") spawn("xattr", ["-d", "com.apple.quarantine", file], { stdio: "ignore" }).on("error", () => {});
}

function onPath(name: string): string | null {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    const p = join(dir, exe(name));
    if (existsSync(p)) return p;
  }
  return null;
}
