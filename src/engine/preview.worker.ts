/// <reference lib="webworker" />
import { ALL_FORMATS, Input, UrlSource, type InputVideoTrack } from "mediabunny";
import { Compositor, type Layer, type Node } from "./compositor";
import { VideoReader } from "./video-reader";
import { rasterText } from "./text";
import { loadFonts } from "./fonts";
import { buildScene, frameNeeds, type SceneNode, type Visual } from "../core/scene";
import { layerFields, syncLuts } from "./layer-look";
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

interface Source {
  input: Input;
  track: Promise<InputVideoTrack | null>;
}
const sources = new Map<string, Source>();
const readers = new Map<string, { reader: VideoReader | null; lastUsed: number }>();
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
        compositor = new Compositor(m.canvas);
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
    case "clock":
      playing = m.playing;
      clockT = m.t;
      clockAt = m.at;
      rate = m.rate;
      if (!playing) stillT = m.t;
      dirty = true;
      break;
    case "snapshot":
      if (compositor) {
        bareItem = m.bare ?? null;
        renderAt(m.t, false);
        bareItem = null;
        post({ type: "snapshot", id: m.id, image: compositor.snapshot() });
      }
      break;
  }
};

function sourceFor(media: MediaRef): Source | null {
  let s = sources.get(media.id);
  if (s) return s;
  const url = urls[media.id];
  if (!url) return null;
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  s = { input, track: input.getPrimaryVideoTrack().catch(() => null) };
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
  const slot: { reader: VideoReader | null; lastUsed: number } = { reader: null, lastUsed: performance.now() };
  readers.set(itemId, slot);
  void src.track.then(track => {
    if (!track || !readers.has(itemId)) {
      readers.delete(itemId);
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

function pruneSources(): void {
  if (!project) return;
  const live = new Set<string>();
  const liveItems = new Set<string>();
  for (const t of project.tracks) for (const i of t.items) if (i.type === "media") {
    live.add(i.mediaId);
    liveItems.add(i.id);
  }
  for (const [id, r] of readers) if (!liveItems.has(id)) {
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
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toLayer(v: Visual, p: Project, scale: number): Layer | null {
  const place = v.place;
  const base = layerFields(place, v.kind === "media" && v.item.id === bareItem);
  if (v.kind === "color") return { ...base, color: hexToRgb(v.item.color) };
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
  if (v.media.kind === "image") {
    const bmp = imageFor(v.media);
    if (!bmp) return null;
    return { ...base, source: { key: "img:" + v.media.id, pixels: bmp, version: 1, width: bmp.width, height: bmp.height } };
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
  return {
    ...base,
    source: { key: v.item.id, pixels: frame, version: f.version, width: frame.codedWidth, height: frame.codedHeight, rotation: f.sample.rotation },
  };
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
  syncLuts(compositor, p);
  compositor.resize(outW, outH, p.settings.width, p.settings.height);
  const scene = buildScene(p, t);
  onScreen.clear();
  for (const id of frameNeeds(scene).keys()) onScreen.add(id);
  const nodes = toNodes(scene, p, scale);
  compositor.render(nodes, hexToRgb(p.settings.background));
  while (pendingClose.length) pendingClose.pop()!.close();
  if (live && playing) prewarm(p, t);
}

function loop(): void {
  const start = performance.now();
  if (compositor?.isLost) {
    post({ type: "error", message: "The graphics device was reset." });
    compositor = null;
  }
  if (playing || dirty) {
    dirty = false;
    renderAt(currentTime(), true);
    stats.frames++;
    stats.worst = Math.max(stats.worst, performance.now() - start);
  }
  if (performance.now() - stats.since > 1000) {
    const settles = stats.settles.sort((a, b) => a - b);
    const seekMs = settles.length ? Math.round(settles[Math.floor(settles.length / 2)]) : 0;
    const seekP95 = settles.length ? Math.round(settles[Math.floor(settles.length * 0.95)]) : 0;
    post({ type: "stats", fps: stats.frames, late: stats.late, worstMs: Math.round(stats.worst * 10) / 10, readers: readers.size, seekMs, seekP95, seeks: settles.length });
    stats.settles = [];
    stats.frames = 0;
    stats.late = 0;
    stats.worst = 0;
    stats.since = performance.now();
    collectIdleReaders();
  }
  self.requestAnimationFrame(loop);
}

function collectIdleReaders(): void {
  const cutoff = performance.now() - 4000;
  for (const [id, r] of readers) if (r.lastUsed < cutoff && !onScreen.has(id)) {
    r.reader?.dispose();
    readers.delete(id);
  }
}

self.requestAnimationFrame(loop);
