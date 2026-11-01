// Every keyboard command in one table. The key handler, the Help sheet and the context
// menus all read it, so what the sheet says is exactly what the keys do.

import { frameDuration } from "../../core/project";
import { zoomEvents } from "./events";
import type { Editor } from "./editor";
import { importFiles } from "./importer";
import { openSmart } from "./smart-events";
import {
  addMarkerHere,
  copySelection,
  copyStyle,
  cutSelection,
  freezeAtPlayhead,
  jumpMarker,
  pasteAtPlayhead,
  pasteStyleToSelection,
  reverseSelection,
  rippleDeleteSelection,
  selectForward,
  splitAll,
  toggleMagnet,
  trimToPlayhead,
} from "./timeline-actions";
import { clearRange, playAround, playRange, setIn, setOut, shuttle, shuttleStop, togglePlay } from "./transport";

export interface Hooks {
  onExport(): void;
}

export type Group = "Playback" | "Editing" | "Selection" | "Clipboard" | "Trimming" | "Markers and range" | "Timeline view" | "Project" | "Mouse";

export interface Command {
  id: string;
  label: string;
  group: Group;
  /** Key descriptors such as "mod+shift+b". The first one is shown. Empty for menu only commands. */
  keys: string[];
  /** Descriptions of mouse gestures; shown in the sheet, never matched against key events. */
  gesture?: string;
  run?(editor: Editor, hooks: Hooks): void;
}

const fwd = (editor: Editor) => editor.seek(editor.time + frameDuration(editor.project));

