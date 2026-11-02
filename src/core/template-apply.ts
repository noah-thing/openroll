// Putting a template on a timeline. Pure: a project and a template in, a project out, so the
// panel, the AI tools and the preview all place things the same way and one call is one undo step.

import { addMedia, deleteItems, draft, freeTrack, indexAtTime, insertItems, isMagnetic, MIN_ITEM, pruneTransitions, sortTrack } from "./edit";
import { placeIn, PIP_WIDTH, type Layout } from "./layouts";
import { restyleCaptions, spreadWords, type CaptionTemplate } from "./captions";
import { newEffect } from "./look/effects";
import {
  createProject,
  findItem,
  IDENTITY,
  itemEnd,
  newId,
  type CaptionItem,
  type Item,
  type KeyframeMap,
  type MediaItem,
  type MediaRef,
  type Micros,
  type Project,
  type ShapeItem,
  type TextItem,
  type TextStyle,
  type TrackKind,
} from "./project";
import { buildScene } from "./scene";
import { stickerById } from "./stickers";
import type { Template, TemplateItem, TemplateSlot } from "./template";

/** What goes into one slot: a library file and the stretch of it to use. */
export interface SlotFill {
  media: MediaRef;
  in: Micros;
  /** Source time available from `in`; unlimited for a still. */
  span: Micros;
}

export interface FillPlan {
  fills: Map<string, SlotFill>;
  /** Timeline clips the template replaces. */
  consume: string[];
  /** Where those clips began, so the template lands in their place. */
  at?: Micros;
}

export interface ApplyOptions {
  at: Micros;
  fills?: ReadonlyMap<string, SlotFill>;
  consume?: readonly string[];
}

export interface ApplyResult {
  project: Project;
  /** Every item the template added. */
  ids: string[];
  /** Slots that got a clip. */
  filled: number;
  /** Labels of slots left empty. */
  empty: string[];
  start: Micros;
  end: Micros;
}

interface Fit {
  kx: number;
  ky: number;
  /** For sizes that have no single axis: the geometric mean, so a change of shape keeps text the same weight. */
  k: number;
}

const EMPTY_FILL = "#262a31";
const EMPTY_LINE = "#6b7280";
const EMPTY_INK = "#aab1bd";
const FONT = "Familjen Grotesk";

function fitFrame(t: Template, p: Project): Fit {
  const kx = p.settings.width / t.frame.width;
  const ky = p.settings.height / t.frame.height;
  return { kx, ky, k: Math.sqrt(kx * ky) };
}

export function scaleStyle(s: TextStyle, k: number): TextStyle {
  if (Math.abs(k - 1) < 0.001) return structuredClone(s);
  return {
    ...s,
    size: Math.max(4, Math.round(s.size * k)),
    letterSpacing: s.letterSpacing * k,
    stroke: s.stroke && { ...s.stroke, width: s.stroke.width * k },
    shadow: s.shadow && { ...s.shadow, blur: s.shadow.blur * k, x: s.shadow.x * k, y: s.shadow.y * k },
    background: s.background && { ...s.background, padding: s.background.padding * k, radius: s.background.radius * k },
  };
}

/** Where a slot's picture lands. Layout slots are placed by the clip's own shape; the rest follow the template's numbers. */
function regionOf(p: Project, layout: Layout | undefined): { x: number; y: number; width: number; height: number } {
  const W = p.settings.width, H = p.settings.height;
  if (!layout || layout === "full") return { x: 0, y: 0, width: W, height: H };
  const stand: MediaRef = { id: "", kind: "image", path: "", name: "", size: 0, mtime: 0, duration: 0, hasAudio: false, hasVideo: true, width: W, height: H };
  const at = placeIn(p, stand, layout);
  if (layout.startsWith("pip")) return { x: at.x, y: at.y, width: W * PIP_WIDTH, height: H * PIP_WIDTH };
  const wide = layout === "top" || layout === "bottom";
  return { x: at.x, y: at.y, width: wide ? W : W / 2, height: wide ? H / 2 : H };
}

