import type { Template } from "../core/template";

export interface TemplateImport {
  added: Template[];
  /** Files that were already in the list unchanged. */
  duplicates: number;
  /** One plain sentence per file that could not be used, starting with its name. */
  problems: string[];
}

/** The community list as last read. Offline it is whatever was read before, or empty. */
export interface CommunityState {
  templates: Template[];
  /** When it was last read from the repository, or null if it never was. */
  updated: number | null;
}

export type SaveTemplateResult = { ok: true; template: Template } | { ok: false; error: string };