export const COMMANDS: Command[] = [
  { id: "play", label: "Play or pause", group: "Playback", keys: ["space"], run: e => togglePlay(e) },
  { id: "play-range", label: "Loop between in and out", group: "Playback", keys: ["shift+space"], run: e => playRange(e) },
  { id: "play-around", label: "Play around the playhead", group: "Playback", keys: ["shift+/"], run: e => playAround(e) },
  { id: "shuttle-back", label: "Play backwards, press again to go faster", group: "Playback", keys: ["j"], run: e => shuttle(e, -1) },
  { id: "shuttle-stop", label: "Stop", group: "Playback", keys: ["k"], run: e => shuttleStop(e) },
  { id: "shuttle-forward", label: "Play, press again to go faster", group: "Playback", keys: ["l"], run: e => shuttle(e, 1) },
  { id: "frame-back", label: "Back one frame", group: "Playback", keys: ["left"], run: e => e.seek(e.time - frameDuration(e.project)) },
  { id: "frame-forward", label: "Forward one frame", group: "Playback", keys: ["right"], run: e => fwd(e) },
  { id: "second-back", label: "Back one second", group: "Playback", keys: ["shift+left"], run: e => e.seek(e.time - 1_000_000) },
  { id: "second-forward", label: "Forward one second", group: "Playback", keys: ["shift+right"], run: e => e.seek(e.time + 1_000_000) },
  { id: "prev-edit", label: "Previous cut", group: "Playback", keys: ["up"], run: e => e.jumpEdit(-1) },
  { id: "next-edit", label: "Next cut", group: "Playback", keys: ["down"], run: e => e.jumpEdit(1) },
  { id: "start", label: "Go to start", group: "Playback", keys: ["home"], run: e => e.seek(0) },
  { id: "end", label: "Go to end", group: "Playback", keys: ["end"], run: e => e.seek(e.player?.duration ?? 0) },

  { id: "split", label: "Split at playhead", group: "Editing", keys: ["s", "mod+b"], run: e => e.splitAtPlayhead() },
  { id: "split-all", label: "Split all tracks at playhead", group: "Editing", keys: ["mod+shift+b"], run: e => splitAll(e) },
  { id: "delete", label: "Delete", group: "Editing", keys: ["backspace", "delete"], run: e => e.deleteSelection() },
  { id: "ripple-delete", label: "Ripple delete", group: "Editing", keys: ["shift+backspace", "shift+delete"], run: e => rippleDeleteSelection(e) },
  { id: "duplicate", label: "Duplicate", group: "Editing", keys: ["mod+d"], run: e => e.duplicateSelection() },
  { id: "freeze", label: "Freeze frame", group: "Editing", keys: ["shift+f"], run: e => freezeAtPlayhead(e) },
  { id: "reverse", label: "Reverse", group: "Editing", keys: ["alt+r"], run: e => reverseSelection(e) },
  { id: "undo", label: "Undo", group: "Editing", keys: ["mod+z"], run: e => e.undo() },
  { id: "redo", label: "Redo", group: "Editing", keys: ["mod+shift+z", "mod+y"], run: e => e.redo() },

  { id: "select-all", label: "Select all", group: "Selection", keys: ["mod+a"], run: e => e.selectAll() },
  { id: "select-forward", label: "Select everything after the playhead", group: "Selection", keys: ["]"], run: e => selectForward(e, 1) },
  { id: "select-backward", label: "Select everything before the playhead", group: "Selection", keys: ["["], run: e => selectForward(e, -1) },
  { id: "deselect", label: "Clear selection", group: "Selection", keys: ["escape"], run: e => e.select([]) },

  { id: "copy", label: "Copy", group: "Clipboard", keys: ["mod+c"], run: e => void copySelection(e) },
  { id: "cut", label: "Cut", group: "Clipboard", keys: ["mod+x"], run: e => cutSelection(e) },
  { id: "paste", label: "Paste at playhead", group: "Clipboard", keys: ["mod+v"], run: e => pasteAtPlayhead(e) },
  { id: "copy-style", label: "Copy style", group: "Clipboard", keys: ["mod+shift+c"], run: e => copyStyle(e) },
  { id: "paste-style", label: "Paste style", group: "Clipboard", keys: ["mod+shift+v"], run: e => pasteStyleToSelection(e) },

  { id: "trim-start", label: "Trim start to playhead", group: "Trimming", keys: ["q"], run: e => trimToPlayhead(e, "start") },
  { id: "trim-end", label: "Trim end to playhead", group: "Trimming", keys: ["w"], run: e => trimToPlayhead(e, "end") },
  { id: "roll", label: "Move the cut between two clips", group: "Mouse", keys: [], gesture: "Alt drag on a cut" },
  { id: "slip", label: "Slip the footage inside a clip", group: "Mouse", keys: [], gesture: "Alt drag inside a clip" },

  { id: "mark-in", label: "Set in point", group: "Markers and range", keys: ["i"], run: e => setIn(e) },
  { id: "mark-out", label: "Set out point", group: "Markers and range", keys: ["o"], run: e => setOut(e) },
  { id: "clear-range", label: "Clear in and out", group: "Markers and range", keys: ["alt+x"], run: e => clearRange(e) },
  { id: "marker", label: "Add marker", group: "Markers and range", keys: ["m"], run: e => addMarkerHere(e) },
  { id: "marker-color", label: "Add marker in the next colour", group: "Markers and range", keys: ["alt+m"], run: e => addMarkerHere(e, MARKER_CYCLE[e.project.markers.length % MARKER_CYCLE.length]) },
  { id: "next-marker", label: "Next marker", group: "Markers and range", keys: ["shift+m"], run: e => jumpMarker(e, 1) },
  { id: "prev-marker", label: "Previous marker", group: "Markers and range", keys: ["alt+shift+m"], run: e => jumpMarker(e, -1) },

  { id: "zoom-in", label: "Zoom in", group: "Timeline view", keys: ["mod+=", "mod+shift+="], run: () => zoomEvents.dispatchEvent(new Event("zoom-in")) },
  { id: "zoom-out", label: "Zoom out", group: "Timeline view", keys: ["mod+-"], run: () => zoomEvents.dispatchEvent(new Event("zoom-out")) },
  { id: "zoom-fit", label: "Fit timeline", group: "Timeline view", keys: ["shift+z"], run: () => zoomEvents.dispatchEvent(new Event("zoom-fit")) },
  { id: "snapping", label: "Snapping on or off", group: "Timeline view", keys: ["n"], run: () => zoomEvents.dispatchEvent(new Event("snapping")) },
  { id: "follow", label: "Follow the playhead on or off", group: "Timeline view", keys: ["alt+f"], run: () => zoomEvents.dispatchEvent(new Event("follow")) },
  { id: "magnet", label: "Main track magnet on or off", group: "Timeline view", keys: ["p"], run: e => toggleMagnet(e) },
  { id: "zoom-wheel", label: "Zoom at the pointer", group: "Mouse", keys: [], gesture: "Pinch, or Ctrl and scroll" },
  { id: "marquee", label: "Select by dragging a box", group: "Mouse", keys: [], gesture: "Drag on empty space" },
  { id: "add-select", label: "Add or remove from the selection", group: "Mouse", keys: [], gesture: "Shift or Cmd click" },
  { id: "no-snap", label: "Move without snapping", group: "Mouse", keys: [], gesture: "Hold Cmd while dragging" },

  { id: "export", label: "Export", group: "Project", keys: ["mod+e"], run: (_e, h) => h.onExport() },
  { id: "import", label: "Import media", group: "Project", keys: ["mod+i"], run: e => void window.openroll.pickMedia().then(f => importFiles(e, f)) },
  { id: "palette", label: "Command bar", group: "Project", keys: ["mod+k"], run: () => openSmart("palette") },
  { id: "history", label: "Undo history", group: "Project", keys: [], run: () => openSmart("history") },
  { id: "save-version", label: "Save a version", group: "Project", keys: [], run: () => openSmart("save-version") },
  { id: "versions", label: "Open saved versions", group: "Project", keys: [], run: () => openSmart("versions") },
  { id: "shortcuts", label: "Keyboard shortcuts", group: "Project", keys: ["mod+/"], run: () => shortcutEvents.dispatchEvent(new Event("open")) },
];

