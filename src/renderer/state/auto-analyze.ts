import { useEffect, useSyncExternalStore } from "react";
import type { Editor } from "./editor";
import type { MediaCache } from "./media-cache";
import { useEditor } from "../lib/hooks";

/**
 * Measures the audio of every clip on the timeline and every imported sound, once, and
 * writes the result onto the media so the player and exporter can use it.
 */
export function useAutoAnalysis(editor: Editor, cache: MediaCache): void {
  const version = useSyncExternalStore(cache.subscribe, () => cache.version);
  const media = useEditor(editor, e => e.project.media);
  const tracks = useEditor(editor, e => e.project.tracks);
  useEffect(() => {
    const used = new Set(tracks.flatMap(t => t.items.flatMap(i => (i.type === "media" ? [i.mediaId] : []))));
    for (const m of Object.values(media)) {
      if (!m.hasAudio || m.loudness !== undefined) continue;
      if (m.kind !== "audio" && !used.has(m.id)) continue;
      const a = cache.analysis(m);
      if (!a) continue;
      // Silence has no loudness; store a floor so the file is not measured again.
      editor.annotateMedia(m.id, { loudness: a.lufs ?? -70, speech: a.speech, beats: a.beats, bpm: a.bpm ?? undefined });
    }
  }, [editor, cache, version, media, tracks]);
}
