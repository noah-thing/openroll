// Turns the text of a project file into a Project the editor can trust. Files come from
// disk, from older or newer builds and from people with a text editor, so nothing here
// assumes a field exists. What can be repaired is repaired and listed; what cannot is refused.

import { IDENTITY, newId, type Item, type MediaKind, type MediaRef, type Project, type Track } from "./project";

export const CURRENT_VERSION = 1;

export type LoadResult = { ok: true; project: Project; repairs: string[] } | { ok: false; error: string };

type Obj = Record<string, unknown>;

/** Steps from version N to N + 1. Add one here whenever the saved shape changes. */
const MIGRATIONS: Record<number, (doc: Obj) => Obj> = {};

const KINDS: MediaKind[] = ["video", "audio", "image"];
const TRACK_KINDS = ["video", "audio", "text"];
const ITEM_TYPES = ["media", "text", "caption", "color", "shape"];
const SAFE_ID = /^\w[\w.-]{0,79}$/;
/** Ten hours in microseconds. Past any real edit; a larger number is a typo or an attempt to stall the renderer. */
const MAX_TIME = 36_000 * 1_000_000;
const clampTime = (v: number) => Math.min(MAX_TIME, Math.max(0, Math.round(v)));

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function readProject(text: string): LoadResult {
  const body = text.replace(/^﻿/, "");
  if (!body.trim()) return { ok: false, error: "The file is empty." };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, error: "The file is damaged. It ends early or has characters that do not belong." };
  }
  if (!isObj(raw) || raw.format !== "openroll") return { ok: false, error: "This is not an OpenRoll project." };

  const repairs: string[] = [];
  let version = raw.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    repairs.push("version");
    version = 1;
  }
  if ((version as number) > CURRENT_VERSION) {
    return { ok: false, error: "This project was made with a newer version of OpenRoll. Update OpenRoll to open it." };
  }
  let doc: Obj = raw;
  for (let v = version as number; v < CURRENT_VERSION; v++) doc = MIGRATIONS[v]?.(doc) ?? doc;

  const media = repairMedia(doc.media, repairs);
  const tracks = repairTracks(doc.tracks, media, repairs);
  const now = Date.now();
  const project = {
    ...doc,
    format: "openroll",
    version: CURRENT_VERSION,
    id: typeof doc.id === "string" && SAFE_ID.test(doc.id) ? doc.id : fix(repairs, "id", newId("p")),
    name: typeof doc.name === "string" && doc.name.trim() ? doc.name : fix(repairs, "name", "Untitled"),
    created: num(doc.created) ? doc.created : fix(repairs, "created", now),
    modified: num(doc.modified) ? doc.modified : fix(repairs, "modified", now),
    settings: repairSettings(doc.settings, repairs),
    media,
    tracks,
    markers: repairMarkers(doc.markers, repairs),
  } as unknown as Project;
  if (doc.luts !== undefined && !isObj(doc.luts)) {
    delete project.luts;
    repairs.push("luts");
  }
  return { ok: true, project, repairs };
}

function fix<T>(repairs: string[], what: string, value: T): T {
  repairs.push(what);
  return value;
}

function repairSettings(raw: unknown, repairs: string[]): Project["settings"] {
  const s = isObj(raw) ? raw : {};
  const size = (v: unknown, fallback: number) => (num(v) && v >= 2 && v <= 16384 ? Math.round(v) : fix(repairs, "frame size", fallback));
  const fps =
    isObj(s.fps) && num(s.fps.num) && num(s.fps.den) && Math.round(s.fps.num) > 0 && Math.round(s.fps.den) > 0
      ? { num: Math.round(s.fps.num), den: Math.round(s.fps.den) }
      : fix(repairs, "frame rate", { num: 30, den: 1 });
  return {
    ...s,
    width: size(s.width, 1920),
    height: size(s.height, 1080),
    fps,
    sampleRate: num(s.sampleRate) && s.sampleRate >= 8000 && s.sampleRate <= 384_000 ? Math.round(s.sampleRate) : fix(repairs, "sample rate", 48_000),
    background: typeof s.background === "string" && /^#[0-9a-f]{6}$/i.test(s.background) ? s.background : fix(repairs, "background", "#000000"),
  };
}

