import { placeSound } from "../../core/audio-edit";
import type { MediaRef, Micros } from "../../core/project";
import { probe } from "../../engine/probe";
import { renderSfx, SFX } from "../../engine/sfx";
import { encodeWav } from "../../engine/wav";
import type { FileInfo } from "../../shared/api";
import type { Editor } from "./editor";

/** Probe a file OpenRoll wrote itself and put it on the timeline as a new sound. */
export async function addMadeSound(editor: Editor, file: FileInfo, origin: NonNullable<MediaRef["origin"]>, at: Micros, label: string): Promise<string | null> {
  const known = Object.values(editor.project.media).find(m => m.path === file.path && m.size === file.size && m.mtime === file.mtime);
  const ref = known ?? { ...(await probe({ ...file, url: window.openroll.mediaUrl(file.path) })), origin };
  let itemId: string | null = null;
  editor.apply(label, p => {
    const r = placeSound(p, ref, at);
    itemId = r.itemId;
    return r.project;
  });
  if (itemId) editor.select([itemId]);
  return itemId;
}

export async function addEffect(editor: Editor, id: string): Promise<void> {
  const def = SFX.find(s => s.id === id);
  if (!def) return;
  const key = `sfx-${id}-v1.wav`;
  let file = await window.openroll.cache.file(key);
  if (!file) {
    await window.openroll.cache.put(key, await renderSfx(def));
    file = await window.openroll.cache.file(key);
  }
  if (!file) return;
  await addMadeSound(editor, file, "effect", editor.time, `Add ${def.name.toLowerCase()}`);
}

export async function saveWavRecording(name: string, planes: Float32Array[], rate: number): Promise<FileInfo | null> {
  return window.openroll.saveRecording(name, "wav", encodeWav(planes, rate));
}
