// Right click menus for the timeline. Each builder returns plain data; the menu component
// does the drawing, positioning and keyboard handling.

import { addMarker, setTrack } from "../../../core/edit";
import { gapAt, moveTrack, removeMarker, removeTrack, addTrack, updateMarker, type Gap } from "../../../core/timeline-edit";
import { findItem, itemEnd, type Item, type Marker, type Micros, type Track, type TrackKind } from "../../../core/project";
import { COMMANDS } from "../../state/commands";
import type { Editor } from "../../state/editor";
import {
  LABEL_COLORS,
  SPEEDS,
  addMarkerHere,
  closeAllGapsOn,
  closeGapAt,
  copySelection,
  copyStyle,
  cutSelection,
  detachAudio,
  freezeAtPlayhead,
  hasClip,
  hasStyle,
  labelItems,
  pasteAtPlayhead,
  pasteStyleToSelection,
  replaceClip,
  reverseSelection,
  rippleDeleteSelection,
  selectForward,
  selectTrack,
  setSpeedFor,
  timelineHooks,
  toggleMagnet,
} from "../../state/timeline-actions";
import { clearRange } from "../../state/transport";
import type { MenuItem } from "../menu/ContextMenu";

const key = (id: string) => COMMANDS.find(c => c.id === id)?.keys[0];
const SEP: MenuItem = { separator: true };

function trackToggles(editor: Editor, track: Track): MenuItem[] {
  const flip = (k: "locked" | "muted" | "hidden", on: string, off: string) => editor.apply(track[k] ? off : on, p => setTrack(p, track.id, { [k]: !track[k] }));
  return [
    { label: track.locked ? "Unlock track" : "Lock track", icon: track.locked ? "unlock" : "lock", onSelect: () => flip("locked", "Lock track", "Unlock track") },
    ...(track.kind !== "text" ? [{ label: track.muted ? "Unmute track" : "Mute track", icon: (track.muted ? "speakerOff" : "speaker") as "speaker", onSelect: () => flip("muted", "Mute track", "Unmute track") }] : []),
    ...(track.kind !== "audio" ? [{ label: track.hidden ? "Show track" : "Hide track", icon: (track.hidden ? "eyeOff" : "eye") as "eye", onSelect: () => flip("hidden", "Hide track", "Show track") }] : []),
  ];
}

export interface ClipMenuContext {
  rename(id: string): void;
}

export function clipMenu(editor: Editor, item: Item, ctx: ClipMenuContext): MenuItem[] {
  const ids = editor.selection.includes(item.id) ? editor.selection : [item.id];
  const found = findItem(editor.project, item.id);
  const track = found?.track;
  const single = ids.length === 1;
  const media = item.type === "media" ? editor.project.media[item.mediaId] : undefined;
  const selected = ids.map(id => findItem(editor.project, id)?.item).filter((i): i is Item => !!i);
  const allMedia = selected.length > 0 && selected.every(i => i.type === "media" && editor.project.media[i.mediaId]?.kind !== "image");
  const speeds = new Set(selected.map(i => (i.type === "media" ? i.speed : 1)));
  const t = editor.time;
  const under = t > item.start && t < itemEnd(item);
  const canDetach = !!timelineHooks.detachAudio && item.type === "media" && !!media?.hasAudio && !!media.hasVideo;

  return [
    { label: "Split", icon: "split", keys: key("split"), disabled: !under, onSelect: () => editor.splitAtPlayhead() },
    { label: ids.length > 1 ? `Delete ${ids.length} clips` : "Delete", icon: "trash", keys: key("delete"), onSelect: () => editor.deleteSelection() },
    { label: "Ripple delete", keys: key("ripple-delete"), onSelect: () => rippleDeleteSelection(editor) },
    { label: "Duplicate", icon: "duplicate", keys: key("duplicate"), onSelect: () => editor.duplicateSelection() },
    SEP,
    { label: "Copy", keys: key("copy"), onSelect: () => void copySelection(editor) },
    { label: "Cut", keys: key("cut"), onSelect: () => cutSelection(editor) },
    { label: "Paste", keys: key("paste"), disabled: !hasClip(), onSelect: () => pasteAtPlayhead(editor, track?.id) },
    { label: "Copy style", keys: key("copy-style"), disabled: !single, onSelect: () => copyStyle(editor) },
    { label: "Paste style", keys: key("paste-style"), disabled: !hasStyle(), onSelect: () => pasteStyleToSelection(editor) },
    SEP,
    ...(canDetach ? [{ label: "Detach audio", icon: "detach" as const, onSelect: () => detachAudio(editor, ids) }] : []),
    ...(allMedia
      ? [
          {
            label: "Speed",
            icon: "speed" as const,
            items: SPEEDS.map(s => ({ label: s === 1 ? "Normal" : `${s}x`, checked: speeds.size === 1 && speeds.has(s), onSelect: () => setSpeedFor(editor, s, ids) })),
          },
          { label: "Reverse", icon: "reverse" as const, keys: key("reverse"), checked: selected.every(i => i.type === "media" && i.reversed) || undefined, onSelect: () => reverseSelection(editor, ids) },
        ]
      : []),
    ...(media?.hasVideo && media.kind === "video" ? [{ label: "Freeze frame", icon: "freeze" as const, keys: key("freeze"), onSelect: () => freezeAtPlayhead(editor, item.id) }] : []),
    ...(single && item.type === "media" ? [{ label: "Replace clip", onSelect: () => void replaceClip(editor, item.id) }] : []),
    { label: "Rename", disabled: !single, onSelect: () => ctx.rename(item.id) },
    {
      label: "Colour label",
      items: [
        ...LABEL_COLORS.map(c => ({ label: c.name, swatch: c.hex, checked: selected.every(i => i.color === c.id) || undefined, onSelect: () => labelItems(editor, ids, c.id) })),
        SEP,
        { label: "None", onSelect: () => labelItems(editor, ids, null) },
      ],
    },
    SEP,
    { label: "Add marker", icon: "marker", keys: key("marker"), onSelect: () => addMarkerHere(editor) },
    ...(track ? [{ label: "Select all on track", onSelect: () => selectTrack(editor, track.id) }] : []),
    ...(track ? trackToggles(editor, track) : []),
  ];
}

