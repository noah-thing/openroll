export const MEDIA_SCHEME = "openroll-media";

/** Turn an absolute path into a URL served by the media protocol in the main process. */
export function mediaUrlFor(path: string, platform: string): string {
  const p = platform === "win32" ? path.replace(/\\/g, "/") : path.replace(/^\/+/, "");
  return `${MEDIA_SCHEME}://file/${p.split("/").map(encodeURIComponent).join("/")}`;
}
