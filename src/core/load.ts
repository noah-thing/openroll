// Turns the text of a project file into a Project the editor can trust. Files come from
// disk, from older or newer builds and from people with a text editor, so nothing here
// assumes a field exists. What can be repaired is repaired and listed; what cannot is refused.

import { IDENTITY, newId, type Item, type MediaKind, type MediaRef, type Project, type Track, type Transform } from "./project";

export const CURRENT_VERSION = 1;

export type LoadResult = { ok: true; project: Project; repairs: string[] } | { ok: false; error: string };

type Obj = Record<string, unknown>;

/** Steps from version N to N + 1. Add one here whenever the saved shape changes. */
const MIGRATIONS: Record<number, (doc: Obj) => Obj> = {};

const KINDS: MediaKind[] = ["video", "audio", "image"];
const TRACK_KINDS = ["video", "audio", "text"];
const ITEM_TYPES = ["media", "text", "caption", "color", "shape"];
const SAFE_ID = /^[\w.-]{1,80}$/;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const between = (v: unknown, lo: number, hi: number): v is number => num(v) && v >= lo && v <= hi;
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
/** Later than this is a typo or an attack, not a timeline (about 11 days). */
const MAX_TIME = 1e12;

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
  // A rate outside this range rounds the frame length to zero or to minutes, and every frame loop stalls on it.
  const fps =
    isObj(s.fps) && num(s.fps.num) && num(s.fps.den) && Math.round(s.fps.num) > 0 && Math.round(s.fps.den) > 0 && between(Math.round(s.fps.num) / Math.round(s.fps.den), 1, 480)
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
    if (id === "__proto__" || !isObj(v)) {
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
      duration: between(v.duration, 0, MAX_TIME) ? Math.round(v.duration) : 0,
      hasAudio: typeof v.hasAudio === "boolean" ? v.hasAudio : kind === "audio",
      hasVideo: typeof v.hasVideo === "boolean" ? v.hasVideo : kind !== "audio",
    } as MediaRef;
    cleanMediaExtras(out[id], repairs);
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
    const track = {
      ...t,
      id: unique(t.id, "t"),
      kind: TRACK_KINDS.includes(t.kind as string) ? (t.kind as Track["kind"]) : fix(repairs, "track kind", "video"),
      name: typeof t.name === "string" ? t.name : "Track",
      items,
    } as Track;
    for (const flag of ["main", "magnetic", "pinned", "muted", "hidden", "locked"] as const) if (flag in track && typeof track[flag] !== "boolean") delete track[flag];
    if ("height" in track && !between(track.height, 8, 2000)) delete track.height;
    tracks.push(track);
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
  return tracks.flatMap(t => settleTrack(t, repairs, unique));
}

/** Puts a track's items in time order with nothing overlapping, which the scene and every edit rely on. Clips that collide move to an extra lane below, never away. */
function settleTrack(track: Track, repairs: string[], unique: (id: unknown, prefix: string) => string): Track[] {
  const sorted = track.items.every((it, i) => !i || track.items[i - 1].start <= it.start) ? track.items : fix(repairs, "clip order", [...track.items].sort((a, b) => a.start - b.start));
  let lanes: Item[][];
  if (track.main && track.magnetic !== false) {
    let t = 0;
    lanes = [
      sorted.map(it => {
        const placed = it.start === t ? it : fix(repairs, "clip position", { ...it, start: t });
        t += it.duration;
        return placed;
      }),
    ];
  } else {
    lanes = [];
    const ends: number[] = [];
    for (const it of sorted) {
      let lane = ends.findIndex(e => e <= it.start);
      if (lane < 0) lane = ends.push(0) - 1;
      if (lane > 0) repairs.push("overlap");
      (lanes[lane] ??= []).push(it);
      ends[lane] = it.start + it.duration;
    }
    if (!lanes.length) lanes = [[]];
  }
  return lanes.map((items, i) => {
    // A transition only works where the clip before it ends exactly where this one starts, and cannot be longer than half of either.
    const fitted = items.map((it, k) => {
      if (!it.transitionIn) return it;
      const prev = items[k - 1];
      const room = prev && prev.start + prev.duration === it.start ? Math.floor(Math.min(prev.duration, it.duration) / 2) : 0;
      if (it.transitionIn.duration <= room) return it;
      repairs.push("transition");
      const { transitionIn: _drop, ...rest } = it;
      return room >= 1 ? ({ ...rest, transitionIn: { ...it.transitionIn, duration: room } } as Item) : (rest as Item);
    });
    if (i === 0) return { ...track, items: fitted };
    const { main: _m, ...base } = track;
    return { ...base, id: unique(undefined, "t"), name: `${track.name} ${i + 1}`, items: fitted };
  });
}

