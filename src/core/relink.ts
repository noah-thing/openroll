import type { Project } from "./project";

export interface Relinked {
  id: string;
  path: string;
  name: string;
  size: number;
  mtime: number;
}

/** Points media at new files. Ids stay, so every clip keeps its place on the timeline. */
export function relinkMedia(p: Project, updates: Relinked[]): Project {
  let media = p.media;
  for (const u of updates) {
    const m = media[u.id];
    if (!m || m.path === u.path) continue;
    if (media === p.media) media = { ...media };
    media[u.id] = { ...m, path: u.path, name: u.name, size: u.size, mtime: u.mtime };
  }
  return media === p.media ? p : { ...p, media };
}
