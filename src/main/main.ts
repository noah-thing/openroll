import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, session as electronSession, shell, type MenuItemConstructorOptions } from "electron";
import { arch, release, type } from "node:os";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { allowPath, handleMediaProtocol, isAllowed, mediaScheme } from "./media-protocol";
import type { CacheInfo, FileInfo, RecentProject, SaveResult, SystemInfo } from "../shared/api";
import { agentPathProblem, isInside, safeFileName, samePath } from "../shared/paths";
import { renameBusy } from "./fs-retry";
import { launcherPath } from "./launch-target";
import { OutputWriters, withExtension } from "./output-writers";
import { Journal } from "./journal";
import { NamedVersions } from "./versions";
import { Session } from "./session";
import { getSettings, updateSettings } from "./settings";
import { Updater } from "./updater";
import { News } from "./news";
import { Control } from "./control";
import { registerFfmpegIpc } from "./ffmpeg-ipc";
import { registerRelinkIpc } from "./relink";
import { clearCacheDir, isProjectFileName, projectStem, Serial, writeFileAtomic } from "./project-files";
import { readProject } from "../core/load";

const isDev = !!process.env.OPENROLL_DEV_URL;
const APP_SCHEME = "openroll-app";

// Electron keeps only the last call to this, so every custom scheme is registered here at once.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  mediaScheme,
]);

if (process.env.OPENROLL_QA) {
  // Lets the voiceover recorder run on machines without a microphone, such as CI.
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

// Without a usable GPU (old drivers, virtual machines, blocklisted cards) Chromium refuses WebGL;
// its software renderer keeps the editor working there, slower but whole.
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

if (process.platform === "linux") {
  // Hardware video decode on Linux is opt in for Chromium. These are harmless where VA-API is absent.
  app.commandLine.appendSwitch("enable-features", "AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder");
}

const MEDIA_EXT = [
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "mts", "m2ts", "3gp", "3g2", "mpg", "mpeg", "m2v", "vob", "ts", "wmv", "asf", "flv", "f4v", "ogv", "mxf", "dv", "divx",
  "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "ac3", "dts", "wma", "aif", "aiff", "caf", "amr",
  "png", "jpg", "jpeg", "webp", "gif", "heic", "bmp",
];

let win: BrowserWindow | null = null;

function projectsDir(): string {
  return process.env.OPENROLL_PROJECTS_DIR ?? getSettings().projectsDir ?? defaultProjectsDir();
}

function defaultProjectsDir(): string {
  return join(app.getPath("videos"), "OpenRoll");
}

const saves = new Serial();
const journal = new Journal(join(app.getPath("userData"), "history"));
const versions = new NamedVersions(join(app.getPath("userData"), "versions"));
const session = new Session(join(app.getPath("userData"), "session.json"));
const updater = new Updater(
  state => win?.webContents.send("updates:state", state),
  () => getSettings().autoUpdate,
);
const control = new Control(
  () => win?.webContents ?? null,
  () => getSettings().aiControl,
  clients => win?.webContents.send("agent:clients", clients),
);
const news = new News(
  items => win?.webContents.send("news:changed", items),
  () => getSettings().news,
);

function cacheDir(): string {
  return join(app.getPath("userData"), "cache");
}

function recordingsDir(): string {
  return join(projectsDir(), "Recordings");
}

function thumbsDir(): string {
  return join(app.getPath("userData"), "thumbs");
}

async function info(path: string): Promise<FileInfo | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    return { path, name: basename(path), size: s.size, mtime: Math.round(s.mtimeMs) };
  } catch {
    return null;
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#141415",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 15 },
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#181819", symbolColor: "#a3a3a9", height: 44 },
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: [`--openroll-version=${app.getVersion()}`],
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(process.env.OPENROLL_DEV_URL ?? `${APP_SCHEME}://`)) e.preventDefault();
  });
  win.on("close", e => {
    if (dirty && !quitting) {
      // Projects save continuously; this only fires in the moment between an edit and its save.
      e.preventDefault();
      closeAfterFlush = true;
      win?.webContents.send("menu", "flush-and-close");
      // A page that is busy or gone must not keep the window open; the journal has the last save.
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => finishClose(), 2500);
    }
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason !== "clean-exit") recoverWindow(`renderer ${details.reason}`);
  });
  win.on("closed", () => {
    win = null;
  });

  if (isDev) void win.loadURL(process.env.OPENROLL_DEV_URL!);
  else void win.loadURL(`${APP_SCHEME}://app/index.html`);
}

