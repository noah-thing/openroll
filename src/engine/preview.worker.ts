/// <reference lib="webworker" />
import { ALL_FORMATS, Input, UrlSource, type InputVideoTrack } from "mediabunny";
import { Compositor, type Layer, type Node } from "./compositor";
import { VideoReader } from "./video-reader";
import { decodesTooSlowly } from "./proxy-policy";
import { rasterText } from "./text";
import { rasterShape } from "./shape-raster";
import { loadFonts } from "./fonts";
import { buildScene, frameNeeds, type SceneNode, type Visual } from "../core/scene";
import { layerFields, syncLuts } from "./layer-look";
import { aiLayerFields, nextFrameTime, temporalLayer, temporalPlan } from "./ai/apply";
import { AiStore } from "./ai/store";
import type { MediaRef, Project } from "../core/project";
import type { PreviewIn, PreviewOut } from "./preview-protocol";

declare const self: DedicatedWorkerGlobalScope;

let compositor: Compositor | null = null;
let project: Project | null = null;
let urls: Record<string, string> = {};
let outW = 960, outH = 540;

let playing = false;
let clockT = 0;
let clockAt = 0;
let rate = 1;
let stillT = 0;
let dirty = true;
let fontsReady = false;
const aiStore = new AiStore();
let renderTime = 0;
let lostReported = false;
let lastError = "";

interface Source {
  input: Input;
  track: Promise<InputVideoTrack | null>;
  url: string;
}
const sources = new Map<string, Source>();
const readers = new Map<string, { reader: VideoReader | null; lastUsed: number; mediaId: string }>();
const reportedSlow = new Set<string>();
/** Readers kept warm for clips that are not on screen. Every one holds a decoder, and hardware decoders run out fast. */
const OFFSCREEN_READERS = 6;
const images = new Map<string, ImageBitmap | Promise<ImageBitmap | null>>();

const stats = { frames: 0, late: 0, since: performance.now(), worst: 0, settles: [] as number[] };

const now = () => performance.timeOrigin + performance.now();
const post = (m: PreviewOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function currentTime(): number {
  return playing ? clockT + (now() - clockAt) * 1000 * rate : stillT;
}

self.onmessage = (e: MessageEvent<PreviewIn>) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      try {
        compositor = makeCompositor(m.canvas);
        void loadFonts(self.fonts).then(() => {
          fontsReady = true;
          dirty = true;
          post({ type: "ready" });
        });
      } catch (err) {
        post({ type: "error", message: (err as Error).message });
      }
      break;
    case "project":
      project = m.project;
      urls = m.urls;
      pruneSources();
      dirty = true;
      break;
    case "size":
      outW = m.width;
      outH = m.height;
      dirty = true;
      break;
    case "ai":
      aiStore.sync(m.sync);
      dirty = true;
      break;
    case "decode":
      if (VideoReader.preferHardware === m.hardware) break;
      VideoReader.preferHardware = m.hardware;
      // Readers are made on demand, so dropping them is enough for the new choice to apply.
      for (const r of readers.values()) r.reader?.dispose();
      readers.clear();
      dirty = true;
      break;
    case "clock":
      playing = m.playing;
      clockT = m.t;
      clockAt = m.at;
      rate = m.rate;
      if (!playing) stillT = m.t;
      dirty = true;
      break;
    case "snapshot":
      void snapshot(m);
      break;
  }
};

function makeCompositor(canvas: OffscreenCanvas): Compositor {
  const c = new Compositor(canvas);
  c.onRestored = () => {
    try {
      compositor = makeCompositor(canvas);
      lostReported = false;
      dirty = true;
    } catch (err) {
      post({ type: "error", message: (err as Error).message });
    }
  };
  return c;
}

function sourceFor(media: MediaRef): Source | null {
  let s = sources.get(media.id);
  if (s) return s;
  const url = urls[media.id];
  if (!url) return null;
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  s = { input, track: input.getPrimaryVideoTrack().catch(() => null), url };
  sources.set(media.id, s);
  return s;
}

