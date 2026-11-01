// Pure parts of the updater: version order, picking the right download, reading the checksums file.
// Kept free of Electron so they can be tested.

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

export interface Release {
  version: string;
  tag: string;
  pageUrl: string;
  assets: ReleaseAsset[];
  /** Release notes as written on GitHub. */
  notes: string;
}

export type Packaging = "mac-zip" | "nsis" | "portable" | "appimage" | "deb";

export interface Runtime {
  platform: NodeJS.Platform | string;
  arch: string;
  /** Windows portable build (the launcher sets PORTABLE_EXECUTABLE_FILE). */
  portable?: boolean;
  /** Linux AppImage (the runtime sets APPIMAGE). */
  appImage?: boolean;
}

interface Parsed {
  core: [number, number, number];
  pre: (string | number)[];
}

export function parseVersion(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split(".").map(p => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** Semver order. A release outranks its own prereleases; numeric prerelease parts sort below text ones. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  if (!parseVersion(candidate) || !parseVersion(current)) return false;
  return compareVersions(candidate, current) > 0;
}

/** The shape GitHub returns for releases/latest, reduced to what the updater needs. */
export function parseRelease(raw: unknown): Release | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tag_name !== "string" || !parseVersion(r.tag_name) || r.draft === true || r.prerelease === true) return null;
  const assets: ReleaseAsset[] = [];
  for (const a of Array.isArray(r.assets) ? r.assets : []) {
    if (!a || typeof a.name !== "string" || typeof a.browser_download_url !== "string" || typeof a.size !== "number") continue;
    assets.push({ name: a.name, size: a.size, url: a.browser_download_url });
  }
  return {
    version: r.tag_name.replace(/^v/, ""),
    tag: r.tag_name,
    pageUrl: typeof r.html_url === "string" ? r.html_url : "",
    assets,
    notes: typeof r.body === "string" ? r.body.slice(0, 20_000) : "",
  };
}

const ARCH_NAMES: Record<string, string[]> = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
};

function hasArch(name: string, arch: string): boolean {
  return (ARCH_NAMES[arch] ?? [arch]).some(a => new RegExp(`(^|[^a-z0-9])${a}([^a-z0-9]|$)`).test(name));
}

export function packagingFor(rt: Runtime): Packaging | null {
  if (rt.platform === "darwin") return "mac-zip";
  if (rt.platform === "win32") return rt.portable ? "portable" : "nsis";
  if (rt.platform === "linux") return rt.appImage ? "appimage" : "deb";
  return null;
}

export function pickAsset(assets: ReleaseAsset[], rt: Runtime): { asset: ReleaseAsset; packaging: Packaging } | null {
  const packaging = packagingFor(rt);
  if (!packaging) return null;
  const match = (a: ReleaseAsset): boolean => {
    const n = a.name.toLowerCase();
    if (!hasArch(n, rt.arch)) return false;
    switch (packaging) {
      case "mac-zip": return n.endsWith(".zip") && /(mac|darwin|osx)/.test(n);
      case "nsis": return n.endsWith(".exe") && n.includes("setup") && !n.includes("portable");
      case "portable": return n.endsWith(".exe") && n.includes("portable");
      case "appimage": return n.endsWith(".appimage");
      case "deb": return n.endsWith(".deb");
    }
  };
  const asset = assets.find(match);
  return asset ? { asset, packaging } : null;
}

export function checksumsAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  return assets.find(a => /^(sha256sums|checksums)(\.txt)?$/i.test(a.name));
}

/** Lines of "<64 hex digits>  <file name>", as written by sha256sum and shasum. */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}
