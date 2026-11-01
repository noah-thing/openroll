import { useSyncExternalStore } from "react";
import type { Project } from "../../core/project";
import { Exporter, type ExportProgress } from "../../engine/exporter";
import type { ExportSettings } from "../../engine/export-protocol";
import type { AiSync } from "../../engine/ai/protocol";

export type Prepare = (onProgress: (label: string, done: number, total: number) => void) => Promise<AiSync[]>;

export interface ExportJob {
  id: number;
  name: string;
  label: string;
  status: "queued" | "running" | "done" | "error";
  progress: ExportProgress | null;
  path: string;
  bytes: number;
  seconds: number;
  error?: string;
  /** A finished job stays listed until the person has seen it. */
  seen: boolean;
}

interface Pending {
  job: ExportJob;
  project: Project;
  urls: Record<string, string>;
  settings: ExportSettings;
  writerId: number;
  exporter: Exporter | null;
  /** Stop was pressed before the exporter existed, for example while background removal is still running. */
  stopped: boolean;
  prepare?: Prepare;
  finished: Array<(job: ExportJob) => void>;
}

/**
 * Exports run one at a time in the order they were added, on a snapshot of the project taken
 * when each was queued. It lives outside any editor, so closing the dialog, or the project,
 * does not stop a render in progress.
 */
class ExportQueue {
  private items: Pending[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private snapshot: ExportJob[] = [];

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get jobs(): ExportJob[] {
    return this.snapshot;
  }

  private emit(): void {
    this.snapshot = this.items.map(i => ({ ...i.job }));
    for (const fn of this.listeners) fn();
  }

  add(entry: { name: string; label: string; project: Project; urls: Record<string, string>; settings: ExportSettings; writer: { id: number; path: string }; prepare?: Prepare }): number {
    const job: ExportJob = { id: this.nextId++, name: entry.name, label: entry.label, status: "queued", progress: null, path: entry.writer.path, bytes: 0, seconds: 0, seen: false };
    this.items.push({ job, project: entry.project, urls: entry.urls, settings: entry.settings, writerId: entry.writer.id, exporter: null, stopped: false, prepare: entry.prepare, finished: [] });
    this.emit();
    void this.pump();
    return job.id;
  }

  cancel(id: number): void {
    const p = this.items.find(i => i.job.id === id);
    if (!p) return;
    if (p.job.status === "running") {
      p.stopped = true;
      p.exporter?.cancel();
    } else if (p.job.status === "queued") {
      void window.openroll.closeWriter(p.writerId, true);
      this.items = this.items.filter(i => i !== p);
      for (const fn of p.finished.splice(0)) fn(p.job);
      this.emit();
    }
  }

  dismiss(id: number): void {
    this.items = this.items.filter(i => i.job.id !== id || i.job.status === "running" || i.job.status === "queued");
    this.emit();
  }

  markSeen(): void {
    let changed = false;
    for (const i of this.items) {
      if (i.job.seen || (i.job.status !== "done" && i.job.status !== "error")) continue;
      i.job.seen = true;
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Resolves when the job finishes, fails or is stopped. */
  whenDone(id: number): Promise<ExportJob> {
    const item = this.items.find(i => i.job.id === id);
    if (!item) return Promise.reject(new Error("no such export"));
    if (item.job.status === "done" || item.job.status === "error") return Promise.resolve(item.job);
    return new Promise(resolve => item.finished.push(resolve));
  }

  private pump = async (): Promise<void> => {
    if (this.items.some(i => i.job.status === "running")) return;
    const next = this.items.find(i => i.job.status === "queued");
    if (!next) return;
    next.job.status = "running";
    this.emit();
    let ex: Exporter | null = null;
    try {
      const ai = next.prepare
        ? await next.prepare((label, done, total) => {
            next.job.progress = { frame: done, frames: Math.max(1, total), elapsed: 0, bytes: 0, note: label };
            this.emit();
          })
        : [];
      if (next.stopped) throw new Error("cancelled");
      ex = new Exporter(next.project, next.urls, next.writerId, ai);
      next.exporter = ex;
      const r = await ex.run(next.settings, {
        onProgress: progress => {
          next.job.progress = progress;
          this.emit();
        },
      });
      await window.openroll.closeWriter(next.writerId);
      Object.assign(next.job, { status: "done", bytes: r.bytes, seconds: r.seconds });
    } catch (err) {
      // A file that will not delete must not leave the job stuck as running.
      await window.openroll.closeWriter(next.writerId, true).catch(() => {});
      const message = (err as Error).message;
      if (message === "cancelled") this.items = this.items.filter(i => i !== next);
      else Object.assign(next.job, { status: "error", error: message });
    } finally {
      ex?.dispose();
      next.exporter = null;
      for (const fn of next.finished.splice(0)) fn(next.job);
      this.emit();
      void this.pump();
    }
  };
}

export const exportQueue = new ExportQueue();

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(exportQueue.subscribe, () => exportQueue.jobs);
}
