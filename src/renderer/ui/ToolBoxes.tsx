import { useEffect, useRef } from "react";
import { defaultMask } from "../../core/look/mask";
import type { Crop, Mask } from "../../core/project";
import { findItem, type MediaItem } from "../../core/project";
import type { Editor } from "../state/editor";
import { setTool, useTool } from "../state/tool";
import { toBoxSpace, useSelectedBox, type BoxGeometry } from "./viewer-box";

/** Crop, mask and key colour tools over the viewer. Only one is open at a time. */
export function ToolBoxes({ editor, width, height }: { editor: Editor; width: number; height: number }) {
  const geo = useSelectedBox(editor, width, height);
  const tool = useTool(geo?.item.id ?? null);
  if (!geo || !tool) return null;
  if (tool === "crop") return <CropBox editor={editor} geo={geo} />;
  if (tool === "mask" && geo.item.mask) return <MaskBox editor={editor} geo={geo} />;
  if (tool === "key") return <KeyPicker editor={editor} geo={geo} width={width} height={height} />;
  return null;
}

function frameOf(el: HTMLElement): DOMRect {
  return el.parentElement!.getBoundingClientRect();
}

function patch(editor: Editor, id: string, label: string, group: string, fn: (d: MediaItem) => void) {
  editor.apply(
    label,
    p => {
      const next = structuredClone(p);
      const hit = findItem(next, id);
      if (!hit || hit.item.type !== "media") return p;
      fn(hit.item);
      return next;
    },
    `${id}:${group}`,
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Run `move` for every pointer move until release, then close the undo group. */
function track(e: React.PointerEvent, editor: Editor, move: (ev: PointerEvent) => void) {
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    editor.endGroup();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

const NONE: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
const MIN_VISIBLE = 0.06;

function CropBox({ editor, geo }: { editor: Editor; geo: BoxGeometry }) {
  const ref = useRef<HTMLDivElement>(null);
  const { item, w, h } = geo;
  const c = item.crop ?? NONE;

  function drag(e: React.PointerEvent, edges: ("left" | "right" | "top" | "bottom" | "move")[]) {
    const frame = frameOf(ref.current!);
    const start = toBoxSpace(geo, frame, e.clientX, e.clientY);
    const from = { ...c };
    track(e, editor, ev => {
      const p = toBoxSpace(geo, frame, ev.clientX, ev.clientY);
      const next = { ...from };
      if (edges[0] === "move") {
        const dx = (p.x - start.x) / w, dy = (p.y - start.y) / h;
        const mx = clamp(dx, -from.left, from.right), my = clamp(dy, -from.top, from.bottom);
        next.left = from.left + mx;
        next.right = from.right - mx;
        next.top = from.top + my;
        next.bottom = from.bottom - my;
      } else {
        for (const edge of edges) {
          if (edge === "left") next.left = clamp((p.x + w / 2) / w, 0, 1 - from.right - MIN_VISIBLE);
          if (edge === "right") next.right = clamp(1 - (p.x + w / 2) / w, 0, 1 - from.left - MIN_VISIBLE);
          if (edge === "top") next.top = clamp((p.y + h / 2) / h, 0, 1 - from.bottom - MIN_VISIBLE);
          if (edge === "bottom") next.bottom = clamp(1 - (p.y + h / 2) / h, 0, 1 - from.top - MIN_VISIBLE);
        }
      }
      const out = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) as unknown as Crop;
      patch(editor, item.id, "Crop on canvas", "canvas-crop", d => {
        if (Object.values(out).every(v => v === 0)) delete d.crop;
        else d.crop = out;
      });
    });
  }

  const hs: { id: string; edges: ("left" | "right" | "top" | "bottom")[]; style: React.CSSProperties; cursor: string }[] = [
    { id: "nw", edges: ["left", "top"], style: { left: 0, top: 0 }, cursor: "nwse-resize" },
    { id: "n", edges: ["top"], style: { left: "50%", top: 0 }, cursor: "ns-resize" },
    { id: "ne", edges: ["right", "top"], style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
    { id: "e", edges: ["right"], style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
    { id: "se", edges: ["right", "bottom"], style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
    { id: "s", edges: ["bottom"], style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
    { id: "sw", edges: ["left", "bottom"], style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
    { id: "w", edges: ["left"], style: { left: 0, top: "50%" }, cursor: "ew-resize" },
  ];

  return (
    <div ref={ref} className="toolbox" style={{ width: w, height: h, transform: `translate(${geo.cx - w / 2}px, ${geo.cy - h / 2}px) rotate(${geo.rotation}deg)` }}>
      <div className="crop-dim" style={{ left: 0, top: 0, right: 0, height: c.top * h }} />
      <div className="crop-dim" style={{ left: 0, bottom: 0, right: 0, height: c.bottom * h }} />
      <div className="crop-dim" style={{ left: 0, top: c.top * h, width: c.left * w, bottom: c.bottom * h }} />
      <div className="crop-dim" style={{ right: 0, top: c.top * h, width: c.right * w, bottom: c.bottom * h }} />
      <div className="crop-win" style={{ left: c.left * w, top: c.top * h, right: c.right * w, bottom: c.bottom * h }} onPointerDown={e => drag(e, ["move"])}>
        <span className="crop-third crop-third-v" style={{ left: "33.33%" }} />
        <span className="crop-third crop-third-v" style={{ left: "66.66%" }} />
        <span className="crop-third crop-third-h" style={{ top: "33.33%" }} />
        <span className="crop-third crop-third-h" style={{ top: "66.66%" }} />
        {hs.map(hd => (
          <span key={hd.id} className="crop-h" style={{ ...hd.style, cursor: hd.cursor }} onPointerDown={e => drag(e, hd.edges)} />
        ))}
      </div>
    </div>
  );
}

function MaskBox({ editor, geo }: { editor: Editor; geo: BoxGeometry }) {
  const ref = useRef<HTMLDivElement>(null);
  const { item, w, h } = geo;
  const m = item.mask!;
  const hw = (m.width * w) / 2, hh = (m.height * h) / 2;
  const reach = Math.hypot(w, h);

  const set = (next: Partial<Mask>) => patch(editor, item.id, "Mask on canvas", "mask-canvas", d => void (d.mask = { ...(d.mask ?? defaultMask("ellipse")), ...next }));

  // Pointer in the mask's own turned axes, in pixels from its centre.
  function local(ev: PointerEvent | React.PointerEvent, frame: DOMRect) {
    const p = toBoxSpace(geo, frame, ev.clientX, ev.clientY);
    const x = p.x - m.x * w, y = p.y - m.y * h;
    const a = (-m.rotation * Math.PI) / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a), box: p };
  }

  function move(e: React.PointerEvent) {
    const frame = frameOf(ref.current!);
    const start = toBoxSpace(geo, frame, e.clientX, e.clientY);
    const from = { x: m.x, y: m.y };
    track(e, editor, ev => {
      const p = toBoxSpace(geo, frame, ev.clientX, ev.clientY);
      set({ x: Math.round((from.x + (p.x - start.x) / w) * 1000) / 1000, y: Math.round((from.y + (p.y - start.y) / h) * 1000) / 1000 });
    });
  }

  function size(e: React.PointerEvent, axis: "x" | "y") {
    const frame = frameOf(ref.current!);
    track(e, editor, ev => {
      const l = local(ev, frame);
      if (axis === "x") set({ width: Math.round(clamp((Math.abs(l.x) * 2) / w, 0.02, 2) * 1000) / 1000 });
      else set({ height: Math.round(clamp((Math.abs(l.y) * 2) / h, 0.02, 2) * 1000) / 1000 });
    });
  }

  function turn(e: React.PointerEvent) {
    const frame = frameOf(ref.current!);
    track(e, editor, ev => {
      const p = toBoxSpace(geo, frame, ev.clientX, ev.clientY);
      let deg = (Math.atan2(p.y - m.y * h, p.x - m.x * w) * 180) / Math.PI + 90;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 3) deg = snap;
      set({ rotation: Math.round(deg * 10) / 10 });
    });
  }

  const band = m.shape === "mirror";
  const line = m.shape === "linear";
  const shapeW = line || band ? reach * 1.5 : hw * 2;
  const shapeH = line ? reach * 1.5 : hh * 2;

  return (
    <div ref={ref} className="toolbox" style={{ width: w, height: h, transform: `translate(${geo.cx - w / 2}px, ${geo.cy - h / 2}px) rotate(${geo.rotation}deg)` }}>
      <div className="mshape-anchor" style={{ left: w / 2 + m.x * w, top: h / 2 + m.y * h, transform: `rotate(${m.rotation}deg)` }}>
        {line ? (
          <>
            <div className="mshape mshape-kept" style={{ width: shapeW, height: shapeH, left: -shapeW / 2, top: 0 }} onPointerDown={move} />
            <div className="mline" style={{ width: shapeW, left: -shapeW / 2, top: 0 }} />
          </>
        ) : (
          <div
            className={"mshape" + (m.shape === "ellipse" ? " mshape-round" : "")}
            style={{ width: shapeW, height: shapeH, left: -shapeW / 2, top: -shapeH / 2 }}
            onPointerDown={move}
          />
        )}
        {(m.shape === "rect" || m.shape === "ellipse") && (
          <>
            <span className="mh" style={{ left: hw, top: 0, cursor: "ew-resize" }} onPointerDown={e => size(e, "x")} />
            <span className="mh" style={{ left: -hw, top: 0, cursor: "ew-resize" }} onPointerDown={e => size(e, "x")} />
          </>
        )}
        {(m.shape === "rect" || m.shape === "ellipse" || band) && (
          <>
            <span className="mh" style={{ left: 0, top: -hh, cursor: "ns-resize" }} onPointerDown={e => size(e, "y")} />
            <span className="mh" style={{ left: 0, top: hh, cursor: "ns-resize" }} onPointerDown={e => size(e, "y")} />
          </>
        )}
        <span className="mh mh-centre" style={{ left: 0, top: 0 }} onPointerDown={move} />
        <span className="mstem" style={{ top: line ? -26 : -hh - 26, height: 26 }} />
        <span className="mh mh-turn" style={{ left: 0, top: line ? -26 : -hh - 26, cursor: "grab" }} onPointerDown={turn} />
      </div>
    </div>
  );
}

function KeyPicker({ editor, geo, width, height }: { editor: Editor; geo: BoxGeometry; width: number; height: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && setTool(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  async function pick(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const img = await editor.player?.snapshot(editor.time, geo.item.id);
    if (!img) return;
    const cx = Math.round(fx * (img.width - 1)), cy = Math.round(fy * (img.height - 1));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, cy - 2); y <= Math.min(img.height - 1, cy + 2); y++)
      for (let x = Math.max(0, cx - 2); x <= Math.min(img.width - 1, cx + 2); x++) {
        // GL rows run bottom up and `snapshot` already flips them; alpha is premultiplied into colour.
        const i = (y * img.width + x) * 4;
        const a = img.data[i + 3];
        if (a < 8) continue;
        r += (img.data[i] * 255) / a;
        g += (img.data[i + 1] * 255) / a;
        b += (img.data[i + 2] * 255) / a;
        n++;
      }
    if (!n) {
      editor.toast("Click on the picture to choose a colour");
      return;
    }
    const hex = "#" + [r, g, b].map(v => Math.round(Math.min(255, v / n)).toString(16).padStart(2, "0")).join("");
    patch(editor, geo.item.id, "Key colour", "key-color", d => void (d.chroma = { similarity: 0.35, smoothness: 0.15, spill: 0.5, ...d.chroma, color: hex }));
    editor.endGroup();
    setTool(null);
  }

  return (
    <div className="keypick" style={{ width, height }} onPointerDown={e => void pick(e)}>
      <span className="keypick-hint">Click the colour to remove. Escape cancels.</span>
    </div>
  );
}
