import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry } from "../shared/api";
import { Serial } from "./project-files";
import { samePath } from "../shared/paths";
import { renameBusy } from "./fs-retry";

/** Versions kept per project. */
export const KEEP = 20;
/** Saves land every few hundred milliseconds while editing; they fold into one version for this long. */
export const FOLD_MS = 3 * 60_000;

interface Version extends HistoryEntry {
  /** When the first save of this version happened; the name of the file. */
  started: number;
}

interface Meta {
  path: string;
  name: string;
}

const SAFE_ID = /^\w[\w.-]{0,79}$/;

export class Journal {
  private queue = new Serial();

  constructor(private root: string, private platform: string = process.platform) {}

  private dirFor(id: string): string {
    return join(this.root, id);
  }

  /** Project id from the saved JSON. Anything that is not a safe folder name is refused. */
  static idOf(json: string): string | null {
    try {
      const id = JSON.parse(json)?.id;
      return typeof id === "string" && SAFE_ID.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Keep this saved text as a version. Unchanged text is skipped, and a run of saves close together
   * rewrites the newest version instead of adding twenty near copies. `force` always starts a new one.
   */
  record(json: string, meta: Meta, opts: { force?: boolean; now?: number } = {}): Promise<void> {
    // Saves overlap with the open and restore that record too; two writers would trim and fold over each other.
    return this.queue.run(() => this.write(json, meta, opts));
  }

  private async write(json: string, meta: Meta, opts: { force?: boolean; now?: number }): Promise<void> {
    const id = Journal.idOf(json);
    if (!id) return;
    const dir = this.dirFor(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta));

    const versions = await this.versions(dir);
    const newest = versions[0];
    const now = opts.now ?? Date.now();
    if (newest) {
      const text = await readFile(join(dir, newest.file), "utf8").catch(() => null);
      if (text === json) return;
      if (!opts.force && now - newest.started < FOLD_MS) {
        await this.writeAtomic(join(dir, newest.file), json);
        return;
      }
    }
    // Two forced saves in one millisecond (restore does this) must not share a file.
    let stamp = now;
    while (versions.some(v => v.started === stamp)) stamp++;
    await this.writeAtomic(join(dir, `${stamp}.json`), json);
    for (const old of versions.slice(KEEP - 1)) await rm(join(dir, old.file), { force: true });
  }

  private async writeAtomic(path: string, text: string): Promise<void> {
    const tmp = path + ".tmp";
    await writeFile(tmp, text, "utf8");
    await renameBusy(tmp, path);
  }

  private async versions(dir: string): Promise<Version[]> {
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: Version[] = [];
    for (const file of names) {
      if (!/^\d+\.json$/.test(file)) continue;
      const s = await stat(join(dir, file)).catch(() => null);
      if (s) out.push({ file, time: Math.round(s.mtimeMs), bytes: s.size, started: parseInt(file, 10) });
    }
    return out.sort((a, b) => b.started - a.started);
  }

  /** Every version of the project that was last saved at this path, newest first. */
  async list(projectPath: string): Promise<HistoryEntry[]> {
    const id = await this.idForPath(projectPath);
    return id ? (await this.versions(this.dirFor(id))).map(({ file, time, bytes }) => ({ file, time, bytes })) : [];
  }

  async read(projectPath: string, file: string): Promise<string | null> {
    const id = await this.idForPath(projectPath);
    if (!id || !/^\d+\.json$/.test(file)) return null;
    return readFile(join(this.dirFor(id), file), "utf8").catch(() => null);
  }

  /** The id of the project that lives at this path, from the journal's own notes. */
  async idForPath(projectPath: string): Promise<string | null> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    let best: { id: string; time: number } | null = null;
    for (const id of names) {
      const meta = await readFile(join(this.dirFor(id), "meta.json"), "utf8").then(t => JSON.parse(t) as Meta).catch(() => null);
      if (!meta || typeof meta.path !== "string" || !samePath(meta.path, projectPath, this.platform)) continue;
      const time = (await stat(join(this.dirFor(id), "meta.json")).catch(() => null))?.mtimeMs ?? 0;
      if (!best || time > best.time) best = { id, time };
    }
    return best?.id ?? null;
  }

  /** Put a version back as the project file. What was there becomes a version first. */
  async restore(projectPath: string, file: string): Promise<boolean> {
    const text = await this.read(projectPath, file);
    if (text === null || Journal.idOf(text) === null) return false;
    const current = await readFile(projectPath, "utf8").catch(() => null);
    const name = projectPath.replace(/^.*[\\/]/, "").replace(/\.openroll$/, "");
    if (current !== null) await this.record(current, { path: projectPath, name }, { force: true });
    if (current !== null) await copyFile(projectPath, projectPath + ".bak").catch(() => {});
    await this.writeAtomic(projectPath, text);
    await this.record(text, { path: projectPath, name }, { force: true });
    return true;
  }
}
