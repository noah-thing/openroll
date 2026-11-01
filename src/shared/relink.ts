// Matching missing media against files found on disk. Pure, so it behaves the same for
// Windows and POSIX paths and is easy to test.

export interface MissingFile {
  id: string;
  path: string;
  name: string;
  size: number;
}

export interface FoundFile {
  path: string;
  size: number;
}

export interface RelinkMatch {
  id: string;
  path: string;
}

const SEP = /[\\/]/;

export function baseName(path: string): string {
  const parts = path.split(SEP);
  return parts[parts.length - 1] ?? path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i);
}

function segments(path: string): string[] {
  return path.split(SEP).filter(Boolean).map(s => s.toLowerCase());
}

/** How many leading folders two paths share. The closer a candidate is to the old home, the likelier it is the same file. */
export function sharedDepth(a: string, b: string): number {
  const x = segments(a), y = segments(b);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

/** Names worth looking for, in lower case, so a scan only keeps files that could match. */
export function wantedNames(missing: MissingFile[]): Set<string> {
  return new Set(missing.map(m => m.name.toLowerCase()));
}

/**
 * Pairs each missing file with a found file of the same name and size. When several
 * qualify, the one nearest the old location wins. Files of the same name but another size are
 * not matched: that is usually a different take, and linking it would silently change the edit.
 */
export function matchFiles(missing: MissingFile[], found: FoundFile[]): RelinkMatch[] {
  const byName = new Map<string, FoundFile[]>();
  for (const f of found) {
    const key = baseName(f.path).toLowerCase();
    const list = byName.get(key);
    if (list) list.push(f);
    else byName.set(key, [f]);
  }
  const taken = new Set<string>();
  const out: RelinkMatch[] = [];
  for (const m of missing) {
    const candidates = (byName.get(m.name.toLowerCase()) ?? []).filter(f => f.size === m.size && !taken.has(f.path));
    if (!candidates.length) continue;
    candidates.sort((a, b) => sharedDepth(b.path, m.path) - sharedDepth(a.path, m.path));
    out.push({ id: m.id, path: candidates[0].path });
    taken.add(candidates[0].path);
  }
  return out;
}

/** Folders to look in first: where the file was, its parent, and (listed by the caller) the parent's other folders. */
export function startFolders(path: string): string[] {
  const dir = dirName(path);
  const parent = dirName(dir);
  return [dir, ...(parent && parent !== dir ? [parent] : [])];
}