function repairMedia(raw: unknown, repairs: string[]): Record<string, MediaRef> {
  const out: Record<string, MediaRef> = {};
  if (raw !== undefined && !isObj(raw)) repairs.push("media");
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    // `out["__proto__"] = v` would swap the map's prototype instead of adding a key.
    if (id === "__proto__") {
      repairs.push("media id");
      continue;
    }
    if (!isObj(v)) {
      repairs.push(`media ${id}`);
      continue;
    }
    const path = typeof v.path === "string" ? v.path : "";
    const kind = KINDS.includes(v.kind as MediaKind) ? (v.kind as MediaKind) : "video";
    out[id] = {
      ...v,
      id,
      kind,
      path,
      name: typeof v.name === "string" ? v.name : path.replace(/^.*[\\/]/, "") || id,
      size: num(v.size) ? v.size : 0,
      mtime: num(v.mtime) ? v.mtime : 0,
      duration: num(v.duration) && v.duration >= 0 ? clampTime(v.duration) : 0,
      hasAudio: typeof v.hasAudio === "boolean" ? v.hasAudio : kind === "audio",
      hasVideo: typeof v.hasVideo === "boolean" ? v.hasVideo : kind !== "audio",
    } as MediaRef;
    if (typeof v.path !== "string" || v.kind !== kind || !num(v.duration) || typeof v.hasAudio !== "boolean") repairs.push(`media ${id}`);
  }
  return out;
}

function repairTracks(raw: unknown, media: Record<string, MediaRef>, repairs: string[]): Track[] {
  const seen = new Set<string>();
  const unique = (id: unknown, prefix: string): string => {
    const out = typeof id === "string" && id && !seen.has(id) ? id : fix(repairs, "ids", newId(prefix));
    seen.add(out);
    return out;
  };
  if (!Array.isArray(raw)) repairs.push("tracks");
  const tracks: Track[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!isObj(t)) {
      repairs.push("track");
      continue;
    }
    const items: Item[] = [];
    for (const it of Array.isArray(t.items) ? t.items : []) {
      const item = repairItem(it, media, repairs);
      if (item) items.push({ ...item, id: unique(item.id, "i") });
    }
    tracks.push({
      ...t,
      id: unique(t.id, "t"),
      kind: TRACK_KINDS.includes(t.kind as string) ? (t.kind as Track["kind"]) : fix(repairs, "track kind", "video"),
      name: typeof t.name === "string" ? t.name : "Track",
      items,
    } as Track);
  }
  // Everything that edits a project assumes exactly one main track.
  const mains = tracks.filter(t => t.main);
  if (!mains.length) {
    const first = tracks.find(t => t.kind === "video");
    if (first) first.main = true;
    else tracks.unshift({ id: unique(undefined, "t"), kind: "video", name: "Main", main: true, items: [] });
    repairs.push("main track");
  }
  for (const extra of mains.slice(1)) {
    delete extra.main;
    repairs.push("main track");
  }
  return tracks;
}

function repairItem(raw: unknown, media: Record<string, MediaRef>, repairs: string[]): Item | null {
  const drop = (): null => (repairs.push("clip dropped"), null);
  if (!isObj(raw) || !ITEM_TYPES.includes(raw.type as string) || !num(raw.start) || !num(raw.duration) || raw.duration < 1) return drop();
  const base = {
    ...raw,
    start: clampTime(raw.start),
    duration: Math.min(MAX_TIME, Math.round(raw.duration)),
    transform: { ...IDENTITY, ...(isObj(raw.transform) ? raw.transform : {}) },
  };
  switch (raw.type) {
    case "media":
      if (typeof raw.mediaId !== "string" || !Object.hasOwn(media, raw.mediaId)) return drop();
      return {
        ...base,
        in: num(raw.in) && raw.in >= 0 ? clampTime(raw.in) : 0,
        speed: num(raw.speed) && raw.speed > 0 ? raw.speed : 1,
        volume: num(raw.volume) && raw.volume >= 0 ? raw.volume : 1,
        fadeIn: num(raw.fadeIn) ? raw.fadeIn : 0,
        fadeOut: num(raw.fadeOut) ? raw.fadeOut : 0,
      } as unknown as Item;
    case "text":
    case "caption":
      if (!isObj(raw.style) || typeof raw.style.text !== "string") return drop();
      return (raw.type === "caption" ? { ...base, words: Array.isArray(raw.words) ? raw.words : [] } : base) as unknown as Item;
    case "color":
      return { ...base, color: typeof raw.color === "string" ? raw.color : "#000000" } as unknown as Item;
    default:
      if (!isObj(raw.shape) || !num(raw.width) || !num(raw.height)) return drop();
      return base as unknown as Item;
  }
}

function repairMarkers(raw: unknown, repairs: string[]): Project["markers"] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) repairs.push("markers");
    return [];
  }
  const out = raw.filter(m => isObj(m) && num(m.t) && typeof m.id === "string") as unknown as Project["markers"];
  if (out.length !== raw.length) repairs.push("markers");
  return out;
}
