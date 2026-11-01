// The list the command bar searches: every keyboard command, plus the things people
// would otherwise hunt through panels for. Built fresh each time the bar opens, so
// markers and the selection are current.

import { LAYOUTS } from "../../core/layouts";
import { GUIDES } from "../../core/safe-zones";
import { STICKERS } from "../../core/stickers";
import { changeFrame, RATIOS } from "../ui/RatioPicker";
import { findItem, type MediaItem } from "../../core/project";
import { shortTime } from "../lib/format";
import { COMMANDS, type Hooks } from "./commands";
import type { Editor } from "./editor";
import { chooseApp, toggleGuide } from "./guides";
import { showRail } from "./smart-events";
import { addShape, addTextPreset, addTransition, generateCaptions, removeSilences, setLayout } from "./smart-actions";
import { closeAllGapsOn, detachAudio, setSpeedFor } from "./timeline-actions";
import { TEXT_PRESETS } from "../ui/panels/text-presets";

export interface Action {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  /** Key descriptors to show, from the keyboard table. */
  keys?: string[];
  enabled?(editor: Editor): boolean;
  run(editor: Editor, hooks: Hooks): void | Promise<void>;
}

const selectedMedia = (e: Editor): MediaItem | null => {
  for (const id of e.selection) {
    const f = findItem(e.project, id);
    if (f?.item.type === "media") return f.item;
  }
  return null;
};
const hasVideoSelected = (e: Editor) => {
  const m = selectedMedia(e);
  return !!m && e.project.media[m.mediaId]?.kind !== "audio";
};

const KEYWORDS: Record<string, string> = {
  split: "cut razor blade",
  delete: "remove",
  "ripple-delete": "remove close gap",
  freeze: "still hold",
  reverse: "backwards",
  marker: "bookmark flag",
  "zoom-fit": "zoom to fit whole timeline",
  export: "render save mp4 share",
  import: "add media files open",
  undo: "back",
  history: "steps back earlier jump",
  "save-version": "snapshot checkpoint name",
  versions: "restore snapshot checkpoint",
  duplicate: "copy clone",
  snapping: "magnet snap",
};

const TRANSITION_NAMES: [string, string][] = [
  ["dissolve", "Dissolve"],
  ["dip-black", "Dip to black"],
  ["dip-white", "Dip to white"],
  ["wipe-left", "Wipe left"],
  ["slide-left", "Slide left"],
  ["push-up", "Push up"],
  ["zoom-in", "Zoom in"],
  ["blur", "Blur"],
  ["flash", "Flash"],
];

const TABS: [string, string][] = [
  ["media", "Media"],
  ["audio", "Audio"],
  ["text", "Text"],
  ["captions", "Captions"],
  ["transitions", "Transitions"],
  ["filters", "Filters"],
  ["effects", "Effects"],
  ["stickers", "Stickers and shapes"],
  ["smart", "Shorts and beat"],
];

export function buildActions(editor: Editor): Action[] {
  const out: Action[] = [];

  for (const c of COMMANDS) {
    if (!c.run || c.id === "palette") continue;
    out.push({ id: c.id, label: c.label, group: c.group, keywords: KEYWORDS[c.id], keys: c.keys, run: (e, h) => c.run!(e, h) });
  }

  const act = (id: string, label: string, group: string, run: Action["run"], extra: Partial<Action> = {}) => out.push({ id, label, group, run, ...extra });

  // Making things
  act("add-text", "Add text", "Add", e => addTextPreset(e, "plain"), { keywords: "title caption words type" });
  for (const p of TEXT_PRESETS) if (p.id !== "plain") act(`add-text-${p.id}`, `Add text, ${p.name.toLowerCase()}`, "Add", e => addTextPreset(e, p.id), { keywords: "title" });
  for (const [kind, name] of TRANSITION_NAMES) act(`transition-${kind}`, `Add transition, ${name.toLowerCase()}`, "Add", e => addTransition(e, kind, name), { keywords: "between cut" });
  for (const [kind, label] of [["rect", "rectangle"], ["ellipse", "ellipse"], ["line", "line"]] as const) act(`shape-${kind}`, `Add ${label}`, "Add", e => void addShape(e, { kind }, "Add shape"), { keywords: "shape box circle" });
  for (const s of STICKERS) act(`sticker-${s.id}`, `Add sticker, ${s.name.toLowerCase()}`, "Stickers", e => void addShape(e, { kind: "sticker", sticker: s.id }), { keywords: s.group.toLowerCase() });

  // Smart edits
  act("captions-generate", "Generate captions", "Smart", e => generateCaptions(e), { keywords: "subtitles speech transcribe words" });
  act("silences", "Remove silences", "Smart", e => removeSilences(e), { keywords: "pauses dead air filler words um uh" });
  act("shorts", "Find shorts in a long video", "Smart", () => showRail("smart"), { keywords: "highlights clips tiktok reels vertical" });
  act("beat", "Cut to the beat", "Smart", () => showRail("smart"), { keywords: "music rhythm sync montage" });

  // Frame shape
  for (const r of RATIOS) {
    const name = r.label === "9:16" ? "Make vertical, 9:16" : r.label === "16:9" ? "Make wide, 16:9" : r.label === "1:1" ? "Make square, 1:1" : "Make portrait, 4:5";
    act(`frame-${r.label}`, name, "Frame", e => changeFrame(e, r), { keywords: `${r.label} aspect ratio shape instagram tiktok youtube shorts reels` });
  }

  // Speed on the selected clip
  for (const s of [0.5, 1.5, 2, 3]) act(`speed-${s}`, `Change speed to ${s}x`, "Speed", e => setSpeedFor(e, s), { keywords: s > 1 ? "faster fast" : "slower slow motion", enabled: hasVideoSelected });
  act("speed-1", "Normal speed", "Speed", e => setSpeedFor(e, 1), { enabled: hasVideoSelected, keywords: "reset" });
  act("detach-audio", "Detach audio from clip", "Editing", e => detachAudio(e), { enabled: hasVideoSelected, keywords: "separate extract sound" });
  act("close-gaps", "Close all gaps on the main track", "Editing", e => closeAllGapsOn(e, e.project.tracks.find(t => t.main)!.id), { keywords: "empty space" });

  // Layouts
  for (const l of LAYOUTS) act(`layout-${l.id}`, l.label, "Layout", e => setLayout(e, l.id, l.label), { enabled: hasVideoSelected, keywords: "pip split screen corner stack" });

  // Panels and tools
  for (const [id, name] of TABS) act(`show-${id}`, `Show ${name.toLowerCase()}`, "Panels", () => showRail(id), { keywords: "open tab panel" });
  for (const g of GUIDES) {
    const app = g.covered.length > 0;
    act(`guide-${g.id}`, `Safe zones, ${g.label}`, "View", () => (app ? chooseApp(g.id) : toggleGuide(g.id)), { keywords: "guides overlay title action tiktok reels shorts" });
  }

  // Markers
  editor.project.markers.forEach((m, i) => act(`marker-${m.id}`, `Go to marker, ${m.label || `${i + 1} at ${shortTime(m.t)}`}`, "Markers", e => e.seek(m.t), { keywords: "jump" }));

  return out;
}

// ---------------------------------------------------------------- recent commands

const STORE = "openroll.recent-commands";
const KEEP = 10;

export function recentIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(raw) ? raw.filter(x => typeof x === "string").slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

export function noteRecent(id: string): string[] {
  const next = [id, ...recentIds().filter(x => x !== id)].slice(0, KEEP);
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* blocked storage: recents just do not persist */
  }
  return next;
}