function mapKeys(keys: KeyframeMap | undefined, fit: Fit, placed?: { x: number; y: number; scale: number }): KeyframeMap | undefined {
  if (!keys) return undefined;
  const out: KeyframeMap = {};
  for (const [path, list] of Object.entries(keys)) {
    out[path] = list.map(key => {
      let v = key.v;
      if (path === "transform.x") v = placed ? v + placed.x : v * fit.kx;
      else if (path === "transform.y") v = placed ? v + placed.y : v * fit.ky;
      else if (path === "transform.scale" && placed) v *= placed.scale;
      return { ...key, v };
    });
  }
  return out;
}

function common(ti: TemplateItem, origin: Micros, fit: Fit, placed?: { x: number; y: number; scale: number }): Pick<Item, "start" | "duration" | "transform" | "keyframes" | "transitionIn" | "animationIn" | "animationOut"> {
  const tr = ti.transform ?? {};
  return {
    start: origin + ti.start,
    duration: ti.duration,
    transform: {
      ...IDENTITY,
      ...tr,
      x: placed ? placed.x : (tr.x ?? 0) * fit.kx,
      y: placed ? placed.y : (tr.y ?? 0) * fit.ky,
      scale: placed ? placed.scale : (tr.scale ?? 1),
    },
    keyframes: mapKeys(ti.keyframes, fit, placed),
    transitionIn: ti.transitionIn && { ...ti.transitionIn },
    animationIn: ti.animationIn && { ...ti.animationIn },
    animationOut: ti.animationOut && { ...ti.animationOut },
  };
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
}

/** Circles, squares and stickers keep their proportions in a new frame; bars and bands follow it. */
function shapeSize(width: number, height: number, sticker: boolean, fit: Fit): { width: number; height: number } {
  const locked = sticker || Math.abs(width / height - 1) < 0.02;
  return locked ? { width: width * fit.k, height: height * fit.k } : { width: width * fit.kx, height: height * fit.ky };
}

type SlotItem = Extract<TemplateItem, { type: "slot" }>;

function filledSlot(p: Project, ti: SlotItem, fill: SlotFill, origin: Micros, fit: Fit): MediaItem {
  const media = fill.media;
  const speed = ti.speed ?? 1;
  const layout = media.kind === "audio" ? undefined : ti.layout;
  const placed = layout ? placeIn(p, media, layout) : undefined;
  const base = common(ti, origin, fit, placed);
  const room = media.kind === "image" ? Infinity : Math.floor(fill.span / speed);
  const item: MediaItem = {
    ...mediaItemFor(media),
    ...base,
    in: media.kind === "image" ? 0 : fill.in,
    speed,
    duration: Math.max(MIN_ITEM, Math.min(ti.duration, room)),
    volume: ti.volume ?? 1,
    fadeIn: ti.fadeIn ?? 0,
    fadeOut: ti.fadeOut ?? 0,
  };
  return strip<MediaItem>({
    ...item,
    reversed: ti.reversed,
    muteAudio: ti.muteAudio,
    crop: placed?.crop ?? ti.crop,
    blend: ti.blend,
    adjust: ti.adjust && { ...ti.adjust },
    filter: ti.filter && { ...ti.filter },
    effects: ti.effects?.map(e => {
      const fx = newEffect(e.kind);
      return { ...fx, amount: e.amount, params: fx.params && { ...fx.params, ...(e.speed !== undefined && "speed" in fx.params ? { speed: e.speed } : {}), ...(e.style !== undefined && "style" in fx.params ? { style: e.style } : {}) }, ...(e.off ? { off: true } : {}) };
    }),
    mask: ti.mask && { ...ti.mask },
    fill: ti.fill && { ...ti.fill },
  });
}

function mediaItemFor(media: MediaRef): MediaItem {
  return { id: newId("i"), type: "media", mediaId: media.id, start: 0, duration: media.duration, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, transform: { ...IDENTITY }, name: media.name };
}

