import { useEffect, useRef } from "react";
import type { Marker } from "../../../core/project";
import { shortTime } from "../../lib/format";
import { rulerStep } from "./layout";

interface Props {
  pps: number;
  left: number;
  width: number;
  markers: Marker[];
  onPointerDown(e: React.PointerEvent): void;
}

export function Ruler({ pps, left, width, markers, onPointerDown }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const h = c.clientHeight;
    c.width = Math.ceil(width * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
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

  return (
    <div className="tl-ruler" onPointerDown={onPointerDown}>
      <canvas ref={ref} className="tl-ruler-canvas" style={{ left, width }} />
      {markers.map(m => (
        <span key={m.id} className="tl-marker" style={{ transform: `translateX(${(m.t / 1e6) * pps}px)` }} title={m.label ?? "Marker"} />
      ))}
    </div>
  );
}

function frameLabel(t: number): string {
  const s = Math.floor(t);
  const f = Math.round((t - s) * 30);
  return f ? `${shortTime(s * 1e6)}.${String(f).padStart(2, "0")}f` : shortTime(s * 1e6);
}
