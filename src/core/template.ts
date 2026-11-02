// Templates: a piece of a timeline with open slots where the user's clips go, or a caption
// look. They are shared as plain files between people who have never met, so reading one is
// strict: every field is rebuilt from an allowed list, numbers are clamped, counts are capped,
// and anything unknown is left out. Nothing here can name a file, a path or a project media id.

import { TRANSITIONS } from "../engine/shaders";
import { safeFont } from "./fonts";
import { LAYOUTS, type Layout } from "./layouts";
import { EFFECTS } from "./look/effects";
import { FILTERS } from "./look/filters";
import type { BlendMode, Easing, Fill, KeyframeMap, Mask, Micros, ShapeKind, ShapeStyle, TextStyle, Transform, TrackKind, Transition } from "./project";
import { ANIMATION_KINDS } from "./scene";
import { STICKERS } from "./stickers";

export const TEMPLATE_FORMAT = "openroll-template";
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_EXT = "openrolltemplate";

export const TEMPLATE_LIMITS = {
  bytes: 256 * 1024,
  slots: 24,
  tracks: 12,
  itemsPerTrack: 80,
  items: 240,
  markers: 200,
  effects: 6,
  keyPaths: 12,
  keysPerPath: 32,
  tags: 8,
  text: 400,
  /** Ten minutes in microseconds, longer than any template is meant to be. */
  time: 600 * 1_000_000,
} as const;

const MIN_TIME: Micros = 100_000;

export type SlotKind = "visual" | "audio";

export interface TemplateSlot {
  id: string;
  /** What the person sees on an empty slot, such as "Clip 1". */
  label: string;
  kind: SlotKind;
}

export interface TemplateEffect {
  kind: string;
  amount: number;
  speed?: number;
  style?: number;
  off?: boolean;
}

interface Timed {
  /** Microseconds from the start of the template. */
  start: Micros;
  duration: Micros;
  transform?: Partial<Transform>;
  keyframes?: KeyframeMap;
  transitionIn?: Transition;
  animationIn?: { kind: string; duration: Micros };
  animationOut?: { kind: string; duration: Micros };
}

export interface SlotLook {
  speed?: number;
  volume?: number;
  fadeIn?: Micros;
  fadeOut?: Micros;
  reversed?: boolean;
  muteAudio?: boolean;
  crop?: { left: number; top: number; right: number; bottom: number };
  blend?: BlendMode;
  adjust?: Record<string, number>;
  filter?: { id: string; amount: number };
  effects?: TemplateEffect[];
  mask?: Mask;
  fill?: Fill;
}

export type TemplateItem =
  | (Timed & SlotLook & { type: "slot"; slot: string; layout?: Layout })
  | (Timed & { type: "text"; style: TextStyle })
  | (Timed & { type: "caption"; style: TextStyle; highlight?: string })
  | (Timed & { type: "color"; color: string })
  | (Timed & { type: "shape"; shape: ShapeStyle; width: number; height: number });

export interface TemplateTrack {
  kind: TrackKind;
  name: string;
  /** The track the clips run along. At most one, and only a video track. */
  main?: boolean;
  items: TemplateItem[];
}

export interface CaptionLook {
  /** The look of every caption; its text is empty. */
  style: TextStyle;
  /** Colour of the word being spoken. */
  highlight?: string;
  /** Distance from the frame centre as a fraction of the frame height, so -0.3 is high and 0.27 is low. */
  y: number;
  animationIn?: { kind: string; duration: Micros };
}

export interface Template {
  format: typeof TEMPLATE_FORMAT;
  version: typeof TEMPLATE_VERSION;
  id: string;
  name: string;
  kind: "timeline" | "captions";
  description?: string;
  author?: string;
  tags?: string[];
  /** The frame the geometry was drawn for. Positions and sizes follow the project's frame from here. */
  frame: { width: number; height: number };
  /** Length of the piece, worked out from its items. */
  duration: Micros;
  slots: TemplateSlot[];
  tracks: TemplateTrack[];
  markers?: { t: Micros; label?: string }[];
  captions?: CaptionLook;
}

