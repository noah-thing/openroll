// The editing language AI tools speak. A batch of operations in seconds, applied to a
// project in one go: either every operation lands or none does, and the batch is one
// undo step. Operations can name what they create ("as") and later ones refer to it
// as "$name", so a whole edit fits in one call.

import { MIN_ITEM, addMarker, deleteItems, insertItems, isMagnetic, mediaItem, moveItem, packMain, pruneTransitions, resolveOverlap, rippleDeleteRange, setSpeed, setTrack, setTransition, split, updateItem } from "../edit";
import { EASINGS, setKey } from "../look/keyframes";
import { addEffectTo, setFilter } from "../look/edit";
import { EFFECTS } from "../look/effects";
import { FILTERS } from "../look/filters";
import {
  findItem,
  IDENTITY,
  mainTrack,
  newId,
  type Easing,
  type Item,
  type MediaItem,
  type Micros,
  type Project,
  type ShapeKind,
  type TextItem,
  type TextStyle,
  type TrackKind,
} from "../project";
import { TRANSITIONS } from "../../engine/shaders";
import { cutToBeat } from "../beat-edit";
import { repairLook, repairStyle } from "../load";
import { applyLayout, LAYOUTS, type Layout } from "../layouts";
import { newShape, placeOverlay } from "../shapes";
import { STICKERS } from "../stickers";

export type Op =
  | { op: "add_clip"; media: string; at?: number; track?: string; in?: number; duration?: number; as?: string }
  | { op: "add_text"; text: string; at: number; duration?: number; style?: Partial<TextStyle>; x?: number; y?: number; track?: string; as?: string }
  | { op: "add_color"; color: string; at: number; duration: number; track?: string; as?: string }
  | { op: "move"; id: string; at: number; track?: string }
  | { op: "trim"; id: string; in?: number; duration?: number }
  | { op: "split"; at: number; ids?: string[]; as?: string }
  | { op: "delete"; ids: string[] }
  | { op: "remove_range"; from: number; to: number }
  | { op: "set"; id: string; props: Record<string, unknown> }
  | { op: "keyframe"; id: string; prop: string; at: number; value: number; ease?: Easing }
  | { op: "transition"; id: string; kind: string | null; duration?: number }
  | { op: "filter"; id: string; filter: string | null; amount?: number }
  | { op: "effect"; id: string; kind: string; amount?: number; speed?: number; style?: number }
  | { op: "marker"; at: number; label?: string }
  | { op: "track"; id: string; muted?: boolean; hidden?: boolean; locked?: boolean; name?: string }
  | { op: "add_track"; kind: TrackKind; name?: string; as?: string }
  | { op: "project"; width?: number; height?: number; ratio?: string; fps?: number; background?: string; name?: string }
  | { op: "add_shape"; kind: ShapeKind; sticker?: string; at: number; duration?: number; color?: string; x?: number; y?: number; scale?: number; as?: string }
  | { op: "layout"; id: string; layout: Layout }
  | { op: "cut_to_beat"; clips: string[]; music: string; every?: 1 | 2 | 4; muteClips?: boolean };

export const OP_NAMES = ["add_clip", "add_text", "add_color", "move", "trim", "split", "delete", "remove_range", "set", "keyframe", "transition", "filter", "effect", "marker", "track", "add_track", "project", "add_shape", "layout", "cut_to_beat"];

export interface OpResult {
  op: string;
  id?: string;
  ids?: string[];
  /** cut_to_beat: how many clips the footage was cut into; their ids are in changed.added. */
  pieces?: number;
}

export class OpError extends Error {
  constructor(readonly index: number, message: string) {
    super(`operation ${index + 1}: ${message}`);
  }
}