/** A slot nobody filled shows as a dark box with its label, so the gap is plain on the timeline and in the viewer. */
function emptySlot(p: Project, ti: SlotItem, slot: TemplateSlot, origin: Micros, fit: Fit): Item[] {
  const region = regionOf(p, ti.layout);
  const placed = ti.layout && ti.layout !== "full" ? { x: region.x, y: region.y, scale: 1 } : undefined;
  const base = common(ti, origin, fit, placed);
  const box: ShapeItem = {
    id: newId("i"),
    type: "shape",
    name: `Empty slot: ${slot.label}`,
    ...base,
    shape: { kind: "rect", color: EMPTY_FILL, stroke: { color: EMPTY_LINE, width: Math.max(2, Math.round(3 * fit.k)) }, radius: 0 },
    width: region.width,
    height: region.height,
  };
  const label: TextItem = {
    id: newId("i"),
    type: "text",
    name: `${slot.label} label`,
    start: base.start,
    duration: base.duration,
    transform: { ...IDENTITY, x: base.transform.x, y: base.transform.y },
    style: { text: slot.label, font: FONT, size: Math.max(12, Math.round(Math.min(region.width, region.height) * 0.09)), weight: 600, color: EMPTY_INK, align: "center", lineHeight: 1.1, letterSpacing: 0 },
  };
  return [box, label];
}

function stickerName(kind: string, sticker?: string): string {
  return stickerById(sticker)?.name ?? (kind === "ellipse" ? "Ellipse" : kind === "line" ? "Line" : "Rectangle");
}

function realize(p: Project, ti: TemplateItem, origin: Micros, fit: Fit, fills: ReadonlyMap<string, SlotFill>, slots: TemplateSlot[], notes: { filled: Set<string>; empty: Map<string, string> }): { items: Item[]; labels: Item[] } {
  switch (ti.type) {
    case "slot": {
      const slot = slots.find(s => s.id === ti.slot)!;
      const fill = fills.get(slot.id);
      if (fill) {
        notes.filled.add(slot.id);
        return { items: [filledSlot(p, ti, fill, origin, fit)], labels: [] };
      }
      notes.empty.set(slot.id, slot.label);
      // A sound has no picture to stand in for it.
      if (slot.kind === "audio") return { items: [], labels: [] };
      const [box, label] = emptySlot(p, ti, slot, origin, fit);
      return { items: [box], labels: [label] };
    }
    case "text": {
      const base = common(ti, origin, fit);
      return { items: [{ id: newId("i"), type: "text", name: ti.style.text.slice(0, 40), ...base, style: scaleStyle(ti.style, fit.k) }], labels: [] };
    }
    case "caption": {
      const base = common(ti, origin, fit);
      const words = spreadWords(ti.style.text.split(/\s+/).filter(Boolean), 0, base.duration);
      const item: CaptionItem = { id: newId("i"), type: "caption", name: "Caption", ...base, style: { ...scaleStyle(ti.style, fit.k), text: "" }, words, highlight: ti.highlight };
      return { items: [strip(item)], labels: [] };
    }
    case "color":
      return { items: [{ id: newId("i"), type: "color", name: "Colour", ...common(ti, origin, fit), color: ti.color }], labels: [] };
    case "shape": {
      const base = common(ti, origin, fit);
      const s = ti.shape;
      const shape: ShapeItem = {
        id: newId("i"),
        type: "shape",
        name: stickerName(s.kind, s.sticker),
        ...base,
        shape: strip({ ...s, stroke: s.stroke && { ...s.stroke, width: s.stroke.width * fit.k }, radius: s.radius === undefined ? undefined : s.radius * fit.k, thickness: s.thickness === undefined ? undefined : s.thickness * fit.k }),
        ...shapeSize(ti.width, ti.height, s.kind === "sticker", fit),
      };
      return { items: [shape], labels: [] };
    }
  }
}

