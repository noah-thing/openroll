import { app, net } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { access, chmod, constants, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateState, WhatsNew } from "../shared/api";
import { renameBusy } from "./fs-retry";
import { LATEST_RELEASE_API, releaseByTagApi } from "../shared/links";
import { checksumsAsset, isNewer, packagingFor, parseChecksums, parseRelease, pickAsset, type Packaging, type Release, type ReleaseAsset } from "../shared/update-logic";

const DAY = 24 * 60 * 60 * 1000;

interface Staged {
  version: string;
  packaging: Packaging;
  /** File to hand to the platform step: the extracted .app, the installer, or the new AppImage or exe. */
  file: string;
}

/**
 * Checks GitHub Releases, downloads the build for this machine in the background and applies it
 * when the app quits. Nothing here talks to the user unless they asked: a missing feed, a private
 * repository and a dead network all end as "no update".
 */
export class Updater {
  private state: UpdateState = { status: "idle" };
  private staged: Staged | null = null;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private relaunch = false;
  private offered: Release | null = null;

  constructor(
    private send: (s: UpdateState) => void,
    private autoEnabled: () => boolean,
  ) {}

  private get feed(): string {
    return process.env.OPENROLL_UPDATE_FEED || LATEST_RELEASE_API;
  }

  private get dir(): string {
    return join(app.getPath("userData"), "updates");
  }

  getState(): UpdateState {
    return this.state;
  }

  private set(s: UpdateState): void {
    this.state = s;
    this.send(s);
  }

  /** Called once at startup: look soon after launch, then check again every few hours if a day has passed. */
  start(): void {
    if (!app.isPackaged && !process.env.OPENROLL_UPDATE_FEED) return;
    setTimeout(() => void this.maybeCheck(), 20_000).unref();
    this.timer = setInterval(() => void this.maybeCheck(), 4 * 60 * 60 * 1000);
    this.timer.unref();
  }

  /** With automatic updates off we still look, but only offer; nothing downloads until asked. */
  private async maybeCheck(): Promise<void> {
    const last = await readFile(join(app.getPath("userData"), "update-state.json"), "utf8").then(t => Number(JSON.parse(t).lastCheck) || 0).catch(() => 0);
    if (Date.now() - last >= DAY) await this.check(false);
  }

  async check(asked: boolean): Promise<void> {
    if (this.busy || this.state.status === "ready") {
      if (asked) this.set({ ...this.state, asked: true });
      return;
    }
    this.busy = true;
    if (asked) this.set({ status: "checking", asked });
    try {
      await writeFile(join(app.getPath("userData"), "update-state.json"), JSON.stringify({ lastCheck: Date.now() })).catch(() => {});
      const release = await this.latest();
      if (release === "unreachable") return this.set({ status: asked ? "unreachable" : "idle", asked });
      if (!release || !isNewer(release.version, app.getVersion())) return this.set({ status: asked ? "current" : "idle", asked });
      if (!asked && !this.autoEnabled()) {
        this.offered = release;
        return this.set({ status: "available", version: release.version, notes: release.notes, pageUrl: release.pageUrl });
      }
      await this.fetchAndStage(release, asked);
    } catch {
      this.set({ status: asked ? "unreachable" : "idle", asked });
    } finally {
      this.busy = false;
    }
  }

  /** The newest release, null when there is none (404 while the repository is private), "unreachable" when offline. */
  private async latest(): Promise<Release | null | "unreachable"> {
    let res: Response;
    try {
      res = await net.fetch(this.feed, { headers: { Accept: "application/vnd.github+json", "User-Agent": `OpenRoll/${app.getVersion()}` } });
    } catch {
      return "unreachable";
    }
    if (!res.ok) return res.status >= 500 ? "unreachable" : null;
    return parseRelease(await res.json().catch(() => null));
  }

