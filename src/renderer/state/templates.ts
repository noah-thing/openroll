import { useSyncExternalStore } from "react";
import { parseTemplate, summarizeTemplate, type Template, type TemplateSummary } from "../../core/template";
import { applyCaptionStyle, applyTemplate, chooseFills, type ApplyResult } from "../../core/template-apply";
import { captureTemplate } from "../../core/template-capture";
import { allCaptions } from "../../core/captions";
import type { CommunityState, TemplateImport } from "../../shared/templates";
import type { Editor } from "./editor";

export type TemplateSource = "starter" | "mine" | "community";

export interface Listed {
  template: Template;
  source: TemplateSource;
}

interface Snapshot {
  starters: Template[];
  mine: Template[];
  community: CommunityState;
  /** True while the list is being read from the repository. */
  reading: boolean;
}

const files = import.meta.glob("../../../templates/*.openrolltemplate", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const indexFile = import.meta.glob("../../../templates/index.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The starters ship inside the app, in the order the index lists them. */
function readStarters(): Template[] {
  const found = new Map<string, Template>();
  for (const text of Object.values(files)) {
    const r = parseTemplate(text);
    if (r.ok) found.set(r.template.id, r.template);
  }
  let order: string[] = [];
  try {
    const index = JSON.parse(Object.values(indexFile)[0] ?? "{}") as { templates?: { id?: string }[] };
    order = (index.templates ?? []).flatMap(e => (typeof e.id === "string" ? [e.id] : []));
  } catch {
    /* the list falls back to file order */
  }
  const first = order.flatMap(id => (found.has(id) ? [found.get(id)!] : []));
  return [...first, ...[...found.values()].filter(t => !order.includes(t.id))];
}

class TemplateStore {
  private snap: Snapshot = { starters: readStarters(), mine: [], community: { templates: [], updated: null }, reading: false };
  private subs = new Set<() => void>();
  private started = false;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.subs) fn();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const [mine, community] = await Promise.all([window.openroll.templates.list(), window.openroll.templates.community()]);
    this.set({ mine, community });
  }

  async refreshCommunity(): Promise<void> {
    if (this.snap.reading) return;
    this.set({ reading: true });
    try {
      this.set({ community: await window.openroll.templates.refreshCommunity() });
    } finally {
      this.set({ reading: false });
    }
  }

  /** Everything a person can apply. Their own come first, so a name they chose wins over a starter's. */
  all(): Listed[] {
    const { mine, starters } = this.snap;
    return [...mine.map(template => ({ template, source: "mine" as const })), ...starters.map(template => ({ template, source: "starter" as const })), ...this.communityOnly().map(template => ({ template, source: "community" as const }))];
  }

  /** Community entries the person does not already have under the same id. */
  communityOnly(): Template[] {
    const have = new Set([...this.snap.starters, ...this.snap.mine].map(t => t.id));
    return this.snap.community.templates.filter(t => !have.has(t.id));
  }

  find(key: string): Listed | null {
    const all = this.all();
    const lower = key.trim().toLowerCase();
    return all.find(l => l.template.id === key) ?? all.find(l => l.template.name.toLowerCase() === lower) ?? null;
  }

  add(mine: Template[]): void {
    const ids = new Set(mine.map(t => t.id));
    this.set({ mine: [...this.snap.mine.filter(t => !ids.has(t.id)), ...mine].sort((a, b) => a.name.localeCompare(b.name)) });
  }

  remove(id: string): void {
    this.set({ mine: this.snap.mine.filter(t => t.id !== id) });
  }
}

export const templateStore = new TemplateStore();

export function useTemplates(): Snapshot {
  return useSyncExternalStore(templateStore.subscribe, templateStore.getSnapshot);
}