export function applyTemplate(p: Project, t: Template, opts: ApplyOptions): ApplyResult {
  const none: ApplyResult = { project: p, ids: [], filled: 0, empty: [], start: 0, end: 0 };
  if (t.kind !== "timeline") return none;

  const fills = opts.fills ?? new Map<string, SlotFill>();
  let next = opts.consume?.length ? deleteItems(p, [...opts.consume]) : p;
  next = addMedia(next, [...fills.values()].map(f => f.media));
  const fit = fitFrame(t, next);

  const main = next.tracks.find(tr => tr.main);
  const hasMain = !!main && t.tracks.some(tr => tr.main);
  const index = hasMain ? indexAtTime(main, opts.at) : 0;
  const lastEnd = main ? Math.max(0, ...main.items.map(itemEnd)) : 0;
  const origin = hasMain && isMagnetic(main) ? (main.items[index]?.start ?? lastEnd) : Math.max(0, opts.at);

  const notes = { filled: new Set<string>(), empty: new Map<string, string>() };
  const lanes = t.tracks.map(tr => {
    const items: Item[] = [];
    const labels: Item[] = [];
    for (const ti of tr.items) {
      const r = realize(next, ti, origin, fit, fills, t.slots, notes);
      items.push(...r.items);
      labels.push(...r.labels);
    }
    return { track: tr, items, labels };
  });

  const mainLane = lanes.find(l => l.track.main);
  let mainEnd = origin;
  if (mainLane) {
    let at = origin;
    for (const i of mainLane.items) {
      i.start = at;
      at += i.duration;
    }
    mainEnd = at;
  }
  const end = mainLane ? mainEnd : origin + t.duration;

  if (mainLane?.items.length) next = insertItems(next, mainLane.items, { trackId: main!.id, index });
  next = draft(next);

  const placed: Item[] = [...(mainLane?.items ?? [])];
  const put = (kind: TrackKind, items: Item[]) => {
    // When the main clips came up short the overlays are trimmed to the new end rather than left hanging in empty time.
    const fitted = items.flatMap(i => {
      if (!mainLane) return [i];
      if (i.start >= end) return [];
      const duration = Math.min(i.duration, end - i.start);
      return duration >= MIN_ITEM ? [{ ...i, duration }] : [];
    });
    if (!fitted.length) return;
    const before = next.tracks.length;
    const lane = freeTrack(next, kind, Math.min(...fitted.map(i => i.start)), Math.max(...fitted.map(itemEnd)));
    // Words belong above every picture, so a lane made for text moves to the top.
    if (kind === "text" && next.tracks.length > before) next.tracks.unshift(next.tracks.splice(next.tracks.indexOf(lane), 1)[0]);
    lane.items.push(...fitted);
    sortTrack(lane);
    placed.push(...fitted);
  };
  for (const lane of lanes) {
    if (lane.track.main) continue;
    put(lane.track.kind, lane.items);
  }
  put("text", lanes.flatMap(l => l.labels));

  for (const m of t.markers ?? []) {
    const at = origin + m.t;
    if (!next.markers.some(x => Math.abs(x.t - at) < 1000)) next.markers.push({ id: newId("m"), t: at, ...(m.label ? { label: m.label } : {}) });
  }
  next.markers.sort((a, b) => a.t - b.t);
  pruneTransitions(next);

  const ids = placed.map(i => i.id).filter(id => findItem(next, id));
  return { project: next, ids, filled: notes.filled.size, empty: [...notes.empty.values()], start: origin, end };
}

/** Which clips fill which slots: the selected clips when there are any, otherwise the library in order, unused files first. */
export function chooseFills(p: Project, t: Template, selection: readonly string[]): FillPlan {
  const visual = t.slots.filter(s => s.kind === "visual");
  const audio = t.slots.filter(s => s.kind === "audio");
  const order = (id: string) => p.tracks.findIndex(tr => tr.items.some(i => i.id === id));
  // A locked track keeps its clips, so they cannot be swapped out for the template and are left alone.
  const trackOf = (id: string) => p.tracks[order(id)];
  const picked = selection
    .map(id => findItem(p, id)?.item)
    .filter((i): i is MediaItem => i?.type === "media" && !!p.media[i.mediaId] && !trackOf(i.id)?.locked)
    .sort((a, b) => a.start - b.start || order(a.id) - order(b.id));

  const fills = new Map<string, SlotFill>();
  if (picked.length) {
    const consume: string[] = [];
    const take = (slots: TemplateSlot[], want: (m: MediaRef) => boolean) => {
      const pool = picked.filter(i => want(p.media[i.mediaId]) && !consume.includes(i.id));
      slots.forEach((slot, n) => {
        const item = pool[n];
        if (!item) return;
        const media = p.media[item.mediaId];
        fills.set(slot.id, { media, in: item.in, span: media.kind === "image" || item.freeze ? Infinity : Math.round(item.duration * item.speed) });
        consume.push(item.id);
      });
    };
    take(visual, m => m.kind !== "audio");
    take(audio, m => m.kind === "audio");
    if (consume.length) return { fills, consume, at: Math.min(...consume.map(id => findItem(p, id)!.item.start)) };
  }

  const inUse = new Set(p.tracks.flatMap(tr => tr.items.flatMap(i => (i.type === "media" ? [i.mediaId] : []))));
  const library = Object.values(p.media);
  const fresh = (kinds: (m: MediaRef) => boolean) => [...library.filter(m => kinds(m) && !inUse.has(m.id)), ...library.filter(m => kinds(m) && inUse.has(m.id))];
  const give = (slots: TemplateSlot[], pool: MediaRef[]) =>
    slots.forEach((slot, n) => {
      const media = pool[n];
      if (media) fills.set(slot.id, { media, in: 0, span: media.kind === "image" ? Infinity : media.duration });
    });
  give(visual, fresh(m => m.kind !== "audio"));
  give(audio, fresh(m => m.kind === "audio"));
  return { fills, consume: [] };
}

