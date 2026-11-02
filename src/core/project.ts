// The project document. Everything the user makes lives in this one plain object,
// which is saved as JSON. Times are integer microseconds everywhere, the same unit
// WebCodecs uses, so a frame timestamp can go straight into the model and back.

export type Micros = number;

export const SECOND: Micros = 1_000_000;

export interface Rational {
  num: number;
  den: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: Rational;
  sampleRate: number;
  /** Colour behind everything, as #rrggbb. */
  background: string;
  /** Show beat marks on music and snap to them. */
  autoBeat?: boolean;
}

export type MediaKind = "video" | "audio" | "image";

export interface MediaRef {
  id: string;
  kind: MediaKind;
  /** Absolute path on disk. Relinking replaces this, never the id. */
  path: string;
  name: string;
  size: number;
  /** File modification time when imported, used to notice changed sources. */
  mtime: number;
  /** The page cannot decode this file, so a converted copy in the cache stands in for it. The project still points at the original. */
  prepared?: boolean;
  duration: Micros;
  width?: number;
  height?: number;
  fps?: number;
  rotation?: 0 | 90 | 180 | 270;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  /** Beat times in microseconds, filled in by beat detection. */
  beats?: Micros[];
  bpm?: number;
  /** Integrated loudness in LUFS, measured once per file. */
  loudness?: number;
  /** Flat start, end pairs in microseconds where speech was detected. */
  speech?: Micros[];
  /** The person was already asked whether to caption this file, so they are not asked again. */
  captionsAsked?: boolean;
  /** Made by OpenRoll rather than imported. */
  origin?: "recording" | "speech" | "effect";
}

export type TrackKind = "video" | "audio" | "text";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** The main track is magnetic: items always sit edge to edge from zero. */
  main?: boolean;
  /** Set to false to let the main track behave like any other lane. */
  magnetic?: boolean;
  /** Lane height in pixels when the user has resized it. */
  height?: number;
  /** Made or shaped by the user, so it stays when it empties. */
  pinned?: boolean;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  items: Item[];
}

export interface Transform {
  /** Offset of the item's centre from the frame centre, in project pixels. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type BlendMode = "normal" | "screen" | "multiply" | "overlay" | "add" | "lighten" | "darken";

export interface Adjust {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vignette: number;
  /** 0..100: lifts the blacks and softens the whites. */
  fade: number;
  /** 0..100 */
  sharpen: number;
  /** 0..100 */
  grain: number;
}

export interface Effect {
  id: string;
  kind: string;
  /** 0..1 strength; kinds read extra values from params (speed, style). */
  amount: number;
  params?: Record<string, number>;
  /** Kept in the stack but not drawn. */
  off?: boolean;
}

export interface CurvePoint {
  x: number;
  y: number;
}

