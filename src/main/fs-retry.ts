import { rename, rm } from "node:fs/promises";

const BUSY = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * Windows refuses to rename or delete a file for a moment while Defender or the search indexer has it
 * open, which a fresh export or download always is. Retrying for a second clears it; elsewhere this is a plain call.
 */
export async function retryBusy<T>(op: () => Promise<T>, platform: string = process.platform, wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (platform !== "win32" || attempt >= 8 || !BUSY.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      await wait(60 * (attempt + 1));
    }
  }
}

export const renameBusy = (from: string, to: string) => retryBusy(() => rename(from, to));
export const removeBusy = (path: string) => retryBusy(() => rm(path, { recursive: true, force: true }));