let dirty = false;
let quitting = false;
let quitRequested = false;
let flushTimer: NodeJS.Timeout | undefined;

function finishClose(): void {
  clearTimeout(flushTimer);
  closeAfterFlush = false;
  quitting = true;
  win?.close();
  if (quitRequested) app.quit();
}
let closeAfterFlush = false;

// A crash loop must not become a reload loop.
const crashTimes: number[] = [];
let reloadedAt = 0;

function recoverWindow(why: string): void {
  const now = Date.now();
  // A renderer and a GPU process often die together; one reload covers both.
  if (!win || now - reloadedAt < 2000) return;
  reloadedAt = now;
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
  console.error(`window recovery: ${why}`);
  if (crashTimes.length > 3) {
    void dialog.showMessageBox(win, {
      type: "error",
      message: "OpenRoll keeps stopping",
      detail: "Your project is saved. Restart OpenRoll, and if this happens again turn off hardware decoding in Settings.",
    });
    return;
  }
  session.crashed();
  win.webContents.reload();
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${mediaScheme.scheme}:`,
  `media-src 'self' blob: ${mediaScheme.scheme}:`,
  // On device models (captions, voices) download once from Hugging Face; nothing else goes out.
  `connect-src 'self' blob: data: ${mediaScheme.scheme}: https://huggingface.co https://*.huggingface.co https://*.hf.co`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join("; ");

function serveApp(): void {
  const root = resolve(import.meta.dirname, "../renderer");
  protocol.handle(APP_SCHEME, async request => {
    const url = new URL(request.url);
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) && file !== root) return new Response("no", { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    // Cross origin isolation lets workers share memory with the page (SharedArrayBuffer).
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Content-Security-Policy", CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

const writers = new OutputWriters();

function registerIpc(): void {
  ipcMain.handle("media:pick", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Import media",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Video, audio and images", extensions: MEDIA_EXT }],
    });
    const out: FileInfo[] = [];
    for (const p of r.filePaths) {
      const i = await info(p);
      if (i) {
        allowPath(p);
        out.push(i);
      }
    }
    return out;
  });

  ipcMain.handle("lut:pick", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "Import LUT", properties: ["openFile"], filters: [{ name: "Colour tables", extensions: ["cube"] }] });
    const path = r.filePaths[0];
    if (!path) return null;
    const size = (await stat(path)).size;
    if (size > 64 * 1024 * 1024) return null;
    return { name: basename(path, extname(path)), text: await readFile(path, "utf8") };
  });

  ipcMain.handle("media:allow-dropped", async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return [];
    const out: FileInfo[] = [];
    for (const p of paths) {
      if (typeof p !== "string" || !MEDIA_EXT.includes(extname(p).slice(1).toLowerCase())) continue;
      const i = await info(p);
      if (i) {
        allowPath(p);
        out.push(i);
      }
    }
    return out;
  });

  ipcMain.handle("media:stat", async (_e, path: unknown) => (typeof path === "string" && isAllowed(path) ? info(path) : null));

  ipcMain.handle("writer:create", async (_e, suggested: unknown, kind: unknown) => {
    const name = typeof suggested === "string" ? safeFileName(suggested, "Export") : "Export";
    const filters =
      kind === "audio" ? [{ name: "Audio", extensions: ["m4a", "wav"] }] :
      kind === "subtitles" ? [{ name: "Subtitles", extensions: ["srt", "vtt"] }] :
      kind === "image" ? [{ name: "Image", extensions: ["png", "jpg"] }] :
      [{ name: "Video", extensions: ["mp4", "mov", "webm", "gif"] }];
    // The format is already chosen, so the dialog offers only its extension.
    const wanted = extname(name).slice(1).toLowerCase();
    const offered = filters[0].extensions.includes(wanted) ? [{ name: filters[0].name, extensions: [wanted] }] : filters;
    const r = process.env.OPENROLL_QA_OUT
      ? { canceled: false, filePath: join(process.env.OPENROLL_QA_OUT, extname(name) ? name : `${name}.${filters[0].extensions[0]}`) }
      : await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath("videos"), name), filters: offered });
    if (r.canceled || !r.filePath) return null;
    const file = offered.length === 1 ? withExtension(r.filePath, wanted) : r.filePath;
    return { id: await writers.create(file), path: file };
  });

  // For AI tools, which name the file themselves. Same temp file and rename as above; no dialog.
  ipcMain.handle("writer:create-at", async (_e, target: unknown, fallbackName: unknown) => {
    const ok = /\.(mp4|mov|webm|gif|m4a|wav|srt|vtt|png|jpg)$/i;
    let path = typeof target === "string" && target ? target : "";
    if (!path) {
      const name = safeFileName(String(fallbackName || "Export"), "Export");
      path = join(app.getPath("videos"), ok.test(name) ? name : `${name}.mp4`);
    }
    if (!isAbsolute(path) || !ok.test(path)) throw new Error("Give an absolute file path ending in a video, audio, image or subtitle extension.");
    const problem = agentPathProblem(path, process.platform, app.getPath("home"), "write");
    if (problem) throw new Error(problem);
    await mkdir(dirname(path), { recursive: true });
    return { id: await writers.create(path), path };
  });

  ipcMain.handle("agent:allow", async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return [];
    const out: FileInfo[] = [];
    for (const p of paths) {
      if (typeof p !== "string" || !isAbsolute(p) || !MEDIA_EXT.includes(extname(p).slice(1).toLowerCase())) continue;
      if (agentPathProblem(p, process.platform, app.getPath("home"), "read")) continue;
      const i = await info(p);
      if (i) {
        allowPath(p);
        out.push(i);
      }
    }
    return out;
  });

  ipcMain.handle("writer:write", (_e, id: number, position: number, data: Uint8Array) => writers.write(id, position, data));

  ipcMain.handle("writer:reset", (_e, id: number) => writers.reset(id));

  ipcMain.handle("writer:close", async (_e, id: number, abort: boolean) => {
    const path = await writers.close(id, !!abort);
    if (path) allowPath(path);
  });

  const media = registerFfmpegIpc({
    win: () => win,
    cacheDir,
    allow: allowPath,
    takeWriter: id => writers.take(id),
  });
  registerRelinkIpc(() => win);

  ipcMain.handle("shell:reveal", (_e, path: unknown) => {
    if (typeof path === "string" && existsSync(path)) shell.showItemInFolder(path);
  });

  ipcMain.handle("projects:dir", () => projectsDir());

  ipcMain.handle("projects:list", async (): Promise<RecentProject[]> => {
    const dir = projectsDir();
    await mkdir(dir, { recursive: true });
    const out: RecentProject[] = [];
    for (const name of await readdir(dir)) {
      if (!isProjectFileName(name)) continue;
      const path = join(dir, name);
      const s = await stat(path).catch(() => null);
      if (!s?.isFile()) continue;
      const thumb = join(thumbsDir(), hash(path) + ".jpg");
      if (existsSync(thumb)) allowPath(thumb);
      out.push({ path, name: name.replace(/\.openroll$/, ""), modified: s.mtimeMs, thumb: existsSync(thumb) ? thumb : undefined });
    }
    return out.sort((a, b) => b.modified - a.modified);
  });

  ipcMain.handle("projects:load", async (_e, path: unknown) => {
    if (typeof path !== "string" || !path.endsWith(".openroll")) return null;
    const text = await readFile(path, "utf8").catch(() => null);
    if (text) {
      session.setProject(path);
      // The state the project had when this session began, so any session can be rolled back whole.
      void journal.record(text, { path, name: basename(path, ".openroll") }, { force: true }).catch(() => {});
      // Media referenced by a project the user opened is theirs to read.
      try {
        const doc = JSON.parse(text);
        for (const m of Object.values<{ path?: unknown }>(doc.media ?? {})) if (typeof m?.path === "string") allowPath(m.path);
      } catch {
        /* the renderer reports bad JSON itself */
      }
      // Repairs are saved over the file at the next autosave, so the file as found is kept beside it first.
      const read = readProject(text);
      if (read.ok && read.repairs.length) await copyFile(path, path + ".original", constants.COPYFILE_EXCL).catch(() => {});
    }
    return text;
  });

  ipcMain.handle("projects:save", (_e, path: unknown, name: unknown, json: unknown): Promise<SaveResult> => {
    if (typeof json !== "string") return Promise.resolve({ ok: false, error: "nothing to save" });
    // One at a time: overlapping saves share a temp file, and a slow older one must not land after a newer one.
    return saves.run(async () => {
      try {
        let target = typeof path === "string" && path.endsWith(".openroll") ? path : await freshProjectPath(String(name || "Untitled"));
        // A renamed project gets a matching file name, but only inside our own projects folder.
        const wanted = projectStem(String(name || ""));
        const current = basename(target, ".openroll");
        const matches = current === wanted || (current.startsWith(wanted + " ") && /^\d+$/.test(current.slice(wanted.length + 1)));
        if (name && !matches && samePath(dirname(target), projectsDir(), process.platform) && existsSync(target)) {
          try {
            const renamed = await freshProjectPath(wanted);
            await renameBusy(target, renamed);
            await rm(target + ".bak", { force: true });
            const oldThumb = join(thumbsDir(), hash(target) + ".jpg");
            if (existsSync(oldThumb)) await renameBusy(oldThumb, join(thumbsDir(), hash(renamed) + ".jpg")).catch(() => {});
            target = renamed;
          } catch {
            // The file name is cosmetic; the save itself must not fail because of it.
          }
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFileAtomic(target, json, true);
        session.setProject(target);
        void journal.record(json, { path: target, name: basename(target, ".openroll") }).catch(() => {});
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });
  });

  ipcMain.handle("projects:thumb", async (_e, path: unknown, jpeg: unknown) => {
    if (typeof path !== "string" || !(jpeg instanceof Uint8Array)) return;
    await mkdir(thumbsDir(), { recursive: true });
    await writeFile(join(thumbsDir(), hash(path) + ".jpg"), jpeg);
  });

  ipcMain.handle("projects:remove", async (_e, path: unknown) => {
    if (typeof path !== "string" || !path.endsWith(".openroll") || !(isInside(path, projectsDir(), process.platform) || isInside(path, defaultProjectsDir(), process.platform))) return;
    // Removing goes to the system trash, never straight to deletion.
    await shell.trashItem(path).catch(() => {});
    await rm(join(thumbsDir(), hash(path) + ".jpg"), { force: true });
  });

  ipcMain.handle("cache:get", async (_e, key: unknown) => {
    if (typeof key !== "string" || !/^[\w.-]+$/.test(key)) return null;
    return readFile(join(cacheDir(), key)).catch(() => null);
  });

  ipcMain.handle("recordings:save", async (_e, name: unknown, ext: unknown, data: unknown): Promise<FileInfo | null> => {
    if (typeof name !== "string" || ext !== "wav" || !(data instanceof Uint8Array) || data.byteLength > 2 ** 31) return null;
    const dir = recordingsDir();
    await mkdir(dir, { recursive: true });
    const clean = safeFileName(name, "Recording");
    let path = join(dir, `${clean}.${ext}`);
    for (let n = 2; existsSync(path); n++) path = join(dir, `${clean} ${n}.${ext}`);
    await writeFile(path, data);
    allowPath(path);
    return info(path);
  });

  // Files OpenRoll made itself (generated sound effects) become readable media.
  ipcMain.handle("cache:file", async (_e, key: unknown): Promise<FileInfo | null> => {
    if (typeof key !== "string" || !/^[\w.-]+$/.test(key)) return null;
    const path = join(cacheDir(), key);
    const i = await info(path);
    if (i) allowPath(path);
    return i;
  });

  ipcMain.handle("cache:put", async (_e, key: unknown, data: unknown) => {
    if (typeof key !== "string" || !/^[\w.-]+$/.test(key) || !(data instanceof Uint8Array)) return;
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(join(cacheDir(), key), data);
  });

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", async (_e, patch: unknown) => {
    const next = await updateSettings(patch);
    win?.webContents.send("settings:changed", next);
    return next;
  });
  ipcMain.handle("settings:pick-projects-dir", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "Projects folder", properties: ["openDirectory", "createDirectory"], defaultPath: projectsDir() });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle("cache:info", async (): Promise<CacheInfo> => ({ dir: cacheDir(), bytes: await folderSize(cacheDir()) }));
  ipcMain.handle("cache:clear", async () => {
    await clearCacheDir(cacheDir());
    media.reset();
  });

  ipcMain.handle("updates:state", () => updater.getState());
  ipcMain.handle("updates:check", () => updater.check(true));
  ipcMain.handle("updates:install-now", () => updater.installNow());
  ipcMain.handle("updates:download", () => updater.downloadOffered());
  ipcMain.handle("updates:whats-new", () => updater.whatsNew());
  ipcMain.handle("news:list", () => news.list());
  ipcMain.on("agent:reply", (_e, callId: unknown, reply: unknown) => {
    if (typeof callId === "number" && reply && typeof reply === "object") control.settle(callId, reply as { id: number });
  });
  ipcMain.handle("agent:clients", () => control.list());
  ipcMain.handle("agent:disconnect", (_e, id: unknown) => typeof id === "number" && control.disconnect(id));
  ipcMain.handle("agent:connect-info", () => ({
    executable: launcherPath(process.execPath, process.env),
    args: app.isPackaged ? ["--mcp"] : [app.getAppPath(), "--mcp"],
  }));
  ipcMain.handle("news:mark-read", (_e, ids: unknown) => news.markRead(ids));

  ipcMain.handle("history:list", (_e, path: unknown) => (typeof path === "string" ? journal.list(path) : []));
  ipcMain.handle("history:restore", (_e, path: unknown, file: unknown) =>
    typeof path === "string" && typeof file === "string" && path.endsWith(".openroll") ? journal.restore(path, file) : false,
  );

  ipcMain.handle("versions:save", (_e, name: unknown, json: unknown) => (typeof name === "string" && typeof json === "string" ? versions.save(json, name) : null));
  ipcMain.handle("versions:list", (_e, id: unknown) => (typeof id === "string" ? versions.list(id) : []));
  ipcMain.handle("versions:read", (_e, id: unknown, file: unknown) => (typeof id === "string" && typeof file === "string" ? versions.read(id, file) : null));
  ipcMain.handle("versions:remove", (_e, id: unknown, file: unknown) => (typeof id === "string" && typeof file === "string" ? versions.remove(id, file) : false));

  ipcMain.handle("session:take", () => session.take());
  ipcMain.on("session:project-closed", () => session.setProject(null));

  ipcMain.handle("system:info", async (): Promise<SystemInfo> => {
    const gpu = await app.getGPUInfo("basic").catch(() => null);
    const devices = ((gpu as { gpuDevice?: { vendorString?: string; deviceString?: string; driverVersion?: string; active?: boolean }[] } | null)?.gpuDevice ?? []);
    const renderer = (gpu as { auxAttributes?: { glRenderer?: string } } | null)?.auxAttributes?.glRenderer;
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      os: `${type()} ${release()}`,
      arch: arch(),
      gpu: [
        ...(renderer ? [renderer] : []),
        ...devices.map(d => [d.vendorString, d.deviceString, d.driverVersion && `driver ${d.driverVersion}`].filter(Boolean).join(" ")).filter(Boolean),
      ],
    };
  });

  if (process.env.OPENROLL_QA) {
    ipcMain.handle("qa:allow", async (_e, paths: string[]) => Promise.all(paths.map(async p => (allowPath(p), info(p)))));
  }

  ipcMain.on("window:title", (_e, title: unknown) => {
    if (typeof title === "string") win?.setTitle(title);
  });
  ipcMain.on("window:dirty", (_e, d: unknown) => {
    dirty = !!d;
    win?.setDocumentEdited(dirty);
    if (!dirty && closeAfterFlush) finishClose();
  });
  ipcMain.on("window:close-now", () => {
    quitting = true;
    win?.close();
  });
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(p);
    else total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

