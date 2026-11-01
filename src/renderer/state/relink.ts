import { relinkMedia } from "../../core/relink";
import type { FileInfo } from "../../shared/api";
import type { MissingFile, RelinkMatch } from "../../shared/relink";
import { derived } from "./derived-media";
import type { Editor } from "./editor";

type Found = (RelinkMatch & { file: FileInfo })[];

/** Marks media whose files are gone. Called when a project opens and after any relink. */
export async function checkMissing(editor: Editor): Promise<MissingFile[]> {
  const media = Object.values(editor.project.media);
  const gone = new Set(await window.openroll.relink.missing(media.map(m => m.path)));
  derived.setMissing([...gone]);
  return media.filter(m => gone.has(m.path)).map(m => ({ id: m.id, path: m.path, name: m.name, size: m.size }));
}

export interface RelinkResult {
  linked: number;
  left: number;
  cancelled?: boolean;
}

function apply(editor: Editor, found: Found): void {
  editor.apply(found.length === 1 ? "Relink media" : `Relink ${found.length} files`, p =>
    relinkMedia(p, found.map(f => ({ id: f.id, path: f.file.path, name: f.file.name, size: f.file.size, mtime: f.file.mtime }))),
  );
}

async function finish(editor: Editor, found: Found): Promise<RelinkResult> {
  if (found.length) apply(editor, found);
  const left = await checkMissing(editor);
  if (found.length) void derived.restore(Object.values(editor.project.media));
  return { linked: found.length, left: left.length };
}

/** Looks beside where the files used to be. Needs no input from the person, so it runs first. */
export async function relinkNearby(editor: Editor, missing: MissingFile[]): Promise<RelinkResult> {
  if (!missing.length) return { linked: 0, left: 0 };
  return finish(editor, await window.openroll.relink.auto(missing));
}

/** The person points at a folder; everything in it that matches by name and size is linked at once. */
export async function relinkFromFolder(editor: Editor, missing: MissingFile[]): Promise<RelinkResult> {
  const r = await window.openroll.relink.folder(missing);
  if (!r) return { linked: 0, left: missing.length, cancelled: true };
  return finish(editor, r.matches);
}

/** One file picked by hand; others in its folder come along when they match. */
export async function relinkFromFile(editor: Editor, missing: MissingFile[], targetId: string): Promise<RelinkResult> {
  const r = await window.openroll.relink.file(missing, targetId);
  if (!r) return { linked: 0, left: missing.length, cancelled: true };
  return finish(editor, r.matches);
}

export function describe(r: RelinkResult): string {
  if (r.cancelled) return "";
  if (!r.linked) return "No matching files found there. Pick the folder that holds your originals, or choose a file by hand.";
  const linked = r.linked === 1 ? "Found 1 file" : `Found ${r.linked} files`;
  return r.left ? `${linked}. ${r.left} still missing.` : `${linked}. Everything is linked again.`;
}