export function laneMenu(editor: Editor, track: Track, t: Micros): MenuItem[] {
  const gap: Gap | null = track.main && track.magnetic !== false ? null : gapAt(track, t);
  return [
    { label: "Paste", keys: key("paste"), disabled: !hasClip() || track.locked, onSelect: () => pasteAtPlayhead(editor, track.id, t) },
    { label: "Add marker", icon: "marker", onSelect: () => editor.apply("Add marker", p => addMarker(p, t)) },
    SEP,
    { label: "Close gap", disabled: !gap, onSelect: () => closeGapAt(editor, track.id, t) },
    { label: "Close all gaps", disabled: track.items.length < 2 || (!!track.main && track.magnetic !== false), onSelect: () => closeAllGapsOn(editor, track.id) },
    { label: "Select all on track", disabled: !track.items.length, onSelect: () => selectTrack(editor, track.id) },
    { label: "Select everything from here", onSelect: () => selectFrom(editor, t) },
    SEP,
    ...trackToggles(editor, track),
  ];
}

function selectFrom(editor: Editor, t: Micros): void {
  editor.select(editor.project.tracks.flatMap(tr => tr.items.filter(i => itemEnd(i) > t).map(i => i.id)));
}

export function trackHeadMenu(editor: Editor, track: Track, rename: () => void): MenuItem[] {
  const tracks = editor.project.tracks;
  const index = tracks.findIndex(t => t.id === track.id);
  const move = (to: number) => editor.apply("Move track", p => moveTrack(p, track.id, to));
  return [
    { label: "Rename", onSelect: rename },
    { label: "Select all on track", disabled: !track.items.length, onSelect: () => selectTrack(editor, track.id) },
    { label: "Close all gaps", disabled: track.items.length < 2 || (!!track.main && track.magnetic !== false), onSelect: () => closeAllGapsOn(editor, track.id) },
    ...(track.main ? [{ label: "Magnetic", icon: "magnet" as const, checked: track.magnetic !== false, keys: key("magnet"), onSelect: () => toggleMagnet(editor) }] : []),
    SEP,
    ...trackToggles(editor, track),
    SEP,
    { label: "Move up", disabled: index <= 0, onSelect: () => move(index - 1) },
    { label: "Move down", disabled: index >= tracks.length - 1, onSelect: () => move(index + 1) },
    ...addTrackItems(editor),
    ...(track.main ? [] : [SEP, { label: "Delete track", danger: true, icon: "trash" as const, onSelect: () => deleteTrack(editor, track) }]),
  ];
}

function deleteTrack(editor: Editor, track: Track): void {
  if (editor.apply("Delete track", p => removeTrack(p, track.id))) editor.toast(track.items.length ? `Deleted ${track.name} and its clips` : `Deleted ${track.name}`, { undo: true });
}

function newTrackItems(editor: Editor): MenuItem[] {
  const add = (kind: TrackKind, label: string) => editor.apply(label, p => addTrack(p, kind));
  return [
    { label: "Video track", icon: "overlay", onSelect: () => add("video", "Add video track") },
    { label: "Text track", icon: "text", onSelect: () => add("text", "Add text track") },
    { label: "Audio track", icon: "audio", onSelect: () => add("audio", "Add audio track") },
  ];
}

function addTrackItems(editor: Editor): MenuItem[] {
  return [{ label: "Add track", icon: "plus", items: newTrackItems(editor) }];
}

export const addTrackMenu = newTrackItems;

export function rulerMenu(editor: Editor, t: Micros, fit: () => void): MenuItem[] {
  const r = editor.range;
  return [
    { label: "Add marker here", icon: "marker", keys: key("marker"), onSelect: () => editor.apply("Add marker", p => addMarker(p, t)) },
    SEP,
    { label: "Set in point here", keys: key("mark-in"), onSelect: () => editor.setRange({ in: t, out: r.out !== null && r.out <= t ? null : r.out }) },
    { label: "Set out point here", keys: key("mark-out"), onSelect: () => editor.setRange({ in: r.in !== null && r.in >= t ? null : r.in, out: t }) },
    { label: "Clear in and out", keys: key("clear-range"), disabled: r.in === null && r.out === null, onSelect: () => clearRange(editor) },
    SEP,
    { label: "Select everything after the playhead", keys: key("select-forward"), onSelect: () => selectForward(editor, 1) },
    { label: "Fit timeline", keys: key("zoom-fit"), onSelect: fit },
  ];
}

export function markerMenu(editor: Editor, m: Marker, rename: () => void): MenuItem[] {
  return [
    { label: "Go to marker", onSelect: () => editor.seek(m.t) },
    { label: "Rename", onSelect: rename },
    {
      label: "Colour",
      items: [
        ...LABEL_COLORS.map(c => ({ label: c.name, swatch: c.hex, checked: m.color === c.id || undefined, onSelect: () => editor.apply("Marker colour", p => updateMarker(p, m.id, { color: c.id })) })),
        SEP,
        { label: "Default", onSelect: () => editor.apply("Marker colour", p => updateMarker(p, m.id, { color: null })) },
      ],
    },
    SEP,
    { label: "Delete marker", danger: true, icon: "trash", onSelect: () => editor.apply("Delete marker", p => removeMarker(p, m.id)) },
  ];
}
