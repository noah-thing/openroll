import { useEffect, useRef } from "react";
import type { Marker } from "../../../core/project";
import { shortTime } from "../../lib/format";
import { labelHex } from "../../state/timeline-actions";
import { rulerStep } from "./layout";

interface Props {
  pps: number;
  left: number;
  width: number;
  markers: Marker[];
  range: { in: number | null; out: number | null };
  renaming: string | null;
  onPointerDown(e: React.PointerEvent): void;
  onContextMenu(e: React.MouseEvent): void;
  onMarkerDown(e: React.PointerEvent, marker: Marker): void;
  onMarkerContext(e: React.MouseEvent, marker: Marker): void;
  onMarkerRename(marker: Marker, label: string | null): void;
  onRangeDown(e: React.PointerEvent, which: "in" | "out"): void;
}

export function Ruler({ pps, left, width, markers, range, renaming, onPointerDown, onContextMenu, onMarkerDown, onMarkerContext, onMarkerRename, onRangeDown }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const h = c.clientHeight;
    // Resizing reallocates the bitmap; this runs on every scroll step, so only do it when the size changed.
    if (c.width !== Math.ceil(width * dpr)) c.width = Math.ceil(width * dpr);
    if (c.height !== Math.ceil(h * dpr)) c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, h);
    const css = getComputedStyle(c);
    const ink = css.getPropertyValue("--ink-3");
    const label = css.getPropertyValue("--ink-2");
    g.font = `500 10.5px ${css.getPropertyValue("--font-num")}`;
    g.textBaseline = "top";
    const { major, minor } = rulerStep(pps);
    const t0 = Math.floor(left / pps / minor) * minor;
    const per = Math.round(major / minor);
    for (let i = 0; ; i++) {
      const t = t0 + i * minor;
      const x = Math.round(t * pps - left) + 0.5;
      if (x > width) break;
      const isMajor = Math.round(t / minor) % per === 0;
      g.fillStyle = ink;
      g.globalAlpha = isMajor ? 0.9 : 0.5;
      g.fillRect(x, h - (isMajor ? 9 : 4), 1, isMajor ? 9 : 4);
      if (isMajor) {
        g.globalAlpha = 1;
        g.fillStyle = label;
        g.fillText(major < 1 ? frameLabel(t) : shortTime(t * 1e6), x + 4, 6);
      }
    }
    g.globalAlpha = 1;
  }, [pps, left, width]);

  const a = range.in !== null ? (range.in / 1e6) * pps : null;
  const b = range.out !== null ? (range.out / 1e6) * pps : null;
  const bandL = a ?? 0;
  const bandR = b ?? null;

  return (
    <div className="tl-ruler" onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <canvas ref={ref} className="tl-ruler-canvas" style={{ left, width }} />
      {(a !== null || b !== null) && (
        <div className="tl-range" style={{ left: bandL, width: bandR !== null ? Math.max(0, bandR - bandL) : 100000 }} aria-hidden />
      )}
      {a !== null && <span className="tl-range-h tl-range-in" style={{ transform: `translateX(${a}px)` }} title="In point" onPointerDown={e => onRangeDown(e, "in")} />}
      {b !== null && <span className="tl-range-h tl-range-out" style={{ transform: `translateX(${b}px)` }} title="Out point" onPointerDown={e => onRangeDown(e, "out")} />}
      {markers.map(m => (
        <div key={m.id} className="tl-marker-wrap" style={{ transform: `translateX(${(m.t / 1e6) * pps}px)` }}>
          <span
            className="tl-marker"
            style={{ background: labelHex(m.color) }}
            title={m.label ?? "Marker"}
            onPointerDown={e => onMarkerDown(e, m)}
            onContextMenu={e => onMarkerContext(e, m)}
            onDoubleClick={e => {
              e.stopPropagation();
              onMarkerRename(m, null);
            }}
          />
          {renaming === m.id ? (
            <input
              className="tl-marker-input"
              autoFocus
              defaultValue={m.label ?? ""}
              placeholder="Marker name"
              onPointerDown={e => e.stopPropagation()}
              onFocus={e => e.currentTarget.select()}
              onBlur={e => onMarkerRename(m, e.currentTarget.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") onMarkerRename(m, m.label ?? "");
              }}
            />
          ) : (
            m.label && <span className="tl-marker-label">{m.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function frameLabel(t: number): string {
  const s = Math.floor(t);
  const f = Math.round((t - s) * 30);
  return f ? `${shortTime(s * 1e6)}.${String(f).padStart(2, "0")}f` : shortTime(s * 1e6);
}
