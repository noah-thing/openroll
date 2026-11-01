import { addMedia, insertItems, mediaItem } from "../../core/edit";
import { mainTrack, projectDuration, type MediaRef, type Micros, type Project } from "../../core/project";
import { NeedsPrepError, probe, UnsupportedMediaError } from "../../engine/probe";
import type { FileInfo } from "../../shared/api";
import { derived } from "./derived-media";
import type { Editor } from "./editor";
import { importViaConverter } from "./prepare-import";

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
        if (err instanceof NeedsPrepError) {
          const ref = await importViaConverter(f, err.hints).catch(() => null);
          if (ref) {
            results[i] = ref;
            continue;
          }
        }
        failures.push(err instanceof UnsupportedMediaError ? err.message : `${f.name} could not be read.`);
      }
    }
  };
  await Promise.all([work(), work(), work()]);

  const refs = results.filter((r): r is MediaRef => !!r);
  const fresh = refs.filter(r => !editor.project.media[r.id]);
  for (const r of fresh) void derived.maybeProxy(r);
  const timelineWasEmpty = projectDuration(editor.project) === 0;
  const place = opts.at !== undefined || timelineWasEmpty;

  if (refs.length) {
    editor.apply(place ? "Import and place clips" : "Import media", p => {
      let out = addMedia(p, fresh);
      if (timelineWasEmpty) out = adoptFirstClip(out, refs);
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

const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

/**
 * A fresh project takes its frame from the first picture the user brings in, the way
 * phone editors do: vertical clips make a vertical project. Sizes are capped at 4K and
 * frame rates snap to the nearest broadcast rate.
 */
export function adoptFirstClip(p: Project, refs: MediaRef[]): Project {
  const first = refs.find(r => r.kind !== "audio" && r.width && r.height);
  if (!first) return p;
  let w = first.width!, h = first.height!;
  if (first.rotation === 90 || first.rotation === 270) [w, h] = [h, w];
  const k = Math.min(1, 3840 / Math.max(w, h));
  const width = Math.max(2, Math.round((w * k) / 2) * 2);
  const height = Math.max(2, Math.round((h * k) / 2) * 2);
  const rate = first.fps ? COMMON_RATES.reduce((a, b) => (Math.abs(b - first.fps!) < Math.abs(a - first.fps!) ? b : a)) : 30;
  const fps = Number.isInteger(rate) ? { num: rate, den: 1 } : { num: Math.round(rate * 1001), den: 1001 };
  if (width === p.settings.width && height === p.settings.height && fps.num / fps.den === p.settings.fps.num / p.settings.fps.den) return p;
  return { ...p, settings: { ...p.settings, width, height, fps } };
}