const EASES = ["linear", "ease", "easeIn", "easeOut", "hold"];
const BLENDS = ["normal", "screen", "multiply", "overlay", "add", "lighten", "darken"];
const VOICE_FX = ["pitchUp", "pitchDown", "robot", "radio", "echo", "bigRoom"];
const SHAPE_KINDS = ["rect", "ellipse", "line", "sticker"];
const MASK_SHAPES = ["rect", "ellipse", "linear", "mirror"];
const ALIGNS = ["left", "center", "right"];

/** True when `raw` is an object whose listed fields are all finite numbers. */
function hasNumbers(raw: unknown, keys: string[]): raw is Obj {
  return isObj(raw) && keys.every(k => num(raw[k]));
}

function cleanMediaExtras(m: MediaRef, repairs: string[]): void {
  const x = m as unknown as Obj;
  const drop = (k: string) => {
    delete x[k];
    repairs.push(`media ${m.id}`);
  };
  for (const k of ["width", "height"]) if (k in x && !between(x[k], 1, 65_536)) drop(k);
  if ("fps" in x && !between(x.fps, 0.1, 1000)) drop("fps");
  if ("rotation" in x && ![0, 90, 180, 270].includes(x.rotation as number)) drop("rotation");
  for (const k of ["beats", "speech"]) if (k in x && !(Array.isArray(x[k]) && (x[k] as unknown[]).every(num))) drop(k);
  for (const k of ["bpm", "loudness", "sampleRate", "channels"]) if (k in x && !num(x[k])) drop(k);
}

function repairKeyframes(raw: unknown): Item["keyframes"] {
  if (!isObj(raw)) return undefined;
  const out: NonNullable<Item["keyframes"]> = {};
  for (const [path, list] of Object.entries(raw)) {
    if (path === "__proto__" || !Array.isArray(list)) continue;
    const keys = list
      .filter((k): k is Obj => isObj(k) && between(k.t, -MAX_TIME, MAX_TIME) && num(k.v))
      .map(k => ({ ...k, t: k.t as number, v: k.v as number, ease: EASES.includes(k.ease as string) ? (k.ease as "linear") : ("linear" as const) }));
    if (keys.length) out[path] = keys.sort((a, b) => a.t - b.t);
  }
  return Object.keys(out).length ? out : undefined;
}

function repairStyle(raw: Obj): Obj {
  const out: Obj = {
    ...raw,
    font: str(raw.font, "Familjen Grotesk"),
    size: between(raw.size, 1, 4000) ? raw.size : 96,
    weight: between(raw.weight, 1, 1000) ? raw.weight : 700,
    color: str(raw.color, "#ffffff"),
    align: ALIGNS.includes(raw.align as string) ? raw.align : "center",
    lineHeight: between(raw.lineHeight, 0.1, 10) ? raw.lineHeight : 1.1,
    letterSpacing: between(raw.letterSpacing, -1000, 1000) ? raw.letterSpacing : 0,
  };
  const colored = (k: string, keys: string[]) => {
    if (k in out && !(hasNumbers(out[k], keys) && typeof (out[k] as Obj).color === "string")) delete out[k];
  };
  colored("stroke", ["width"]);
  colored("shadow", ["blur", "x", "y"]);
  colored("background", ["padding", "radius"]);
  return out;
}

