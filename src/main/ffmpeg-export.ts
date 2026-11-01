import { randomUUID } from "node:crypto";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { Writable } from "node:stream";
import type { PipeSpec } from "../shared/ffexport";
import { pipeArgs } from "./ffmpeg-export-args";
import { findBinaries } from "./ffmpeg-binaries";
import { removeBusy } from "./fs-retry";
import type { JobQueue } from "./ffmpeg-queue";
import { start, type Run } from "./ffmpeg-runner";

interface Session {
  dir: string;
  audio: FileHandle | null;
  audioFile: string;
  raw: FileHandle | null;
  rawFile: string;
  run: Run | null;
  failure: Error | null;
  abort: AbortController;
  held: boolean;
}

/**
 * Receives rendered frames from the page and feeds them to an ffmpeg process. Memory stays
 * flat because a frame call only returns once ffmpeg has taken the bytes.
 */
export class PipeExports {
  private sessions = new Map<string, Session>();

  constructor(private tempRoot: () => string, private queue: JobQueue) {}

  async open(): Promise<string> {
    const id = randomUUID();
    const dir = join(this.tempRoot(), id);
    await mkdir(dir, { recursive: true });
    this.sessions.set(id, {
      dir,
      audio: null,
      audioFile: join(dir, "audio.f32"),
      raw: null,
      rawFile: join(dir, "frames.rgba"),
      run: null,
      failure: null,
      abort: new AbortController(),
      held: false,
    });
    return id;
  }

  private get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error("export session closed");
    return s;
  }

  /** Interleaved 32 bit float stereo at 48 kHz, appended in order. */
  async audio(id: string, data: Uint8Array): Promise<void> {
    const s = this.get(id);
    s.audio ??= await open(s.audioFile, "w");
    await s.audio.write(data);
  }

  /** Starts ffmpeg. Resolves once it is running; a failure to start is reported here. */
  async begin(id: string, spec: PipeSpec, output: string): Promise<void> {
    const s = this.get(id);
    const bins = findBinaries();
    if (!bins) throw new Error("The converter is missing.");
    await s.audio?.close();
    s.audio = null;
    const args = pipeArgs(spec, "pipe:0", spec.hasAudio ? s.audioFile : null, output, join(s.dir, "palette.png"));
    if (args.twoPass) {
      s.raw = await open(s.rawFile, "w");
      return;
    }
    // Background conversions wait while an export owns the machine.
    this.queue.hold(id);
    s.held = true;
    s.run = start(bins.ffmpeg, args.main, { pipeInput: true, signal: s.abort.signal });
    s.run.done.catch((err: Error) => (s.failure = err));
  }

  async frame(id: string, data: Uint8Array): Promise<void> {
    const s = this.get(id);
    if (s.failure) throw s.failure;
    if (s.raw) {
      await s.raw.write(data);
      return;
    }
    const stdin = s.run?.stdin;
    if (!stdin) throw new Error("The converter is not running.");
    await write(stdin, data, () => s.failure);
  }

  /** Closes the input and waits for ffmpeg to finish writing the file. */
  async finish(id: string, spec: PipeSpec, output: string, onProgress?: (frac: number) => void): Promise<void> {
    const s = this.get(id);
    try {
      if (s.raw) {
        await s.raw.close();
        s.raw = null;
        const bins = findBinaries()!;
        const args = pipeArgs(spec, s.rawFile, null, output, join(s.dir, "palette.png"));
        await start(bins.ffmpeg, args.palette!, { signal: s.abort.signal }).done;
        onProgress?.(0.5);
        await start(bins.ffmpeg, args.main, { signal: s.abort.signal }).done;
        return;
      }
      s.run?.stdin?.end();
      await s.run?.done;
      if (s.failure) throw s.failure;
    } finally {
      await this.close(id);
    }
  }

  async cancel(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.abort.abort();
    await this.close(id);
  }

  private async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (s.held) this.queue.release(id);
    await s.audio?.close().catch(() => {});
    await s.raw?.close().catch(() => {});
    await removeBusy(s.dir);
  }
}

function write(stream: Writable, data: Uint8Array, failure: () => Error | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => reject(failure() ?? err);
    stream.once("error", fail);
    const ok = stream.write(data, err => {
      if (err) fail(err);
    });
    if (ok) {
      stream.off("error", fail);
      resolve();
    } else {
      stream.once("drain", () => {
        stream.off("error", fail);
        resolve();
      });
    }
  });
}
