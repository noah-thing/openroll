// The editing language AI tools speak. A batch of operations in seconds, applied to a
// project in one go: either every operation lands or none does, and the batch is one
// undo step. Operations can name what they create ("as") and later ones refer to it
// as "$name", so a whole edit fits in one call.

import { addMarker, deleteItems, insertItems, mediaItem, moveItem, rippleDeleteRange, setSpeed, setTrack, setTransition, split, updateItem } from "../edit";
import { setKey } from "../look/keyframes";
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
  type TextItem,
  type TextStyle,
  type TrackKind,
} from "../project";
import { TRANSITIONS } from "../../engine/shaders";

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
  | { op: "project"; width?: number; height?: number; ratio?: string; fps?: number; background?: string; name?: string };

export interface OpResult {
  op: string;
  id?: string;
  ids?: string[];
}

export class OpError extends Error {
  constructor(readonly index: number, message: string) {
    super(`operation ${index + 1}: ${message}`);
  }
}

const S = 1_000_000;
const us = (seconds: unknown, what: string): Micros => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) throw new Error(`${what} must be a number of seconds`);
  return Math.round(seconds * S);
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
    if (!found) throw new Error(`no clip with id ${id}`);
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
          if (!media) throw new Error(`no media ${o.media}; import it first`);
          const it = mediaItem(media, o.at === undefined ? Number.MAX_SAFE_INTEGER : us(o.at, "at"));
          if (o.in !== undefined) it.in = Math.max(0, us(o.in, "in"));
          if (o.duration !== undefined) it.duration = Math.max(100_000, us(o.duration, "duration"));
          if (media.kind !== "image") it.duration = Math.min(it.duration, media.duration - it.in);
          if (it.duration <= 0) throw new Error("in is past the end of the media");
          const trackId = trackFor(o.track);
          const audio = media.kind === "audio";
          const toMain = !audio && (o.track === undefined || o.track === "main");
          if (toMain && o.at === undefined) it.start = Number.MAX_SAFE_INTEGER;
          p = insertItems(p, [it], toMain ? { trackId: mainTrack(p).id } : trackId ? { trackId } : {});
          result.id = it.id;
          name(o.as, it.id);
          break;
        }
        case "add_text": {
          const it: TextItem = {
            id: newId("i"),
            type: "text",
            start: us(o.at, "at"),
            duration: us(o.duration ?? 3, "duration"),
            transform: { ...IDENTITY, x: o.x ?? 0, y: o.y ?? 0 },
            style: { text: o.text, font: "Familjen Grotesk", size: 96, weight: 700, color: "#ffffff", align: "center", lineHeight: 1.1, letterSpacing: 0, ...o.style },
            name: o.text.slice(0, 40),
          };
          const textTrack = trackFor(o.track) ?? p.tracks.find(t => t.kind === "text")?.id;
          p = insertItems(p, [it], textTrack ? { trackId: textTrack } : {});
          result.id = it.id;
          name(o.as, it.id);
          break;
        }
        case "add_color": {
          const it: Item = { id: newId("i"), type: "color", color: o.color, start: us(o.at, "at"), duration: us(o.duration, "duration"), transform: { ...IDENTITY } };
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
          p = moveItem(p, id, { trackId: trackFor(o.track) ?? current.track.id, start: us(o.at, "at") });
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
          if (o.duration !== undefined) patch.duration = Math.max(100_000, us(o.duration, "duration"));
          const media = it.type === "media" ? p.media[it.mediaId] : undefined;
          if (media && media.kind !== "image" && it.type === "media") {
            const inPoint = patch.in ?? it.in;
            const room = Math.floor((media.duration - inPoint) / it.speed);
            if (room <= 0) throw new Error("in is past the end of the media");
            patch.duration = Math.min(patch.duration ?? it.duration, room);
          }
          p = updateItem(p, it.id, patch as Partial<Item>);
          p = repack(p, it.id);
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
          p = updateItem(p, it.id, { keyframes: setKey(it.keyframes, o.prop, local, o.value, o.ease ?? "ease") });
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
          p = setFilter(p, it.id, o.filter, o.amount ?? 1);
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
          if (o.speed !== undefined) params.speed = o.speed;
          if (o.style !== undefined) params.style = o.style;
          p = updateItem(p, it.id, {
            effects: (findItem(p, it.id)!.item as MediaItem).effects!.map(e => (e.id === added.effect!.id ? { ...e, amount: o.amount ?? e.amount, params } : e)),
          } as Partial<Item>);
          result.id = added.effect.id;
          break;
        }
        case "marker":
          p = addMarker(p, us(o.at, "at"), o.label);
          break;
        case "track": {
          const id = trackFor(o.id);
          if (!id) throw new Error("track needs an id");
          const { op: _op, id: _id, ...patch } = o;
          p = setTrack(p, id, patch);
          break;
        }
        case "add_track": {
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
        default:
          throw new Error(`unknown op ${(o as { op: string }).op}; see the catalog`);
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
    names.set(as, id);
  }
}

