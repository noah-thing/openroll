// Things the timeline can do, as plain functions of the editor. Shortcuts, the context
// menu and the toolbar all call these, so each action behaves the same wherever it starts.

import { deleteItems, setSpeed, setSpeedRamp, split, updateItem, addMarker } from "../../core/edit";
import type { SpeedPreset } from "../../core/speed-presets";
import {
  type Clip,
  closeGap,
  closeAllGaps,
  copyItems,
  freezeFrame,
  itemsFrom,
  neighbourMarker,
  pasteItems,
  pasteStyle,
  replaceMedia,
  reverseItems,
  rippleDeleteItems,
  setItemColor,
  setMagnetic,
  trackItemIds,
  trimToTime,
  updateMarker,
} from "../../core/timeline-edit";
import { findItem, itemEnd, mainTrack, type Item, type Micros } from "../../core/project";
import type { Edge } from "../../core/edit";
import type { Editor } from "./editor";
import { importFiles } from "./importer";

/** The clipboard outlives the project, so a copy can be pasted into another one. */
let clip: Clip | null = null;
let styleSource: Item | null = null;

/** Other parts of the app fill these in when they own the behaviour. */
export const timelineHooks: { detachAudio?(editor: Editor, ids: string[]): void } = {};

export const LABEL_COLORS: { id: string; name: string; hex: string }[] = [
  { id: "red", name: "Red", hex: "#b25a52" },
  { id: "amber", name: "Amber", hex: "#b08a45" },
  { id: "green", name: "Green", hex: "#5f9272" },
  { id: "teal", name: "Teal", hex: "#4d8c93" },
  { id: "blue", name: "Blue", hex: "#5a7fb5" },
  { id: "violet", name: "Violet", hex: "#8670ad" },
];

export function labelHex(id: string | undefined): string | undefined {
  return LABEL_COLORS.find(c => c.id === id)?.hex;
}

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

export function hasClip(): boolean {
  return !!clip;
}

export function hasStyle(): boolean {
  return !!styleSource;
}

export function copySelection(editor: Editor): boolean {
  if (!editor.selection.length) return false;
  const c = copyItems(editor.project, editor.selection);
  if (!c) return false;
  clip = c;
  editor.toast(c.entries.length === 1 ? "Copied" : `Copied ${c.entries.length} clips`);
  return true;
}

export function cutSelection(editor: Editor): void {
  if (!copySelection(editor)) return;
  const ids = editor.selection;
  editor.apply("Cut", p => deleteItems(p, ids));
  editor.select([]);
}

export function pasteAtPlayhead(editor: Editor, trackId?: string, at?: Micros): void {
  if (!clip) {
    editor.toast("Nothing copied yet");
    return;
  }
  const c = clip;
  const t = at ?? editor.time;
  let made: string[] = [];
  const ok = editor.apply("Paste", p => {
    const r = pasteItems(p, c, t, { trackId });
    made = r.ids;
    return r.project;
  });
  if (ok) editor.select(made);
}

export function copyStyle(editor: Editor): void {
  const id = editor.selection[0];
  const found = id ? findItem(editor.project, id) : null;
  if (!found) return;
  styleSource = structuredClone(found.item);
  editor.toast("Style copied. Select clips and use Paste style");
}

export function pasteStyleToSelection(editor: Editor): void {
  if (!styleSource) {
    editor.toast("Copy a clip's style first");
    return;
  }
  const src = styleSource;
  const ids = editor.selection;
  if (!ids.length) {
    editor.toast("Select the clips to restyle");
    return;
  }
  if (!editor.apply("Paste style", p => pasteStyle(p, src, ids))) editor.toast("That style does not fit the selected clips");
}

export function rippleDeleteSelection(editor: Editor): void {
  const ids = editor.selection;
  if (!ids.length) return;
  if (editor.apply(ids.length === 1 ? "Ripple delete" : "Ripple delete clips", p => rippleDeleteItems(p, ids))) {
    editor.select([]);
    editor.toast(ids.length === 1 ? "Clip deleted, gap closed" : `${ids.length} clips deleted, gaps closed`, { undo: true });
  }
}

export function splitAll(editor: Editor): void {
  const t = editor.time;
  if (!editor.apply("Split all", p => split(p, t))) editor.toast("Move the playhead over a clip to split it");
}

export function selectForward(editor: Editor, dir: 1 | -1): void {
  const t = editor.time;
  const p = editor.project;
  const ids = dir > 0 ? itemsFrom(p, t) : p.tracks.flatMap(tr => tr.items.filter(i => i.start < t).map(i => i.id));
  editor.select(ids);
  if (!ids.length) editor.toast(dir > 0 ? "Nothing after the playhead" : "Nothing before the playhead");
}

export function selectTrack(editor: Editor, trackId: string): void {
  editor.select(trackItemIds(editor.project, trackId));
}

