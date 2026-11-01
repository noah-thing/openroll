import { win32 } from "node:path";

/**
 * The command that unpacks a zip. On Windows it is the bsdtar in System32 by full path: a bare `tar`
 * finds the GNU tar that Git for Windows puts first on PATH, which cannot read zip and reads `C:\...` as a host name.
 */
export function unzipCommand(platform, env, archive, into) {
  if (platform === "win32") return { command: win32.join(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows", "System32", "tar.exe"), args: ["-xf", archive, "-C", into] };
  return { command: "unzip", args: ["-oq", archive, "-d", into] };
}
