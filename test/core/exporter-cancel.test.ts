import { describe, expect, it } from "vitest";
import { Exporter } from "../../src/engine/exporter";
import type { ExportSettings } from "../../src/engine/export-protocol";

describe("Exporter", () => {
  it("does not start rendering when stopped before an encoder was running", async () => {
    const started: unknown[] = [];
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      constructor() {
        started.push(this);
        throw new Error("worker started");
      }
    };
    (globalThis as unknown as { window: unknown }).window = { openroll: { convert: { status: async () => ({ available: true }) }, resetWriter: async () => {} } };
    const ex = new Exporter({ tracks: [], media: {}, settings: {} } as never, {}, 1);
    ex.cancel();
    const s = { format: "mp4", encoder: "hardware", audio: true, transparent: false } as ExportSettings;
    await expect(ex.run(s, { onProgress() {} })).rejects.toThrow("cancelled");
    expect(started).toHaveLength(0);
  });
});