export function trimToPlayhead(editor: Editor, edge: Edge): void {
  const t = editor.time;
  const label = edge === "start" ? "Trim start to playhead" : "Trim end to playhead";
  const sel = editor.selection.length ? editor.selection : undefined;
  if (editor.apply(label, p => trimToTime(p, t, edge, sel))) return;
  if (sel && editor.apply(label, p => trimToTime(p, t, edge))) return;
  editor.toast("Move the playhead over a clip to trim it");
}

export function freezeAtPlayhead(editor: Editor, id?: string): void {
  const t = editor.time;
  const p = editor.project;
  const under = (i: Item) => t >= i.start && t < itemEnd(i);
  const pick =
    id ??
    editor.selection.find(s => {
      const f = findItem(p, s);
      return f && f.item.type === "media" && under(f.item);
    }) ??
    p.tracks.filter(tr => tr.kind === "video").flatMap(tr => tr.items).find(i => i.type === "media" && under(i))?.id;
  if (!pick) {
    editor.toast("Move the playhead over a video clip first");
    return;
  }
  const found = findItem(p, pick);
  // Freezing from a clip that does not sit under the playhead (menu on another clip) uses its first frame.
  const at = found && under(found.item) ? t : found?.item.start ?? t;
  if (!editor.apply("Freeze frame", q => freezeFrame(q, pick, at))) editor.toast("A still needs a video clip");
}

export function reverseSelection(editor: Editor, ids = editor.selection): void {
  if (!editor.apply("Reverse", p => reverseItems(p, ids))) editor.toast("Reverse works on video and audio clips");
}

export function setSpeedFor(editor: Editor, speed: number, ids = editor.selection): void {
  editor.apply(speed === 1 ? "Normal speed" : `Speed ${speed}x`, p => ids.reduce((q, id) => setSpeed(q, id, speed), p));
}

export function setSpeedCurveFor(editor: Editor, preset: SpeedPreset, ids = editor.selection): void {
  editor.apply(`Speed curve, ${preset.label}`, p => ids.reduce((q, id) => setSpeedRamp(q, id, preset.keys, preset.id), p));
}

export function renameItem(editor: Editor, id: string, name: string): void {
  const clean = name.trim();
  const found = findItem(editor.project, id);
  if (!found || found.item.name === clean) return;
  editor.apply("Rename", p => updateItem(p, id, { name: clean || undefined }));
}

export function labelItems(editor: Editor, ids: string[], color: string | null): void {
  editor.apply("Colour label", p => setItemColor(p, ids, color));
}

export function addMarkerHere(editor: Editor, color?: string): void {
  const t = editor.time;
  const exists = editor.project.markers.some(m => Math.abs(m.t - t) < 1000);
  if (exists) {
    editor.toast("There is already a marker here");
    return;
  }
  editor.apply("Add marker", p => {
    const next = addMarker(p, t);
    if (!color || next === p) return next;
    const id = next.markers.find(m => m.t === t)!.id;
    return updateMarker(next, id, { color });
  });
}

export function jumpMarker(editor: Editor, dir: -1 | 1): void {
  const m = neighbourMarker(editor.project, editor.time, dir);
  if (m) editor.seek(m.t);
  else editor.toast(dir > 0 ? "No marker ahead" : "No marker behind");
}

export function closeGapAt(editor: Editor, trackId: string, t: Micros): void {
  if (!editor.apply("Close gap", p => closeGap(p, trackId, t))) editor.toast("There is no gap here");
}

export function closeAllGapsOn(editor: Editor, trackId: string): void {
  const t = editor.project.tracks.find(x => x.id === trackId);
  if (t && t.main && t.magnetic !== false) {
    editor.toast("The main track closes gaps by itself");
    return;
  }
  if (!editor.apply("Close all gaps", p => closeAllGaps(p, trackId))) editor.toast("No gaps on this track");
}

export function toggleMagnet(editor: Editor): void {
  const main = mainTrack(editor.project);
  const on = main.magnetic === false;
  editor.apply(on ? "Magnetic main track on" : "Magnetic main track off", p => setMagnetic(p, main.id, on));
  editor.toast(on ? "Main track is magnetic" : "Main track is free: clips stay where you put them");
}

/** Pick a new file for a clip. It keeps its place and as much of its length as the file allows. */
export async function replaceClip(editor: Editor, id: string): Promise<void> {
  const files = await window.openroll.pickMedia();
  if (!files.length) return;
  const refs = await importFiles(editor, files.slice(0, 1));
  const ref = refs[0];
  if (!ref) return;
  if (!editor.apply("Replace clip", p => replaceMedia(p, id, ref))) editor.toast("That file cannot replace this clip", { tone: "error" });
}

export function detachAudio(editor: Editor, ids = editor.selection): void {
  timelineHooks.detachAudio?.(editor, ids);
}