export const MARKER_CYCLE = ["amber", "red", "green", "teal", "blue", "violet"];

export const shortcutEvents = new EventTarget();

export function commandById(id: string): Command | undefined {
  return COMMANDS.find(c => c.id === id);
}

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseKeys(desc: string): Parsed {
  const parts = desc.split("+");
  // "mod+=" splits fine, but "mod++" would not; descriptors never use a bare plus.
  const key = parts.pop()!;
  return { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt"), key };
}

const CODE_KEYS: Record<string, string> = {
  Space: "space",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Backspace: "backspace",
  Delete: "delete",
  Escape: "escape",
  Home: "home",
  End: "end",
  Enter: "enter",
  Slash: "/",
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  NumpadAdd: "=",
  NumpadSubtract: "-",
};

/** The key a stroke means. Letters follow the layout; punctuation and alt chords follow the physical key. */
export function eventKey(e: KeyboardEvent): string {
  if (!e.altKey && /^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1].toLowerCase();
  return e.key.toLowerCase();
}

export function matches(p: Parsed, e: KeyboardEvent, mac: boolean): boolean {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const stray = mac ? e.ctrlKey : e.metaKey;
  return !stray && mod === p.mod && e.shiftKey === p.shift && e.altKey === p.alt && eventKey(e) === p.key;
}

const MAC_GLYPH: Record<string, string> = { backspace: "⌫", delete: "⌦", left: "←", right: "→", up: "↑", down: "↓", escape: "Esc", space: "Space", home: "Home", end: "End", enter: "↩" };
const WIN_NAME: Record<string, string> = { backspace: "Backspace", delete: "Del", left: "←", right: "→", up: "↑", down: "↓", escape: "Esc", space: "Space", home: "Home", end: "End", enter: "Enter" };

/** Key caps for a descriptor, one string per cap: ["⌘", "⇧", "B"] or ["Ctrl", "Shift", "B"]. */
export function keyCaps(desc: string, mac: boolean): string[] {
  const p = parseKeys(desc);
  const out: string[] = [];
  if (mac) {
    if (p.alt) out.push("⌥");
    if (p.shift) out.push("⇧");
    if (p.mod) out.push("⌘");
  } else {
    if (p.mod) out.push("Ctrl");
    if (p.alt) out.push("Alt");
    if (p.shift) out.push("Shift");
  }
  const names = mac ? MAC_GLYPH : WIN_NAME;
  out.push(names[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key));
  return out;
}

export function keyLabel(desc: string, mac: boolean): string {
  return keyCaps(desc, mac).join(mac ? "" : "+");
}

/** A tooltip label such as "Duplicate (Ctrl+D)", with the keys of the command as this platform writes them. */
export function titled(text: string, id: string, mac: boolean): string {
  const key = commandById(id)?.keys[0];
  return key ? `${text} (${keyLabel(key, mac)})` : text;
}
