import { buildScene, type SceneNode, type Visual } from "../../../core/scene";
import { posterTime, previewProject } from "../../../core/template-apply";
import type { Template } from "../../../core/template";
import type { Micros, Project } from "../../../core/project";
import { Compositor, type Layer, type Node } from "../../../engine/compositor";
import { layerFields } from "../../../engine/layer-look";
import { rasterShape } from "../../../engine/shape-raster";
import { rasterText } from "../../../engine/text";

/** Longest side of a card picture, in pixels. The card shows it smaller, so it stays sharp on dense screens. */
const LONG_SIDE = 320;

export interface Preview {
  project: Project;
  poster: Micros;
  length: Micros;
  width: number;
  height: number;
  /** Stand in pictures for the slots, by the media id the preview project gave them. */
  pictures: Map<string, OffscreenCanvas>;
  /** Behind graphics that have no picture of their own, so a title is judged on something and not on black. */
  backdrop?: OffscreenCanvas;
}

let shared: Compositor | null = null;
let unavailable = false;
let fonts: Promise<unknown> | null = null;

function compositor(): Compositor | null {
  if (!shared && !unavailable) {
    try {
      shared = new Compositor(new OffscreenCanvas(LONG_SIDE, LONG_SIDE));
    } catch {
      unavailable = true;
    }
  }
  return shared;
}

/** Text drawn before the face is ready would be cached in the fallback font. */
export function previewFontsReady(): Promise<unknown> {
  fonts ??= Promise.all([700, 400].map(w => document.fonts.load(`${w} 32px "Familjen Grotesk"`).catch(() => [])));
  return fonts;
}

const TONES: [string, string, string][] = [
  ["#2f4a43", "#d9cfb8", "#1d2f2a"],
  ["#4a3b52", "#e8c9a0", "#2f2437"],
  ["#2e3f5c", "#f0d9a8", "#1c2840"],
  ["#5a3a35", "#cfe0d4", "#3a2321"],
  ["#3d4f35", "#e6dcc4", "#27331f"],
  ["#26333d", "#e2b8a0", "#161f26"],
];

/** Colour blocks and a circle: nothing that reads as footage, but enough to show how a layout cuts the picture. */
function picture(n: number, width: number, height: number): OffscreenCanvas {
  const [ground, light, dark] = TONES[n % TONES.length];
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext("2d")!;
  g.fillStyle = ground;
  g.fillRect(0, 0, width, height);
  g.fillStyle = dark;
  g.beginPath();
  g.moveTo(width * 0.45, height);
  g.lineTo(width * 0.72, 0);
  g.lineTo(width, 0);
  g.lineTo(width, height);
  g.closePath();
  g.fill();
  g.fillStyle = light;
  g.beginPath();
  g.arc(width * 0.34, height * 0.5, Math.min(width, height) * 0.24, 0, Math.PI * 2);
  g.fill();
  return c;
}

const cache = new WeakMap<Template, Preview>();

export function previewOf(t: Template): Preview {
  let pv = cache.get(t);
  if (pv) return pv;
  const project = previewProject(t);
  const k = LONG_SIDE / Math.max(t.frame.width, t.frame.height);
  const width = Math.max(2, Math.round(t.frame.width * k));
  const height = Math.max(2, Math.round(t.frame.height * k));
  const pictures = new Map<string, OffscreenCanvas>();
  t.slots.forEach((slot, n) => pictures.set(`slot-${slot.id}`, picture(n, width, height)));
  const covers = t.tracks.some(tr => tr.items.some(i => i.type === "slot" || i.type === "color"));
  const length = Math.max(1, ...project.tracks.flatMap(tr => tr.items.map(i => i.start + i.duration)));
  pv = { project, poster: posterTime(project), length, width, height, pictures, backdrop: covers ? undefined : picture(0, width, height) };
  cache.set(t, pv);
  return pv;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const versionOf = (o: object): number => ids.get(o) ?? (ids.set(o, nextId), nextId++);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function layerFor(v: Visual, pv: Preview, scale: number): Layer | null {
  const base = layerFields(v.place);
  const p = pv.project;
  switch (v.kind) {
    case "color":
      return { ...base, color: rgb(v.item.color) };
    case "shape": {
      const r = rasterShape(v.item.shape, v.item.width, v.item.height, base.width * scale, base.height * scale);
      return { ...base, source: { key: v.item.id, pixels: r.canvas, version: r.key, width: r.canvas.width, height: r.canvas.height, premultiplied: false } };
    }
    case "text": {
      const userScale = v.place.width / p.settings.width;
      const raster = rasterText(v.item.style, v.text, v.highlight, v.item.type === "caption" ? v.item.highlight : undefined, p.settings.width * 0.86, scale * userScale * v.place.animScale);
      return {
        ...base,
        width: raster.width * userScale * v.place.animScale,
        height: raster.height * userScale * v.place.animScale,
        source: { key: v.item.id, pixels: raster.canvas, version: raster.key, width: raster.canvas.width, height: raster.canvas.height, premultiplied: false },
      };
    }
    case "media": {
      const pixels = pv.pictures.get(v.media.id);
      return pixels ? { ...base, source: { key: v.item.id, pixels, version: versionOf(pixels), width: pixels.width, height: pixels.height } } : null;
    }
  }
}

function nodesFor(scene: SceneNode[], pv: Preview, scale: number): Node[] {
  const out: Node[] = [];
  if (pv.backdrop) {
    const { width, height } = pv.project.settings;
    out.push({ kind: "layer", layer: { x: 0, y: 0, width, height, rotation: 0, opacity: 1, source: { key: "backdrop", pixels: pv.backdrop, version: 1, width: pv.backdrop.width, height: pv.backdrop.height } } });
  }
  for (const n of scene) {
    if (n.kind === "visual") {
      const l = layerFor(n.visual, pv, scale);
      if (l) out.push({ kind: "layer", layer: l });
    } else {
      const a = layerFor(n.a, pv, scale);
      const b = layerFor(n.b, pv, scale);
      if (a && b) out.push({ kind: "transition", a: [a], b: [b], transition: n.transition, progress: n.progress });
      else if (a || b) out.push({ kind: "layer", layer: (a ?? b)! });
    }
  }
  return out;
}

/** One moment of the template, drawn by the same compositor the viewer uses. False where the machine has no WebGL2. */
export function drawPreview(target: HTMLCanvasElement, pv: Preview, t: Micros): boolean {
  const c = compositor();
  if (!c) return false;
  const p = pv.project;
  const scale = pv.width / p.settings.width;
  c.resize(pv.width, pv.height, p.settings.width, p.settings.height);
  c.render(nodesFor(buildScene(p, t), pv, scale), rgb(p.settings.background));
  const bmp = (c.canvas as OffscreenCanvas).transferToImageBitmap();
  if (target.width !== pv.width) target.width = pv.width;
  if (target.height !== pv.height) target.height = pv.height;
  target.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return true;
}
