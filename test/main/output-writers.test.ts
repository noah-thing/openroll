import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutputWriters, withExtension } from "../../src/main/output-writers";

let dir = "";
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "openroll-writers-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bytes = (...n: number[]) => new Uint8Array(n);

describe("OutputWriters", () => {
  it("keeps the old file until the new one is closed", async () => {
    const out = join(dir, "clip.mp4");
    writeFileSync(out, "old");
    const w = new OutputWriters();
    const id = await w.create(out);
    await w.write(id, 0, bytes(1, 2, 3));
    expect(readFileSync(out, "utf8")).toBe("old");
    expect(await w.close(id, false)).toBe(out);
    expect([...readFileSync(out)]).toEqual([1, 2, 3]);
    expect(readdirSync(dir)).toEqual(["clip.mp4"]);
  });

  it("leaves the old file and no temp file when an export is cancelled", async () => {
    const out = join(dir, "clip.mp4");
    writeFileSync(out, "old");
    const w = new OutputWriters();
    const id = await w.create(out);
    await w.write(id, 0, bytes(9));
    expect(await w.close(id, true)).toBeNull();
    expect(readFileSync(out, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["clip.mp4"]);
  });

  it("gives two exports to the same file separate temp files", async () => {
    const out = join(dir, "clip.mp4");
    const w = new OutputWriters();
    const a = await w.create(out);
    await w.write(a, 0, bytes(1, 1, 1, 1));
    const b = await w.create(out);
    await w.write(b, 0, bytes(2));
    await w.write(a, 4, bytes(1));
    await w.close(a, false);
    expect([...readFileSync(out)]).toEqual([1, 1, 1, 1, 1]);
    await w.close(b, true);
    expect([...readFileSync(out)]).toEqual([1, 1, 1, 1, 1]);
    expect(readdirSync(dir)).toEqual(["clip.mp4"]);
  });

  it("reports a rename that fails and leaves no temp file", async () => {
    const out = join(dir, "clip.mp4");
    // A folder with something in it cannot be replaced by a file.
    mkdirSync(out);
    writeFileSync(join(out, "inside"), "x");
    const w = new OutputWriters();
    const id = await w.create(out);
    await w.write(id, 0, bytes(1));
    await expect(w.close(id, false)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["clip.mp4"]);
    expect(readFileSync(join(out, "inside"), "utf8")).toBe("x");
  });

  it("removes temp files for writers still open at quit", async () => {
    const w = new OutputWriters();
    await w.create(join(dir, "a.mp4"));
    expect(readdirSync(dir)).toHaveLength(1);
    w.discardAll();
    expect(existsSync(join(dir, "a.mp4"))).toBe(false);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("rejects a write to a closed writer or a bad position", async () => {
    const w = new OutputWriters();
    const id = await w.create(join(dir, "a.mp4"));
    await expect(w.write(id, -1, bytes(1))).rejects.toThrow();
    await w.close(id, true);
    await expect(w.write(id, 0, bytes(1))).rejects.toThrow("writer closed");
  });
});

describe("withExtension", () => {
  it("keeps a name that already ends right and adds the extension to one that does not", () => {
    expect(withExtension("/v/clip.mp4", "mp4")).toBe("/v/clip.mp4");
    expect(withExtension("/v/clip.MP4", "mp4")).toBe("/v/clip.MP4");
    expect(withExtension("/v/clip", "mp4")).toBe("/v/clip.mp4");
    expect(withExtension("/v/clip.gif", "mp4")).toBe("/v/clip.gif.mp4");
  });
});
