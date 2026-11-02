import { useState } from "react";
import { setSpeed, updateItem } from "../../core/edit";
import { findItem, type CaptionItem, type Item, type MediaItem, type MediaRef, type Project, type TextItem } from "../../core/project";
import { useEditor } from "../lib/hooks";
import { span } from "../lib/format";
import type { Editor } from "../state/editor";
import { CaptionHighlight } from "./captions/CaptionHighlight";
import { CaptionTextField } from "./captions/CaptionTextField";
import { fontWeights, snapWeight } from "../../core/fonts";
import { Section, Segmented, Slider, Toggle } from "./kit/Field";
import { FontPicker } from "./kit/FontPicker";
import { AudioInspector, ReadAloudSection } from "./panels/AudioInspector";
import { useAnim } from "./inspector/anim";
import { BlendSection, CanvasSection, KeySection, MaskSection, TransformSection } from "./inspector/FrameSections";
import { KeyframeList, KeyNav } from "./inspector/Keyframes";
import { LayoutSection } from "./inspector/LayoutSection";
import { LookTab } from "./inspector/LookTab";
import { AiSpeedSections, AiVideoSections } from "./ai/AiSections";
import { ShapeInspector } from "./inspector/ShapeInspector";
import { SpeedCurve } from "./inspector/SpeedCurve";

type Tab = "video" | "look" | "audio" | "speed" | "animate" | "text" | "shape";

export function Inspector({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const found = selection.length === 1 ? findItem(project, selection[0]) : null;
  const item = found?.item;

  return (
    <section className="pane insp" aria-label="Inspector">
      {!item ? (
        selection.length > 1 ? (
          <div className="insp-empty">{selection.length} clips selected. Delete, duplicate or drag them together.</div>
        ) : (
          <ProjectSettings editor={editor} project={project} />
        )
      ) : (
        <ItemInspector key={item.id} editor={editor} item={item} project={project} />
      )}
    </section>
  );
}

function ItemInspector({ editor, item, project }: { editor: Editor; item: Item; project: Project }) {
  const media = item.type === "media" ? project.media[item.mediaId] : undefined;
  const tabs: { id: Tab; label: string }[] =
    item.type === "shape"
      ? [{ id: "shape", label: "Shape" }, { id: "video", label: "Place" }, { id: "animate", label: "Animate" }]
      : item.type === "text" || item.type === "caption"
      ? [{ id: "text", label: "Text" }, { id: "video", label: "Place" }, { id: "animate", label: "Animate" }]
      : media?.kind === "audio"
        ? [{ id: "audio", label: "Audio" }, { id: "speed", label: "Speed" }]
        : [{ id: "video", label: "Video" }, { id: "look", label: "Look" }, ...(media?.hasAudio ? [{ id: "audio" as Tab, label: "Audio" }] : []), ...(media?.kind === "video" ? [{ id: "speed" as Tab, label: "Speed" }] : []), { id: "animate", label: "Animate" }];
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id;

  const anim = useAnim(editor, item);
  const set = (label: string, patch: Partial<Item>, group: string) => editor.apply(label, p => updateItem(p, item.id, patch), `${item.id}:${group}`);
  const done = () => editor.endGroup();
  const name = item.type === "shape" ? item.name ?? "Shape" : item.type === "text" ? item.style.text : item.type === "caption" ? item.words.map(w => w.text).join(" ") || "Caption" : item.name ?? media?.name ?? "Clip";

  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="insp-body">
        <div className="insp-title">
          <b>{name}</b>
          <span className="num">{span(item.duration)}</span>
        </div>

        {(active === "video" || active === "look" || active === "animate") && <KeyNav editor={editor} item={item} anim={anim} />}

        {active === "video" && (
          <>
            <TransformSection editor={editor} item={item} anim={anim} width={project.settings.width} height={project.settings.height} />
            {item.type === "media" && media?.kind !== "audio" && (
              <>
                <LayoutSection editor={editor} item={item} />
                <CanvasSection editor={editor} item={item} everyClip={() => fillEveryClip(editor, item)} />
                <AiVideoSections editor={editor} item={item} project={project} />
                <MaskSection editor={editor} item={item} />
                <KeySection editor={editor} item={item} />
                <BlendSection editor={editor} item={item} />
              </>
            )}
          </>
        )}

        {active === "shape" && item.type === "shape" && <ShapeInspector editor={editor} item={item} />}

        {active === "look" && item.type === "media" && <LookTab editor={editor} item={item} project={project} />}

        {active === "audio" && item.type === "media" && <AudioInspector editor={editor} item={item} project={project} />}

        {active === "speed" && item.type === "media" && (
          <>
            <SpeedSection editor={editor} item={item} media={media} />
            <AiSpeedSections editor={editor} item={item} />
          </>
        )}

        {active === "animate" && (
          <>
            <AnimateSection item={item} set={set} done={done} />
            <KeyframeList editor={editor} item={item} />
          </>
        )}

        {active === "text" && item.type === "text" && (
          <>
            <TextSection item={item} set={set} done={done} />
            <ReadAloudSection editor={editor} item={item} />
          </>
        )}

        {active === "text" && item.type === "caption" && (
          <TextSection
            item={item}
            set={set}
            done={done}
            words={
              <>
                <CaptionTextField editor={editor} item={item} />
                <p className="insp-note">Edited words keep their timing. Changing a word leaves the others where they were.</p>
              </>
            }
            extra={<CaptionHighlight item={item} set={set} done={done} />}
          />
        )}
      </div>
    </>
  );
}