/** The look of a caption template in a project's own frame. */
export function captionLook(t: Template, p: Project): CaptionTemplate | null {
  if (t.kind !== "captions" || !t.captions) return null;
  const k = Math.sqrt((p.settings.width / t.frame.width) * (p.settings.height / t.frame.height));
  return {
    style: { ...scaleStyle(t.captions.style, k), text: "" },
    highlight: t.captions.highlight,
    y: Math.round(t.captions.y * p.settings.height),
    animationIn: t.captions.animationIn && { ...t.captions.animationIn },
  };
}

/** Restyle the given captions, or all of them. Returns the same project when there are none. */
export function applyCaptionStyle(p: Project, t: Template, only?: readonly string[]): Project {
  const look = captionLook(t, p);
  return look ? restyleCaptions(p, look, only) : p;
}

const SAMPLE_WORDS = ["Wait", "for", "the", "good", "part"];

/** A project that shows the template on stand in pictures, in the template's own frame. */
export function previewProject(t: Template): Project {
  const base = createProject(t.name, { width: t.frame.width, height: t.frame.height, background: "#101113" });
  if (t.kind === "captions") {
    const look = captionLook(t, base)!;
    const step = 450_000;
    const words = SAMPLE_WORDS.map((text, i) => ({ text, start: i * step, end: (i + 1) * step }));
    const caption: CaptionItem = {
      id: "preview-caption",
      type: "caption",
      start: 0,
      duration: SAMPLE_WORDS.length * step,
      transform: { ...IDENTITY, y: look.y },
      style: look.style,
      words,
      highlight: look.highlight,
      animationIn: look.animationIn,
    };
    const lane = { id: "preview-text", kind: "text" as const, name: "Captions", items: [caption] };
    return { ...base, tracks: [lane, ...base.tracks] };
  }
  const fills = new Map<string, SlotFill>();
  for (const slot of t.slots) {
    if (slot.kind !== "visual") continue;
    const media: MediaRef = { id: `slot-${slot.id}`, kind: "image", path: "", name: slot.label, size: 0, mtime: 0, duration: 5_000_000, hasAudio: false, hasVideo: true, width: t.frame.width, height: t.frame.height };
    fills.set(slot.id, { media, in: 0, span: Infinity });
  }
  return applyTemplate(base, t, { at: 0, fills }).project;
}

/** A moment that shows the template at its fullest: the one with the most graphics on screen, nearest the middle on a tie. */
export function posterTime(p: Project): Micros {
  const length = Math.max(...p.tracks.flatMap(tr => tr.items.map(itemEnd)), 1);
  let best = 0;
  let bestScore = -1;
  for (let n = 0; n < 24; n++) {
    const t = Math.round((length * (n + 0.5)) / 24);
    const score = buildScene(p, t).reduce((sum, node) => sum + (node.kind === "visual" ? (node.visual.kind === "media" ? 0.2 : 1) : 1), 0) - Math.abs(t / length - 0.5) * 0.1;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}
