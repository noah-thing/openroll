import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { SessionNotice } from "../shared/api";

interface Marker {
  clean: boolean;
  path: string | null;
}

/**
 * Remembers which project was open and whether the last run ended normally. A run that did not
 * leaves a notice for the page to offer, once. Writes are synchronous so they survive a quit in progress.
 */
export class Session {
  private pending: SessionNotice | null = null;
  private openPath: string | null = null;

  constructor(private file: string) {}

  begin(): void {
    let prev: Partial<Marker> = {};
    try {
      prev = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      /* first run */
    }
    if (prev.clean === false && typeof prev.path === "string" && existsSync(prev.path)) {
      this.pending = { reason: "unclean", path: prev.path, name: basename(prev.path).replace(/\.openroll$/, "") };
    }
    this.write(false);
  }

  /** The renderer or GPU process died and the window is about to reload. */
  crashed(): void {
    if (this.openPath) this.pending = { reason: "crash", path: this.openPath, name: basename(this.openPath).replace(/\.openroll$/, "") };
  }

  setProject(path: string | null): void {
    if (path === this.openPath) return;
    this.openPath = path;
    this.write(false);
  }

  take(): SessionNotice | null {
    const n = this.pending;
    this.pending = null;
    return n;
  }

  end(): void {
    this.write(true);
  }

  private write(clean: boolean): void {
    try {
      writeFileSync(this.file, JSON.stringify({ clean, path: this.openPath } satisfies Marker));
    } catch {
      /* losing the marker only costs a recovery offer */
    }
  }
}
