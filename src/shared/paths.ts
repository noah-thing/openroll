// Path rules that differ by platform, kept free of Node and Electron so they can be tested for each.

/** What two spellings of one file share: separators and, where the file system ignores case, case. */
export function pathKey(path: string, platform: string): string {
  const slashed = platform === "win32" ? path.replace(/\\/g, "/") : path;
  const key = collapse(slashed).replace(/(?<=.)\/+$/, "");
  // NTFS and APFS (by default) ignore case; Linux file systems do not.
  return platform === "win32" || platform === "darwin" ? key.toLowerCase() : key;
}

/** Resolve "." and ".." so "/a/b/../c" and "/a/c" compare equal, and ".." cannot climb out of a folder unseen. */
function collapse(path: string): string {
  const lead = /^(\/\/|[A-Za-z]:\/|\/)/.exec(path)?.[0] ?? "";
  const parts: string[] = [];
  for (const part of path.slice(lead.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return lead + parts.join("/");
}

export function samePath(a: string, b: string, platform: string): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

/** True when `path` is `dir` itself or lies below it. A sibling that merely starts with the same letters is not inside. */
export function isInside(path: string, dir: string, platform: string): boolean {
  const p = pathKey(path, platform), d = pathKey(dir, platform);
  return p === d || p.startsWith(d.endsWith("/") ? d : d + "/");
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * A name that is safe to create on every platform, since projects and exports travel between them.
 * Windows refuses control characters, a few punctuation marks, the device names (also with an
 * extension, so CON.mp4 fails too) and names ending in a dot or space.
 */
export function safeFileName(name: string, fallback: string): string {
  let out = name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").trim().replace(/[. ]+$/, "");
  if (RESERVED.test(out.split(".")[0].trim())) out = "_" + out;
  // Long names are cut before the extension so the file type survives.
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(out)?.[0] ?? "";
  return (out.length > 180 ? out.slice(0, 180 - ext.length) + ext : out) || fallback;
}

const SYSTEM_DIRS: Record<string, string[]> = {
  win32: ["windows", "program files", "program files (x86)", "programdata"],
  darwin: ["system", "usr", "bin", "sbin", "etc", "library", "applications"],
  linux: ["usr", "bin", "sbin", "etc", "lib", "lib64", "boot", "dev", "proc", "sys"],
};

/**
 * Why an AI tool may not use this path, or null when it may. Tools name files themselves, so:
 * no network shares (opening one sends the person's Windows credentials to that server), no
 * hidden folders in the home directory (.ssh, .aws, .config), and for writing also no app
 * bundles, system folders or the per user Library and AppData folders.
 */
export function agentPathProblem(path: string, platform: string, home: string, access: "read" | "write"): string | null {
  if (path.includes("\0")) return "The path is not valid.";
  if (platform === "win32" && /^[\\/]{2}/.test(path)) return "Network paths are not allowed for AI tools. Copy the file to a local folder first.";
  const key = pathKey(path, platform);
  const parts = key.split("/").filter(Boolean);
  if (isInside(path, home, platform)) {
    const below = key.slice(pathKey(home, platform).length).split("/").filter(Boolean);
    if (below[0]?.startsWith(".")) return "AI tools cannot use hidden folders in the home directory.";
    if (access === "write" && (below[0] === "library" || below[0] === "appdata")) return "AI tools cannot write into the Library or AppData folder.";
  }
  if (access === "write") {
    if (parts.some(part => part.endsWith(".app"))) return "AI tools cannot write inside an application bundle.";
    const top = platform === "win32" ? parts[1] : parts[0];
    if (top && SYSTEM_DIRS[platform]?.includes(top)) return "AI tools cannot write into system folders.";
  }
  return null;
}