type Setter = (label: string, patch: Partial<Item>, group: string) => void;

/** The same canvas fill on every picture clip, so a vertical batch looks alike in a wide project. */
function fillEveryClip(editor: Editor, from: MediaItem): void {
  if (!from.fill) return;
  editor.apply("Canvas fill on every clip", p => {
    const next = structuredClone(p);
    for (const t of next.tracks) for (const i of t.items) if (i.type === "media" && next.media[i.mediaId]?.kind !== "audio") i.fill = structuredClone(from.fill);
    return next;
  });
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 5];

function SpeedSection({ editor, item, media }: { editor: Editor; item: MediaItem; media?: MediaRef }) {
  const setTo = (s: number, group?: string) => editor.apply(`Speed ${s}×`, p => setSpeed(p, item.id, s), group);
  return (
    <>
      <Section title="Speed">
        <div className="chips">
          {SPEEDS.map(s => (
            <button key={s} className={"chip" + (!item.ramp && Math.abs(item.speed - s) < 0.001 ? " on" : "")} onClick={() => setTo(s)}>
              {s}×
            </button>
          ))}
        </div>
        <Slider
          label="Custom"
          value={Math.log2(item.speed)}
          min={-3}
          max={4}
          step={0.01}
          reset={0}
          format={v => `${Math.round(2 ** v * 100) / 100}×`}
          onChange={v => setTo(Math.round(2 ** v * 100) / 100, `${item.id}:speed`)}
          onCommit={() => editor.endGroup()}
        />
        <p className="insp-note">The clip gets longer or shorter to match. Audio changes pitch for now.</p>
      </Section>
      <SpeedCurve editor={editor} item={item} media={media} />
      <Section title="Playback">
        <Toggle label="Reverse" value={!!item.reversed} onChange={v => editor.apply(v ? "Reverse" : "Play forward", p => updateItem(p, item.id, { reversed: v }))} />
        <Toggle label="Freeze on first frame" value={!!item.freeze} onChange={v => editor.apply(v ? "Freeze frame" : "Unfreeze", p => updateItem(p, item.id, v ? { freeze: true, ramp: undefined } : { freeze: false }))} />
      </Section>
    </>
  );
}

const ANIMATIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Rise" },
  { value: "slide-left", label: "From right" },
  { value: "slide-right", label: "From left" },
  { value: "zoom-in", label: "Grow" },
  { value: "zoom-out", label: "Shrink" },
  { value: "pop", label: "Pop" },
  { value: "spin", label: "Spin" },
];

function AnimateSection({ item, set, done }: { item: Item; set: Setter; done(): void }) {
  const row = (which: "animationIn" | "animationOut", title: string) => {
    const current = item[which];
    return (
      <Section title={title}>
        <div className="chips">
          {ANIMATIONS.map(a => (
            <button
              key={a.value}
              className={"chip" + ((current?.kind ?? "none") === a.value ? " on" : "")}
              onClick={() => (set(`${title} ${a.label.toLowerCase()}`, { [which]: a.value === "none" ? undefined : { kind: a.value, duration: current?.duration ?? 500_000 } }, which), done())}
            >
              {a.label}
            </button>
          ))}
        </div>
        {current && (
          <Slider
            label="Length"
            value={current.duration / 1e6}
            min={0.1}
            max={Math.max(0.2, Math.min(3, item.duration / 2e6))}
            step={0.05}
            unit="s"
            onChange={v => set(`${title} length`, { [which]: { ...current, duration: Math.round(v * 1e6) } }, which + "len")}
            onCommit={done}
          />
        )}
      </Section>
    );
  };
  return (
    <>
      {row("animationIn", "In")}
      {row("animationOut", "Out")}
    </>
  );
}

const COLORS = ["#ffffff", "#14130e", "#f2c23a", "#e2674f", "#7fb4e8", "#8fbf8a", "#c9a7e8", "#ff8fb1"];

