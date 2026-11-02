import { useRef } from "react";
import { easeAsBezier, easeAt } from "../../../core/easing";
import type { CubicBezier, Ease } from "../../../core/project";

const W = 132, H = 132, PAD = 14;
const Y_MIN = -0.5, Y_MAX = 1.5;
const px = (x: number) => PAD + x * (W - 2 * PAD);
const py = (y: number) => PAD + (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * (H - 2 * PAD);

export const EASE_PRESETS: { label: string; value: Ease }[] = [
  { label: "Smooth", value: "ease" },
  { label: "Linear", value: "linear" },
  { label: "Ease in", value: "easeIn" },
  { label: "Ease out", value: "easeOut" },
  { label: "Hold", value: "hold" },
  { label: "Sharp", value: [0.7, 0, 0.3, 1] },
  { label: "Overshoot", value: [0.34, 1.56, 0.64, 1] },
  { label: "Anticipate", value: [0.36, 0, 0.66, -0.56] },
];

export function sameEase(a: Ease, b: Ease): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.every((n, i) => Math.abs(n - b[i]) < 1e-6);
}

function curvePath(ease: Ease): string {
  if (ease === "hold") return `M${px(0)},${py(0)} L${px(1)},${py(0)} L${px(1)},${py(1)}`;
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    pts.push(`${i ? "L" : "M"}${px(x).toFixed(1)},${py(easeAt(ease, x)).toFixed(1)}`);
  }
  return pts.join(" ");
}

interface Props {
  value: Ease;
  onChange(next: Ease): void;
  onCommit(): void;
  label: string;
}

/** A small graph of an easing with presets and two draggable handles. The curve runs from (0, 0) to (1, 1); x stays inside the box, y may swing past it. */
export function BezierEditor({ value, onChange, onCommit, label }: Props) {
  const box = useRef<SVGSVGElement>(null);
  const bezier = easeAsBezier(value);

  function drag(which: 0 | 1, e: React.PointerEvent) {
    if (!bezier) return;
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const start = bezier;
    const move = (ev: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * W;
      const sy = ((ev.clientY - r.top) / r.height) * H;
      const x = Math.min(1, Math.max(0, (sx - PAD) / (W - 2 * PAD)));
      const y = Y_MIN + (1 - (sy - PAD) / (H - 2 * PAD)) * (Y_MAX - Y_MIN);
      const next: CubicBezier = [...start];
      next[which * 2] = round(x);
      next[which * 2 + 1] = round(Math.min(Y_MAX, Math.max(Y_MIN, y)));
      onChange(next);
    };
    const up = () => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up);
      onCommit();
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up);
  }

  function nudge(which: 0 | 1, e: React.KeyboardEvent) {
    if (!bezier) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const next: CubicBezier = [...bezier];
    next[which * 2] = round(Math.min(1, Math.max(0, next[which * 2] + dx)));
    next[which * 2 + 1] = round(Math.min(Y_MAX, Math.max(Y_MIN, next[which * 2 + 1] + dy)));
    onChange(next);
    onCommit();
  }

  return (
    <div className="bez">
      <div className="chips">
        {EASE_PRESETS.map(p => (
          <button
            key={p.label}
            className={"chip" + (sameEase(value, p.value) ? " on" : "")}
            onClick={() => {
              onChange(p.value);
              onCommit();
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <svg ref={box} className="bez-graph" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
        <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} className="bez-box" />
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="bez-diag" />
        <path d={curvePath(value)} className="bez-curve" />
        {bezier && (
          <>
            <line x1={px(0)} y1={py(0)} x2={px(bezier[0])} y2={py(bezier[1])} className="bez-arm" />
            <line x1={px(1)} y1={py(1)} x2={px(bezier[2])} y2={py(bezier[3])} className="bez-arm" />
            {([0, 1] as const).map(i => (
              <circle
                key={i}
                cx={px(bezier[i * 2])}
                cy={py(bezier[i * 2 + 1])}
                r={5}
                className="bez-handle"
                tabIndex={0}
                role="slider"
                aria-label={i ? "Ending handle" : "Starting handle"}
                aria-valuetext={`x ${bezier[i * 2]}, y ${bezier[i * 2 + 1]}`}
                onPointerDown={e => drag(i, e)}
                onKeyDown={e => nudge(i, e)}
              />
            ))}
          </>
        )}
      </svg>
      {bezier && <p className="insp-note num">{bezier.map(n => n.toFixed(2)).join(", ")}</p>}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
