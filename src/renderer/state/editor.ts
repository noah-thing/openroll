import { History } from "../../core/history";
import { deleteItems, duplicateItems, split } from "../../core/edit";
import { createProject, findItem, itemEnd, type MediaRef, type Micros, type Project } from "../../core/project";
import { Player } from "../../engine/player";

export type Listener = () => void;

export interface Toast {
  id: number;
  message: string;
  undo?: boolean;
  tone?: "error";
}

const SAVE_DELAY = 400;

/**
 * Everything the editor screen works on. Components read it through useEditor() and
 * change it only through methods here, so every edit lands in undo history and gets
 * saved, and nothing writes to the project behind the history's back.
 */
export class Editor {
  project: Project;
  path: string | null;
  selection: string[] = [];
  history = new History();
  player: Player | null = null;
  toasts: Toast[] = [];
  saveState: "saved" | "saving" | "unsaved" | "error" = "saved";
  /** In and out points shown on the ruler. Kept for the session, not saved in the project. */
  range: { in: Micros | null; out: Micros | null } = { in: null, out: null };
  /** Shuttle speed while J or L is stepping the playhead, 0 otherwise. */
  shuttle = 0;
  /** Set while a range or the stretch around the playhead is looping. */
  looping = false;
  private listeners = new Set<Listener>();
  private saveTimer = 0;
  private toastId = 0;
  private urlCache = new Map<string, string>();

  constructor(project?: Project, path: string | null = null) {
    this.project = project ?? createProject();
    this.path = path;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  attachPlayer(player: Player): void {
    this.player = player;
    player.setProject(this.project, this.urls());
  }

  urls(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of Object.values(this.project.media)) {
      let u = this.urlCache.get(m.path);
      if (!u) {
        u = window.openroll.mediaUrl(m.path);
        this.urlCache.set(m.path, u);
      }
      out[m.id] = u;
    }
    return out;
  }

  /**
   * Apply an edit. `group` coalesces a run of edits (a drag, a slider) into one undo step;
   * call `endGroup()` when the gesture ends.
   */
  apply(label: string, fn: (p: Project) => Project, group?: string): boolean {
    const before = this.project;
    const next = fn(before);
    if (next === before) return false;
    this.history.push(before, label, group);
    this.commit(next);
    return true;
  }

  /**
   * Record facts measured from a file (loudness, beats). Not an edit, so it adds no undo
   * step, but it is saved and the player sees it.
   */
  annotateMedia(id: string, patch: Partial<MediaRef>): void {
    const m = this.project.media[id];
    if (!m) return;
    this.commit({ ...this.project, media: { ...this.project.media, [id]: { ...m, ...patch } } });
  }

  endGroup(): void {
    this.history.seal();
  }

  private commit(next: Project): void {
    this.project = next;
    this.selection = this.selection.filter(id => findItem(next, id));
    this.player?.setProject(next, this.urls());
    this.scheduleSave();
    this.emit();
  }

  undo(): void {
    const e = this.history.undo(this.project);
    if (!e) return;
    this.commit(e.project);
    this.toast(`Undid ${e.label.toLowerCase()}`);
  }

  redo(): void {
    const e = this.history.redo(this.project);
    if (!e) return;
    this.commit(e.project);
    this.toast(`Redid ${e.label.toLowerCase()}`);
  }

  select(ids: string[]): void {
    if (ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i])) return;
    this.selection = ids;
    this.emit();
  }

  setRange(range: { in: Micros | null; out: Micros | null }): void {
    this.range = range;
    this.emit();
  }

  setShuttle(rate: number, looping = this.looping): void {
    if (rate === this.shuttle && looping === this.looping) return;
    this.shuttle = rate;
    this.looping = looping;
    this.emit();
  }

  /** Seek while dragging the playhead: moves the frame and plays a short grain of sound. */
  scrub(t: Micros): void {
    this.player?.scrub(t);
  }

  get time(): Micros {
    return this.player?.time ?? 0;
  }

  seek(t: Micros): void {
    this.player?.seek(t);
  }

  /** Edit points on the main track, plus every clip edge when there is no main track content. */
  jumpEdit(dir: -1 | 1): void {
    const t = this.time;
    const points = new Set<number>([0]);
    for (const track of this.project.tracks) for (const i of track.items) {
      points.add(i.start);
      points.add(itemEnd(i));
    }
    const sorted = [...points].sort((a, b) => a - b);
    const target = dir > 0 ? sorted.find(p => p > t + 1000) : sorted.reverse().find(p => p < t - 1000);
    if (target !== undefined) this.seek(target);
  }

  splitAtPlayhead(): void {
    const t = this.time;
    const ids = this.selection.length ? this.selection : undefined;
    const ok = this.apply("Split", p => split(p, t, ids));
    if (!ok && ids) this.apply("Split", p => split(p, t));
    else if (!ok) this.toast("Move the playhead over a clip to split it");
  }

  deleteSelection(): void {
    if (!this.selection.length) return;
    const n = this.selection.length;
    if (this.apply(n === 1 ? "Delete clip" : `Delete ${n} clips`, p => deleteItems(p, this.selection))) {
      this.selection = [];
      this.toast(n === 1 ? "Clip deleted" : `${n} clips deleted`, { undo: true });
    }
  }

  duplicateSelection(): void {
    if (this.selection.length) this.apply("Duplicate", p => duplicateItems(p, this.selection));
  }

  selectAll(): void {
    this.select(this.project.tracks.flatMap(t => t.items.map(i => i.id)));
  }

  toast(message: string, opts: Omit<Toast, "id" | "message"> = {}): void {
    const t: Toast = { id: ++this.toastId, message, ...opts };
    this.toasts = [...this.toasts.slice(-2), t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter(x => x !== t);
      this.emit();
    }, opts.tone === "error" ? 6000 : 3200);
  }

  private scheduleSave(): void {
    this.saveState = "unsaved";
    window.openroll.setDirty(true);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY);
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saveState === "saved") return;
    this.saveState = "saving";
    this.emit();
    const snapshot = this.project;
    const r = await window.openroll.projects.save(this.path, snapshot.name, JSON.stringify(snapshot));
    if (!r.ok) {
      this.saveState = "error";
      this.toast(`Could not save: ${r.error}`, { tone: "error" });
      this.emit();
      return;
    }
    this.path = r.path ?? this.path;
    void this.saveThumb();
    // An edit may have landed while we were writing; that one saves on its own timer.
    if (this.project === snapshot) {
      this.saveState = "saved";
      window.openroll.setDirty(false);
    }
    this.emit();
  }

  private thumbAt = 0;

  /** A small picture of the edit for the home screen, refreshed at most every 20 s. */
  async saveThumb(force = false): Promise<void> {
    const player = this.player;
    if (!player || !this.path || (!force && Date.now() - this.thumbAt < 20_000)) return;
    if (!this.project.tracks.some(t => t.items.length)) return;
    this.thumbAt = Date.now();
    try {
      const img = await player.snapshot(player.time);
      const w = Math.min(480, img.width), h = Math.round((img.height * w) / img.width);
      const src = new OffscreenCanvas(img.width, img.height);
      src.getContext("2d")!.putImageData(img, 0, 0);
      const out = new OffscreenCanvas(w, h);
      out.getContext("2d")!.drawImage(src, 0, 0, w, h);
      const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      await window.openroll.projects.saveThumb(this.path, new Uint8Array(await blob.arrayBuffer()));
    } catch {
      // A missing thumbnail only costs a blank card.
    }
  }

  dispose(): void {
    void this.save();
    this.player = null;
    this.listeners.clear();
  }
}
