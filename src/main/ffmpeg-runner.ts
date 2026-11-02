import { spawn, type ChildProcess } from "node:child_process";
import { setPriority } from "node:os";
import type { Writable } from "node:stream";
import { failureReason, ProgressParser, type FfmpegProgress } from "./ffmpeg-progress";
import { CancelledError } from "./ffmpeg-queue";

export interface RunOptions {
  /** Keeps stdin open so frames or audio can be written to it. */
  pipeInput?: boolean;
  onProgress?(p: FfmpegProgress): void;
  signal?: AbortSignal;
  /** Background work should not compete with the interface for the CPU. */
  lowPriority?: boolean;
}

export interface Run {
  /** Resolves when ffmpeg exits cleanly. */
  done: Promise<void>;
  stdin: Writable | null;
  kill(): void;
}

export class FfmpegError extends Error {}

/** Starts a binary with windowsHide so no console flashes up on Windows, and parses its progress output. */
export function start(bin: string, args: string[], opts: RunOptions = {}): Run {
  const full = ["-hide_banner", "-y", ...(opts.pipeInput ? [] : ["-nostdin"]), "-progress", "pipe:1", "-nostats", ...args];
  const child = spawn(bin, full, { windowsHide: true, stdio: [opts.pipeInput ? "pipe" : "ignore", "pipe", "pipe"] });
  if (opts.lowPriority && child.pid) {
    try {
      setPriority(child.pid, 10);
    } catch {
      /* the process may already be gone */
    }
  }
  const parser = new ProgressParser();
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    for (const p of parser.push(chunk)) opts.onProgress?.(p);
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    // Keep the tail only; a long encode can print a lot of warnings.
    stderr = (stderr + chunk).slice(-8000);
  });
  // A closed pipe after cancel or a crash would otherwise raise an unhandled error.
  child.stdin?.on("error", () => {});

  const kill = () => killTree(child);
  opts.signal?.addEventListener("abort", kill, { once: true });

  const done = new Promise<void>((resolve, reject) => {
    child.on("error", err => reject(new FfmpegError(`ffmpeg could not start: ${err.message}`)));
    child.on("close", code => {
      opts.signal?.removeEventListener("abort", kill);
      if (opts.signal?.aborted) reject(new CancelledError());
      else if (code === 0) resolve();
      else reject(new FfmpegError(failureReason(stderr) || `ffmpeg exited with code ${code}`));
    });
  });
  return { done, stdin: child.stdin, kill };
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  // ffmpeg ignores SIGTERM while it waits on a blocked pipe.
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 1500).unref();
}

const MAX_CAPTURE = 16 * 1024 * 1024;

/** Runs a short command to completion and returns what it printed. Used for ffprobe and capability checks. */
export function capture(bin: string, args: string[], timeoutMs = 20_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let flooded = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout!.setEncoding("utf8").on("data", (c: string) => {
      // A crafted file can carry endless tags or streams; ffprobe would print them all.
      if (stdout.length + c.length > MAX_CAPTURE) {
        flooded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += c;
    });
    child.stderr!.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-8000)));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ stdout: flooded ? "" : stdout, stderr, code: flooded ? null : code });
    });
  });
}
