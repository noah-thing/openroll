import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { allowPath, handleMediaProtocol, isAllowed, mediaScheme } from "./media-protocol";
import type { FileInfo, RecentProject, SaveResult } from "../shared/api";

const isDev = !!process.env.OPENROLL_DEV_URL;
const APP_SCHEME = "openroll-app";

// Electron keeps only the last call to this, so every custom scheme is registered here at once.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  mediaScheme,
]);

if (process.platform === "linux") {
  // Hardware video decode on Linux is opt in for Chromium. These are harmless where VA-API is absent.
  app.commandLine.appendSwitch("enable-features", "AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder");
}

const MEDIA_EXT = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mts", "m2ts", "3gp", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "png", "jpg", "jpeg", "webp", "gif", "heic", "bmp"];

let win: BrowserWindow | null = null;

function projectsDir(): string {
  return process.env.OPENROLL_PROJECTS_DIR ?? join(app.getPath("videos"), "OpenRoll");
}

function cacheDir(): string {
  return join(app.getPath("userData"), "cache");
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
      win?.webContents.send("menu", "flush-and-close");
    }
  });

  if (isDev) void win.loadURL(process.env.OPENROLL_DEV_URL!);
  else void win.loadURL(`${APP_SCHEME}://app/index.html`);
}

let dirty = false;
let quitting = false;

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
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---------------------------------------------------------------- IPC

const writers = new Map<number, { handle: FileHandle; path: string; tmp: string }>();
let nextWriter = 1;

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
    const name = typeof suggested === "string" ? suggested.replace(/[\\/:*?"<>|]/g, "_") : "Export";
    const filters =
      kind === "audio" ? [{ name: "Audio", extensions: ["m4a", "wav"] }] :
      kind === "subtitles" ? [{ name: "Subtitles", extensions: ["srt", "vtt"] }] :
      kind === "image" ? [{ name: "Image", extensions: ["png", "jpg"] }] :
      [{ name: "Video", extensions: ["mp4", "mov", "webm"] }];
    const r = process.env.OPENROLL_QA_OUT
      ? { canceled: false, filePath: join(process.env.OPENROLL_QA_OUT, name + ".mp4") }
      : await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath("videos"), name), filters });
    if (r.canceled || !r.filePath) return null;
    // Write to a temp name and rename on close, so a failed export never leaves a broken file
    // with the real name, and never clobbers an old export until the new one is complete.
    const tmp = r.filePath + ".openroll-part";
    const handle = await open(tmp, "w");
    const id = nextWriter++;
    writers.set(id, { handle, path: r.filePath, tmp });
    return { id, path: r.filePath };
  });

  ipcMain.handle("writer:write", async (_e, id: number, position: number, data: Uint8Array) => {
    const w = writers.get(id);
    if (!w) throw new Error("writer closed");
    await w.handle.write(data, 0, data.byteLength, position);
  });

  ipcMain.handle("writer:close", async (_e, id: number, abort: boolean) => {
    const w = writers.get(id);
    if (!w) return;
    writers.delete(id);
    await w.handle.close();
    if (abort) await rm(w.tmp, { force: true });
    else {
      await rm(w.path, { force: true });
      await rename(w.tmp, w.path);
      allowPath(w.path);
    }
  });

  ipcMain.handle("shell:reveal", (_e, path: unknown) => {
    if (typeof path === "string" && existsSync(path)) shell.showItemInFolder(path);
  });

  ipcMain.handle("projects:dir", () => projectsDir());

  ipcMain.handle("projects:list", async (): Promise<RecentProject[]> => {
    const dir = projectsDir();
    await mkdir(dir, { recursive: true });
    const out: RecentProject[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".openroll")) continue;
      const path = join(dir, name);
      const s = await stat(path).catch(() => null);
      if (!s) continue;
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
      // Media referenced by a project the user opened is theirs to read.
      try {
        const doc = JSON.parse(text);
        for (const m of Object.values<{ path?: unknown }>(doc.media ?? {})) if (typeof m.path === "string") allowPath(m.path);
      } catch {
        /* the renderer reports bad JSON itself */
      }
    }
    return text;
  });

  ipcMain.handle("projects:save", async (_e, path: unknown, name: unknown, json: unknown): Promise<SaveResult> => {
    if (typeof json !== "string") return { ok: false, error: "nothing to save" };
    try {
      const target = typeof path === "string" && path.endsWith(".openroll") ? path : await freshProjectPath(String(name || "Untitled"));
      await mkdir(dirname(target), { recursive: true });
      const tmp = target + ".tmp";
      await writeFile(tmp, json, "utf8");
      if (existsSync(target)) await copyFile(target, target + ".bak").catch(() => {});
      await rename(tmp, target);
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("projects:thumb", async (_e, path: unknown, jpeg: unknown) => {
    if (typeof path !== "string" || !(jpeg instanceof Uint8Array)) return;
    await mkdir(thumbsDir(), { recursive: true });
    await writeFile(join(thumbsDir(), hash(path) + ".jpg"), jpeg);
  });

  ipcMain.handle("projects:remove", async (_e, path: unknown) => {
    if (typeof path !== "string" || !path.endsWith(".openroll") || !path.startsWith(projectsDir())) return;
    // Removing goes to the system trash, never straight to deletion.
    await shell.trashItem(path).catch(() => {});
  });

  ipcMain.handle("cache:get", async (_e, key: unknown) => {
    if (typeof key !== "string" || !/^[\w.-]+$/.test(key)) return null;
    return readFile(join(cacheDir(), key)).catch(() => null);
  });

  ipcMain.handle("cache:put", async (_e, key: unknown, data: unknown) => {
    if (typeof key !== "string" || !/^[\w.-]+$/.test(key) || !(data instanceof Uint8Array)) return;
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(join(cacheDir(), key), data);
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
  });
  ipcMain.on("window:close-now", () => {
    quitting = true;
    win?.close();
  });
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

async function freshProjectPath(name: string): Promise<string> {
  const dir = projectsDir();
  await mkdir(dir, { recursive: true });
  const clean = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
  let path = join(dir, clean + ".openroll");
  for (let n = 2; existsSync(path); n++) path = join(dir, `${clean} ${n}.openroll`);
  return path;
}

// ---------------------------------------------------------------- menu

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
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        item("New Project", "new", "CmdOrCtrl+N"),
        item("Open Project…", "open", "CmdOrCtrl+O"),
        item("Import Media…", "import", "CmdOrCtrl+I"),
        { type: "separator" },
        item("Export…", "export", "CmdOrCtrl+E"),
        { type: "separator" },
        item("Project Settings…", "settings", "CmdOrCtrl+,"),
        ...(mac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "undo", "CmdOrCtrl+Z"),
        item("Redo", "redo", "Shift+CmdOrCtrl+Z"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        item("Duplicate", "duplicate", "CmdOrCtrl+D"),
        item("Delete", "delete", "Delete"),
        { type: "separator" },
        item("Split at Playhead", "split", "S"),
        item("Select All", "select-all", "CmdOrCtrl+A"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("Zoom In Timeline", "zoom-in", "CmdOrCtrl+="),
        item("Zoom Out Timeline", "zoom-out", "CmdOrCtrl+-"),
        item("Fit Timeline", "zoom-fit", "Shift+Z"),
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" as const }, { role: "reload" as const }] : []),
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [item("Keyboard Shortcuts", "shortcuts", "CmdOrCtrl+/"), item("Report a Problem…", "report", undefined)],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  handleMediaProtocol();
  serveApp();
  registerIpc();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = !dirty;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