export type TemplateResult = { ok: true; template: Template; repairs: string[] } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_SLOT = /^[A-Za-z0-9][\w-]{0,31}$/;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,3}|1\.0{1,3})\s*)?\)$/;
const KEY_PATH = /^(transform\.(x|y|scale|rotation|opacity)|filter\.amount|adjust\.[a-z]{3,12})$/;
const ADJUST_KEYS = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "vignette", "fade", "sharpen", "grain"];
const BLENDS: BlendMode[] = ["normal", "screen", "multiply", "overlay", "add", "lighten", "darken"];
const EASINGS: Easing[] = ["linear", "ease", "easeIn", "easeOut", "hold"];
const TRACK_KINDS: TrackKind[] = ["video", "audio", "text"];
const SHAPE_KINDS: ShapeKind[] = ["rect", "ellipse", "line", "sticker"];
const MASK_SHAPES: Mask["shape"][] = ["rect", "ellipse", "linear", "mirror"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const number = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);
const whole = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = number(v, lo, hi);
  return n === undefined ? undefined : Math.round(n);
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
const flag = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
function text(v: unknown, max: number, multiline = false): string | undefined {
  if (typeof v !== "string") return undefined;
  const clean = v.replace(CONTROL, "").replace(multiline ? /\r/g : /\s+/g, multiline ? "" : " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

function colour(v: unknown): string | undefined {
  return typeof v === "string" && (HEX.test(v) || RGBA.test(v)) ? v : undefined;
}

/** Drops keys the caller did not ask for, and any value that came out undefined. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as Obj)[k] === undefined) delete (o as Obj)[k];
  return o;
}

export function parseTemplate(source: string): TemplateResult {
  if (source.length > TEMPLATE_LIMITS.bytes) return { ok: false, error: "This template is too large to be a real one." };
  const body = source.replace(/^﻿/, "");
  if (!body.trim()) return { ok: false, error: "The file is empty." };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, error: "The file is damaged. It ends early or has characters that do not belong." };
  }
  return sanitizeTemplate(raw);
}

export function serializeTemplate(t: Template): string {
  return JSON.stringify(t, null, 2) + "\n";
}

export function sanitizeTemplate(raw: unknown): TemplateResult {
  if (!isObj(raw) || raw.format !== TEMPLATE_FORMAT) return { ok: false, error: "This is not an OpenRoll template." };
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) return { ok: false, error: "This template has no version number." };
  if ((raw.version as number) > TEMPLATE_VERSION) return { ok: false, error: "This template was made with a newer version of OpenRoll. Update OpenRoll to use it." };
  const kind = oneOf(raw.kind, ["timeline", "captions"] as const);
  if (!kind) return { ok: false, error: "This template is neither a timeline nor a caption style." };
  const name = text(raw.name, 60);
  if (!name) return { ok: false, error: "This template has no name." };

  const repairs: string[] = [];
  const frame = {
    width: whole(isObj(raw.frame) ? raw.frame.width : undefined, 16, 8192) ?? 1080,
    height: whole(isObj(raw.frame) ? raw.frame.height : undefined, 16, 8192) ?? 1920,
  };
  if (!isObj(raw.frame) || raw.frame.width !== frame.width || raw.frame.height !== frame.height) repairs.push("frame");

  const id = typeof raw.id === "string" && SAFE_ID.test(raw.id) ? raw.id : (repairs.push("id"), idFromName(name));
  const slots = readSlots(raw.slots, repairs);
  const tracks = kind === "timeline" ? readTracks(raw.tracks, slots, repairs) : [];
  const captions = kind === "captions" ? readCaptionLook(raw.captions) : undefined;
  if (kind === "captions" && !captions) return { ok: false, error: "This caption style has no look to apply." };
  if (kind === "timeline" && !tracks.some(t => t.items.length)) return { ok: false, error: "This template has nothing in it." };

  const used = new Set(tracks.flatMap(t => t.items.flatMap(i => (i.type === "slot" ? [i.slot] : []))));
  const duration = Math.max(0, ...tracks.flatMap(t => t.items.map(i => i.start + i.duration)));
  const markers = readMarkers(raw.markers, duration);
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.map(t => text(t, 24)?.toLowerCase()).filter((t): t is string => !!t))].slice(0, TEMPLATE_LIMITS.tags) : [];

  const template: Template = compact({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id,
    name,
    kind,
    description: text(raw.description, 300),
    author: text(raw.author, 60),
    tags: tags.length ? tags : undefined,
    frame,
    duration,
    slots: slots.filter(s => used.has(s.id)),
    tracks,
    markers: markers.length ? markers : undefined,
    captions,
  });
  return { ok: true, template, repairs };
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "template";
}

/** A stable id for a template that arrived without a usable one. */
export function idFromName(name: string): string {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return `${slugify(name)}-${(h >>> 0).toString(36).slice(0, 5)}`;
}

function readSlots(raw: unknown, repairs: string[]): TemplateSlot[] {
  const out: TemplateSlot[] = [];
  if (!Array.isArray(raw)) return out;
  for (const s of raw.slice(0, TEMPLATE_LIMITS.slots)) {
    const id = isObj(s) && typeof s.id === "string" && SAFE_SLOT.test(s.id) ? s.id : undefined;
    if (!isObj(s) || !id || out.some(o => o.id === id)) {
      repairs.push("slot");
      continue;
    }
    const kind = oneOf(s.kind, ["visual", "audio"] as const) ?? "visual";
    out.push({ id, label: text(s.label, 24) ?? `Clip ${out.length + 1}`, kind });
  }
  return out;
}

function readTracks(raw: unknown, slots: TemplateSlot[], repairs: string[]): TemplateTrack[] {
  const out: TemplateTrack[] = [];
  if (!Array.isArray(raw)) return out;
  let total = 0;
  for (const t of raw.slice(0, TEMPLATE_LIMITS.tracks)) {
    const kind = isObj(t) ? oneOf(t.kind, TRACK_KINDS) : undefined;
    if (!isObj(t) || !kind) {
      repairs.push("track");
      continue;
    }
    const main = kind === "video" && t.main === true && !out.some(o => o.main);
    const items: TemplateItem[] = [];
    for (const raw of Array.isArray(t.items) ? t.items.slice(0, TEMPLATE_LIMITS.itemsPerTrack) : []) {
      if (total >= TEMPLATE_LIMITS.items) break;
      const item = readItem(raw, kind, slots);
      if (!item) {
        repairs.push("item");
        continue;
      }
      items.push(item);
      total++;
    }
    items.sort((a, b) => a.start - b.start);
    if (main) {
      let at = 0;
      for (const i of items) {
        i.start = at;
        at += i.duration;
      }
    } else {
      // A lane holds one thing at a time; whatever would sit on top of the one before is left out.
      let end = 0;
      for (let i = 0; i < items.length; i++) {
        if (items[i].start < end) {
          repairs.push("overlap");
          items.splice(i--, 1);
        } else end = items[i].start + items[i].duration;
      }
    }
    if (!items.length) continue;
    out.push({ kind, name: text(t.name, 40) ?? (kind === "audio" ? "Audio" : kind === "text" ? "Text" : "Overlay"), ...(main ? { main } : {}), items });
  }
  return out;
}

function readItem(raw: unknown, lane: TrackKind, slots: TemplateSlot[]): TemplateItem | null {
  if (!isObj(raw)) return null;
  const start = whole(raw.start, 0, TEMPLATE_LIMITS.time);
  const duration = whole(raw.duration, MIN_TIME, TEMPLATE_LIMITS.time);
  if (start === undefined || duration === undefined) return null;
  const type = raw.type;
  const slot = type === "slot" && typeof raw.slot === "string" ? slots.find(s => s.id === raw.slot) : undefined;
  const fits =
    (type === "slot" && !!slot && (slot.kind === "audio" ? lane === "audio" : lane === "video")) ||
    ((type === "color" || type === "shape") && lane === "video") ||
    ((type === "text" || type === "caption") && lane === "text");
  if (!fits) return null;

  const base: Timed = compact({
    start,
    duration,
    transform: readTransform(raw.transform),
    keyframes: readKeyframes(raw.keyframes, duration, type === "slot"),
    transitionIn: readTransition(raw.transitionIn, duration),
    animationIn: readAnimation(raw.animationIn),
    animationOut: readAnimation(raw.animationOut),
  });

  switch (type) {
    case "slot":
      return compact({ ...base, type: "slot" as const, slot: slot!.id, layout: oneOf(raw.layout, LAYOUTS.map(l => l.id)), ...readLook(raw, duration) });
    case "text":
    case "caption": {
      const style = readStyle(raw.style, true);
      if (!style || (type === "caption" && !style.text)) return null;
      return type === "text" ? { ...base, type: "text" as const, style } : compact({ ...base, type: "caption" as const, style, highlight: colour(raw.highlight) });
    }
    case "color": {
      const color = colour(raw.color);
      return color ? { ...base, type, color } : null;
    }
    default: {
      const shape = readShape(raw.shape);
      const width = number(raw.width, 1, 20000);
      const height = number(raw.height, 1, 20000);
      return shape && width && height ? { ...base, type: "shape", shape, width, height } : null;
    }
  }
}

function readTransform(raw: unknown): Partial<Transform> | undefined {
  if (!isObj(raw)) return undefined;
  const t = compact({
    x: number(raw.x, -20000, 20000),
    y: number(raw.y, -20000, 20000),
    scale: number(raw.scale, 0.01, 20),
    rotation: number(raw.rotation, -3600, 3600),
    opacity: number(raw.opacity, 0, 1),
  });
  return Object.keys(t).length ? t : undefined;
}

function readKeyframes(raw: unknown, duration: Micros, onSlot: boolean): KeyframeMap | undefined {
  if (!isObj(raw)) return undefined;
  const out: KeyframeMap = {};
  for (const path of Object.keys(raw).slice(0, TEMPLATE_LIMITS.keyPaths)) {
    if (!KEY_PATH.test(path) || (!onSlot && !path.startsWith("transform."))) continue;
    if (path.startsWith("adjust.") && !ADJUST_KEYS.includes(path.slice(7))) continue;
    const list = raw[path];
    if (!Array.isArray(list)) continue;
    const keys = list
      .slice(0, TEMPLATE_LIMITS.keysPerPath)
      .map(k => (isObj(k) ? { t: whole(k.t, 0, duration), v: number(k.v, -100000, 100000), ease: oneOf(k.ease, EASINGS) ?? "ease" } : null))
      .filter((k): k is { t: number; v: number; ease: Easing } => !!k && k.t !== undefined && k.v !== undefined)
      .sort((a, b) => a.t - b.t)
      .filter((k, i, all) => i === 0 || k.t !== all[i - 1].t);
    if (keys.length) out[path] = keys;
  }
  return Object.keys(out).length ? out : undefined;
}

function readTransition(raw: unknown, itemDuration: Micros): Transition | undefined {
  if (!isObj(raw)) return undefined;
  const kind = oneOf(raw.kind, TRANSITIONS);
  const duration = whole(raw.duration, MIN_TIME, Math.min(5_000_000, itemDuration));
  return kind && duration ? { kind, duration } : undefined;
}

function readAnimation(raw: unknown): { kind: string; duration: Micros } | undefined {
  if (!isObj(raw)) return undefined;
  const kind = oneOf(raw.kind, ANIMATION_KINDS);
  const duration = whole(raw.duration, 50_000, 5_000_000);
  return kind && duration ? { kind, duration } : undefined;
}

function readLook(raw: Obj, duration: Micros): SlotLook {
  const adjust: Record<string, number> = {};
  if (isObj(raw.adjust)) {
    for (const key of ADJUST_KEYS) {
      const v = number(raw.adjust[key], -100, 100);
      if (v !== undefined) adjust[key] = v;
    }
  }
  const filterId = isObj(raw.filter) ? raw.filter.id : undefined;
  const filter = isObj(raw.filter) && FILTERS.some(f => f.id === filterId) ? { id: filterId as string, amount: number(raw.filter.amount, 0, 1) ?? 1 } : undefined;
  const effects = (Array.isArray(raw.effects) ? raw.effects : [])
    .slice(0, TEMPLATE_LIMITS.effects)
    .map((e): TemplateEffect | null => {
      if (!isObj(e) || typeof e.kind !== "string" || !EFFECTS.some(d => d.kind === e.kind && !d.internal)) return null;
      return compact({ kind: e.kind, amount: number(e.amount, 0, 1) ?? 0.5, speed: number(e.speed, 0, 20), style: whole(e.style, 0, 9), off: flag(e.off) });
    })
    .filter((e): e is TemplateEffect => !!e);
  const crop = isObj(raw.crop)
    ? { left: number(raw.crop.left, 0, 0.95) ?? 0, top: number(raw.crop.top, 0, 0.95) ?? 0, right: number(raw.crop.right, 0, 0.95) ?? 0, bottom: number(raw.crop.bottom, 0, 0.95) ?? 0 }
    : undefined;
  const mask = isObj(raw.mask) && oneOf(raw.mask.shape, MASK_SHAPES)
    ? {
        shape: oneOf(raw.mask.shape, MASK_SHAPES)!,
        x: number(raw.mask.x, -2, 2) ?? 0,
        y: number(raw.mask.y, -2, 2) ?? 0,
        width: number(raw.mask.width, 0, 4) ?? 1,
        height: number(raw.mask.height, 0, 4) ?? 1,
        rotation: number(raw.mask.rotation, -360, 360) ?? 0,
        feather: number(raw.mask.feather, 0, 1) ?? 0,
        invert: raw.mask.invert === true,
      }
    : undefined;
  const fillMode = isObj(raw.fill) ? oneOf(raw.fill.mode, ["blur", "color"] as const) : undefined;
  const fill = isObj(raw.fill) && fillMode ? compact<Fill>({ mode: fillMode, color: colour(raw.fill.color), blur: number(raw.fill.blur, 0, 1) }) : undefined;
  return compact({
    speed: number(raw.speed, 0.1, 8),
    volume: number(raw.volume, 0, 2),
    fadeIn: whole(raw.fadeIn, 0, duration),
    fadeOut: whole(raw.fadeOut, 0, duration),
    reversed: flag(raw.reversed),
    muteAudio: flag(raw.muteAudio),
    crop,
    blend: oneOf(raw.blend, BLENDS),
    adjust: Object.keys(adjust).length ? adjust : undefined,
    filter,
    effects: effects.length ? effects : undefined,
    mask,
    fill,
  });
}

export function readStyle(raw: unknown, withText: boolean): TextStyle | null {
  if (!isObj(raw)) return null;
  const sample = withText ? text(raw.text, TEMPLATE_LIMITS.text, true) : undefined;
  if (withText && !sample) return null;
  const stroke = isObj(raw.stroke) ? { color: colour(raw.stroke.color) ?? "#000000", width: number(raw.stroke.width, 0, 200) ?? 0 } : undefined;
  const shadow = isObj(raw.shadow)
    ? { color: colour(raw.shadow.color) ?? "rgba(0,0,0,0.5)", blur: number(raw.shadow.blur, 0, 200) ?? 0, x: number(raw.shadow.x, -200, 200) ?? 0, y: number(raw.shadow.y, -200, 200) ?? 0 }
    : undefined;
  const background = isObj(raw.background)
    ? { color: colour(raw.background.color) ?? "#000000", padding: number(raw.background.padding, 0, 400) ?? 0, radius: number(raw.background.radius, 0, 400) ?? 0 }
    : undefined;
  // A face this build does not bundle would be stored in the project and drawn as the default.
  const font = safeFont(raw.font);
  return compact({
    text: sample ?? "",
    font,
    size: number(raw.size, 4, 1000) ?? 96,
    weight: whole(raw.weight, 100, 900) ?? 700,
    color: colour(raw.color) ?? "#ffffff",
    align: oneOf(raw.align, ["left", "center", "right"] as const) ?? "center",
    lineHeight: number(raw.lineHeight, 0.5, 3) ?? 1.1,
    letterSpacing: number(raw.letterSpacing, -50, 200) ?? 0,
    stroke,
    shadow,
    background,
  });
}

function readShape(raw: unknown): ShapeStyle | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw.kind, SHAPE_KINDS);
  const color = colour(raw.color);
  if (!kind || !color) return null;
  const sticker = typeof raw.sticker === "string" && STICKERS.some(s => s.id === raw.sticker) ? raw.sticker : undefined;
  if (kind === "sticker" && !sticker) return null;
  const stroke = isObj(raw.stroke) ? { color: colour(raw.stroke.color) ?? "#000000", width: number(raw.stroke.width, 0, 200) ?? 0 } : undefined;
  return compact({
    kind,
    sticker: kind === "sticker" ? sticker : undefined,
    color,
    stroke,
    radius: number(raw.radius, 0, 4000),
    thickness: number(raw.thickness, 0, 500),
    weight: number(raw.weight, 0.2, 5),
    noFill: flag(raw.noFill),
  });
}

