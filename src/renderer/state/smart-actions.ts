// Actions the command bar and the panels share, so a thing done from either place
// goes through the same code and the same undo step.

import { insertItems, setTransition } from "../../core/edit";
import { type CutOptions, applyCuts, describePlan, planCuts } from "../../core/smartcut";
import { applyLayout, type Layout } from "../../core/layouts";
import { findItem, itemEnd, mainTrack, type ShapeKind, type ShapeStyle } from "../../core/project";
import { newShape, placeOverlay } from "../../core/shapes";
import { recall } from "../ui/captions/CaptionsPanel";
import { TEXT_PRESETS, textFromPreset } from "../ui/panels/text-presets";
import { captionService, listenTargets } from "./captions";
import type { Editor } from "./editor";

export function addTextPreset(editor: Editor, presetId: string): void {
  const preset = TEXT_PRESETS.find(p => p.id === presetId) ?? TEXT_PRESETS[0];
  const item = textFromPreset(preset, editor.time, editor.project);
  const textTrack = editor.project.tracks.find(t => t.kind === "text");
  editor.apply("Add text", proj => insertItems(proj, [item], textTrack ? { trackId: textTrack.id } : {}));
  editor.select([item.id]);
}

export function addShape(editor: Editor, style: Partial<ShapeStyle> & { kind: ShapeKind }, label?: string): string {
  const item = newShape(editor.project, editor.time, style);
  editor.apply(label ?? (style.kind === "sticker" ? "Add sticker" : "Add shape"), p => placeOverlay(p, item));
  editor.select([item.id]);
  return item.id;
}

/** The cut a transition goes on: the selected main clip's start, else the cut nearest the playhead. */
export function transitionTarget(editor: Editor): string | null {
  const main = mainTrack(editor.project);
  const sel = main.items.findIndex(i => editor.selection.includes(i.id));
  if (sel > 0) return main.items[sel].id;
  let best: string | null = null;
  let dist = Infinity;
  for (let i = 1; i < main.items.length; i++) {
    const d = Math.abs(main.items[i].start - editor.time);
    if (d < dist && itemEnd(main.items[i - 1]) === main.items[i].start) {
      dist = d;
      best = main.items[i].id;
    }
  }
  return best;
}

export function addTransition(editor: Editor, kind: string, name: string): void {
  const id = transitionTarget(editor);
  if (!id) {
    editor.toast("Put two clips next to each other on the main track first");
    return;
  }
  editor.apply(`Add ${name.toLowerCase()}`, p => setTransition(p, id, kind, 500_000));
}

export function setLayout(editor: Editor, layout: Layout, label: string): void {
  const id = editor.selection.find(s => findItem(editor.project, s)?.item.type === "media");
  if (!id) {
    editor.toast("Select a video clip first");
    return;
  }
  editor.apply(label, p => applyLayout(p, id, layout));
}

/** Captions for the selection, or everything when nothing is selected, with the look last used in the Captions panel. */
export async function generateCaptions(editor: Editor): Promise<void> {
  const r = recall();
  await captionService(editor).generate(editor.selection.length ? editor.selection : null, { language: r.language === "auto" ? null : r.language, model: r.model }, r.choice);
}

/** Take the dead air and filler words out of a main track clip, listening first if it has not been heard. */
export async function removeSilences(editor: Editor, options: Partial<CutOptions> = {}): Promise<void> {
  const service = captionService(editor);
  const main = mainTrack(editor.project);
  const item = (main.items.find(i => editor.selection.includes(i.id)) ?? (main.items.length === 1 ? main.items[0] : undefined)) as (typeof main.items)[number] | undefined;
  if (!item || item.type !== "media") {
    editor.toast("Select a clip on the main track that has speech in it");
    return;
  }
  const media = editor.project.media[item.mediaId];
  if (!media?.hasAudio || !listenTargets(editor.project, [item.id]).length) {
    editor.toast("That clip has no speech to work from");
    return;
  }
  const r = recall();
  const settings = { language: r.language === "auto" ? null : r.language, model: r.model };
  let words = service.heard(item, settings) ?? service.fromCaptions(item);
  if (!words) {
    const heard = await service.listen([{ item, media }], settings);
    words = heard?.get(item.id) ?? null;
  }
  if (!words) return;
  const plan = planCuts(words, { from: item.start, to: itemEnd(item) }, { ...options, language: settings.language ?? service.spokenLanguage(item) ?? undefined });
  if (!plan.ranges.length) {
    editor.toast("Nothing to remove");
    return;
  }
  if (editor.apply("Remove pauses and fillers", p => applyCuts(p, plan.ranges))) editor.toast(describePlan(plan).replace(/^Removes/, "Removed"), { undo: true });
}
