import { useSyncExternalStore } from "react";
import type { MediaRef } from "../../core/project";
import type { ProxyMode } from "../../engine/proxy-policy";
import type { DerivedState } from "../../shared/derived";

interface Entry {
  prepare?: DerivedState;
  proxy?: DerivedState;
}

export type MediaBadge = "missing" | "preparing" | "failed" | "proxy" | "proxy-building";

/**
 * What the page knows about converted copies and missing files, by source path. The project
 * never points at these: it keeps the original file, and this decides which file to read.
 */
class DerivedStore {
  private entries = new Map<string, Entry>();
  private missing = new Set<string>();
  private listeners = new Set<() => void>();
  private started = false;
  proxyMode: ProxyMode = "auto";
  version = 0;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.openroll.convert.onState((path, state) => this.set(path, state));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  set(path: string, state: DerivedState): void {
    const e = this.entries.get(path) ?? {};
    if (state.status === "cancelled") delete e[state.kind];
    else e[state.kind] = state;
    this.entries.set(path, e);
    this.bump();
  }

  /** The cache folder was emptied: forget copies that no longer exist so the next look rebuilds them. */
  reset(): void {
    this.entries.clear();
    this.bump();
  }

  setMissing(paths: string[]): void {
    this.missing = new Set(paths);
    this.bump();
  }

  isMissing(m: MediaRef): boolean {
    return this.missing.has(m.path);
  }

  missingPaths(): ReadonlySet<string> {
    return this.missing;
  }

  setProxyMode(mode: ProxyMode): void {
    if (mode === this.proxyMode) return;
    this.proxyMode = mode;
    this.bump();
  }

  state(m: MediaRef): Entry {
    return this.entries.get(m.path) ?? {};
  }

  /** The converted copy that stands in for the original, once it exists. Null while it is still being made. */
  private preparedFile(m: MediaRef): string | null {
    const s = this.entries.get(m.path)?.prepare;
    return s?.status === "ready" && s.file ? s.file : null;
  }

  /** For anything that reads the whole picture or sound: filmstrips, analysis, export. Never a proxy. */
  decodeUrl(m: MediaRef): string {
    if (!m.prepared) return window.openroll.mediaUrl(m.path);
    const f = this.preparedFile(m);
    return f ? window.openroll.mediaUrl(f) : "";
  }

  /** For the live preview: the proxy when one is ready and allowed. */
  previewUrl(m: MediaRef): string {
    if (m.prepared) return this.decodeUrl(m);
    const p = this.entries.get(m.path)?.proxy;
    if (this.proxyMode !== "off" && p?.status === "ready" && p.file) return window.openroll.mediaUrl(p.file);
    return window.openroll.mediaUrl(m.path);
  }

  badge(m: MediaRef): MediaBadge | null {
    if (this.missing.has(m.path)) return "missing";
    const e = this.entries.get(m.path);
    if (m.prepared) {
      if (e?.prepare?.status === "failed") return "failed";
      if (e?.prepare?.status !== "ready") return "preparing";
    }
    if (this.proxyMode !== "off" && e?.proxy) {
      if (e.proxy.status === "ready") return "proxy";
      if (e.proxy.status === "queued" || e.proxy.status === "running") return "proxy-building";
    }
    return null;
  }

  /** Percent done for whichever conversion is running, or null. */
  progress(m: MediaRef): number | null {
    const e = this.entries.get(m.path);
    const s = m.prepared ? e?.prepare : e?.proxy;
    return s && (s.status === "running" || s.status === "queued") ? s.progress : null;
  }

  error(m: MediaRef): string | null {
    return this.entries.get(m.path)?.prepare?.error ?? null;
  }

  /** Looks up copies made in earlier sessions and starts any that a reopened project still needs. */
  async restore(media: MediaRef[]): Promise<void> {
    this.start();
    const paths = media.filter(m => m.kind !== "image").map(m => m.path);
    if (!paths.length) return;
    const found = await window.openroll.convert.existing(paths);
    for (const [path, states] of Object.entries(found)) for (const s of states) this.set(path, s);
    for (const m of media) {
      if (m.prepared && !this.preparedFile(m) && !this.entries.get(m.path)?.prepare) void window.openroll.convert.prepare(m.path);
      else if (!m.prepared) void this.maybeProxy(m);
    }
  }

  /** Asks for a proxy; the main process applies the policy and only builds one when it helps. */
  async maybeProxy(m: MediaRef, slow = false): Promise<void> {
    if (this.proxyMode === "off" || m.kind !== "video" || m.prepared) return;
    if (this.entries.get(m.path)?.proxy && !slow) return;
    const s = await window.openroll.convert.proxy(m.path, { mode: this.proxyMode, slow });
    if (s) this.set(m.path, s);
  }
}

export const derived = new DerivedStore();

/** Re-renders when conversions or missing files change. */
export function useDerivedVersion(): number {
  return useSyncExternalStore(derived.subscribe, () => derived.version);
}

export const BADGE_TEXT: Record<MediaBadge, string> = {
  missing: "Missing",
  preparing: "Preparing",
  failed: "Cannot open",
  proxy: "Proxy",
  "proxy-building": "Making proxy",
};