/** Keep the main track packed after a length change made through updateItem. */
function repack(p: Project, id: string): Project {
  const found = findItem(p, id);
  if (!found?.track.main || found.track.magnetic === false) return p;
  const next = structuredClone(p);
  const track = next.tracks.find(t => t.id === found.track.id)!;
  let t = 0;
  for (const it of track.items) {
    it.start = t;
    t += it.duration;
  }
  return next;
}

const TIME_PROPS = new Set(["fadeIn", "fadeOut"]);
const TRANSFORM_PROPS = new Set(["x", "y", "scale", "rotation", "opacity"]);
const PLAIN_PROPS = new Set([
  "volume", "reversed", "freeze", "blend", "adjust", "mask", "chroma", "crop", "curves", "hsl", "fill", "cutout", "stabilize", "enhance",
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
      if (typeof value !== "number") throw new Error(`${key} must be a number`);
      (transform as Record<string, number>)[key] = value;
      transformTouched = true;
    } else if (TIME_PROPS.has(key)) {
      patch[key] = us(value, key);
    } else if (key === "speed") {
      if (typeof value !== "number" || value <= 0) throw new Error("speed must be above 0");
      speed = value;
    } else if (key === "animationIn" || key === "animationOut") {
      if (value === null) patch[key] = undefined;
      else {
        const v = value as { kind?: unknown; duration?: unknown };
        if (typeof v?.kind !== "string") throw new Error(`${key} needs a kind`);
        patch[key] = { kind: v.kind, duration: us(v.duration ?? 0.5, `${key}.duration`) };
      }
    } else if (key === "text" || key === "style") {
      if (it.type !== "text" && it.type !== "caption") throw new Error(`${key} only applies to text`);
      const style = { ...it.style, ...(key === "text" ? { text: String(value) } : (value as object)) };
      patch.style = style;
    } else if (PLAIN_PROPS.has(key)) {
      patch[key] = value === null ? undefined : value;
    } else {
      throw new Error(`unknown property ${key}; see the catalog`);
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

const RATIOS: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "4:3": [1440, 1080], "21:9": [2560, 1080] };

function setProject(p: Project, o: Extract<Op, { op: "project" }>): Project {
  const settings = { ...p.settings };
  if (o.ratio) {
    const r = RATIOS[o.ratio];
    if (!r) throw new Error(`ratio must be one of ${Object.keys(RATIOS).join(", ")}`);
    [settings.width, settings.height] = r;
  }
  if (o.width) settings.width = Math.round(o.width / 2) * 2;
  if (o.height) settings.height = Math.round(o.height / 2) * 2;
  if (o.fps) settings.fps = Number.isInteger(o.fps) ? { num: o.fps, den: 1 } : { num: Math.round(o.fps * 1001), den: 1001 };
  if (o.background) {
    if (!/^#[0-9a-f]{6}$/i.test(o.background)) throw new Error("background must be #rrggbb");
    settings.background = o.background;
  }
  return { ...p, name: o.name?.trim() || p.name, settings, modified: Date.now() };
}

