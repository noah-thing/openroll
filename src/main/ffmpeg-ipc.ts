import { ipcMain, type BrowserWindow } from "electron";
import { join } from "node:path";
import type { DerivedKind, DerivedState, InspectResult, ProxyRequest } from "../shared/derived";
import { PIPE_EXTENSION, type PipeSpec } from "../shared/ffexport";
import { PipeExports } from "./ffmpeg-export";
import { findBinaries } from "./ffmpeg-binaries";
import { MediaService } from "./ffmpeg-media";
import { isAllowed } from "./media-protocol";

interface Deps {
  win(): BrowserWindow | null;
  cacheDir(): string;
  allow(path: string): void;
  /** Gives ffmpeg the temp file behind a writer handle, closing the handle so ffmpeg can own the file. */
  takeWriter(writerId: number): Promise<string | null>;
}

const FORMATS = new Set(Object.keys(PIPE_EXTENSION));

function validSpec(s: unknown): s is PipeSpec {
  const p = s as PipeSpec;
  return (
    !!p &&
    FORMATS.has(p.format) &&
    Number.isInteger(p.width) && p.width > 0 && p.width <= 16384 &&
    Number.isInteger(p.height) && p.height > 0 && p.height <= 16384 &&
    p.fps > 0 && p.fps <= 240 &&
    typeof p.transparent === "boolean" &&
    typeof p.hasAudio === "boolean" &&
    Number.isFinite(p.bitrate)
  );
}

export function registerFfmpegIpc(deps: Deps): MediaService {
  const service = new MediaService({
    cacheDir: deps.cacheDir,
    allow: deps.allow,
    emit: (path, state) => deps.win()?.webContents.send("ff:state", path, state),
  });
  const pipes = new PipeExports(() => join(deps.cacheDir(), "export"), service.queue);
  const outputs = new Map<string, string>();

  const allowed = (path: unknown): path is string => typeof path === "string" && isAllowed(path);

  ipcMain.handle("ff:status", () => ({ available: service.available, probe: !!findBinaries()?.ffprobe }));
  ipcMain.handle("ff:inspect", async (_e, path: unknown): Promise<InspectResult | null> => (allowed(path) ? service.describe(path) : null));
  ipcMain.handle("ff:prepare", async (_e, path: unknown, hints: unknown): Promise<DerivedState | null> =>
    allowed(path) ? service.prepare(path, { videoDecodable: !!(hints as { videoDecodable?: boolean } | null)?.videoDecodable }) : null,
  );
  ipcMain.handle("ff:proxy", async (_e, path: unknown, req: unknown): Promise<DerivedState | null> => {
    const r = req as ProxyRequest | null;
    if (!allowed(path) || !r || (r.mode !== "auto" && r.mode !== "always")) return null;
    return service.proxy(path, { mode: r.mode, slow: !!r.slow });
  });
  ipcMain.handle("ff:existing", async (_e, paths: unknown) => (Array.isArray(paths) ? service.existing(paths.filter(allowed)) : {}));
  ipcMain.on("ff:cancel", (_e, path: unknown, kind: unknown) => {
    if (allowed(path) && (kind === "prepare" || kind === "proxy")) service.cancel(path, kind as DerivedKind);
  });
  ipcMain.on("ff:playback", (_e, active: unknown) => service.queue.setPlayback(!!active));

  ipcMain.handle("ffexport:open", () => pipes.open());
  ipcMain.handle("ffexport:audio", (_e, id: string, data: Uint8Array) => pipes.audio(id, data));
  ipcMain.handle("ffexport:begin", async (_e, id: string, writerId: number, spec: unknown) => {
    if (!validSpec(spec)) throw new Error("bad export settings");
    const output = await deps.takeWriter(writerId);
    if (!output) throw new Error("The output file is not open.");
    outputs.set(id, output);
    await pipes.begin(id, spec, output);
  });
  ipcMain.handle("ffexport:frame", (_e, id: string, data: Uint8Array) => pipes.frame(id, data));
  ipcMain.handle("ffexport:finish", async (_e, id: string, spec: unknown) => {
    const output = outputs.get(id);
    outputs.delete(id);
    if (!output || !validSpec(spec)) throw new Error("bad export state");
    await pipes.finish(id, spec, output);
  });
  ipcMain.handle("ffexport:cancel", async (_e, id: string) => {
    outputs.delete(id);
    await pipes.cancel(id);
  });

  return service;
}