function readerFor(itemId: string, media: MediaRef): VideoReader | null {
  const hit = readers.get(itemId);
  if (hit) {
    hit.lastUsed = performance.now();
    return hit.reader;
  }
  const src = sourceFor(media);
  if (!src) return null;
  const slot: { reader: VideoReader | null; lastUsed: number; mediaId: string } = { reader: null, lastUsed: performance.now(), mediaId: media.id };
  readers.set(itemId, slot);
  void src.track.then(track => {
    if (!track || readers.get(itemId) !== slot) {
      if (readers.get(itemId) === slot) readers.delete(itemId);
      return;
    }
    slot.reader = new VideoReader(track, media.duration / 1e6);
    slot.reader.onFrame = () => (dirty = true);
    slot.reader.onSettle = ms => stats.settles.push(ms);
    dirty = true;
  });
  return null;
}

function imageFor(media: MediaRef): ImageBitmap | null {
  const hit = images.get(media.id);
  if (hit instanceof ImageBitmap) return hit;
  if (hit) return null;
  const url = urls[media.id];
  if (!url) return null;
  const p = fetch(url)
    .then(r => r.blob())
    .then(b => createImageBitmap(b, { imageOrientation: "from-image" }))
    .then(bmp => {
      images.set(media.id, bmp);
      dirty = true;
      return bmp;
    })
    .catch(() => null);
  images.set(media.id, p);
  return null;
}

/** A source whose url changed (a proxy finished, a file was relinked) is read afresh from the new place. */
function dropChangedSources(): void {
  for (const [id, s] of sources) {
    if (urls[id] === s.url) continue;
    for (const [itemId, r] of readers) if (r.mediaId === id) {
      r.reader?.dispose();
      readers.delete(itemId);
    }
    s.input.dispose();
    sources.delete(id);
    const img = images.get(id);
    if (img instanceof ImageBitmap) img.close();
    images.delete(id);
  }
}

