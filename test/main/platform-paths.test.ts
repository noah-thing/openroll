import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { retryBusy } from "../../src/main/fs-retry";
import { Journal } from "../../src/main/journal";
import { launcherPath } from "../../src/main/launch-target";
import { mediaUrlFor, pathFromMediaUrl } from "../../src/shared/media-url";
import { isInside, pathKey, safeFileName, samePath } from "../../src/shared/paths";
import { unzipCommand } from "../../scripts/unzip-command.mjs";

const pathnameOf = (url: string) => new URL(url).pathname;

describe("media URLs round trip", () => {
  const roundTrip = (path: string, platform: string) => pathFromMediaUrl(pathnameOf(mediaUrlFor(path, platform)), platform);

  it("keeps a Windows drive path with spaces and Swedish letters", () => {
    const p = "C:\\Users\\Mina filmer\\Överkörning.mov";
    expect(roundTrip(p, "win32")).toBe("C:/Users/Mina filmer/Överkörning.mov");
  });

  it("keeps a network share, which needs both leading slashes", () => {
    expect(roundTrip("\\\\nas\\media\\clip #1.mp4", "win32")).toBe("//nas/media/clip #1.mp4");
  });

  it("keeps the long path prefix", () => {
    expect(roundTrip("\\\\?\\C:\\deep\\clip.mp4", "win32")).toBe("//?/C:/deep/clip.mp4");
  });

  it("restores a POSIX path", () => {
    expect(roundTrip("/home/mina/Videos/a b%20c.mp4", "linux")).toBe("/home/mina/Videos/a b%20c.mp4");
  });

  it("serves a network share only when it was allowed under the same spelling", () => {
    const served = roundTrip("\\\\nas\\media\\a.mp4", "win32");
    expect(pathKey(served, "win32")).toBe(pathKey("\\\\NAS\\Media\\a.mp4", "win32"));
  });
});

describe("path comparison", () => {
  it("ignores case, separators and a trailing slash on Windows only", () => {
    expect(samePath("C:\\Users\\Mina\\a.openroll", "c:/users/mina/A.openroll", "win32")).toBe(true);
    expect(samePath("/home/mina/A.openroll", "/home/mina/a.openroll", "linux")).toBe(false);
    expect(samePath("/Users/mina/Movies/", "/users/mina/movies", "darwin")).toBe(true);
  });

  it("does not take a sibling folder for a child", () => {
    expect(isInside("C:\\Videos\\OpenRoll\\a.openroll", "c:\\videos\\openroll", "win32")).toBe(true);
    expect(isInside("C:\\Videos\\OpenRollOld\\a.openroll", "C:\\Videos\\OpenRoll", "win32")).toBe(false);
    expect(isInside("/", "/", "linux")).toBe(true);
  });
});

describe("safeFileName", () => {
  it("replaces what Windows refuses and keeps ordinary names", () => {
    expect(safeFileName("Mina filmer/Överkörning", "x")).toBe("Mina filmer_Överkörning");
    expect(safeFileName('a<b>c:d"e|f?g*h', "x")).toBe("a_b_c_d_e_f_g_h");
    expect(safeFileName("tab\there", "x")).toBe("tab_here");
  });

  it("avoids device names, also with an extension", () => {
    expect(safeFileName("CON", "x")).toBe("_CON");
    expect(safeFileName("nul.mp4", "x")).toBe("_nul.mp4");
    expect(safeFileName("Com1", "x")).toBe("_Com1");
    expect(safeFileName("Console", "x")).toBe("Console");
  });

  it("drops trailing dots and spaces", () => {
    expect(safeFileName("My film. ", "x")).toBe("My film");
    expect(safeFileName("...", "fallback")).toBe("fallback");
  });

  it("cuts long names before the extension", () => {
    const out = safeFileName("a".repeat(300) + ".mp4", "x");
    expect(out.length).toBe(180);
    expect(out.endsWith(".mp4")).toBe(true);
  });
});

describe("retryBusy", () => {
  const busy = () => Object.assign(new Error("busy"), { code: "EBUSY" });
  const instant = async () => {};

  it("tries again on Windows while a scanner holds the file", async () => {
    let calls = 0;
    const result = await retryBusy(async () => {
      if (++calls < 3) throw busy();
      return "ok";
    }, "win32", instant);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after a while and passes the error on", async () => {
    let calls = 0;
    await expect(retryBusy(async () => { calls++; throw busy(); }, "win32", instant)).rejects.toThrow("busy");
    expect(calls).toBe(9);
  });

  it("does not retry elsewhere, or other errors", async () => {
    let calls = 0;
    await expect(retryBusy(async () => { calls++; throw busy(); }, "linux", instant)).rejects.toThrow();
    expect(calls).toBe(1);
    calls = 0;
    await expect(retryBusy(async () => { calls++; throw Object.assign(new Error("gone"), { code: "ENOENT" }); }, "win32", instant)).rejects.toThrow("gone");
    expect(calls).toBe(1);
  });
});

describe("launcherPath", () => {
  it("prefers the AppImage and the portable exe over their temporary execPath", () => {
    expect(launcherPath("/tmp/.mount_OpenRoXYZ/openroll", { APPIMAGE: "/home/mina/OpenRoll.AppImage" })).toBe("/home/mina/OpenRoll.AppImage");
    expect(launcherPath("C:\\Temp\\1234\\OpenRoll.exe", { PORTABLE_EXECUTABLE_FILE: "D:\\Apps\\OpenRoll-portable.exe" })).toBe("D:\\Apps\\OpenRoll-portable.exe");
    expect(launcherPath("/Applications/OpenRoll.app/Contents/MacOS/OpenRoll", {})).toBe("/Applications/OpenRoll.app/Contents/MacOS/OpenRoll");
  });
});

describe("unzipCommand", () => {
  it("uses the system bsdtar on Windows, never the tar found first on PATH", () => {
    const c = unzipCommand("win32", { SystemRoot: "C:\\Windows" }, "C:\\t\\a.zip", "C:\\t\\x");
    expect(c.command).toBe("C:\\Windows\\System32\\tar.exe");
    expect(c.args).toEqual(["-xf", "C:\\t\\a.zip", "-C", "C:\\t\\x"]);
    expect(unzipCommand("linux", {}, "a.zip", "x").command).toBe("unzip");
  });
});

describe("Journal on case insensitive systems", () => {
  it("finds a project's history when the path comes back with other casing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openroll-paths-"));
    try {
      const journal = new Journal(join(dir, "history"), "win32");
      const json = JSON.stringify({ format: "openroll", id: "p1", n: 1 });
      await journal.record(json, { path: "C:\\Users\\Mina\\Videos\\OpenRoll\\a.openroll", name: "a" });
      const list = await journal.list("c:/users/mina/videos/openroll/A.openroll");
      expect(list).toHaveLength(1);
      expect(await readFile(join(dir, "history", "p1", list[0].file), "utf8")).toBe(json);
      expect(await new Journal(join(dir, "history"), "linux").list("c:/users/mina/videos/openroll/A.openroll")).toHaveLength(0);
      await writeFile(join(dir, "unused"), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