function TextSection({ item, set, done, words, extra }: { item: TextItem | CaptionItem; set: Setter; done(): void; words?: React.ReactNode; extra?: React.ReactNode }) {
  const s = item.style;
  const weights = fontWeights(s.font);
  const weight = Math.min(weights.at(-1)!, Math.max(weights[0], s.weight));
  const style = (label: string, patch: Partial<TextItem["style"]>, group: string) => set(label, { style: { ...s, ...patch } } as Partial<Item>, group);
  return (
    <>
      <Section title="Words">
        {words ?? (
          <textarea
            className="text-input"
            value={s.text}
            rows={3}
            onChange={e => style("Edit text", { text: e.target.value }, "text")}
            onBlur={done}
            placeholder="Type something"
          />
        )}
      </Section>
      {extra}
      <Section title="Style">
        <FontPicker value={s.font} onChange={font => (style("Text font", { font, weight: snapWeight(font, s.weight) }, "font"), done())} />
        <Slider label="Size" value={s.size} min={12} max={400} reset={96} onChange={v => style("Text size", { size: v }, "size")} onCommit={done} />
        {weights.length > 1 ? (
          <Slider label="Weight" value={weight} min={weights[0]} max={weights.at(-1)!} step={100} onChange={v => style("Text weight", { weight: v }, "weight")} onCommit={done} />
        ) : (
          <div className="field">
            <span className="field-label">
              <span className="field-label-text">Weight</span>
            </span>
            <span className="field-note">{s.font.split(",")[0]} has one weight</span>
          </div>
        )}
        <Slider label="Spacing" value={s.letterSpacing} min={-10} max={40} reset={0} onChange={v => style("Letter spacing", { letterSpacing: v }, "ls")} onCommit={done} />
        <Segmented
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
          value={s.align}
          onChange={v => (style("Align text", { align: v }, "align"), done())}
        />
        <div className="swatches">
          {COLORS.map(c => (
            <button key={c} className={"swatch" + (s.color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => (style("Text colour", { color: c }, "color"), done())} />
          ))}
        </div>
      </Section>
      <Section title="Outline and box">
        <Toggle label="Outline" value={!!s.stroke} onChange={v => (style("Outline", { stroke: v ? { color: "#000000", width: 6 } : undefined }, "stroke"), done())} />
        {s.stroke && <Slider label="Thickness" value={s.stroke.width} min={1} max={30} onChange={v => style("Outline", { stroke: { ...s.stroke!, width: v } }, "strokew")} onCommit={done} />}
        <Toggle label="Shadow" value={!!s.shadow} onChange={v => (style("Shadow", { shadow: v ? { color: "rgba(0,0,0,0.55)", blur: 20, x: 0, y: 6 } : undefined }, "shadow"), done())} />
        <Toggle label="Box behind" value={!!s.background} onChange={v => (style("Text box", { background: v ? { color: "rgba(10,12,11,0.72)", padding: 20, radius: 6 } : undefined }, "bg"), done())} />
      </Section>
    </>
  );
}

function ProjectSettings({ editor, project }: { editor: Editor; project: Project }) {
  const s = project.settings;
  const fps = s.fps.num / s.fps.den;
  const setFps = (n: number) => editor.apply(`Frame rate ${n}`, p => ({ ...p, settings: { ...p.settings, fps: n === 29.97 ? { num: 30000, den: 1001 } : { num: n, den: 1 } } }));
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected>
          Project
        </button>
      </div>
      <div className="insp-body">
        <Section title="Frame">
          <div className="insp-kv num">
            <span>Size</span>
            <b>
              {s.width} × {s.height}
            </b>
          </div>
          <div className="chips">
            {[24, 25, 30, 50, 60].map(n => (
              <button key={n} className={"chip" + (Math.abs(fps - n) < 0.01 ? " on" : "")} onClick={() => setFps(n)}>
                {n} fps
              </button>
            ))}
          </div>
        </Section>
        <Section title="Background">
          <div className="swatches">
            <button
              className={"swatch swatch-none" + (s.background === "none" ? " on" : "")}
              title="None, for exports with a transparent background"
              aria-label="No background"
              onClick={() => editor.apply("Background colour", p => ({ ...p, settings: { ...p.settings, background: "none" } }))}
            />
            {["#000000", "#ffffff", "#1b1f1d", "#ece7da", "#f2c23a", "#2b5fe0"].map(c => (
              <button
                key={c}
                className={"swatch" + (s.background === c ? " on" : "")}
                style={{ background: c }}
                onClick={() => editor.apply("Background colour", p => ({ ...p, settings: { ...p.settings, background: c } }))}
              />
            ))}
          </div>
        </Section>
        <p className="insp-note">Select a clip to change how it looks, sounds or moves.</p>
      </div>
    </>
  );
}
