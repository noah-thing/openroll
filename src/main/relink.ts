import { dialog, ipcMain, type BrowserWindow } from "electron";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileInfo } from "../shared/api";
import { baseName, dirName, matchFiles, startFolders, wantedNames, type FoundFile, type MissingFile, type RelinkMatch } from "../shared/relink";
import { allowPath } from "./media-protocol";

const SKIP = /^(\.|\$|node_modules$|Library$|AppData$|System Volume Information$)/;
const MAX_FILES = 60_000;
const MAX_MS = 12_000;

/** Walks a folder to a depth and returns the files whose names could match. Never throws on unreadable folders. */
export async function scan(root: string, depth: number, names: Set<string>, found: FoundFile[] = [], budget = { files: 0, until: Date.now() + MAX_MS }): Promise<FoundFile[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  const dirs: string[] = [];
  for (const e of entries) {
    if (budget.files > MAX_FILES || Date.now() > budget.until) break;
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP.test(e.name)) dirs.push(join(root, e.name));
    } else if (names.has(e.name.toLowerCase())) {
      budget.files++;
      const s = await stat(join(root, e.name)).catch(() => null);
      if (s?.isFile()) found.push({ path: join(root, e.name), size: s.size });
    } else budget.files++;
  }
  for (const d of dirs) await scan(d, depth - 1, names, found, budget);
  return found;
}

async function toInfo(path: string): Promise<FileInfo | null> {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return null;
  allowPath(path);
  return { path, name: baseName(path), size: s.size, mtime: Math.round(s.mtimeMs) };
}

async function infos(matches: RelinkMatch[]): Promise<(RelinkMatch & { file: FileInfo })[]> {
  const out = [];
  for (const m of matches) {
    const file = await toInfo(m.path);
    if (file) out.push({ ...m, file });
  }
  return out;
}

export function registerRelinkIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle("relink:missing", async (_e, paths: unknown): Promise<string[]> => {
    if (!Array.isArray(paths)) return [];
    const out: string[] = [];
    for (const p of paths) if (typeof p === "string" && !(await stat(p).then(s => s.isFile()).catch(() => false))) out.push(p);
    return out;
  });

  // Look near where the files used to be: their folder, its parent, and the folders beside it.
  ipcMain.handle("relink:auto", async (_e, missing: MissingFile[]) => {
    const names = wantedNames(missing);
    const found: FoundFile[] = [];
    const seen = new Set<string>();
    for (const m of missing) {
      for (const dir of startFolders(m.path)) {
        if (seen.has(dir)) continue;
        seen.add(dir);
        await scan(dir, dir === startFolders(m.path)[0] ? 2 : 1, names, found);
      }
    }
    return infos(matchFiles(missing, found));
  });

  // The person points at a folder and everything found in it, at any depth, is relinked at once.
  ipcMain.handle("relink:folder", async (_e, missing: MissingFile[]) => {
    const w = win();
    const r = await dialog.showOpenDialog(w!, { title: "Find the missing media", properties: ["openDirectory"], message: "Choose the folder that holds your media" });
    const folder = r.filePaths[0];
    if (r.canceled || !folder) return null;
    const found = await scan(folder, 6, wantedNames(missing));
    return { folder, matches: await infos(matchFiles(missing, found)) };
  });

  // One file picked by hand links to the clip asked about, whatever its name or size, and its folder is searched for the rest.
  ipcMain.handle("relink:file", async (_e, missing: MissingFile[], targetId: string) => {
    const target = missing.find(m => m.id === targetId);
    if (!target) return null;
    const r = await dialog.showOpenDialog(win()!, { title: `Find ${target.name}`, properties: ["openFile"] });
    const chosen = r.filePaths[0];
    if (r.canceled || !chosen) return null;
    const rest = missing.filter(m => m.id !== targetId);
    const found = await scan(dirName(chosen), 3, wantedNames(rest));
    const others = matchFiles(rest, found);
    return { matches: await infos([{ id: targetId, path: chosen }, ...others]) };
  });
}
