import type { Settings } from "./settings";

// The surface the preload script exposes as window.openroll. Keep it small: every
// function here is something a compromised page could call, so each one does one
// narrow thing and the main process checks its arguments.

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface RecentProject {
  path: string;
  name: string;
  modified: number;
  thumb?: string;
}

export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "manual" | "current" | "unreachable";

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  /** 0 to 1 while downloading. */
  progress?: number;
  /** Release page, for builds that cannot update themselves (deb, a read only install). */
  pageUrl?: string;
  /** True when a person asked, so the answer deserves a visible reply. */
  asked?: boolean;
}

export interface HistoryEntry {
  file: string;
  time: number;
  bytes: number;
}

/** What main remembers about the last run when the window comes up. */
export interface SessionNotice {
  reason: "crash" | "unclean";
  path: string;
  name: string;
}

export interface SystemInfo {
  app: string;
  electron: string;
  chrome: string;
  os: string;
  arch: string;
  gpu: string[];
}

export interface CacheInfo {
  dir: string;
  bytes: number;
}

export interface OpenRollApi {
  platform: NodeJS.Platform;
  versions: { app: string; electron: string; chrome: string };

  /** Native open dialog for media. Paths come back already allowed for reading. */
  pickMedia(): Promise<FileInfo[]>;
  /** Paths for files dropped onto the window. */
  pathsForDropped(files: File[]): Promise<FileInfo[]>;
  /** URL the renderer can fetch (with Range) to read an allowed file. */
  mediaUrl(path: string): string;
  stat(path: string): Promise<FileInfo | null>;

  /** Writes go through a handle so exports can stream large files without holding them in memory. */
  createWriter(suggestedName: string, kind: "video" | "audio" | "subtitles" | "image"): Promise<{ id: number; path: string } | null>;
  write(id: number, position: number, data: Uint8Array): Promise<void>;
  closeWriter(id: number, abort?: boolean): Promise<void>;
  revealInFolder(path: string): Promise<void>;

  projects: {
    dir(): Promise<string>;
    list(): Promise<RecentProject[]>;
    load(path: string): Promise<string | null>;
    /** Atomic save: write a temp file, keep the previous copy as a backup, rename. */
    save(path: string | null, name: string, json: string): Promise<SaveResult>;
    saveThumb(path: string, jpeg: Uint8Array): Promise<void>;
    remove(path: string): Promise<void>;
  };

  cache: {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, data: Uint8Array): Promise<void>;
    /** A cached file as importable media, or null if it does not exist. */
    file(key: string): Promise<FileInfo | null>;
  };

  /** Saves a finished recording next to the projects and returns it as importable media. */
  saveRecording(name: string, ext: "wav", data: Uint8Array): Promise<FileInfo | null>;

  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    /** Folder picker; null when cancelled. */
    pickProjectsDir(): Promise<string | null>;
    onChange(handler: (s: Settings) => void): () => void;
  };
  cacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<void>;

  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<void>;
    /** Quit now, apply the downloaded update and open the new version. */
    installNow(): Promise<void>;
    onState(handler: (s: UpdateState) => void): () => void;
  };

  history: {
    list(projectPath: string): Promise<HistoryEntry[]>;
    /** Puts an earlier version back. The current file is kept as a version first, so this can be undone. */
    restore(projectPath: string, file: string): Promise<boolean>;
  };
  session: {
    /** The crash or unclean exit main wants the page to deal with, once. */
    take(): Promise<SessionNotice | null>;
    projectClosed(): void;
  };

  systemInfo(): Promise<SystemInfo>;

  onMenu(handler: (command: string) => void): () => void;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  /** Present only when the app runs under the QA harness. */
  qa?: { allow(paths: string[]): Promise<FileInfo[]> };
}
