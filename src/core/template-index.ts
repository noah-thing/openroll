// The community index: templates/index.json in the repository. It is fetched from the
// internet, so each entry is checked and anything odd is left out.

export const INDEX_FORMAT = "openroll-template-index";
export const MAX_INDEX_ENTRIES = 200;
const FILE = /^[a-z0-9][a-z0-9-]{0,63}\.openrolltemplate$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface IndexEntry {
  id: string;
  name: string;
  /** File name inside the templates folder. */
  file: string;
  kind: "timeline" | "captions";
  description?: string;
  author?: string;
  tags: string[];
}

const short = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function parseIndex(raw: unknown): IndexEntry[] {
  if (!raw || typeof raw !== "object" || (raw as { format?: unknown }).format !== INDEX_FORMAT) return [];
  const list = (raw as { templates?: unknown }).templates;
  if (!Array.isArray(list)) return [];
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const e of list.slice(0, MAX_INDEX_ENTRIES)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const name = short(r.name, 60);
    if (typeof r.id !== "string" || !ID.test(r.id) || seen.has(r.id) || !name) continue;
    if (typeof r.file !== "string" || !FILE.test(r.file)) continue;
    if (r.kind !== "timeline" && r.kind !== "captions") continue;
    seen.add(r.id);
    const tags = Array.isArray(r.tags) ? r.tags.map(t => short(t, 24)?.toLowerCase()).filter((t): t is string => !!t).slice(0, 8) : [];
    out.push({ id: r.id, name, file: r.file, kind: r.kind, description: short(r.description, 300), author: short(r.author, 60), tags });
  }
  return out;
}
