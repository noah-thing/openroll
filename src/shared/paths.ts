// Path rules that differ by platform, kept free of Node and Electron so they can be tested for each.

/** What two spellings of one file share: separators and, where the file system ignores case, case. */
export function pathKey(path: string, platform: string): string {
  if (platform === "win32") return path.replace(/\\/g, "/").replace(/(?<=.)\/+$/, "").toLowerCase();
  const trimmed = path.replace(/(?<=.)\/+$/, "");
  // APFS is case insensitive by default; Linux file systems are not.
  return platform === "darwin" ? trimmed.toLowerCase() : trimmed;
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