  async downloadOffered(): Promise<void> {
    const release = this.offered;
    if (!release || this.busy) return;
    this.busy = true;
    try {
      await this.fetchAndStage(release, true);
    } catch {
      this.set({ status: "unreachable", asked: true });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Called once per launch. When the version changed since the last run, returns its notes:
   * kept from the download when this app updated itself, fetched otherwise.
   */
  async whatsNew(): Promise<WhatsNew | null> {
    const marker = join(app.getPath("userData"), "last-version.json");
    const version = app.getVersion();
    const previous = await readFile(marker, "utf8").then(t => String(JSON.parse(t).version)).catch(() => null);
    await writeFile(marker, JSON.stringify({ version })).catch(() => {});
    if (!previous || previous === version || !isNewer(version, previous)) return null;
    const saved = await readFile(join(app.getPath("userData"), "release-notes.json"), "utf8").then(t => JSON.parse(t) as WhatsNew).catch(() => null);
    if (saved?.version === version) return saved;
    try {
      const res = await net.fetch(releaseByTagApi(`v${version}`), { headers: { Accept: "application/vnd.github+json", "User-Agent": `OpenRoll/${version}` } });
      const release = res.ok ? parseRelease(await res.json()) : null;
      return { version, notes: release?.notes ?? "", pageUrl: release?.pageUrl };
    } catch {
      return { version, notes: "" };
    }
  }

  private runtime() {
    return {
      platform: process.platform,
      arch: process.arch,
      portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      appImage: !!process.env.APPIMAGE,
    };
  }

  private async fetchAndStage(release: Release, asked: boolean): Promise<void> {
    const rt = this.runtime();
    const picked = pickAsset(release.assets, rt);
    const packaging = packagingFor(rt);
    // A deb or a read only install cannot replace itself; tell the person and point at the release.
    if (!picked || packaging === "deb" || !(await this.canReplaceSelf(packaging))) {
      return this.set({ status: "manual", version: release.version, pageUrl: release.pageUrl, asked });
    }
    const sums = checksumsAsset(release.assets);
    if (!sums) return this.set({ status: asked ? "unreachable" : "idle", asked });

    const sumsText = await net.fetch(sums.url).then(r => (r.ok ? r.text() : null));
    const expected = sumsText ? parseChecksums(sumsText).get(picked.asset.name) : undefined;
    if (!expected) return this.set({ status: asked ? "unreachable" : "idle", asked });

    this.set({ status: "downloading", version: release.version, progress: 0, asked });
    const folder = join(this.dir, release.version);
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
    await mkdir(folder, { recursive: true });
    const file = join(folder, picked.asset.name);
    await this.download(picked.asset, file, expected, p => this.set({ status: "downloading", version: release.version, progress: p, asked }));

    const staged = await this.stage(release.version, picked.packaging, file, folder);
    if (!staged) {
      await rm(this.dir, { recursive: true, force: true }).catch(() => {});
      return this.set({ status: "idle" });
    }
    this.staged = staged;
    const notes: WhatsNew = { version: release.version, notes: release.notes, pageUrl: release.pageUrl };
    await writeFile(join(app.getPath("userData"), "release-notes.json"), JSON.stringify(notes)).catch(() => {});
    this.set({ status: "ready", version: release.version, notes: release.notes, asked });
  }

  private async canReplaceSelf(packaging: Packaging | null): Promise<boolean> {
    try {
      if (packaging === "mac-zip") {
        const bundle = macBundle();
        if (bundle.includes("/AppTranslocation/")) return false;
        await access(dirname(bundle), constants.W_OK);
      } else if (packaging === "appimage") {
        await access(dirname(process.env.APPIMAGE!), constants.W_OK);
      } else if (packaging === "portable") {
        await access(dirname(process.env.PORTABLE_EXECUTABLE_FILE!), constants.W_OK);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Download to a part file, then check size and sha256 before it gets its real name. */
  private async download(asset: ReleaseAsset, file: string, sha256: string, onProgress: (p: number) => void): Promise<void> {
    const res = await net.fetch(asset.url, { headers: { "User-Agent": `OpenRoll/${app.getVersion()}` } });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    const part = file + ".part";
    const hash = createHash("sha256");
    let seen = 0;
    const body = Readable.fromWeb(res.body as never);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      seen += chunk.length;
      onProgress(Math.min(1, seen / (asset.size || seen || 1)));
    });
    await pipeline(body, createWriteStream(part));
    const size = (await stat(part)).size;
    if (size !== asset.size || hash.digest("hex") !== sha256) {
      await rm(part, { force: true });
      throw new Error("download did not match its checksum");
    }
    await renameBusy(part, file);
  }

  private async stage(version: string, packaging: Packaging, file: string, folder: string): Promise<Staged | null> {
    if (packaging === "mac-zip") {
      const out = join(folder, "unpacked");
      await mkdir(out, { recursive: true });
      // ditto keeps symlinks, permissions and resource forks that a generic unzip can lose in an app bundle.
      const r = spawnSync("/usr/bin/ditto", ["-x", "-k", file, out]);
      if (r.status !== 0) return null;
      const app = (await readdir(out)).find(n => n.endsWith(".app"));
      return app ? { version, packaging, file: join(out, app) } : null;
    }
    if (packaging === "appimage") await chmod(file, 0o755);
    return { version, packaging, file };
  }

  /** Quit and apply now; the new version opens afterwards. */
  installNow(): void {
    if (this.state.status !== "ready") return;
    this.relaunch = true;
    app.quit();
  }

  /** Runs from will-quit. Starts a detached helper that waits for this process to end, swaps files and optionally reopens. */
  applyOnQuit(): void {
    const s = this.staged;
    if (!s) return;
    this.staged = null;
    if (!app.isPackaged && !process.env.OPENROLL_UPDATE_APPLY) return;
    const script = this.scriptFor(s);
    if (!script) return;
    const child = spawn(script.command, script.args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }

  private scriptFor(s: Staged): { command: string; args: string[] } | null {
    const pid = String(process.pid);
    const relaunch = this.relaunch ? "1" : "0";
    const dir = this.dir;
    if (s.packaging === "mac-zip") {
      const script = join(dir, "apply.sh");
      writeSync(script, MAC_SCRIPT);
      return { command: "/bin/sh", args: [script, pid, s.file, macBundle(), relaunch] };
    }
    if (s.packaging === "appimage") {
      const script = join(dir, "apply.sh");
      writeSync(script, APPIMAGE_SCRIPT);
      return { command: "/bin/sh", args: [script, pid, s.file, process.env.APPIMAGE!, relaunch] };
    }
    // Windows: a hidden PowerShell so no console window flashes, which cmd.exe cannot promise.
    const script = join(dir, "apply.ps1");
    writeSync(script, s.packaging === "nsis" ? NSIS_SCRIPT : PORTABLE_SCRIPT);
    const target = s.packaging === "nsis" ? process.execPath : process.env.PORTABLE_EXECUTABLE_FILE!;
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-ProcId", pid, "-Source", s.file, "-Target", target, "-Relaunch", relaunch],
    };
  }
}

// Written synchronously: will-quit does not wait for promises.
function writeSync(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o755 });
}

/** .../OpenRoll.app/Contents/MacOS/OpenRoll up to the bundle. */
export function macBundle(): string {
  return dirname(dirname(dirname(process.execPath)));
}

// Moves the old bundle aside first so a failed copy can be put back; the app is never left half replaced.
const MAC_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; DEST="$3"; RELAUNCH="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
OLD="$DEST.old.$$"
if mv "$DEST" "$OLD"; then
  if mv "$NEW" "$DEST" || /usr/bin/ditto "$NEW" "$DEST"; then
    rm -rf "$OLD"
  else
    rm -rf "$DEST"; mv "$OLD" "$DEST"
  fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
[ "$RELAUNCH" = "1" ] && /usr/bin/open "$DEST"
exit 0
`;

const APPIMAGE_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; DEST="$3"; RELAUNCH="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
chmod +x "$NEW"
mv -f "$NEW" "$DEST" || cp -f "$NEW" "$DEST"
[ "$RELAUNCH" = "1" ] && nohup "$DEST" >/dev/null 2>&1 &
exit 0
`;

const NSIS_SCRIPT = `param([int]$ProcId, [string]$Source, [string]$Target, [string]$Relaunch)
try { Wait-Process -Id $ProcId -Timeout 60 -ErrorAction SilentlyContinue } catch {}
Start-Process -FilePath $Source -ArgumentList '/S' -Wait
if ($Relaunch -eq '1') { Start-Process -FilePath $Target }
`;

const PORTABLE_SCRIPT = `param([int]$ProcId, [string]$Source, [string]$Target, [string]$Relaunch)
try { Wait-Process -Id $ProcId -Timeout 60 -ErrorAction SilentlyContinue } catch {}
for ($i = 0; $i -lt 20; $i++) {
  try { Move-Item -LiteralPath $Source -Destination $Target -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }
}
if ($Relaunch -eq '1') { Start-Process -FilePath $Target }
`;
