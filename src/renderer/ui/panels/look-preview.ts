import { useEffect, useRef, useState } from "react";
import { sourceTime, type MediaItem, type Project } from "../../../core/project";
import { Compositor, type Layer } from "../../../engine/compositor";
import { syncLuts } from "../../../engine/layer-look";
import { useEditor, useFrame } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { grabFrame } from "../../state/frame-grab";
import { abstractFrames } from "./transition-preview";

export const CARD_W = 288;
export const CARD_H = 162;

let shared: Compositor | null = null;
let abstract: OffscreenCanvas | null = null;
const ids = new WeakMap<object, number>();
let nextId = 1;

let unavailable = false;

/** Null where the machine has no WebGL2; cards then show the plain picture. */
function compositor(): Compositor | null {
  if (!shared && !unavailable) {
    try {
      shared = new Compositor(new OffscreenCanvas(CARD_W, CARD_H));
    } catch {
      unavailable = true;
    }
  }
  return shared;
}

/** The neutral stand in when the project has nothing to show yet. */
export function fallbackFrame(): OffscreenCanvas {
  return (abstract ??= abstractFrames()[0]);
}

/** Render `fields` on top of a picture into a 2D canvas, at card resolution. */
export function drawLook(target: HTMLCanvasElement, source: CanvasImageSource, fields: Partial<Layer>, project?: Project, moving = false): void {
  const c = compositor();
  if (!c) return plain(target, source);
  if (!moving) c.resetTrails();
  if (project) syncLuts(c, project);
  c.resize(CARD_W, CARD_H, CARD_W, CARD_H);
  let id = ids.get(source);
  if (!id) ids.set(source, (id = nextId++));
  const layer: Layer = {
    x: 0,
    y: 0,
    width: CARD_W,
    height: CARD_H,
    rotation: 0,
    opacity: 1,
    ...fields,
    source: { key: "look-src", pixels: source as OffscreenCanvas, version: id, width: CARD_W, height: CARD_H },
  };
  c.render([{ kind: "layer", layer }], [0, 0, 0]);
  const bmp = (c.canvas as OffscreenCanvas).transferToImageBitmap();
  if (target.width !== CARD_W) target.width = CARD_W;
  if (target.height !== CARD_H) target.height = CARD_H;
  target.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
}

export interface Footage {
  source: CanvasImageSource;
  /** True when this is the user's own picture, false for the neutral stand in. */
  own: boolean;
  /** Changes whenever the picture does, so cards know to redraw. */
  key: string;
}

/** The frame under the playhead of the selected clip, or of the top clip at the playhead. */
export function useFootage(editor: Editor): Footage {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [want, setWant] = useState("");
  const [frame, setFrame] = useState<{ key: string; canvas: OffscreenCanvas } | null>(null);
  const latest = useRef({ project, selection });
  latest.current = { project, selection };

  useFrame(() => {
    if (editor.player?.playing) return;
    const k = lookTarget(latest.current.project, latest.current.selection, editor.time);
    const next = k ? `${k.item.mediaId}:${Math.round(k.seconds * 3)}` : "";
    if (next !== want) setWant(next);
  });

  useEffect(() => {
    if (!want) {
      setFrame(null);
      return;
    }
    const t = lookTarget(latest.current.project, latest.current.selection, editor.time);
    if (!t) return;
    let live = true;
    const timer = setTimeout(() => {
      void grabFrame(t.media, t.seconds).then(canvas => {
        if (live && canvas) setFrame({ key: want, canvas });
        else if (live) setFrame(null);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [want, editor]);

  return frame ? { source: frame.canvas, own: true, key: frame.key } : { source: fallbackFrame(), own: false, key: "abstract" };
}

/** The clip a filter or effect click lands on: the selected clip, else the top one under the playhead. */
export function lookTarget(p: Project, selection: string[], t: number): { item: MediaItem; media: Project["media"][string]; seconds: number } | null {
  const visual = (i: { type: string }) => i.type === "media";
  let pick: MediaItem | null = null;
  if (selection.length === 1) {
    for (const tr of p.tracks) {
      const hit = tr.items.find(i => i.id === selection[0]);
      if (hit && visual(hit)) pick = hit as MediaItem;
    }
  }
  if (!pick) {
    for (const tr of p.tracks) {
      if (tr.kind !== "video" || tr.hidden) continue;
      const hit = tr.items.find(i => visual(i) && t >= i.start && t < i.start + i.duration);
      if (hit) {
        pick = hit as MediaItem;
        break;
      }
    }
  }
  if (!pick) return null;
  const media = p.media[pick.mediaId];
  if (!media || media.kind === "audio") return null;
  return { item: pick, media, seconds: media.kind === "video" ? sourceTime(pick, Math.min(Math.max(t, pick.start), pick.start + pick.duration - 1), media.duration) / 1e6 : 0 };
}

function plain(target: HTMLCanvasElement, source: CanvasImageSource): void {
  const g = target.getContext("2d");
  if (!g) return;
  target.width = target.width || 288;
  target.height = target.height || 162;
  g.drawImage(source, 0, 0, target.width, target.height);
}
