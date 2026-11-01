import { renameBusy } from "./fs-retry";
import { copyFile, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** File names top out at 255 bytes; leave room for " 12.openroll.bak" and for four byte characters. */
const MAX_STEM_BYTES = 180;
const MAX_STEM = 120;
let tmpCount = 0;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A project name made safe to use as a file name on any system. Never empty. */
export function projectStem(name: string): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  let kept = "";
  for (const ch of [...s].slice(0, MAX_STEM)) {
    if (Buffer.byteLength(kept + ch) > MAX_STEM_BYTES) break;
    kept += ch;
  }
  s = kept.replace(/[. ]+$/, "").replace(/^\.+/, "").trim();
  if (RESERVED.test(s.split(".")[0])) s = `${s}_`;
  return s || "Untitled";
}


/** Names the home screen lists: real project files, not hidden leftovers like AppleDouble stubs. */
export function isProjectFileName(name: string): boolean {
  return name.endsWith(".openroll") && !name.startsWith(".") && name.length > ".openroll".length;
}

/** Writes beside the target, flushes to disk, then swaps in. A crash leaves the old file or the new one, never half. */
export async function writeFileAtomic(target: string, text: string, backup = false): Promise<void> {
  const tmp = `${target}.${process.pid}.${tmpCount++}.tmp`;
  try {
    const h = await open(tmp, "w");
    try {
      await h.writeFile(text, "utf8");
      await h.sync();
    } finally {
      await h.close();
    }
    if (backup) await copyFile(target, target + ".bak").catch(() => {});
    await renameBusy(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Runs jobs one at a time in the order they arrive. A failure does not stop the ones behind it. */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => {});
    return result;
  }
}

/** Empties the cache folder but keeps files that projects point at: generated sound effects are media, not cache. */
export async function clearCacheDir(dir: string, keep = /^sfx-[\w.-]+\.wav$/): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!keep.test(name)) await rm(join(dir, name), { recursive: true, force: true });
  }
}