export function templateSummaries(): (TemplateSummary & { source: TemplateSource })[] {
  return templateStore.all().map(l => ({ ...summarizeTemplate(l.template), source: l.source }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What applying would use right now, for the panel to say before the person clicks. */
export function describeFill(editor: Editor, t: Template): string {
  if (t.kind === "captions") {
    const picked = editor.selection.filter(id => allCaptions(editor.project).some(c => c.id === id));
    const n = picked.length || allCaptions(editor.project).length;
    return n ? `Restyles ${picked.length ? plural(n, "selected caption") : plural(n, "caption")}` : "Needs captions on the timeline";
  }
  if (!t.slots.length) return "Adds titles and graphics at the playhead";
  const plan = chooseFills(editor.project, t, editor.selection);
  const used = plan.fills.size;
  if (!used) return `${plural(t.slots.length, "empty slot")}, marked in the viewer`;
  const from = plan.consume.length ? "selected" : "from your library";
  return used < t.slots.length ? `Uses ${plural(used, "clip")} ${from}, ${t.slots.length - used} left empty` : `Uses ${plural(used, "clip")} ${from}`;
}

export function applyToEditor(editor: Editor, t: Template): void {
  if (t.kind === "captions") {
    const only = editor.selection.filter(id => allCaptions(editor.project).some(c => c.id === id));
    const count = only.length || allCaptions(editor.project).length;
    if (!count) {
      editor.toast("There are no captions yet. Make some in the Captions panel, then pick a style.");
      return;
    }
    editor.apply(`Caption style ${t.name}`, p => applyCaptionStyle(p, t, only.length ? only : undefined));
    editor.toast(`${t.name} applied to ${plural(count, "caption")}`);
    return;
  }

  const plan = chooseFills(editor.project, t, editor.selection);
  const out: { done?: ApplyResult } = {};
  editor.apply(`Add ${t.name}`, p => {
    out.done = applyTemplate(p, t, { at: plan.at ?? editor.time, fills: plan.fills, consume: plan.consume });
    return out.done.project;
  });
  const done = out.done;
  if (!done) return;
  editor.select(done.ids);
  editor.seek(done.start);
  if (!done.empty.length) editor.toast(done.filled ? `Added ${t.name} with ${plural(done.filled, "clip")}` : `Added ${t.name}`);
  else {
    const names = done.empty.length > 2 ? plural(done.empty.length, "slot") : done.empty.join(" and ");
    editor.toast(`Added ${t.name}. ${names} ${done.empty.length === 1 ? "is" : "are"} empty and shows as a dark box. Import footage, undo, and apply it again to fill ${done.empty.length === 1 ? "it" : "them"}.`);
  }
}

/** Save the selection, or the whole timeline when nothing is selected, under a name. */
export async function saveAsTemplate(editor: Editor, name: string, scope: "selection" | "timeline"): Promise<boolean> {
  const made = captureTemplate(editor.project, scope === "selection" ? editor.selection : null, name);
  if (!made.ok) {
    editor.toast(made.error, { tone: "error" });
    return false;
  }
  const saved = await window.openroll.templates.save(made.template);
  if (!saved.ok) {
    editor.toast(saved.error, { tone: "error" });
    return false;
  }
  templateStore.add([saved.template]);
  editor.toast(`Saved ${saved.template.name} to your templates`);
  return true;
}

export function reportImport(editor: Editor, r: TemplateImport): void {
  if (r.added.length) {
    templateStore.add(r.added);
    editor.toast(r.added.length === 1 ? `Added ${r.added[0].name} to your templates` : `Added ${plural(r.added.length, "template")} to your templates`);
  } else if (r.duplicates && !r.problems.length) editor.toast("Already in your templates");
  if (r.problems.length) editor.toast(r.problems.length === 1 ? r.problems[0] : `${plural(r.problems.length, "file")} could not be used. ${r.problems[0]}`, { tone: "error" });
}

/** A template file dropped anywhere on the editor is imported, wherever the drop lands. */
export function startTemplateDrops(editor: Editor): () => void {
  const drop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length || !files.every(f => f.name.toLowerCase().endsWith(".openrolltemplate"))) return;
    e.preventDefault();
    e.stopPropagation();
    void window.openroll.templates.importDropped(files).then(r => reportImport(editor, r));
  };
  document.addEventListener("drop", drop, true);
  return () => document.removeEventListener("drop", drop, true);
}

export async function importFromDialog(editor: Editor): Promise<void> {
  reportImport(editor, await window.openroll.templates.pick());
}

export async function exportTemplate(editor: Editor, t: Template): Promise<void> {
  const path = await window.openroll.templates.export(t);
  if (path) editor.toast(`Exported ${t.name}`);
}

export async function removeTemplate(editor: Editor, t: Template): Promise<void> {
  await window.openroll.templates.remove(t.id);
  templateStore.remove(t.id);
  editor.toast(`Removed ${t.name} from your templates`);
}

export async function keepCommunityTemplate(editor: Editor, t: Template): Promise<void> {
  const saved = await window.openroll.templates.save(t);
  if (!saved.ok) {
    editor.toast(saved.error, { tone: "error" });
    return;
  }
  templateStore.add([saved.template]);
  editor.toast(`Added ${t.name} to your templates`);
}
