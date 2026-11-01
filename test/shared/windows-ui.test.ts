import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { titled } from "../../src/renderer/state/commands";
import { dirName, matchFiles, startFolders, wantedNames, type MissingFile } from "../../src/shared/relink";

describe("shortcut tooltips", () => {
  it("name the keys of the platform", () => {
    expect(titled("Duplicate", "duplicate", true)).toBe("Duplicate (⌘D)");
    expect(titled("Duplicate", "duplicate", false)).toBe("Duplicate (Ctrl+D)");
    expect(titled("Keep the playhead in view", "follow", false)).toBe("Keep the playhead in view (Alt+F)");
    expect(titled("Delete", "delete", false)).toBe("Delete (Backspace)");
  });

  it("leaves the text alone for an unknown command", () => {
    expect(titled("Something", "nope", false)).toBe("Something");
  });
});

describe("window controls", () => {
  it("leave room on the home bar as well as the editor bar", () => {
    const css = readFileSync("src/renderer/styles/app.css", "utf8");
    expect(css).toMatch(/\[data-platform="win32"\] \.home-bar[^{]*\{ padding-right: 150px/);
    expect(css).toMatch(/\[data-platform="win32"\] \.top[^{]*\{ padding-right: 150px/);
  });
});

describe("relink on Windows paths", () => {
  it("keeps the backslash of a drive root", () => {
    expect(dirName("C:\\clip.mov")).toBe("C:\\");
    expect(dirName("C:\\a\\clip.mov")).toBe("C:\\a");
    expect(startFolders("C:\\a\\clip.mov")).toEqual(["C:\\a", "C:\\"]);
    expect(startFolders("C:\\clip.mov")).toEqual(["C:\\"]);
    expect(dirName("/clip.mov")).toBe("/");
    expect(dirName("\\\\nas\\share\\clip.mov")).toBe("\\\\nas\\share");
  });

  it("matches a name written with combining marks to the same name in one piece", () => {
    const decomposed = "O\u0308verko\u0308rning.mov";
    const composed = "\u00d6verk\u00f6rning.mov";
    const missing: MissingFile[] = [{ id: "m1", path: `/Volumes/Old/${decomposed}`, name: decomposed, size: 10 }];
    expect(wantedNames(missing).has(composed.toLowerCase())).toBe(true);
    expect(matchFiles(missing, [{ path: `D:\\Mina filmer\\${composed}`, size: 10 }])).toEqual([{ id: "m1", path: `D:\\Mina filmer\\${composed}` }]);
  });
});
