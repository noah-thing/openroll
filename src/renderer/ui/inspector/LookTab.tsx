import { useRef, useState } from "react";
import { effectPath } from "../../../core/look/animated";
import { FLAT_CURVE, isFlat, makeCurve } from "../../../core/look/curves";
import { moveEffect, patchEffect, removeEffect, setFilter } from "../../../core/look/edit";
import { effectDef } from "../../../core/look/effects";
import { filterPreset } from "../../../core/look/filters";
import { HSL_BANDS, type CurvePoint, type Curves, type HslBand, type MediaItem, type Project } from "../../../core/project";
import type { Editor } from "../../state/editor";
import { Icon } from "../kit/Icon";
import { Section, Segmented, Slider } from "../kit/Field";
import { AnimSlider, useAnim, useItemEdit, type Anim } from "./anim";

export function LookTab({ editor, item, project }: { editor: Editor; item: MediaItem; project: Project }) {
  const anim = useAnim(editor, item);
  return (
    <>
      <FilterSection editor={editor} item={item} project={project} anim={anim} />
      <AdjustSection editor={editor} item={item} anim={anim} />
      <CurvesSection editor={editor} item={item} />
      <ColourSection editor={editor} item={item} />
      <EffectsSection editor={editor} item={item} anim={anim} />
    </>
  );
}

function FilterSection({ editor, item, project, anim }: { editor: Editor; item: MediaItem; project: Project; anim: Anim }) {
  const f = item.filter;
  const name = f ? (filterPreset(f.id)?.name ?? project.luts?.[f.id]?.name ?? "Missing LUT") : null;
  return (
    <Section title="Filter" fold="filter">
      {f ? (
        <>
          <div className="insp-kv">
            <span>{name}</span>
            <button className="reset" onClick={() => editor.apply("Remove filter", p => setFilter(p, item.id, null))}>
              Remove
            </button>
          </div>
          <AnimSlider anim={anim} path="filter.amount" label="Strength" undo="Filter strength" min={0} max={100} unit="%" reset={100} scale={100} />
        </>
      ) : (
        <p className="insp-note">Pick one in the Filters panel on the left.</p>
      )}
    </Section>
  );
}

const ADJUSTS: [string, string, number, number, number][] = [
  ["exposure", "Exposure", -100, 100, 0],
  ["contrast", "Contrast", -100, 100, 0],
  ["saturation", "Saturation", -100, 100, 0],
  ["temperature", "Warmth", -100, 100, 0],
  ["tint", "Tint", -100, 100, 0],
  ["highlights", "Highlights", -100, 100, 0],
  ["shadows", "Shadows", -100, 100, 0],
  ["fade", "Fade", 0, 100, 0],
  ["vignette", "Vignette", -100, 100, 0],
  ["sharpen", "Sharpen", 0, 100, 0],
  ["grain", "Grain", 0, 100, 0],
];

function AdjustSection({ editor, item, anim }: { editor: Editor; item: MediaItem; anim: Anim }) {
  const edit = useItemEdit(editor, item);
  return (
    <Section
      title="Adjust"
      fold="adjust"
      onReset={() => {
        edit("Reset adjust", d => {
          delete d.adjust;
          if (d.keyframes) for (const k of Object.keys(d.keyframes)) if (k.startsWith("adjust.")) delete d.keyframes[k];
        });
        editor.endGroup();
      }}
    >
      {ADJUSTS.map(([key, label, min, max, reset]) => (
        <AnimSlider key={key} anim={anim} path={"adjust." + key} label={label} undo={`Adjust ${label.toLowerCase()}`} min={min} max={max} reset={reset} />
      ))}
    </Section>
  );
}

type Channel = "master" | "r" | "g" | "b";
const CHANNELS: { value: Channel; label: string; color: string }[] = [
  { value: "master", label: "All", color: "var(--ink)" },
  { value: "r", label: "Red", color: "#ef6a5e" },
  { value: "g", label: "Green", color: "#5fcf8a" },
  { value: "b", label: "Blue", color: "#6aa6f0" },
];

function CurvesSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const [channel, setChannel] = useState<Channel>("master");
  const edit = useItemEdit(editor, item);
  const points = item.curves?.[channel] ?? FLAT_CURVE;
  const set = (pts: CurvePoint[] | undefined, label = "Curves") =>
    edit(
      label,
      d => {
        const next: Curves = { ...(d.curves ?? {}) };
        if (!pts || isFlat(pts)) delete next[channel];
        else next[channel] = pts;
        if (Object.keys(next).length) d.curves = next;
        else delete d.curves;
      },
      "curves-" + channel,
    );
  return (
    <Section title="Curves" fold="curves" onReset={() => (edit("Reset curves", d => void delete d.curves), editor.endGroup())}>
      <Segmented<Channel> options={CHANNELS.map(c => ({ value: c.value, label: c.label }))} value={channel} onChange={setChannel} />
      <CurveEditor points={points} color={CHANNELS.find(c => c.value === channel)!.color} onChange={set} onCommit={() => editor.endGroup()} />
    </Section>
  );
}

const PAD = 8;
const SIZE = 200;

function CurveEditor({ points, color, onChange, onCommit }: { points: CurvePoint[]; color: string; onChange(p: CurvePoint[]): void; onCommit(): void }) {
  const ref = useRef<SVGSVGElement>(null);
  const px = (x: number) => PAD + x * SIZE;
  const py = (y: number) => PAD + (1 - y) * SIZE;
  const f = makeCurve(points);
  const d = Array.from({ length: 65 }, (_, i) => `${i ? "L" : "M"}${px(i / 64).toFixed(1)} ${py(Math.min(1, Math.max(0, f(i / 64)))).toFixed(1)}`).join("");

  function drag(e: React.PointerEvent, i: number) {
    e.preventDefault();
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
    const box = ref.current!.getBoundingClientRect();
    const k = (SIZE + PAD * 2) / box.width;
    const move = (ev: PointerEvent) => {
      const x = ((ev.clientX - box.left) * k - PAD) / SIZE;
      const y = 1 - ((ev.clientY - box.top) * k - PAD) / SIZE;
      const next = points.map(p => ({ ...p }));
      next[i].y = Math.min(1, Math.max(0, y));
      if (i > 0 && i < points.length - 1) next[i].x = Math.min(points[i + 1].x - 0.06, Math.max(points[i - 1].x + 0.06, x));
      onChange(next);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      onCommit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <svg ref={ref} className="curve" viewBox={`0 0 ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}>
      {[0.25, 0.5, 0.75].map(g => (
        <g key={g} className="curve-grid">
          <path d={`M${px(g)} ${py(0)}V${py(1)}M${px(0)} ${py(g)}H${px(1)}`} />
        </g>
      ))}
      <path className="curve-diag" d={`M${px(0)} ${py(0)}L${px(1)} ${py(1)}`} />
      <path className="curve-line" d={d} style={{ stroke: color }} />
      {points.map((p, i) => (
        <circle
          key={i}
          className="curve-pt"
          cx={px(p.x)}
          cy={py(p.y)}
          r={5.5}
          style={{ fill: color }}
          onPointerDown={e => drag(e, i)}
          onDoubleClick={() => {
            const next = points.map(q => ({ ...q }));
            next[i] = { ...FLAT_CURVE[i] };
            onChange(next);
            onCommit();
          }}
        />
      ))}
    </svg>
  );
}

const BAND_COLORS: Record<HslBand, string> = {
  red: "#e5483d",
  orange: "#ee8a2c",
  yellow: "#e8c935",
  green: "#4cb760",
  aqua: "#38b8b8",
  blue: "#3f7be0",
  purple: "#8a58d6",
  magenta: "#d553a8",
};

function ColourSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const [band, setBand] = useState<HslBand>("red");
  const edit = useItemEdit(editor, item);
  const v = item.hsl?.[band] ?? { hue: 0, sat: 0, light: 0 };
  const set = (field: "hue" | "sat" | "light", n: number) =>
    edit(
      "Colour mix",
      d => {
        const hsl = { ...(d.hsl ?? {}) };
        hsl[band] = { ...v, [field]: n };
        const empty = HSL_BANDS.every(b => !hsl[b] || (!hsl[b]!.hue && !hsl[b]!.sat && !hsl[b]!.light));
        if (empty) delete d.hsl;
        else d.hsl = hsl;
      },
      `hsl-${band}-${field}`,
    );
  return (
    <Section title="Colour mix" fold="hsl" onReset={() => (edit("Reset colour mix", d => void delete d.hsl), editor.endGroup())}>
      <div className="bands" role="radiogroup" aria-label="Colour band">
        {HSL_BANDS.map(b => {
          const touched = item.hsl?.[b] && (item.hsl[b]!.hue || item.hsl[b]!.sat || item.hsl[b]!.light);
          return (
            <button key={b} role="radio" aria-checked={b === band} title={b[0].toUpperCase() + b.slice(1)} className={"band" + (b === band ? " on" : "") + (touched ? " touched" : "")} style={{ background: BAND_COLORS[b] }} onClick={() => setBand(b)} />
          );
        })}
      </div>
      <Slider label="Hue" value={v.hue} min={-100} max={100} reset={0} onChange={n => set("hue", n)} onCommit={() => editor.endGroup()} />
      <Slider label="Saturation" value={v.sat} min={-100} max={100} reset={0} onChange={n => set("sat", n)} onCommit={() => editor.endGroup()} />
      <Slider label="Lightness" value={v.light} min={-100} max={100} reset={0} onChange={n => set("light", n)} onCommit={() => editor.endGroup()} />
    </Section>
  );
}

function EffectsSection({ editor, item, anim }: { editor: Editor; item: MediaItem; anim: Anim }) {
  const list = item.effects ?? [];
  const patch = (label: string, id: string, fn: (e: NonNullable<MediaItem["effects"]>[number]) => void, group?: string) =>
    editor.apply(label, p => patchEffect(p, item.id, id, fn), group ? `${item.id}:${id}:${group}` : undefined);
  return (
    <Section title="Effects" fold="effects">
      {!list.length && <p className="insp-note">Add effects from the Effects panel on the left.</p>}
      {list.map((e, i) => {
        const def = effectDef(e.kind);
        return (
          <div key={e.id} className={"fxrow" + (e.off ? " off" : "")}>
            <div className="fxrow-head">
              <b>{def?.name ?? e.kind}</b>
              <span className="fxrow-tools">
                <button className="iconbtn" title="Move up" disabled={i === 0} onClick={() => editor.apply("Reorder effects", p => moveEffect(p, item.id, e.id, -1))}>
                  <Icon name="arrowUp" size={14} />
                </button>
                <button className="iconbtn" title="Move down" disabled={i === list.length - 1} onClick={() => editor.apply("Reorder effects", p => moveEffect(p, item.id, e.id, 1))}>
                  <Icon name="arrowDown" size={14} />
                </button>
                <button className="iconbtn" title={e.off ? "Turn on" : "Turn off"} onClick={() => patch(e.off ? "Turn effect on" : "Turn effect off", e.id, x => void (x.off = !x.off))}>
                  <Icon name={e.off ? "eyeOff" : "eye"} size={14} />
                </button>
                <button className="iconbtn" title="Remove" onClick={() => editor.apply("Remove effect", p => removeEffect(p, item.id, e.id))}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            </div>
            <AnimSlider anim={anim} path={effectPath(e.id)} label="Amount" undo={`${def?.name ?? "Effect"} amount`} min={0} max={100} unit="%" scale={100} reset={Math.round((def?.amount ?? 0.5) * 100)} />
            {def?.speed !== undefined && (
              <Slider
                label="Speed"
                value={e.params?.speed ?? def.speed}
                min={0.1}
                max={8}
                step={0.1}
                unit="×"
                reset={def.speed}
                onChange={v => patch("Effect speed", e.id, x => void (x.params = { ...x.params, speed: v }), "speed")}
                onCommit={() => editor.endGroup()}
              />
            )}
            {def?.styles && (
              <div className="chips">
                {def.styles.map((s, n) => (
                  <button key={s} className={"chip" + ((e.params?.style ?? 0) === n ? " on" : "")} onClick={() => patch("Effect style", e.id, x => void (x.params = { ...x.params, style: n }))}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {list.length > 1 && <p className="insp-note">Effects run from the top down.</p>}
    </Section>
  );
}
