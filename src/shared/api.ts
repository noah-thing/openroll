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
  };

  onMenu(handler: (command: string) => void): () => void;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  /** Present only when the app runs under the QA harness. */
  qa?: { allow(paths: string[]): Promise<FileInfo[]> };
}