function repairItem(raw: unknown, media: Record<string, MediaRef>, repairs: string[]): Item | null {
  const drop = (): null => (repairs.push("clip dropped"), null);
  if (!isObj(raw) || !ITEM_TYPES.includes(raw.type as string) || !between(raw.start, -MAX_TIME, MAX_TIME) || !between(raw.duration, 1, MAX_TIME)) return drop();
  const tf: Obj = isObj(raw.transform) ? raw.transform : {};
  const transform = { ...IDENTITY } as Transform;
  for (const k of Object.keys(IDENTITY) as (keyof Transform)[]) if (num(tf[k])) transform[k] = tf[k] as number;
  const base: Obj = { ...raw, start: Math.max(0, Math.round(raw.start)), duration: Math.round(raw.duration), transform: { ...tf, ...transform } };
  const keyframes = repairKeyframes(raw.keyframes);
  if (keyframes) base.keyframes = keyframes;
  else delete base.keyframes;
  const ti = raw.transitionIn;
  if (!(isObj(ti) && typeof ti.kind === "string" && between(ti.duration, 1, MAX_TIME))) delete base.transitionIn;
  for (const k of ["animationIn", "animationOut"]) {
    const a = raw[k];
    if (!(isObj(a) && typeof a.kind === "string" && between(a.duration, 0, MAX_TIME))) delete base[k];
  }
  for (const k of ["name", "color"]) if (k in base && typeof base[k] !== "string") delete base[k];

  let item: Obj;
  switch (raw.type) {
    case "media":
      if (typeof raw.mediaId !== "string" || !media[raw.mediaId]) return drop();
      item = {
        ...base,
        in: between(raw.in, 0, MAX_TIME) ? Math.round(raw.in) : 0,
        speed: between(raw.speed, 0.1, 100) ? raw.speed : 1,
        volume: between(raw.volume, 0, 100) ? raw.volume : 1,
        fadeIn: between(raw.fadeIn, 0, MAX_TIME) ? raw.fadeIn : 0,
        fadeOut: between(raw.fadeOut, 0, MAX_TIME) ? raw.fadeOut : 0,
      };
      repairLook(item);
      break;
    case "text":
    case "caption":
      if (!isObj(raw.style) || typeof raw.style.text !== "string") return drop();
      item = { ...base, style: repairStyle(raw.style) };
      if (raw.type === "caption") {
        const span = item.duration as number;
        let at = 0;
        item.words = (Array.isArray(raw.words) ? raw.words : [])
          .filter((w): w is Obj => isObj(w) && typeof w.text === "string" && num(w.start) && num(w.end))
          .sort((a, b) => (a.start as number) - (b.start as number))
          .map(w => {
            const start = Math.min(span, Math.max(at, Math.round(w.start as number)));
            at = start;
            return { ...w, start, end: Math.min(span, Math.max(start, Math.round(w.end as number))) };
          });
      }
      break;
    case "color":
      item = { ...base, color: typeof raw.color === "string" ? raw.color : "#000000" };
      break;
    default: {
      const s = raw.shape;
      if (!isObj(s) || !SHAPE_KINDS.includes(s.kind as string) || !between(raw.width, 1, 100_000) || !between(raw.height, 1, 100_000)) return drop();
      item = { ...base, shape: { ...s, color: str(s.color, "#ffffff") } };
    }
  }
  if (JSON.stringify(item) !== JSON.stringify(raw)) repairs.push("clip");
  return item as unknown as Item;
}

/** Drops look settings the compositor could not read, so a damaged clip shows plain instead of failing. */
function repairLook(item: Obj): void {
  const keep = (k: string, ok: boolean) => {
    if (k in item && !ok) delete item[k];
  };
  for (const k of ["reversed", "freeze", "cutout", "muteAudio"]) keep(k, typeof item[k] === "boolean");
  keep("link", typeof item.link === "string");
  keep("blend", BLENDS.includes(item.blend as string));
  keep("voiceFx", VOICE_FX.includes(item.voiceFx as string));
  keep("slowMotion", item.slowMotion === "blend" || item.slowMotion === "flow");
  keep("crop", hasNumbers(item.crop, ["left", "top", "right", "bottom"]));
  if ("adjust" in item) {
    const a = item.adjust;
    if (isObj(a)) item.adjust = Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== "__proto__" && num(v)));
    else delete item.adjust;
  }
  keep("filter", hasNumbers(item.filter, ["amount"]) && typeof (item.filter as Obj).id === "string");
  if ("effects" in item) {
    const list = Array.isArray(item.effects) ? item.effects.filter((e): e is Obj => isObj(e) && typeof e.id === "string" && typeof e.kind === "string" && num(e.amount)) : [];
    if (list.length) item.effects = list;
    else delete item.effects;
  }
  keep("mask", hasNumbers(item.mask, ["x", "y", "width", "height", "rotation", "feather"]) && MASK_SHAPES.includes((item.mask as Obj).shape as string));
  keep("chroma", hasNumbers(item.chroma, ["similarity", "smoothness", "spill"]) && typeof (item.chroma as Obj).color === "string");
  keep("fill", isObj(item.fill) && (item.fill.mode === "blur" || item.fill.mode === "color"));
  keep("stabilize", hasNumbers(item.stabilize, ["strength"]));
  keep("enhance", hasNumbers(item.enhance, ["amount"]));
  keep("motionBlur", hasNumbers(item.motionBlur, ["amount"]));
  keep("audio", isObj(item.audio));
  keep("curves", isObj(item.curves) && Object.values(item.curves).every(c => Array.isArray(c) && c.every(pt => hasNumbers(pt, ["x", "y"]))));
  keep("hsl", isObj(item.hsl) && Object.values(item.hsl).every(b => hasNumbers(b, ["hue", "sat", "light"])));
}

function repairMarkers(raw: unknown, repairs: string[]): Project["markers"] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) repairs.push("markers");
    return [];
  }
  const out = raw.filter(m => isObj(m) && between(m.t, 0, MAX_TIME) && typeof m.id === "string") as unknown as Project["markers"];
  if (out.length !== raw.length) repairs.push("markers");
  return out;
}
