export const MEDIA_SCHEME = "openroll-media";

/** Turn an absolute path into a URL served by the media protocol in the main process. */
export function mediaUrlFor(path: string, platform: string): string {
  const p = platform === "win32" ? path.replace(/\\/g, "/") : path.replace(/^\/+/, "");
  return `${MEDIA_SCHEME}://file/${p.split("/").map(encodeURIComponent).join("/")}`;
}

/** The inverse of mediaUrlFor, from the URL's pathname. */
export function pathFromMediaUrl(pathname: string, platform: string): string {
  const path = decodeURIComponent(pathname.replace(/^\//, ""));
  // A network share (//server/share) or \\?\ prefix keeps its two slashes: mediaUrlFor wrote them after the one it stripped here.
  if (platform === "win32") return path;
  return "/" + path.replace(/^\/+/, "");
}
