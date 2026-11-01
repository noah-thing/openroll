import { useRef, useState } from "react";
import { updateItem } from "../../core/edit";
import { findItem, itemEnd, type Item, type Project } from "../../core/project";
import { fitSize } from "../../core/scene";
import { rasterText } from "../../engine/text";
import { useEditor, useFrame } from "../lib/hooks";
import type { Editor } from "../state/editor";

/** Size of an item's box in project pixels at its own scale of 1. */
function baseSize(p: Project, item: Item): { width: number; height: number } | null {
  if (item.type === "media") {
    const m = p.media[item.mediaId];
    if (!m || m.kind === "audio") return null;
    return fitSize(p, m);
  }
  if (item.type === "text") {
    const r = rasterText(item.style, item.style.text, -1, undefined, p.settings.width * 0.86, 0.25);
    return { width: r.width, height: r.height };
  }
  if (item.type === "color") return { width: p.settings.width, height: p.settings.height };
  return null;
}

const SNAP = 10;

/** Handles over the preview for moving and scaling the selected clip directly. */
export function TransformBox({ editor, width, height }: { editor: Editor; width: number; height: number }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [guides, setGuides] = useState({ x: false, y: false });
  const boxRef = useRef<HTMLDivElement>(null);
  const found = selection.length === 1 ? findItem(project, selection[0]) : null;
  const [onScreen, setOnScreen] = useState(false);
  useFrame(() => {
    const it = found?.item;
    const t = editor.time;
    const visible = !!it && t >= it.start && t < itemEnd(it);
    if (visible !== onScreen) setOnScreen(visible);
  });
  if (!found || !width || !onScreen) return null;
  const item = found.item;
  const size = baseSize(project, item);
  if (!size) return null;

  const k = width / project.settings.width;
  const t = item.transform;
  const w = size.width * t.scale * k;
  const h = size.height * t.scale * k;
  const cx = width / 2 + t.x * k;
  const cy = height / 2 + t.y * k;

  function drag(e: React.PointerEvent, mode: "move" | "scale") {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, scale: t.scale };
    const frame = boxRef.current!.parentElement!.getBoundingClientRect();
    const centre = { x: frame.left + cx, y: frame.top + cy };
    const d0 = Math.hypot(e.clientX - centre.x, e.clientY - centre.y) || 1;
    const group = `${item.id}:canvas-${mode}`;

    const move = (ev: PointerEvent) => {
      const current = findItem(editor.project, item.id)?.item;
      if (!current) return;
      if (mode === "move") {
        let x = start.tx + (ev.clientX - start.x) / k;
        let y = start.ty + (ev.clientY - start.y) / k;
        const sx = !ev.metaKey && !ev.ctrlKey && Math.abs(x) * k < SNAP;
        const sy = !ev.metaKey && !ev.ctrlKey && Math.abs(y) * k < SNAP;
        if (sx) x = 0;
        if (sy) y = 0;
        setGuides({ x: sx, y: sy });
        editor.apply("Move on canvas", p => updateItem(p, item.id, { transform: { ...current.transform, x: Math.round(x), y: Math.round(y) } }), group);
      } else {
        const d = Math.hypot(ev.clientX - centre.x, ev.clientY - centre.y);
        const scale = Math.max(0.05, Math.min(8, start.scale * (d / d0)));
        editor.apply("Scale on canvas", p => updateItem(p, item.id, { transform: { ...current.transform, scale: Math.round(scale * 1000) / 1000 } }), group);
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setGuides({ x: false, y: false });
      editor.endGroup();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <>
      {guides.x && <div className="guide guide-v" style={{ left: width / 2 }} />}
      {guides.y && <div className="guide guide-h" style={{ top: height / 2 }} />}
      <div
        ref={boxRef}
        className="tbox"
        style={{ width: w, height: h, transform: `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${t.rotation}deg)` }}
        onPointerDown={e => drag(e, "move")}
      >
        {(["nw", "ne", "sw", "se"] as const).map(c => (
          <span key={c} className={"tbox-h tbox-" + c} onPointerDown={e => drag(e, "scale")} />
        ))}
      </div>
    </>
  );
}
