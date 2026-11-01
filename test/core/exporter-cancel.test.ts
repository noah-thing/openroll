import { afterEach, describe, expect, it } from "vitest";
import { Exporter, ipcReason } from "../../src/engine/exporter";
import type { ExportSettings } from "../../src/engine/export-protocol";

const g = globalThis as unknown as { window: unknown; Worker: unknown };
const settings = { format: "mp4", encoder: "hardware", audio: true, transparent: false } as ExportSettings;
const project = { tracks: [], media: {}, settings: {} } as never;
afterEach(() => {
  delete (g as { Worker?: unknown }).Worker;
});

describe("Exporter", () => {
  it("does not start rendering when stopped before an encoder was running", async () => {
    const started: unknown[] = [];
    g.Worker = class {
      constructor() {
        started.push(this);
        throw new Error("worker started");
      }
    };
    g.window = { openroll: { convert: { status: async () => ({ available: true }) }, resetWriter: async () => {} } };
    const ex = new Exporter(project, {}, 1);
    ex.cancel();
    await expect(ex.run(settings, { onProgress() {} })).rejects.toThrow("cancelled");
    expect(started).toHaveLength(0);
  });

  it("stops at once when the file cannot be written instead of trying the other encoders", async () => {
    const started: unknown[] = [];
    const resets: number[] = [];
    g.Worker = class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror = null;
      constructor() {
        started.push(this);
      }
      postMessage(m: { type: string }) {
        if (m.type === "start") queueMicrotask(() => this.onmessage?.({ data: { type: "write", req: 1, position: 0, data: new Uint8Array(1) } }));
      }
      terminate() {}
    };
    g.window = {
      openroll: {
        convert: { status: async () => ({ available: true }) },
        resetWriter: async (id: number) => void resets.push(id),
        write: async () => {
          throw new Error("Error invoking remote method 'writer:write': Error: ENOSPC: no space left on device, write");
        },
      },
    };
    const ex = new Exporter(project, {}, 1);
    await expect(ex.run(settings, { onProgress() {} })).rejects.toThrow("the file could not be written (ENOSPC: no space left on device, write)");
    expect(started).toHaveLength(1);
    expect(resets).toEqual([]);
  });

  it("stops at once when the sound cannot be mixed", async () => {
    const started: unknown[] = [];
    g.Worker = class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror = null;
      constructor() {
        started.push(this);
      }
      postMessage(m: { type: string }) {
        if (m.type === "start") queueMicrotask(() => this.onmessage?.({ data: { type: "need-audio", req: 1, from: 0, seconds: 10 } }));
      }
      terminate() {}
    };
    g.window = { openroll: { convert: { status: async () => ({ available: true }) }, resetWriter: async () => {} } };
    // A project with a clip but no OfflineAudioContext here: mixing throws.
    const withClip = { tracks: [{ muted: false, items: [{ type: "media", mediaId: "a", start: 0, duration: 1_000_000, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 }] }], media: { a: { hasAudio: true } }, settings: {} } as never;
    const ex = new Exporter(withClip, { a: "x" }, 1);
    await expect(ex.run(settings, { onProgress() {} })).rejects.toThrow("the sound could not be mixed");
    expect(started).toHaveLength(1);
  });

  it("strips the wrapper Electron puts on errors from the main process", () => {
    expect(ipcReason(new Error("Error invoking remote method 'writer:write': Error: EACCES: permission denied"))).toBe("EACCES: permission denied");
    expect(ipcReason("plain")).toBe("plain");
  });
});
