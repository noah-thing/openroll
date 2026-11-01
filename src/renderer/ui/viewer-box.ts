import { useRef, useState } from "react";
import { readAt } from "../../core/look/animated";
import { findItem, itemEnd, type MediaItem, type Micros } from "../../core/project";
import { useEditor, useFrame } from "../lib/hooks";
import type { Editor } from "../state/editor";
import { baseSize } from "./TransformBox";

export interface BoxGeometry {
  item: MediaItem;
  /** Playhead inside the clip. */
  local: Micros;
  /** The clip's uncropped box on screen, in pixels of the viewer frame. */
  w: number;
  h: number;
  cx: number;
  cy: number;
  rotation: number;
  /** Screen pixels per project pixel. */
  k: number;
}

/** Where the selected picture clip sits in the viewer right now, following its keyframes. */
export function useSelectedBox(editor: Editor, width: number, height: number): BoxGeometry | null {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [, tick] = useState(0);
  const found = selection.length === 1 ? findItem(project, selection[0]) : null;
  const item = found?.item.type === "media" ? found.item : null;
  const animated = !!item?.keyframes && Object.keys(item.keyframes).length > 0;
  const shown = useRef(false);
  const lastT = useRef(-1);
  useFrame(() => {
    const t = editor.time;
    const visible = !!item && t >= item.start && t < itemEnd(item);
    if (visible !== shown.current || (visible && animated && lastT.current !== t)) {
      shown.current = visible;
      lastT.current = t;
      tick(n => n + 1);
    }
  });
  if (!item || !width) return null;
  const t = editor.time;
  if (t < item.start || t >= itemEnd(item)) return null;
  const size = baseSize(project, item);
  if (!size) return null;
  const local = t - item.start;
  const k = width / project.settings.width;
  const scale = readAt(item, "transform.scale", local);
  const w = size.width * scale * k;
  const h = size.height * scale * k;
  return {
    item,
    local,
    w,
    h,
    cx: width / 2 + readAt(item, "transform.x", local) * k,
    cy: height / 2 + readAt(item, "transform.y", local) * k,
    rotation: readAt(item, "transform.rotation", local),
    k,
  };
}

/** A pointer position as pixels from the clip's centre, in the clip's own turned axes. */
export function toBoxSpace(g: BoxGeometry, frame: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const px = clientX - frame.left - g.cx;
  const py = clientY - frame.top - g.cy;
  const a = (-g.rotation * Math.PI) / 180;
  return { x: px * Math.cos(a) - py * Math.sin(a), y: px * Math.sin(a) + py * Math.cos(a) };
}
