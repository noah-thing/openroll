import { describe, expect, it } from "vitest";
import { agentPathProblem } from "../../src/shared/paths";

const mac = (path: string, access: "read" | "write") => agentPathProblem(path, "darwin", "/Users/sam", access);
const win = (path: string, access: "read" | "write") => agentPathProblem(path, "win32", "C:\\Users\\Sam", access);

describe("agentPathProblem", () => {
  it("allows ordinary media folders", () => {
    expect(mac("/Users/sam/Movies/cut.mp4", "write")).toBeNull();
    expect(mac("/Volumes/Drive/footage/a.mov", "read")).toBeNull();
    expect(mac("/tmp/out.mp4", "write")).toBeNull();
    expect(win("D:\\Edits\\cut.mp4", "write")).toBeNull();
    expect(win("C:\\Users\\Sam\\Videos\\cut.mp4", "write")).toBeNull();
  });

  it("refuses network shares on Windows, both ways", () => {
    expect(win("\\\\evil\\share\\a.mp4", "read")).toMatch(/Network/);
    expect(win("//evil/share/a.mp4", "write")).toMatch(/Network/);
  });

  it("refuses hidden home folders, also with dots in the way", () => {
    expect(mac("/Users/sam/.ssh/id.png", "read")).toMatch(/hidden/);
    expect(mac("/Users/sam/Movies/../.aws/x.png", "write")).toMatch(/hidden/);
  });

  it("refuses writing into bundles, system folders and Library", () => {
    expect(mac("/Applications/OpenRoll.app/Contents/Resources/icon.png", "write")).toBeTruthy();
    expect(mac("/Users/sam/Apps/Thing.app/x.png", "write")).toMatch(/bundle/);
    expect(mac("/System/Library/a.png", "write")).toMatch(/system/);
    expect(mac("/Users/sam/Library/Application Support/x.png", "write")).toMatch(/Library/);
    expect(win("C:\\Windows\\System32\\a.png", "write")).toMatch(/system/);
    expect(win("C:\\Users\\Sam\\AppData\\Roaming\\a.png", "write")).toMatch(/AppData/);
  });

  it("still reads from places it will not write", () => {
    expect(mac("/Library/Audio/Apple Loops/loop.wav", "read")).toBeNull();
    expect(win("C:\\Windows\\Media\\ding.wav", "read")).toBeNull();
  });
});