function readMarkers(raw: unknown, duration: Micros): { t: Micros; label?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out = raw
    .slice(0, TEMPLATE_LIMITS.markers)
    .flatMap(m => {
      const t = isObj(m) ? whole(m.t, 0, Math.max(duration, 1)) : undefined;
      return t === undefined ? [] : [compact({ t, label: text((m as Obj).label, 40) })];
    })
    .sort((a, b) => a.t - b.t);
  return out.filter((m, i) => i === 0 || m.t - out[i - 1].t >= 1000);
}

function readCaptionLook(raw: unknown): CaptionLook | undefined {
  if (!isObj(raw)) return undefined;
  const style = readStyle(raw.style, false);
  if (!style) return undefined;
  return compact({ style, highlight: colour(raw.highlight), y: number(raw.y, -0.5, 0.5) ?? 0.27, animationIn: readAnimation(raw.animationIn) });
}

export interface TemplateSummary {
  id: string;
  name: string;
  kind: Template["kind"];
  description?: string;
  author?: string;
  tags: string[];
  ratio: string;
  seconds: number;
  slots: { id: string; label: string; kind: SlotKind }[];
}

const RATIOS: [string, number][] = [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["21:9", 21 / 9]];

export function frameRatio(frame: { width: number; height: number }): string {
  const r = frame.width / frame.height;
  const near = RATIOS.find(([, v]) => Math.abs(v - r) < 0.02);
  return near ? near[0] : `${frame.width}:${frame.height}`;
}

export function summarizeTemplate(t: Template): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    ...(t.description ? { description: t.description } : {}),
    ...(t.author ? { author: t.author } : {}),
    tags: t.tags ?? [],
    ratio: frameRatio(t.frame),
    seconds: Math.round(t.duration / 1000) / 1000,
    slots: t.slots.map(s => ({ id: s.id, label: s.label, kind: s.kind })),
  };
}
