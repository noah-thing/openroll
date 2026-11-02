import { useRef, useState } from "react";
import { setSpeedRamp } from "../../../core/edit";
import { sliceEase } from "../../../core/easing";
import type { MediaItem, MediaRef, SpeedKey } from "../../../core/project";
import { MAX_SPEED, MIN_SPEED, rampKeepsAudio, speedAt } from "../../../core/speed";
import { SPEED_PRESETS } from "../../../core/speed-presets";
import { span } from "../../lib/format";
import type { Editor } from "../../state/editor";
import { Section } from "../kit/Field";
import { BezierEditor } from "./BezierEditor";

const W = 260, H = 132;
const LEFT = 30, RIGHT = 8, TOP = 8, BOTTOM = 16;
/** The graph shows 0.1x to 10x on a log scale, so slowing to half and doubling sit the same distance from 1x. */
const SHOWN_MIN = 0.1, SHOWN_MAX = 10;
const GAP = 0.01;
const LABELS = [0.1, 0.25, 0.5, 1, 2, 4, 10];
const SNAPS = [0.25, 0.5, 1, 2, 4];

const gx = (x: number) => LEFT + x * (W - LEFT - RIGHT);
const gy = (v: number) => {
  const t = (Math.log10(Math.min(SHOWN_MAX, Math.max(SHOWN_MIN, v))) - Math.log10(SHOWN_MIN)) / (Math.log10(SHOWN_MAX) - Math.log10(SHOWN_MIN));
  return TOP + (1 - t) * (H - TOP - BOTTOM);
};
const speedFromY = (y: number) => {
  const t = 1 - (y - TOP) / (H - TOP - BOTTOM);
  return 10 ** (Math.log10(SHOWN_MIN) + Math.min(1, Math.max(0, t)) * (Math.log10(SHOWN_MAX) - Math.log10(SHOWN_MIN)));
};

/** Round to something readable and pull close to the usual speeds, unless the user holds Alt. */
function tidy(v: number, free: boolean): number {
  if (!free) for (const s of SNAPS) if (Math.abs(Math.log(v / s)) < 0.045) return s;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(v * 100) / 100));
}

function fmt(v: number): string {
  return `${Math.round(v * 100) / 100}x`;
}

