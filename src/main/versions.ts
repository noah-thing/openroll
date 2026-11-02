import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VersionEntry } from "../shared/api";
import { renameBusy } from "./fs-retry";
import { Journal } from "./journal";

/** Named versions kept per project. The automatic journal keeps its own, rolling, list. */
export const KEEP_NAMED = 100;

const SAFE_ID = /^\w[\w.-]{0,79}$/;
const FILE = /^\d+\.json$/;

/**
 * Versions the person saved on purpose, with a name. They live next to the journal but in
 * their own folder, so the journal's trimming never touches them and nothing here touches
 * its files.
 */
export class NamedVersions {
  constructor(private root: string) {}

  private dir(projectId: string): string | null {
    return SAFE_ID.test(projectId) ? join(this.root, projectId) : null;
  }

  private async readIndex(dir: string): Promise<VersionEntry[]> {
    try {
      const raw = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
      return Array.isArray(raw) ? raw.filter(e => typeof e?.file === "string" && FILE.test(e.file)) : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(dir: string, entries: VersionEntry[]): Promise<void> {
    const tmp = join(dir, "index.json.tmp");
    await writeFile(tmp, JSON.stringify(entries), "utf8");
    await renameBusy(tmp, join(dir, "index.json"));
  }

  async save(json: string, name: string, now = Date.now()): Promise<VersionEntry | null> {
    const id = Journal.idOf(json);
    const dir = id && this.dir(id);
    if (!dir) return null;
    await mkdir(dir, { recursive: true });
    const entries = await this.readIndex(dir);
    let stamp = now;
    while (entries.some(e => e.file === `${stamp}.json`)) stamp++;
    const file = `${stamp}.json`;
    await writeFile(join(dir, file), json, "utf8");
    const bytes = (await stat(join(dir, file))).size;
    const entry: VersionEntry = { file, name: name.trim().slice(0, 80) || "Version", time: stamp, bytes };
    const next = [entry, ...entries];
    for (const old of next.splice(KEEP_NAMED)) await rm(join(dir, old.file), { force: true });
    await this.writeIndex(dir, next);
    return entry;
  }

  async list(projectId: string): Promise<VersionEntry[]> {
    const dir = this.dir(projectId);
    return dir ? (await this.readIndex(dir)).sort((a, b) => b.time - a.time) : [];
  }

  async read(projectId: string, file: string): Promise<string | null> {
    const dir = this.dir(projectId);
    if (!dir || !FILE.test(file)) return null;
    return readFile(join(dir, file), "utf8").catch(() => null);
  }

  async remove(projectId: string, file: string): Promise<boolean> {
    const dir = this.dir(projectId);
    if (!dir || !FILE.test(file)) return false;
    const entries = await this.readIndex(dir);
    if (!entries.some(e => e.file === file)) return false;
    await rm(join(dir, file), { force: true });
    await this.writeIndex(dir, entries.filter(e => e.file !== file));
    return true;
  }
}
