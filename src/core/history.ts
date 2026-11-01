// Undo history. Projects are immutable, so a history entry is just the previous root
// plus a label for the Edit menu ("Undo Split"). Drags and slider scrubs coalesce into
// one entry through `group`, so undo never walks back through every pixel of a drag.

import type { Project } from "./project";

export interface Entry {
  project: Project;
  label: string;
}

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private openGroup: string | null = null;

  constructor(private limit = 300) {}

  /** Record that `before` is being replaced by an edit called `label`. */
  push(before: Project, label: string, group?: string): void {
    if (group && group === this.openGroup) return;
    this.past.push({ project: before, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.openGroup = group ?? null;
  }

  /** End a coalescing group, e.g. on pointerup. */
  seal(): void {
    this.openGroup = null;
  }

  undo(current: Project): Entry | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ project: current, label: e.label });
    this.openGroup = null;
    return e;
  }

  redo(current: Project): Entry | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ project: current, label: e.label });
    this.openGroup = null;
    return e;
  }

  /** Every step by name, oldest first, and how many of them are applied. */
  get timeline(): { labels: string[]; applied: number } {
    return { labels: [...this.past.map(e => e.label), ...this.future.map(e => e.label).reverse()], applied: this.past.length };
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.openGroup = null;
  }
}
