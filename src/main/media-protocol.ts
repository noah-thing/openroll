// openroll-media://file/<encoded absolute path>
//
// Serves local media to the renderer with HTTP range support, so decoders can seek
// inside multi gigabyte files without reading them whole. Only paths the user has
// picked, dropped or opened through a project are served; everything else is a 403.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";

export const SCHEME = "openroll-media";

const allowed = new Set<string>();

export function allowPath(path: string): void {
  allowed.add(normal(path));
}

export function isAllowed(path: string): boolean {
  return allowed.has(normal(path));
}

function normal(path: string): string {
  if (process.platform === "win32") return path.replace(/\\/g, "/").toLowerCase();
  // APFS is case insensitive by default; Linux file systems are not.
  return process.platform === "darwin" ? path.toLowerCase() : path;
}

export const mediaScheme: Electron.CustomScheme = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
};

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
};

export function handleMediaProtocol(): void {
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const filePath = process.platform === "win32" ? path : "/" + path.replace(/^\/+/, "");
    if (!isAllowed(filePath)) return new Response("not allowed", { status: 403 });

    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return new Response("missing", { status: 404 });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Type": TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });

    const range = request.headers.get("range");
    if (!range) {
      headers.set("Content-Length", String(size));
      return new Response(toWeb(createReadStream(filePath)), { status: 200, headers });
    }

    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (Number.isNaN(start)) {
      // suffix range: the last N bytes
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(toWeb(createReadStream(filePath, { start, end })), { status: 206, headers });
  });
}

function toWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}