function pruneSources(): void {
  if (!project) return;
  dropChangedSources();
  const live = new Set<string>();
  const liveItems = new Set<string>();
  for (const t of project.tracks) for (const i of t.items) if (i.type === "media") {
    live.add(i.mediaId);
    liveItems.add(i.id);
  }
  for (const [id, r] of readers) if (!liveItems.has(id.replace(/#n$/, ""))) {
    r.reader?.dispose();
    readers.delete(id);
  }
  for (const [id, s] of sources) if (!live.has(id) && !project.media[id]) {
    s.input.dispose();
    sources.delete(id);
  }
  for (const [id, img] of images) if (!project.media[id]) {
    if (img instanceof ImageBitmap) img.close();
    images.delete(id);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  if (!/^#?[0-9a-f]{6}/i.test(hex)) return [0, 0, 0];
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toLayer(v: Visual, p: Project, scale: number): Layer | null {
  const place = v.place;
  const base = layerFields(place, v.kind === "media" && v.item.id === bareItem);
  if (v.kind === "color") return { ...base, color: hexToRgb(v.item.color) };
  if (v.kind === "shape") {
    const w = base.width, h = base.height;
    const r = rasterShape(v.item.shape, v.item.width, v.item.height, w * scale, h * scale);
    return { ...base, source: { key: v.item.id, pixels: r.canvas, version: r.key, width: r.canvas.width, height: r.canvas.height, premultiplied: false } };
  }
  if (v.kind === "text") {
    if (!fontsReady) return null;
    const s = v.item.style;
    const userScale = place.width / p.settings.width;
    const raster = rasterText(s, v.text, v.highlight, v.item.type === "caption" ? v.item.highlight : undefined, p.settings.width * 0.86, scale * userScale * place.animScale);
    return {
      ...base,
      width: raster.width * userScale * place.animScale,
      height: raster.height * userScale * place.animScale,
      source: { key: v.item.id, pixels: raster.canvas, version: raster.key, width: raster.canvas.width, height: raster.canvas.height, premultiplied: false },
    };
  }
  const ai = aiLayerFields(aiStore, p, v, renderTime);
  if (v.media.kind === "image") {
    const bmp = imageFor(v.media);
    if (!bmp) return null;
    return { ...base, ...ai, source: { key: "img:" + v.media.id, pixels: bmp, version: 1, width: bmp.width, height: bmp.height } };
  }
  const reader = readerFor(v.item.id, v.media);
  if (!reader) return null;
  reader.want(v.sourceTime / 1e6, playing);
  const f = reader.frame();
  if (!f) return null;
  if (!f.exact) stats.late++;
  let frame: VideoFrame | null = null;
  try {
    frame = f.sample.toVideoFrame();
  } catch {
    return null;
  }
  pendingClose.push(frame);
  const layer: Layer = {
    ...base,
    ...ai,
    source: { key: v.item.id, pixels: frame, version: f.version, width: frame.codedWidth, height: frame.codedHeight, rotation: f.sample.rotation },
  };
  const plan = base.opacity > 0 ? temporalPlan(v.item, v.media) : null;
  if (plan) {
    // a second reader sits one source frame ahead; until it has that frame the picture is drawn as is
    const ahead = readerFor(v.item.id + "#n", v.media);
    const t = v.sourceTime / 1e6;
    if (ahead) {
      ahead.want(nextFrameTime(v.media, t), playing);
      const g = ahead.frame();
      if (g && g.exact && g.sample.timestamp > f.sample.timestamp) {
        try {
          const next = g.sample.toVideoFrame();
          pendingClose.push(next);
          layer.temporal = temporalLayer(plan, f.sample, g.sample, t, { key: v.item.id + "#n", pixels: next, version: g.version, width: next.codedWidth, height: next.codedHeight, rotation: g.sample.rotation });
        } catch {
          /* the frame went away mid read; draw without it */
        }
      }
    }
  }
  return layer;
}

const pendingClose: VideoFrame[] = [];

function toNodes(scene: SceneNode[], p: Project, scale: number): Node[] {
  const out: Node[] = [];
  for (const n of scene) {
    if (n.kind === "visual") {
      const l = toLayer(n.visual, p, scale);
      if (l) out.push({ kind: "layer", layer: l });
    } else {
      const a = toLayer(n.a, p, scale);
      const b = toLayer(n.b, p, scale);
      if (a && b) out.push({ kind: "transition", a: [a], b: [b], transition: n.transition, progress: n.progress });
      else if (a || b) out.push({ kind: "layer", layer: (a ?? b)! });
    }
  }
  return out;
}

/** Wake decoders for clips that start soon, so a cut never waits on a cold decoder. */
function prewarm(p: Project, t: number): void {
  for (const ahead of [400_000, 1_200_000]) {
    const needs = frameNeeds(buildScene(p, t + ahead));
    for (const [itemId, need] of needs) {
      if (need.media.kind !== "video") continue;
      // An idle reader parked on its first frame costs one decode and makes the cut instant.
      const r = readerFor(itemId, need.media);
      if (r && !onScreen.has(itemId)) r.want(need.sourceTime / 1e6, false);
    }
  }
}

const onScreen = new Set<string>();
/** While set, this item renders without its look, for picking a key colour from the raw picture. */
let bareItem: string | null = null;

function renderAt(t: number, live: boolean): void {
  if (!compositor || !project) return;
  const p = project;
  const scale = outW / p.settings.width;
  renderTime = t;
  syncLuts(compositor, p);
  compositor.resize(outW, outH, p.settings.width, p.settings.height);
  const scene = buildScene(p, t);
  onScreen.clear();
  for (const id of frameNeeds(scene).keys()) onScreen.add(id), onScreen.add(id + "#n");
  try {
    compositor.render(toNodes(scene, p, scale), hexToRgb(p.settings.background));
  } finally {
    while (pendingClose.length) pendingClose.pop()!.close();
  }
  if (live && playing) prewarm(p, t);
  trimReaders();
}

/** Scrubbing across hundreds of clips opens a decoder per clip; keep only the most recent few of those off screen. */
function trimReaders(): void {
  const parked = [...readers].filter(([id]) => !onScreen.has(id));
  if (parked.length <= OFFSCREEN_READERS) return;
  parked.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [id, r] of parked.slice(0, parked.length - OFFSCREEN_READERS)) {
    r.reader?.dispose();
    readers.delete(id);
  }
}

let snapshotting = false;

async function snapshot(m: Extract<PreviewIn, { type: "snapshot" }>): Promise<void> {
  if (!compositor || !project) return;
  snapshotting = true;
  const keepW = outW, keepH = outH;
  try {
    if (m.width) {
      outW = Math.max(2, Math.round(m.width / 2) * 2);
      outH = Math.max(2, Math.round((outW * project.settings.height) / project.settings.width / 2) * 2);
    }
    bareItem = m.bare ?? null;
    for (let tries = 0; ; tries++) {
      renderAt(m.t, false);
      if (!m.settle || tries > 60 || settled(m.t)) break;
      await new Promise(r => setTimeout(r, 40));
    }
    post({ type: "snapshot", id: m.id, image: compositor.snapshot() });
  } finally {
    bareItem = null;
    outW = keepW;
    outH = keepH;
    snapshotting = false;
    dirty = true;
  }
}

/** Every clip visible at t has its exact frame decoded, and text has its fonts. */
function settled(t: number): boolean {
  if (!project || !fontsReady) return false;
  for (const [id, need] of frameNeeds(buildScene(project, t))) {
    if (need.media.kind === "image") {
      if (!(images.get(need.media.id) instanceof ImageBitmap)) return false;
      continue;
    }
    const r = readers.get(id)?.reader;
    if (!r?.frame()?.exact) return false;
  }
  return true;
}

function loop(): void {
  const start = performance.now();
  if (compositor?.isLost && !lostReported) {
    lostReported = true;
    post({ type: "error", message: "The graphics device was reset." });
  }
  if ((playing || dirty) && !snapshotting) {
    dirty = false;
    try {
      renderAt(currentTime(), true);
      lastError = "";
    } catch (err) {
      // One bad frame must not end the render loop; say it once, not sixty times a second.
      const message = (err as Error).message;
      if (message !== lastError) post({ type: "error", message });
      lastError = message;
    }
    stats.frames++;
    stats.worst = Math.max(stats.worst, performance.now() - start);
  }
  if (performance.now() - stats.since > 1000) {
    const settles = stats.settles.sort((a, b) => a - b);
    const seekMs = settles.length ? Math.round(settles[Math.floor(settles.length / 2)]) : 0;
    const seekP95 = settles.length ? Math.round(settles[Math.floor(settles.length * 0.95)]) : 0;
    post({ type: "stats", fps: stats.frames, late: stats.late, worstMs: Math.round(stats.worst * 10) / 10, readers: readers.size, open: VideoReader.openSamples, decoders: VideoReader.openDecoders, seekMs, seekP95, seeks: settles.length });
    stats.settles = [];
    stats.frames = 0;
    stats.late = 0;
    stats.worst = 0;
    stats.since = performance.now();
    collectIdleReaders();
    reportSlowReaders();
  }
  self.requestAnimationFrame(loop);
}

function reportSlowReaders(): void {
  for (const r of readers.values()) {
    const rd = r.reader;
    if (!rd || reportedSlow.has(r.mediaId) || !decodesTooSlowly(rd.playedFrames, rd.lateFrames)) continue;
    reportedSlow.add(r.mediaId);
    post({ type: "slow-decode", mediaId: r.mediaId });
  }
}

function collectIdleReaders(): void {
  const cutoff = performance.now() - 4000;
  for (const [id, r] of readers) if (r.lastUsed < cutoff && !onScreen.has(id)) {
    r.reader?.dispose();
    readers.delete(id);
  }
}

self.requestAnimationFrame(loop);
