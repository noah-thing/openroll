export interface JobContext {
  signal: AbortSignal;
  /** True when playback was running as this job started, so it can pick a gentler thread count. */
  playbackActive: boolean;
}

export interface Job {
  id: string;
  /** Heavy jobs use a whole encoder. Light ones (probing) run beside anything. */
  heavy: boolean;
  /** Higher runs first. Exports a person is waiting on outrank background preparation. */
  priority: number;
  run(ctx: JobContext): Promise<void>;
}

interface Entry {
  job: Job;
  order: number;
  controller: AbortController;
  resolve(): void;
  reject(err: unknown): void;
}

/**
 * Runs ffmpeg work in the background without starving playback. While the timeline plays
 * only one heavy job runs at a time; when it is idle a second may join if the machine has
 * the cores. Running jobs are never paused, only the next start is held back.
 */
export class JobQueue {
  private waiting: Entry[] = [];
  private running = new Map<string, Entry>();
  private playback = false;
  private holds = new Set<string>();
  private counter = 0;

  constructor(private cores = 4) {}

  get heavyLimit(): number {
    return this.playback ? 1 : Math.max(1, Math.min(2, Math.floor(this.cores / 4)));
  }

  /** While an export runs, no new heavy job starts. Ones already running finish. */
  hold(id: string): void {
    this.holds.add(id);
  }

  release(id: string): void {
    this.holds.delete(id);
    this.pump();
  }

  setPlayback(active: boolean): void {
    this.playback = active;
    this.pump();
  }

  has(id: string): boolean {
    return this.running.has(id) || this.waiting.some(e => e.job.id === id);
  }

  add(job: Job): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiting.push({ job, order: this.counter++, controller: new AbortController(), resolve, reject });
      this.pump();
    });
  }

  cancel(id: string): void {
    const queued = this.waiting.findIndex(e => e.job.id === id);
    if (queued >= 0) {
      const [e] = this.waiting.splice(queued, 1);
      e.reject(new CancelledError());
      return;
    }
    this.running.get(id)?.controller.abort();
  }

  get heavyRunning(): number {
    let n = 0;
    for (const e of this.running.values()) if (e.job.heavy) n++;
    return n;
  }

  private pump(): void {
    for (;;) {
      const next = this.pick();
      if (!next) return;
      this.waiting.splice(this.waiting.indexOf(next), 1);
      this.running.set(next.job.id, next);
      const playbackActive = this.playback;
      void next.job
        .run({ signal: next.controller.signal, playbackActive })
        .then(
          () => next.resolve(),
          err => next.reject(next.controller.signal.aborted ? new CancelledError() : err),
        )
        .finally(() => {
          this.running.delete(next.job.id);
          this.pump();
        });
    }
  }

  private pick(): Entry | undefined {
    const ordered = [...this.waiting].sort((a, b) => b.job.priority - a.job.priority || a.order - b.order);
    const heavyFree = this.holds.size === 0 && this.heavyRunning < this.heavyLimit;
    return ordered.find(e => !e.job.heavy || heavyFree);
  }
}

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}