export function SpeedCurve({ editor, item, media }: { editor: Editor; item: MediaItem; media?: MediaRef }) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const keys: SpeedKey[] = item.ramp?.keys ?? [{ x: 0, v: item.speed }, { x: 1, v: item.speed }];
  const sel = selected !== null && selected < keys.length ? selected : null;
  const locked = !!item.freeze;

  const put = (next: SpeedKey[]) => editor.apply("Edit speed curve", p => setSpeedRamp(p, item.id, next), `${item.id}:ramp`);
  const done = () => editor.endGroup();

  function point(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  function dragPoint(i: number, e: React.PointerEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(i);
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const start = keys.map(k => ({ ...k }));
    const move = (ev: PointerEvent) => {
      const at = point(ev);
      const next = start.map(k => ({ ...k }));
      next[i].v = tidy(speedFromY(at.y), ev.altKey);
      if (i > 0 && i < next.length - 1) {
        const x = (at.x - LEFT) / (W - LEFT - RIGHT);
        next[i].x = Math.min(next[i + 1].x - GAP, Math.max(next[i - 1].x + GAP, Math.round(x * 1000) / 1000));
      }
      put(next);
    };
    const up = () => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up);
      done();
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up);
  }

  function addPoint(e: React.MouseEvent) {
    if (locked) return;
    const x = Math.round(((point(e).x - LEFT) / (W - LEFT - RIGHT)) * 1000) / 1000;
    if (x <= GAP || x >= 1 - GAP || keys.some(k => Math.abs(k.x - x) < GAP)) return;
    const i = keys.findIndex(k => k.x > x);
    const a = keys[i - 1], b = keys[i];
    const f = (x - a.x) / (b.x - a.x);
    const next = [...keys.slice(0, i - 1), { ...a, ease: sliceEase(a.ease ?? "ease", 0, f) }, { x, v: speedAt(keys, x), ease: sliceEase(a.ease ?? "ease", f, 1) }, ...keys.slice(i)];
    editor.apply("Add speed point", p => setSpeedRamp(p, item.id, next));
    setSelected(i);
  }

  function removePoint(i: number) {
    if (i <= 0 || i >= keys.length - 1) return;
    editor.apply("Remove speed point", p => setSpeedRamp(p, item.id, keys.filter((_, j) => j !== i)));
    setSelected(null);
  }

  function key(i: number, e: React.KeyboardEvent) {
    if (locked) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removePoint(i);
      return;
    }
    const big = e.shiftKey ? 4 : 1;
    const next = keys.map(k => ({ ...k }));
    if (e.key === "ArrowUp") next[i].v = Math.min(MAX_SPEED, next[i].v * 1.05 ** big);
    else if (e.key === "ArrowDown") next[i].v = Math.max(MIN_SPEED, next[i].v / 1.05 ** big);
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && i > 0 && i < next.length - 1) {
      const dx = (e.key === "ArrowRight" ? 0.01 : -0.01) * big;
      next[i].x = Math.min(next[i + 1].x - GAP, Math.max(next[i - 1].x + GAP, next[i].x + dx));
    } else return;
    e.preventDefault();
    put(next);
    done();
  }

  const path: string[] = [];
  for (let i = 0; i <= 200; i++) {
    const x = i / 200;
    path.push(`${i ? "L" : "M"}${gx(x).toFixed(1)},${gy(speedAt(keys, x)).toFixed(1)}`);
  }

  const muted = !!item.ramp && !!media?.hasAudio && !rampKeepsAudio(item.ramp);

  return (
    <Section title="Speed curve" fold="speed-curve">
      <div className="chips">
        {SPEED_PRESETS.map(pr => (
          <button
            key={pr.id}
            className={"chip" + (item.ramp?.preset === pr.id ? " on" : "")}
            disabled={locked}
            onClick={() => {
              editor.apply(`Speed curve, ${pr.label}`, p => setSpeedRamp(p, item.id, pr.keys, pr.id));
              setSelected(null);
            }}
          >
            {pr.label}
          </button>
        ))}
      </div>
      <div className="sc">
        <svg ref={svg} className="sc-graph" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Speed along the clip" onPointerDown={() => setSelected(null)} onDoubleClick={addPoint}>
          <rect x={gx(0)} y={gy(SHOWN_MAX)} width={gx(1) - gx(0)} height={gy(SHOWN_MIN) - gy(SHOWN_MAX)} className="sc-plot" />
          {LABELS.map(v => (
            <g key={v}>
              <line x1={gx(0)} x2={gx(1)} y1={gy(v)} y2={gy(v)} className={"sc-grid" + (v === 1 ? " one" : "")} />
              <text x={gx(0) - 4} y={gy(v) + 3} textAnchor="end" className="sc-label">
                {v}x
              </text>
            </g>
          ))}
          <path d={path.join(" ")} className="sc-curve" />
          {keys.map((k, i) => (
            <circle
              key={i}
              cx={gx(k.x)}
              cy={gy(k.v)}
              r={5}
              className={"sc-point" + (sel === i ? " sel" : "")}
              tabIndex={0}
              role="slider"
              aria-label={`Speed point ${i + 1} of ${keys.length}`}
              aria-valuetext={fmt(k.v)}
              onPointerDown={e => dragPoint(i, e)}
              onFocus={() => setSelected(i)}
              onKeyDown={e => key(i, e)}
            />
          ))}
        </svg>
        <div className="sc-readout num">
          <span>
            Clip length <strong>{span(item.duration)}</strong>
          </span>
          <span>{item.ramp ? `Average ${fmt(item.speed)}` : `Steady ${fmt(item.speed)}`}</span>
        </div>
      </div>
      {sel !== null && sel < keys.length - 1 && !locked && (
        <>
          <p className="sub">Change from point {sel + 1} to the next</p>
          <BezierEditor
            label="Speed change curve"
            value={keys[sel].ease ?? "ease"}
            onChange={ease => put(keys.map((k, i) => (i === sel ? { ...k, ease } : { ...k })))}
            onCommit={done}
          />
        </>
      )}
      <div className="btnrow">
        <p className="insp-note">{locked ? "A frozen clip has no speed to change." : "Drag a point. Double click the line to add one."}</p>
        {sel !== null && sel > 0 && sel < keys.length - 1 && (
          <button className="tool" onClick={() => removePoint(sel)}>
            Remove point
          </button>
        )}
        {item.ramp && (
          <button className="tool" onClick={() => editor.apply("Steady speed", p => setSpeedRamp(p, item.id, null))}>
            Steady speed
          </button>
        )}
      </div>
      {muted && <p className="insp-note">Sound is silent on this clip because the curve goes below 0.25x or above 4x.</p>}
      {item.ramp && <p className="insp-note">The curve follows playing order, so reversing the clip keeps its rhythm.</p>}
    </Section>
  );
}
