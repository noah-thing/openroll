import { describe, expect, it } from "vitest";
import { decodesTooSlowly, proxyReason, proxySize } from "../../src/engine/proxy-policy";
import { baseName, dirName, matchFiles, sharedDepth, startFolders, type MissingFile } from "../../src/shared/relink";

const facts = (over = {}) => ({ hasVideo: true, width: 3840, height: 2160, keyframeInterval: 4, ...over });

describe("proxy policy", () => {
  it("does nothing when off or when there is no video", () => {
    expect(proxyReason("off", facts())).toBeNull();
    expect(proxyReason("always", facts({ hasVideo: false }))).toBeNull();
  });

  it("makes proxies in auto only for long GOP footage above 1080p", () => {
    expect(proxyReason("auto", facts())).toBe("long-gop");
    expect(proxyReason("auto", facts({ keyframeInterval: 0.5 }))).toBeNull();
    expect(proxyReason("auto", facts({ width: 1920, height: 1080 }))).toBeNull();
    expect(proxyReason("auto", facts({ keyframeInterval: null }))).toBeNull();
  });

  it("treats vertical 4K the same way", () => {
    expect(proxyReason("auto", facts({ width: 2160, height: 3840 }))).toBe("long-gop");
  });

  it("proxies measured slow decoding at any size above the proxy", () => {
    expect(proxyReason("auto", facts({ width: 1920, height: 1080, keyframeInterval: 0.5, slowDecode: true }))).toBe("slow-decode");
    expect(proxyReason("auto", facts({ width: 1280, height: 720, slowDecode: true }))).toBeNull();
  });

  it("always means every file that a proxy would shrink", () => {
    expect(proxyReason("always", facts({ width: 1920, height: 1080, keyframeInterval: 0.5 }))).toBe("always");
    expect(proxyReason("always", facts({ width: 1280, height: 720 }))).toBeNull();
  });

  it("sizes proxies to a 960 short side with even numbers", () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 1706, height: 960 });
    expect(proxySize(2160, 3840)).toEqual({ width: 960, height: 1706 });
    expect(proxySize(4096, 4096)).toEqual({ width: 960, height: 960 });
  });

  it("calls decoding slow only after enough frames", () => {
    expect(decodesTooSlowly(20, 20)).toBe(false);
    expect(decodesTooSlowly(60, 20)).toBe(true);
    expect(decodesTooSlowly(60, 6)).toBe(false);
  });
});

const miss = (id: string, path: string, size: number): MissingFile => ({ id, path, name: baseName(path), size });

describe("relink matching", () => {
  it("splits both kinds of path", () => {
    expect(baseName("C:\\Users\\Ana Lopez\\Clips\\a b.mov")).toBe("a b.mov");
    expect(dirName("C:\\Users\\Ana Lopez\\Clips\\a b.mov")).toBe("C:\\Users\\Ana Lopez\\Clips");
    expect(dirName("/Volumes/Cards/DCIM/a.mov")).toBe("/Volumes/Cards/DCIM");
    expect(startFolders("/Volumes/Cards/DCIM/a.mov")).toEqual(["/Volumes/Cards/DCIM", "/Volumes/Cards"]);
  });

  it("matches by name and size, ignoring case", () => {
    const m = matchFiles([miss("1", "/old/Clip.MOV", 100)], [{ path: "/new/clip.mov", size: 100 }]);
    expect(m).toEqual([{ id: "1", path: "/new/clip.mov" }]);
  });

  it("does not link a same named file of another size", () => {
    expect(matchFiles([miss("1", "/old/a.mov", 100)], [{ path: "/new/a.mov", size: 101 }])).toEqual([]);
  });

  it("prefers the candidate nearest the old folder", () => {
    const found = [{ path: "/Users/me/Backup/trip/a.mov", size: 5 }, { path: "/Users/me/Desktop/trip/a.mov", size: 5 }];
    const m = matchFiles([miss("1", "/Users/me/Desktop/Footage/a.mov", 5)], found);
    expect(m[0].path).toBe("/Users/me/Desktop/trip/a.mov");
    expect(sharedDepth("/a/b/c", "/a/b/d")).toBe(2);
  });

  it("relinks every file found in one folder at once and uses each file once", () => {
    const missing = [miss("1", "/old/a.mov", 1), miss("2", "/old/b.mov", 2), miss("3", "/old/c.mov", 3), miss("4", "/elsewhere/a.mov", 1)];
    const found = [{ path: "/new/a.mov", size: 1 }, { path: "/new/b.mov", size: 2 }];
    const m = matchFiles(missing, found);
    expect(m.map(x => x.id).sort()).toEqual(["1", "2"]);
  });
});