/** Each curve is a few control points in 0..1; a missing curve is the identity. */
export interface Curves {
  master?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslBand = (typeof HSL_BANDS)[number];
/** Each value runs -100..100. */
export type Hsl = Partial<Record<HslBand, { hue: number; sat: number; light: number }>>;

/** What shows behind a clip that does not cover the frame. */
export interface Fill {
  mode: "blur" | "color";
  color?: string;
  /** 0..1 */
  blur?: number;
}

/** A .cube LUT kept inside the project so it travels with the file. `data` is base64 of size^3 RGB bytes. */
export interface ImportedLut {
  name: string;
  size: number;
  data: string;
}

export interface Mask {
  shape: "rect" | "ellipse" | "linear" | "mirror";
  /** Centre offset from the item centre and size, as fractions of the item box. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  feather: number;
  invert: boolean;
}

export interface ChromaKey {
  color: string;
  similarity: number;
  smoothness: number;
  spill: number;
}

export interface AudioCleanup {
  denoise?: number;
  voice?: boolean;
  normalize?: boolean;
  /** Lower this item's volume while speech plays on other tracks. */
  duckUnder?: boolean;
}

export type VoiceFx = "pitchUp" | "pitchDown" | "robot" | "radio" | "echo" | "bigRoom";

export type Easing = "linear" | "ease" | "easeIn" | "easeOut" | "hold";

export interface Keyframe {
  /** Time relative to the item start. */
  t: Micros;
  v: number;
  ease: Easing;
}

/** Any numeric property path on an item can be animated, e.g. "transform.scale". */
export type KeyframeMap = Record<string, Keyframe[]>;

export interface Transition {
  kind: string;
  duration: Micros;
}

export interface TextStyle {
  text: string;
  /** A family from `fonts.ts`; the loader replaces anything else. */
  font: string;
  size: number;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  background?: { color: string; padding: number; radius: number };
}

export interface CaptionWord {
  text: string;
  start: Micros;
  end: Micros;
}

interface ItemBase {
  id: string;
  /** Position on the timeline. */
  start: Micros;
  duration: Micros;
  name?: string;
  /** Colour label shown on the clip, a key of the timeline palette. */
  color?: string;
  transform: Transform;
  keyframes?: KeyframeMap;
  transitionIn?: Transition;
  animationIn?: { kind: string; duration: Micros };
  animationOut?: { kind: string; duration: Micros };
}

export interface MediaItem extends ItemBase {
  type: "media";
  mediaId: string;
  /** Where in the source this item begins. */
  in: Micros;
  speed: number;
  volume: number;
  fadeIn: Micros;
  fadeOut: Micros;
  reversed?: boolean;
  crop?: Crop;
  blend?: BlendMode;
  adjust?: Partial<Adjust>;
  filter?: { id: string; amount: number };
  effects?: Effect[];
  mask?: Mask;
  chroma?: ChromaKey;
  curves?: Curves;
  hsl?: Hsl;
  fill?: Fill;
  /** Remove the background with the on device matting model. */
  cutout?: boolean;
  /** Smooth out camera shake. Strength runs 0..1 and sets how still the result is. */
  stabilize?: { strength: number };
  /** Clean up and sharpen a soft or noisy clip; `upscale` runs the super resolution model on export. */
  enhance?: { amount: number; upscale?: boolean };
  /** How frames are made up when the clip plays slower than the source. */
  slowMotion?: "blend" | "flow";
  /** Shutter amount, 0..1 of a frame, blurring fast moving content. */
  motionBlur?: { amount: number };
  audio?: AudioCleanup;
  /** Preset effect chain applied after cleanup. */
  voiceFx?: VoiceFx;
  /** Silence this item's own sound, e.g. after its audio was detached. */
  muteAudio?: boolean;
  /** Shared by a video item and the audio item detached from it. */
  link?: string;
  freeze?: boolean;
}

export interface TextItem extends ItemBase {
  type: "text";
  style: TextStyle;
}

export interface CaptionItem extends ItemBase {
  type: "caption";
  style: TextStyle;
  words: CaptionWord[];
  highlight?: string;
}

export interface ColorItem extends ItemBase {
  type: "color";
  color: string;
}

export type ShapeKind = "rect" | "ellipse" | "line" | "sticker";

export interface ShapeStyle {
  kind: ShapeKind;
  /** Which drawn sticker, for kind "sticker". */
  sticker?: string;
  /** Main colour: the fill of a rectangle or ellipse, the ink of a line or sticker. */
  color: string;
  /** Outline for a rectangle or ellipse, in project pixels. */
  stroke?: { color: string; width: number };
  /** Rectangle corner radius in project pixels. */
  radius?: number;
  /** Line thickness in project pixels, for kind "line". */
  thickness?: number;
  /** Sticker line weight, 1 is the drawn weight. */
  weight?: number;
  /** Rectangles and ellipses start filled; turn it off for an outline only. */
  noFill?: boolean;
}

/** A drawn shape or sticker. Its box is width by height project pixels at scale 1. */
export interface ShapeItem extends ItemBase {
  type: "shape";
  shape: ShapeStyle;
  width: number;
  height: number;
}

export type Item = MediaItem | TextItem | CaptionItem | ColorItem | ShapeItem;

export interface Marker {
  id: string;
  t: Micros;
  label?: string;
  color?: string;
}

export interface Project {
  format: "openroll";
  version: 1;
  id: string;
  name: string;
  created: number;
  modified: number;
  settings: ProjectSettings;
  media: Record<string, MediaRef>;
  tracks: Track[];
  markers: Marker[];
  luts?: Record<string, ImportedLut>;
}

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

export function newId(prefix = ""): string {
  // 12 base36 characters from crypto: plenty for one person's projects, short in JSON.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return prefix + n.toString(36).padStart(12, "0").slice(-12);
}

export function createProject(name = "Untitled", settings?: Partial<ProjectSettings>): Project {
  const now = Date.now();
  return {
    format: "openroll",
    version: 1,
    id: newId("p"),
    name,
    created: now,
    modified: now,
    settings: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      sampleRate: 48_000,
      background: "#000000",
      ...settings,
    },
    media: {},
    tracks: [
      { id: newId("t"), kind: "video", name: "Main", main: true, items: [] },
      { id: newId("t"), kind: "audio", name: "Audio", items: [] },
    ],
    markers: [],
  };
}

export function itemEnd(item: Item): Micros {
  return item.start + item.duration;
}

export function projectDuration(p: Project): Micros {
  let end = 0;
  for (const t of p.tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
  return end;
}

export function frameDuration(p: Project): Micros {
  return Math.round((SECOND * p.settings.fps.den) / p.settings.fps.num);
}

export function findItem(p: Project, id: string): { track: Track; item: Item; index: number } | null {
  for (const track of p.tracks) {
    const index = track.items.findIndex(i => i.id === id);
    if (index >= 0) return { track, item: track.items[index], index };
  }
  return null;
}

export function mainTrack(p: Project): Track {
  const t = p.tracks.find(t => t.main);
  if (!t) throw new Error("project has no main track");
  return t;
}

/** Source time shown by a media item at a timeline time, honouring speed and reverse. */
export function sourceTime(item: MediaItem, t: Micros, mediaDuration: Micros): Micros {
  const local = Math.max(0, Math.min(item.duration, t - item.start));
  if (item.freeze) return item.in;
  const offset = local * item.speed;
  if (item.reversed) {
    const span = item.duration * item.speed;
    return Math.max(0, Math.min(mediaDuration, item.in + span - offset));
  }
  return Math.max(0, Math.min(mediaDuration, item.in + offset));
}

/** How much of the source an item consumes. */
export function sourceSpan(item: MediaItem): Micros {
  return item.freeze ? 0 : Math.round(item.duration * item.speed);
}
