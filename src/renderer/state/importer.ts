import { addMedia, insertItems, mediaItem } from "../../core/edit";
import { mainTrack, projectDuration, type MediaRef, type Micros } from "../../core/project";
import { probe, UnsupportedMediaError } from "../../engine/probe";
import type { FileInfo } from "../../shared/api";
import type { Editor } from "./editor";

export interface ImportOptions {
  /** Place the new clips on the timeline at this time. */
  at?: Micros;
  trackId?: string;
}

/**
 * Probe files and add them to the project. Files already in the project are reused, not
 * duplicated. An empty timeline gets the clips straight away, in the order picked,
 * because that is what almost everyone does next.
 */
export async function importFiles(editor: Editor, files: FileInfo[], opts: ImportOptions = {}): Promise<MediaRef[]> {
  if (!files.length) return [];
  const known = new Map(Object.values(editor.project.media).map(m => [m.path, m]));
  const results: (MediaRef | null)[] = new Array(files.length).fill(null);
  const failures: string[] = [];

  let next = 0;
  const work = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      const existing = known.get(f.path);
      if (existing && existing.size === f.size && existing.mtime === f.mtime) {
        results[i] = existing;
        continue;
      }
      try {
        results[i] = await probe({ ...f, url: window.openroll.mediaUrl(f.path) });
      } catch (err) {
        failures.push(err instanceof UnsupportedMediaError ? err.message : `${f.name} could not be read.`);
      }
    }
  };
  await Promise.all([work(), work(), work()]);

  const refs = results.filter((r): r is MediaRef => !!r);
  const fresh = refs.filter(r => !editor.project.media[r.id]);
  const timelineWasEmpty = projectDuration(editor.project) === 0;
  const place = opts.at !== undefined || timelineWasEmpty;

  if (refs.length) {
    editor.apply(place ? "Import and place clips" : "Import media", p => {
      let out = addMedia(p, fresh);
      if (place) {
        let t = opts.at ?? projectDuration(out);
        const items = refs.map(r => {
          const it = mediaItem(r, t);
          t += it.duration;
          return it;
        });
        const visual = items.filter(i => out.media[i.mediaId]?.kind !== "audio");
        const audio = items.filter(i => out.media[i.mediaId]?.kind === "audio");
        if (visual.length) out = insertItems(out, visual, { trackId: opts.trackId ?? mainTrack(out).id });
        if (audio.length) {
          let at = opts.at ?? 0;
          for (const a of audio) {
            a.start = at;
            at += a.duration;
          }
          out = insertItems(out, audio, opts.trackId ? { trackId: opts.trackId } : {});
        }
      }
      return out;
    });
  }

  if (failures.length === 1) editor.toast(failures[0], { tone: "error" });
  else if (failures.length > 1) editor.toast(`${failures.length} files could not be imported. ${failures[0]}`, { tone: "error" });
  else if (refs.length && place && timelineWasEmpty) editor.toast(refs.length === 1 ? "Added to the timeline" : `Added ${refs.length} clips to the timeline`, { undo: true });
  return refs;
}
