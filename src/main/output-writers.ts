import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { open, rename, rm, type FileHandle } from "node:fs/promises";

interface Writer {
  handle: FileHandle | null;
  path: string;
  tmp: string;
}

/**
 * Output files for exports. Everything goes to a temp file beside the target and is renamed
 * over it on close, so a failed or cancelled export never leaves a broken file with the real
 * name, and an older file at that path stays until the new one is complete.
 */
export class OutputWriters {
  private writers = new Map<number, Writer>();
  private next = 1;

  async create(path: string): Promise<number> {
    // Two queued exports can name the same file; each needs a temp file of its own.
    const tmp = `${path}.${randomUUID().slice(0, 8)}.openroll-part`;
    const handle = await open(tmp, "w");
    const id = this.next++;
    this.writers.set(id, { handle, path, tmp });
    return id;
  }

  async write(id: number, position: number, data: Uint8Array): Promise<void> {
    const w = this.writers.get(id);
    if (!w?.handle) throw new Error("writer closed");
    if (!Number.isSafeInteger(position) || position < 0) throw new Error("bad write position");
    // A single write can stop short of the end, so go on until every byte is down.
    let done = 0;
    while (done < data.byteLength) {
      const { bytesWritten } = await w.handle.write(data, done, data.byteLength - done, position + done);
      if (bytesWritten <= 0) throw new Error("The file could not be written.");
      done += bytesWritten;
    }
  }

  /** A retry with another encoder starts the file over, so nothing of the failed attempt stays behind. */
  async reset(id: number): Promise<void> {
    const w = this.writers.get(id);
    if (w?.handle) await w.handle.truncate(0);
  }

  /** Hands the temp file to a process that writes it itself, such as ffmpeg. */
  async take(id: number): Promise<string | null> {
    const w = this.writers.get(id);
    if (!w) return null;
    await w.handle?.close();
    w.handle = null;
    return w.tmp;
  }

  /** Returns the final path once the file is in place. */
  async close(id: number, abort: boolean): Promise<string | null> {
    const w = this.writers.get(id);
    if (!w) return null;
    this.writers.delete(id);
    try {
      if (!abort) {
        await w.handle?.sync();
        await w.handle?.close();
        await rename(w.tmp, w.path);
        return w.path;
      }
    } catch (err) {
      await w.handle?.close().catch(() => {});
      await rm(w.tmp, { force: true });
      throw err;
    }
    await w.handle?.close().catch(() => {});
    await rm(w.tmp, { force: true });
    return null;
  }

  /** On quit, so an export that was running leaves no half written file beside the person's folder. */
  discardAll(): void {
    for (const w of this.writers.values()) rmSync(w.tmp, { force: true });
    this.writers.clear();
  }
}
