import { describe, expect, it } from "vitest";
import { checksumsAsset, compareVersions, isNewer, parseChecksums, parseRelease, pickAsset, type ReleaseAsset } from "../../src/shared/update-logic";

const asset = (name: string): ReleaseAsset => ({ name, size: 10, url: `https://example.test/${name}` });

const assets = [
  "OpenRoll-0.2.0-mac-arm64.dmg",
  "OpenRoll-0.2.0-mac-arm64.zip",
  "OpenRoll-0.2.0-mac-x64.dmg",
  "OpenRoll-0.2.0-mac-x64.zip",
  "OpenRoll-Setup-0.2.0-win-x64.exe",
  "OpenRoll-Setup-0.2.0-win-arm64.exe",
  "OpenRoll-0.2.0-win-x64-portable.exe",
  "OpenRoll-0.2.0-linux-x86_64.AppImage",
  "OpenRoll-0.2.0-linux-amd64.deb",
  "SHA256SUMS.txt",
].map(asset);

describe("compareVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
  });
  it("ignores a leading v and build metadata", () => {
    expect(compareVersions("v1.2.3", "1.2.3+abc")).toBe(0);
  });
  it("ranks a release above its prereleases", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.2")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBe(-1);
  });
  it("throws on junk", () => {
    expect(() => compareVersions("latest", "1.0.0")).toThrow();
  });
});

describe("isNewer", () => {
  it("is false for anything it cannot read", () => {
    expect(isNewer("nightly", "1.0.0")).toBe(false);
    expect(isNewer("1.0.1", "dev")).toBe(false);
  });
  it("is true only for a higher version", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0-rc.1", "0.1.0")).toBe(false);
  });
});

describe("pickAsset", () => {
  const pick = (platform: string, arch: string, extra = {}) => pickAsset(assets, { platform, arch, ...extra })?.asset.name ?? null;
  it("takes the zip for the right Mac architecture, not the dmg", () => {
    expect(pick("darwin", "arm64")).toBe("OpenRoll-0.2.0-mac-arm64.zip");
    expect(pick("darwin", "x64")).toBe("OpenRoll-0.2.0-mac-x64.zip");
  });
  it("separates the installer from the portable build on Windows", () => {
    expect(pick("win32", "x64")).toBe("OpenRoll-Setup-0.2.0-win-x64.exe");
    expect(pick("win32", "x64", { portable: true })).toBe("OpenRoll-0.2.0-win-x64-portable.exe");
    expect(pick("win32", "arm64")).toBe("OpenRoll-Setup-0.2.0-win-arm64.exe");
  });
  it("knows x86_64 and amd64 are x64 on Linux", () => {
    expect(pick("linux", "x64", { appImage: true })).toBe("OpenRoll-0.2.0-linux-x86_64.AppImage");
    expect(pick("linux", "x64")).toBe("OpenRoll-0.2.0-linux-amd64.deb");
  });
  it("returns null when there is no build for this machine", () => {
    expect(pick("linux", "arm64", { appImage: true })).toBeNull();
    expect(pick("freebsd", "x64")).toBeNull();
    expect(pickAsset([], { platform: "darwin", arch: "arm64" })).toBeNull();
  });
});

describe("checksums", () => {
  const hex = "a".repeat(64);
  it("finds the checksums file", () => {
    expect(checksumsAsset(assets)?.name).toBe("SHA256SUMS.txt");
    expect(checksumsAsset([asset("notes.txt")])).toBeUndefined();
  });
  it("reads sha256sum output, binary marks and CRLF", () => {
    const m = parseChecksums(`${hex}  OpenRoll-0.2.0-mac-arm64.zip\r\n${hex.toUpperCase()} *My File.exe\nnot a line\n`);
    expect(m.get("OpenRoll-0.2.0-mac-arm64.zip")).toBe(hex);
    expect(m.get("My File.exe")).toBe(hex);
    expect(m.size).toBe(2);
  });
});

describe("parseRelease", () => {
  const raw = { tag_name: "v0.2.0", html_url: "https://example.test/r", draft: false, prerelease: false, assets: [{ name: "a.zip", size: 3, browser_download_url: "https://example.test/a.zip" }, { name: 5 }] };
  it("reads a GitHub release and drops malformed assets", () => {
    const r = parseRelease(raw)!;
    expect(r.version).toBe("0.2.0");
    expect(r.assets).toHaveLength(1);
  });
  it("drops assets with a path in the name or a plain http address", () => {
    const asset = (name: string, url: string) => ({ name, size: 1, browser_download_url: url });
    const r = parseRelease({ ...raw, assets: [asset("../x.zip", "https://example.test/x"), asset("b.zip", "http://example.test/b"), asset("c.zip", "http://127.0.0.1:9/c"), asset("d.zip", "https://example.test/d")] })!;
    expect(r.assets.map(a => a.name)).toEqual(["c.zip", "d.zip"]);
  });
  it("ignores drafts, prereleases and non version tags", () => {
    expect(parseRelease({ ...raw, draft: true })).toBeNull();
    expect(parseRelease({ ...raw, prerelease: true })).toBeNull();
    expect(parseRelease({ ...raw, tag_name: "nightly" })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ message: "Not Found" })).toBeNull();
  });
});