async function freshProjectPath(name: string): Promise<string> {
  const dir = projectsDir();
  await mkdir(dir, { recursive: true });
  const clean = projectStem(name);
  let path = join(dir, clean + ".openroll");
  for (let n = 2; existsSync(path); n++) path = join(dir, `${clean} ${n}.openroll`);
  return path;
}

function buildMenu(): void {
  const send = (cmd: string) => () => win?.webContents.send("menu", cmd);
  // Shortcuts are handled by the page so they can respect focus (typing in a text box
  // must not split a clip). The menu shows them but does not grab the keys.
  const item = (label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: send(cmd),
  });
  const mac = process.platform === "darwin";
  const checkUpdates: MenuItemConstructorOptions = { label: "Check for updates…", click: () => void updater.check(true) };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              item("About OpenRoll", "about"),
              checkUpdates,
              { type: "separator" as const },
              item("Settings…", "settings", "Cmd+,"),
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        item("New project", "new", "CmdOrCtrl+N"),
        item("Open project…", "open", "CmdOrCtrl+O"),
        item("Import media…", "import", "CmdOrCtrl+I"),
        { type: "separator" },
        item("Export…", "export", "CmdOrCtrl+E"),
        { type: "separator" },
        ...(mac ? [] : [item("Settings…", "settings", "Ctrl+,"), { type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "undo", "CmdOrCtrl+Z"),
        item("Redo", "redo", "Shift+CmdOrCtrl+Z"),
        item("Undo history…", "history"),
        item("Save a version…", "save-version"),
        item("Versions…", "versions"),
        { type: "separator" },
        item("Command bar…", "palette", "CmdOrCtrl+K"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        item("Duplicate", "duplicate", "CmdOrCtrl+D"),
        item("Delete", "delete", "Delete"),
        { type: "separator" },
        item("Split at playhead", "split", "S"),
        item("Select all", "select-all", "CmdOrCtrl+A"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("Zoom in timeline", "zoom-in", "CmdOrCtrl+="),
        item("Zoom out timeline", "zoom-out", "CmdOrCtrl+-"),
        item("Fit timeline", "zoom-fit", "Shift+Z"),
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" as const }, { role: "reload" as const }] : []),
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        item("Keyboard shortcuts", "shortcuts", "CmdOrCtrl+/"),
        { type: "separator" },
        item("Report a problem…", "report"),
        ...(mac ? [] : [checkUpdates, item("About OpenRoll", "about")]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The microphone is the only device the page may ask for, and only from our own pages. */
function guardMicrophone(): void {
  const ours = (url: string) => url.startsWith(`${APP_SCHEME}://app/`) || (!!process.env.OPENROLL_DEV_URL && url.startsWith(process.env.OPENROLL_DEV_URL));
  const s = electronSession.defaultSession;
  s.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    callback(permission === "media" && ours(details.requestingUrl) && types.includes("audio") && !types.includes("video"));
  });
  s.setPermissionCheckHandler((_wc, permission, origin, details) => {
    const type = (details as { mediaType?: string }).mediaType;
    return permission === "media" && ours(origin + "/") && type !== "video";
  });
}

// A second launch (the updater reopening the app, a double click) focuses the window that exists.
const secondLaunch = !process.env.OPENROLL_QA && !app.requestSingleInstanceLock();
if (secondLaunch) app.quit();
app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.whenReady().then(() => {
  // A second launch must not touch the session marker, or it hides the first one's crash from the next start.
  if (secondLaunch) return;
  nativeTheme.themeSource = "dark";
  session.begin();
  updater.start();
  void news.start();
  void control.start().catch(err => console.warn("AI control is unavailable:", err.message));
  guardMicrophone();
  handleMediaProtocol();
  serveApp();
  registerIpc();
  buildMenu();
  createWindow();
  app.on("child-process-gone", (_e, details) => {
    if (details.type === "GPU" && details.reason !== "clean-exit") recoverWindow(`gpu ${details.reason}`);
  });
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on("before-quit", () => {
  quitRequested = true;
  quitting = !dirty;
});

app.on("will-quit", () => {
  writers.discardAll();
  if (secondLaunch) return;
  void control.stop();
  session.end();
  updater.applyOnQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