const S = 1_000_000;
/** Two days. Anything longer is a unit mistake, and microseconds stop being exact long before overflow. */
const MAX_SECONDS = 172_800;
const us = (seconds: unknown, what: string): Micros => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) throw new Error(`${what} must be a number of seconds`);
  if (Math.abs(seconds) > MAX_SECONDS) throw new Error(`${what} of ${seconds} s is out of range; times are in seconds`);
  return Math.round(seconds * S);
};
/** A position on the timeline: nothing sits before zero. */
const at = (seconds: unknown, what: string): Micros => Math.max(0, us(seconds, what));
/** A length: never shorter than the smallest clip the editor allows. */
const span = (seconds: unknown, what: string): Micros => Math.max(MIN_ITEM, us(seconds, what));
const finite = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} must be a number`);
  return value;
};

/** Apply a batch. Throws OpError (with the failing index) and leaves nothing applied. */
export function applyOps(start: Project, ops: Op[]): { project: Project; results: OpResult[] } {
  let p = start;
  const names = new Map<string, string>();
  const results: OpResult[] = [];
  const ref = (id: string): string => {
    if (id.startsWith("$")) {
      const real = names.get(id.slice(1));
      if (!real) throw new Error(`nothing was named ${id} earlier in this batch`);
      return real;
    }
    return id;
  };
  const item = (id: string): Item => {
    const found = findItem(p, ref(id));
    if (!found) throw new Error(`no clip with id ${id}; ids come from get_project or an earlier result`);
    return found.item;
  };
  const trackFor = (track: string | undefined): string | undefined => {
    if (!track || track === "auto") return undefined;
    if (track === "main") return mainTrack(p).id;
    const id = ref(track);
    if (!p.tracks.some(t => t.id === id)) throw new Error(`no track with id ${track}`);
    return id;
  };

  ops.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== "object" || typeof (raw as Op).op !== "string") throw new Error("each operation needs an \"op\"");
      const o = raw as Op;
      const result: OpResult = { op: o.op };
      switch (o.op) {
        case "add_clip": {
          const media = p.media[ref(o.media)] ?? Object.values(p.media).find(m => m.path === o.media || m.name === o.media);
          if (!media) throw new Error(`no media ${o.media}; pass a media id from import_media, or an absolute file path`);
          const it = mediaItem(media, o.at === undefined ? 0 : at(o.at, "at"));
          if (o.in !== undefined) it.in = Math.max(0, us(o.in, "in"));
          if (o.duration !== undefined) it.duration = span(o.duration, "duration");
          if (media.kind !== "image") it.duration = Math.min(it.duration, media.duration - it.in);
          if (it.duration <= 0) throw new Error("in is past the end of the media");
          const trackId = trackFor(o.track);
          const audio = media.kind === "audio";
          const toMain = !audio && (o.track === undefined || o.track === "main");
          // Without a time the clip goes after what is on its lane. A main track that is not magnetic does not append on its own.
          if (o.at === undefined) it.start = Math.max(0, ...(p.tracks.find(t => t.id === (toMain ? mainTrack(p).id : trackId))?.items.map(i => i.start + i.duration) ?? []));
          p = insertItems(p, [it], toMain ? { trackId: mainTrack(p).id } : trackId ? { trackId } : {});
          result.id = it.id;
          name(o.as, it.id);
          break;
        }
        case "add_text": {
          if (typeof o.text !== "string") throw new Error("text must be a string");
          const it: TextItem = {
            id: newId("i"),
            type: "text",
            start: at(o.at, "at"),
            duration: span(o.duration ?? 3, "duration"),
            transform: { ...IDENTITY, x: o.x === undefined ? 0 : finite(o.x, "x"), y: o.y === undefined ? 0 : finite(o.y, "y") },
            style: textStyle({ text: o.text, font: "Familjen Grotesk", size: 96, weight: 700, color: "#ffffff", align: "center", lineHeight: 1.1, letterSpacing: 0 }, o.style),
            name: o.text.slice(0, 40),
          };
          const textTrack = trackFor(o.track) ?? p.tracks.find(t => t.kind === "text")?.id;
          p = insertItems(p, [it], textTrack ? { trackId: textTrack } : {});
          result.id = it.id;
          name(o.as, it.id);
          break;
        }
        case "add_color": {
          if (typeof o.color !== "string" || !o.color) throw new Error("color must be a colour such as #ff0000");
          const it: Item = { id: newId("i"), type: "color", color: o.color, start: at(o.at, "at"), duration: span(o.duration, "duration"), transform: { ...IDENTITY } };
          const trackId = trackFor(o.track);
          p = insertItems(p, [it], trackId ? { trackId } : {});
          result.id = it.id;
          name(o.as, it.id);
          break;
        }
        case "move": {
          const id = ref(o.id);
          const current = findItem(p, id)!;
          item(id);
          p = moveItem(p, id, { trackId: trackFor(o.track) ?? current.track.id, start: at(o.at, "at") });
          result.id = id;
          break;
        }
        case "trim": {
          const it = item(o.id);
          const patch: Partial<MediaItem> = {};
          if (o.in !== undefined) {
            if (it.type !== "media") throw new Error("only media clips have an in point");
            patch.in = Math.max(0, us(o.in, "in"));
          }
          if (o.duration !== undefined) patch.duration = span(o.duration, "duration");
          const media = it.type === "media" ? p.media[it.mediaId] : undefined;
          if (media && media.kind !== "image" && it.type === "media") {
            const inPoint = patch.in ?? it.in;
            const room = Math.floor((media.duration - inPoint) / it.speed);
            if (room <= 0) throw new Error("in is past the end of the media");
            patch.duration = Math.min(patch.duration ?? it.duration, room);
          }
          p = repack(updateItem(p, it.id, patch as Partial<Item>), it.id);
          result.id = it.id;
          break;
        }
        case "split": {
          const ids = o.ids?.map(ref);
          const before = new Set(p.tracks.flatMap(t => t.items.map(i => i.id)));
          const next = split(p, us(o.at, "at"), ids);
          if (next === p) throw new Error(`nothing to split at ${o.at} s`);
          p = next;
          result.ids = p.tracks.flatMap(t => t.items.map(i => i.id)).filter(id => !before.has(id));
          if (o.as && result.ids.length !== 1) throw new Error(`"as" needs a split that makes exactly one new clip, this one made ${result.ids.length}`);
          if (result.ids.length === 1) name(o.as, result.ids[0]);
          break;
        }
        case "delete": {
          const ids = o.ids.map(ref);
          for (const id of ids) item(id);
          p = deleteItems(p, ids);
          break;
        }
        case "remove_range":
          p = rippleDeleteRange(p, us(o.from, "from"), us(o.to, "to"));
          break;
        case "set": {
          const it = item(o.id);
          p = setProps(p, it, o.props ?? {});
          result.id = it.id;
          break;
        }
        case "keyframe": {
          const it = item(o.id);
          const local = us(o.at, "at") - it.start;
          if (local < 0 || local > it.duration) throw new Error(`${o.at} s is outside the clip`);
          if (o.ease !== undefined && !EASINGS.some(e => e.value === o.ease)) throw new Error(`ease is one of ${EASINGS.map(e => e.value).join(", ")}`);
          if (typeof o.prop !== "string" || !/^[A-Za-z][\w.:-]*$/.test(o.prop) || o.prop.includes("__proto__")) throw new Error("prop is a path like transform.scale");
          p = updateItem(p, it.id, { keyframes: setKey(it.keyframes, o.prop, local, finite(o.value, "value"), o.ease ?? "ease") });
          result.id = it.id;
          break;
        }
        case "transition": {
          const it = item(o.id);
          if (o.kind && !TRANSITIONS.includes(o.kind as never)) throw new Error(`unknown transition ${o.kind}; see the catalog`);
          const next = setTransition(p, it.id, o.kind, us(o.duration ?? 0.5, "duration"));
          if (next === p && o.kind) throw new Error("a transition needs the clip to start exactly where the previous one ends");
          p = next;
          result.id = it.id;
          break;
        }
        case "filter": {
          const it = item(o.id);
          if (o.filter && !FILTERS.some(f => f.id === o.filter) && !(p as Project & { luts?: Record<string, unknown> }).luts?.[o.filter]) throw new Error(`unknown filter ${o.filter}; see the catalog`);
          p = setFilter(p, it.id, o.filter, o.amount === undefined ? 1 : finite(o.amount, "amount"));
          result.id = it.id;
          break;
        }
        case "effect": {
          const it = item(o.id);
          if (!EFFECTS.some(e => e.kind === o.kind && !e.internal)) throw new Error(`unknown effect ${o.kind}; see the catalog`);
          const added = addEffectTo(p, it.id, o.kind);
          if (!added.effect) throw new Error("effects only go on video and image clips");
          p = added.project;
          const params: Record<string, number> = { ...added.effect.params };
          if (o.speed !== undefined) params.speed = finite(o.speed, "speed");
          if (o.style !== undefined) params.style = finite(o.style, "style");
          p = updateItem(p, it.id, {
            effects: (findItem(p, it.id)!.item as MediaItem).effects!.map(e => (e.id === added.effect!.id ? { ...e, amount: o.amount === undefined ? e.amount : finite(o.amount, "amount"), params } : e)),
          } as Partial<Item>);
          result.id = added.effect.id;
          break;
        }
        case "marker":
          p = addMarker(p, at(o.at, "at"), o.label);
          break;
        case "track": {
          const id = trackFor(o.id);
          if (!id) throw new Error("track needs an id");
          const patch: Parameters<typeof setTrack>[2] = {};
          for (const key of ["muted", "hidden", "locked"] as const) {
            if (o[key] === undefined) continue;
            if (typeof o[key] !== "boolean") throw new Error(`${key} must be true or false`);
            patch[key] = o[key];
          }
          if (o.name !== undefined) {
            if (typeof o.name !== "string" || !o.name.trim()) throw new Error("name must be some text");
            patch.name = o.name.trim();
          }
          p = setTrack(p, id, patch);
          break;
        }
        case "add_track": {
          if (!["video", "audio", "text"].includes(o.kind)) throw new Error("kind is video, audio or text");
          const id = newId("t");
          p = { ...p, tracks: [...p.tracks] };
          const track = { id, kind: o.kind, name: o.name ?? (o.kind === "audio" ? "Audio" : o.kind === "text" ? "Text" : "Overlay"), items: [], pinned: true };
          const mainIndex = p.tracks.findIndex(t => t.main);
          if (o.kind === "audio") p.tracks.push(track);
          else p.tracks.splice(Math.max(0, mainIndex), 0, track);
          result.id = id;
          name(o.as, id);
          break;
        }
        case "project":
          p = setProject(p, o);
          break;
        case "add_shape": {
          if (!["rect", "ellipse", "line", "sticker"].includes(o.kind)) throw new Error("kind is rect, ellipse, line or sticker");
          if (o.kind === "sticker" && !STICKERS.some(st => st.id === o.sticker)) throw new Error(`unknown sticker ${o.sticker}; see the catalog`);
          const shape = newShape(p, at(o.at, "at"), { kind: o.kind, sticker: o.sticker, ...(o.color ? { color: o.color } : {}) });
          shape.duration = span(o.duration ?? 3, "duration");
          shape.transform = {
            ...shape.transform,
            x: o.x === undefined ? shape.transform.x : finite(o.x, "x"),
            y: o.y === undefined ? shape.transform.y : finite(o.y, "y"),
            scale: o.scale === undefined ? shape.transform.scale : finite(o.scale, "scale"),
          };
          p = placeOverlay(p, shape);
          result.id = shape.id;
          name(o.as, shape.id);
          break;
        }
        case "layout": {
          const it = item(o.id);
          if (it.type !== "media") throw new Error("layouts apply to video and image clips");
          if (!LAYOUTS.some(l => l.id === o.layout)) throw new Error(`layout is one of ${LAYOUTS.map(l => l.id).join(", ")}`);
          // Same as the menu: animated position is cleared, otherwise it would override the layout.
          const placed = applyLayout(p, it.id, o.layout);
          if (placed === p) throw new Error("layouts apply to video and image clips");
          p = placed;
          result.id = it.id;
          break;
        }
        case "cut_to_beat": {
          if (o.every !== undefined && ![1, 2, 4].includes(o.every)) throw new Error("every is 1, 2 or 4");
          const music = item(o.music);
          if (music.type !== "media" || !p.media[music.mediaId]?.beats?.length) throw new Error("the music needs beats; call analyze_media on it first");
          const r = cutToBeat(p, o.clips.map(ref), music.id, o.every ?? 2, o.muteClips ?? true);
          if (!r.pieces) throw new Error("nothing to cut; pass video clips and a music clip with beats");
          p = r.project;
          result.pieces = r.pieces;
          break;
        }
        default:
          throw new Error(`unknown op ${(o as { op: string }).op}. Operations: ${OP_NAMES.join(", ")}`);
      }
      results.push(result);
    } catch (err) {
      throw new OpError(index, (err as Error).message);
    }
  });
  return { project: p, results };

  function name(as: string | undefined, id: string): void {
    if (!as) return;
    if (!/^[\w-]+$/.test(as)) throw new Error(`"as" names use letters, digits, _ and -`);
    if (names.has(as)) throw new Error(`"${as}" already names something earlier in this batch`);
    names.set(as, id);
  }
}

/** After a length change made through updateItem: keep the track packed or clear of neighbours, and the transitions legal. */
function repack(p: Project, id: string): Project {
  if (!findItem(p, id)) return p;
  const next = structuredClone(p);
  const { track, item } = findItem(next, id)!;
  if (isMagnetic(track)) packMain(track);
  else resolveOverlap(next, track, item);
  pruneTransitions(next);
  return next;
}

const TIME_PROPS = new Set(["fadeIn", "fadeOut"]);
const TRANSFORM_PROPS = new Set(["x", "y", "scale", "rotation", "opacity"]);
const PLAIN_PROPS = new Set([
  "reversed", "freeze", "blend", "adjust", "mask", "chroma", "crop", "curves", "hsl", "fill", "cutout", "stabilize", "enhance",
  "slowMotion", "motionBlur", "audio", "voiceFx", "muteAudio", "name", "color", "highlight",
]);

/** Friendly property names for `set`, in seconds where they are times. */
function setProps(p: Project, it: Item, props: Record<string, unknown>): Project {
  const patch: Record<string, unknown> = {};
  const transform = { ...it.transform };
  let transformTouched = false;
  let speed: number | undefined;
  for (const [key, value] of Object.entries(props)) {
    if (TRANSFORM_PROPS.has(key)) {
      (transform as Record<string, number>)[key] = finite(value, key);
      transformTouched = true;
    } else if (TIME_PROPS.has(key)) {
      patch[key] = Math.max(0, us(value, key));
    } else if (key === "volume") {
      patch[key] = Math.min(100, Math.max(0, finite(value, key)));
    } else if (key === "speed") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("speed must be above 0");
      speed = value;
    } else if (key === "animationIn" || key === "animationOut") {
      if (value === null) patch[key] = undefined;
      else {
        const v = value as { kind?: unknown; duration?: unknown };
        if (typeof v?.kind !== "string") throw new Error(`${key} needs a kind`);
        patch[key] = { kind: v.kind, duration: Math.max(0, us(v.duration ?? 0.5, `${key}.duration`)) };
      }
    } else if (key === "text" || key === "style") {
      if (it.type !== "text" && it.type !== "caption") throw new Error(`${key} only applies to text`);
      patch.style = textStyle(it.style, key === "text" ? { text: String(value) } : value);
    } else if (PLAIN_PROPS.has(key)) {
      if (value !== null && !plainValueOk(key, value)) throw new Error(`${key} does not accept ${JSON.stringify(value)?.slice(0, 60)}; see the catalog for its fields`);
      patch[key] = value === null ? undefined : value;
    } else {
      throw new Error(`unknown property ${key}. Allowed: ${[...TRANSFORM_PROPS, ...TIME_PROPS, "volume", ...PLAIN_PROPS, "speed", "text", "style", "animationIn", "animationOut"].join(", ")}`);
    }
  }
  if (transformTouched) patch.transform = transform;
  let next = Object.keys(patch).length ? updateItem(p, it.id, patch as Partial<Item>) : p;
  if (speed !== undefined) {
    if (it.type !== "media") throw new Error("speed only applies to media clips");
    next = setSpeed(next, it.id, speed);
  }
  return next;
}

/** Text style with the caller's fields on top, refused when a field has the wrong type or range. */
function textStyle(base: TextStyle, over: unknown): TextStyle {
  if (over === undefined || over === null) return base;
  if (typeof over !== "object" || Array.isArray(over)) throw new Error("style must be an object of style fields");
  const merged = { ...base, ...over } as Record<string, unknown>;
  const clean = repairStyle(merged);
  const bad = Object.keys(clean).find(k => JSON.stringify(clean[k]) !== JSON.stringify(merged[k]));
  if (bad) throw new Error(`style.${bad} does not accept ${JSON.stringify(merged[bad])?.slice(0, 60)}`);
  return merged as unknown as TextStyle;
}

/** Whether a look or flag field holds something the compositor can read. */
function plainValueOk(key: string, value: unknown): boolean {
  if (key === "name" || key === "color" || key === "highlight") return typeof value === "string";
  const probe: Record<string, unknown> = { [key]: value };
  repairLook(probe);
  return key in probe;
}

const RATIOS: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "4:3": [1440, 1080], "21:9": [2560, 1080] };

function setProject(p: Project, o: Extract<Op, { op: "project" }>): Project {
  const settings = { ...p.settings };
  if (o.ratio) {
    const r = RATIOS[o.ratio];
    if (!r) throw new Error(`ratio must be one of ${Object.keys(RATIOS).join(", ")}`);
    [settings.width, settings.height] = r;
  }
  for (const key of ["width", "height"] as const) {
    const size = o[key];
    if (size === undefined) continue;
    if (typeof size !== "number" || !(size >= 16 && size <= 8192)) throw new Error(`${key} is a number of pixels between 16 and 8192`);
    settings[key] = Math.round(size / 2) * 2;
  }
  if (o.fps !== undefined) {
    if (typeof o.fps !== "number" || !(o.fps >= 1 && o.fps <= 240)) throw new Error("fps is between 1 and 240");
    settings.fps = Number.isInteger(o.fps) ? { num: o.fps, den: 1 } : { num: Math.round(o.fps * 1001), den: 1001 };
  }
  if (o.background) {
    if (!/^#[0-9a-f]{6}$/i.test(o.background)) throw new Error("background must be #rrggbb");
    settings.background = o.background;
  }
  return { ...p, name: o.name?.trim() || p.name, settings, modified: Date.now() };
}

