import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCacheDir, isInside, isProjectFileName, projectStem, Serial, writeFileAtomic } from "../../src/main/project-files";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openroll-files-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("projectStem", () => {
  it("replaces separators and control characters", () => {
    expect(projectStem("a/b\\c:d\u0007")).toBe("a_b_c_d_");
  });
  it("keeps emoji and caps very long names inside file name limits", () => {
    expect(projectStem("Trip 🌴")).toBe("Trip 🌴");
    const long = projectStem("x".repeat(300));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(long + ".openroll.bak")).toBeLessThan(255);
    expect(Buffer.byteLength(projectStem("🌴".repeat(300)) + ".openroll.bak")).toBeLessThan(255);
  });
  it("avoids Windows reserved names, trailing dots and hidden names", () => {
    expect(projectStem("CON")).toBe("CON_");
    expect(projectStem("nul.txt")).toBe("nul.txt_");
    expect(projectStem("Cut...")).toBe("Cut");
    expect(projectStem("..")).toBe("Untitled");
    expect(projectStem("   ")).toBe("Untitled");
    expect(projectStem(".hidden")).toBe("hidden");
  });
});

describe("isInside", () => {
  it("rejects sibling folders that share a prefix and dot segments", () => {
    expect(isInside("/home/me/OpenRoll", "/home/me/OpenRoll/a.openroll")).toBe(true);
    expect(isInside("/home/me/OpenRoll", "/home/me/OpenRoll-old/a.openroll")).toBe(false);
    expect(isInside("/home/me/OpenRoll", "/home/me/OpenRoll/../Documents/a.openroll")).toBe(false);
    expect(isInside("/home/me/OpenRoll", "/home/me/OpenRoll")).toBe(false);
  });
});

describe("isProjectFileName", () => {
  it("lists projects only", () => {
    expect(isProjectFileName("Trip.openroll")).toBe(true);
    expect(isProjectFileName("._Trip.openroll")).toBe(false);
    expect(isProjectFileName("Trip.openroll.bak")).toBe(false);
    expect(isProjectFileName(".openroll")).toBe(false);
  });
});

describe("writeFileAtomic", () => {
  it("keeps a backup of what it replaces and leaves no temp files", async () => {
    const f = join(dir, "a.openroll");
    await writeFileAtomic(f, "one", true);
    await writeFileAtomic(f, "two", true);
    expect(await readFile(f, "utf8")).toBe("two");
    expect(await readFile(f + ".bak", "utf8")).toBe("one");
    expect((await readdir(dir)).sort()).toEqual(["a.openroll", "a.openroll.bak"]);
  });
  it("overlapping writes through Serial never fail and the last one wins", async () => {
    const f = join(dir, "a.openroll");
    const q = new Serial();
    await Promise.all(Array.from({ length: 20 }, (_, i) => q.run(() => writeFileAtomic(f, String(i), true))));
    expect(await readFile(f, "utf8")).toBe("19");
  });
  it("uses a temp file per call and cleans up", async () => {
    const f = join(dir, "a.openroll");
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(f, String(i))));
    expect((await readdir(dir)).filter(n => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("Serial", () => {
  it("runs in order and survives a failing job", async () => {
    const q = new Serial();
    const order: number[] = [];
    const a = q.run(async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push(1);
    });
    const b = q.run(() => Promise.reject(new Error("no")));
    const c = q.run(async () => void order.push(3));
    await a;
    await expect(b).rejects.toThrow("no");
    await c;
    expect(order).toEqual([1, 3]);
  });
});

describe("clearCacheDir", () => {
  it("keeps generated sound effects that projects point at", async () => {
    await mkdir(join(dir, "derived"));
    await writeFile(join(dir, "derived", "x.mp4"), "x");
    await writeFile(join(dir, "sfx-whoosh-v1.wav"), "w");
    await writeFile(join(dir, "abc.jpg"), "j");
    await clearCacheDir(dir);
    expect(await readdir(dir)).toEqual(["sfx-whoosh-v1.wav"]);
  });
  it("is fine with a folder that does not exist", async () => {
    await expect(clearCacheDir(join(dir, "nope"))).resolves.toBeUndefined();
  });
});
