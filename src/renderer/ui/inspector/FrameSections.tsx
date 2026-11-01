import { defaultMask } from "../../../core/look/mask";
import type { BlendMode, Crop, Item, MediaItem } from "../../../core/project";
import { updateItem } from "../../../core/edit";
import type { Editor } from "../../state/editor";
import { setTool, useTool } from "../../state/tool";
import { Icon } from "../kit/Icon";
import { Section, Segmented, Slider, Toggle } from "../kit/Field";
import { AnimSlider, useItemEdit, type Anim } from "./anim";

export function TransformSection({ editor, item, anim, width, height }: { editor: Editor; item: Item; anim: Anim; width: number; height: number }) {
  return (
    <Section
      title="Transform"
      fold="transform"
      onReset={() => {
        editor.apply("Reset transform", p => {
          const next = updateItem(p, item.id, { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } });
          const found = next.tracks.flatMap(t => t.items).find(i => i.id === item.id);
          if (found?.keyframes) {
            for (const k of Object.keys(found.keyframes)) if (k.startsWith("transform.")) delete found.keyframes[k];
            if (!Object.keys(found.keyframes).length) delete found.keyframes;
          }
          return next;
        });
      }}
    >
      <AnimSlider anim={anim} path="transform.scale" label="Scale" undo="Scale" min={5} max={400} unit="%" reset={100} scale={100} />
      <AnimSlider anim={anim} path="transform.x" label="Position X" undo="Move" min={-width} max={width} reset={0} />
      <AnimSlider anim={anim} path="transform.y" label="Position Y" undo="Move" min={-height} max={height} reset={0} />
      <AnimSlider anim={anim} path="transform.rotation" label="Rotate" undo="Rotate" min={-180} max={180} unit="°" reset={0} />
      <AnimSlider anim={anim} path="transform.opacity" label="Opacity" undo="Opacity" min={0} max={100} unit="%" reset={100} scale={100} />
    </Section>
  );
}

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
const FILL_COLOURS = ["#000000", "#ffffff", "#1b1f1d", "#ece7da", "#f2c23a", "#2b5fe0"];

export function CanvasSection({ editor, item, everyClip }: { editor: Editor; item: MediaItem; everyClip(): void }) {
  const edit = useItemEdit(editor, item);
  const tool = useTool(item.id);
  const crop = item.crop ?? NO_CROP;
  const side = (key: keyof Crop, label: string) => (
    <Slider
      label={label}
      value={crop[key] * 100}
      min={0}
      max={90}
      unit="%"
      reset={0}
      onChange={v =>
        edit(
          "Crop",
          d => {
            const next = { ...(d.crop ?? NO_CROP), [key]: v / 100 };
            if (next.left + next.right > 0.95) return;
            if (next.top + next.bottom > 0.95) return;
            if (Object.values(next).every(n => n === 0)) delete d.crop;
            else d.crop = next;
          },
          "crop-" + key,
        )
      }
      onCommit={() => editor.endGroup()}
    />
  );
  const fill = item.fill;
  return (
    <Section title="Crop and canvas" fold="canvas">
      <div className="btnrow">
        <button className={"tool" + (tool === "crop" ? " on" : "")} onClick={() => setTool(tool === "crop" ? null : "crop", item.id)}>
          <Icon name="crop" size={15} />
          Crop on canvas
        </button>
        {item.crop && (
          <button className="reset" onClick={() => (edit("Reset crop", d => void delete d.crop), editor.endGroup())}>
            Reset
          </button>
        )}
      </div>
      {side("left", "Left")}
      {side("top", "Top")}
      {side("right", "Right")}
      {side("bottom", "Bottom")}
      <h4 className="sub">Behind the clip</h4>
      <Segmented
        options={[
          { value: "none", label: "Nothing" },
          { value: "blur", label: "Blur" },
          { value: "color", label: "Colour" },
        ]}
        value={fill?.mode ?? "none"}
        onChange={v =>
          edit("Canvas fill", d => {
            if (v === "none") delete d.fill;
            else d.fill = { mode: v, color: d.fill?.color ?? "#000000", blur: d.fill?.blur ?? 0.6 };
          })
        }
      />
      {fill?.mode === "blur" && (
        <Slider label="Blur" value={(fill.blur ?? 0.6) * 100} min={0} max={100} unit="%" reset={60} onChange={v => edit("Canvas blur", d => void (d.fill = { ...d.fill!, blur: v / 100 }), "fill-blur")} onCommit={() => editor.endGroup()} />
      )}
      {fill?.mode === "color" && (
        <div className="swatches">
          {FILL_COLOURS.map(c => (
            <button key={c} className={"swatch" + (fill.color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => edit("Canvas colour", d => void (d.fill = { ...d.fill!, color: c }))} />
          ))}
        </div>
      )}
      {fill && (
        <button className="textbtn" onClick={everyClip}>
          Use on every clip
        </button>
      )}
      <p className="insp-note">Shows where the clip does not fill the frame, such as a vertical clip in a wide project.</p>
    </Section>
  );
}

const SHAPES: { value: "none" | NonNullable<MediaItem["mask"]>["shape"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "rect", label: "Box" },
  { value: "ellipse", label: "Oval" },
  { value: "linear", label: "Line" },
  { value: "mirror", label: "Band" },
];

export function MaskSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const edit = useItemEdit(editor, item);
  const tool = useTool(item.id);
  const m = item.mask;
  const num = (label: string, key: "feather" | "width" | "height" | "rotation" | "x" | "y", min: number, max: number, scale: number, unit: string, reset: number) => (
    <Slider
      label={label}
      value={m![key] * scale}
      min={min}
      max={max}
      unit={unit}
      reset={reset}
      onChange={v => edit("Mask", d => void (d.mask = { ...d.mask!, [key]: v / scale }), "mask-" + key)}
      onCommit={() => editor.endGroup()}
    />
  );
  return (
    <Section title="Mask" fold="mask">
      <Segmented
        options={SHAPES}
        value={m?.shape ?? "none"}
        onChange={v => {
          edit("Mask shape", d => {
            if (v === "none") delete d.mask;
            else d.mask = { ...defaultMask(v), invert: d.mask?.invert ?? false };
          });
          editor.endGroup();
          setTool(v === "none" ? null : "mask", item.id);
        }}
      />
      {m && (
        <>
          <button className={"tool" + (tool === "mask" ? " on" : "")} onClick={() => setTool(tool === "mask" ? null : "mask", item.id)}>
            Edit on canvas
          </button>
          {num("Feather", "feather", 0, 100, 100, "%", 10)}
          {(m.shape === "rect" || m.shape === "ellipse") && num("Width", "width", 5, 200, 100, "%", 60)}
          {(m.shape === "rect" || m.shape === "ellipse" || m.shape === "mirror") && num(m.shape === "mirror" ? "Band" : "Height", "height", 2, 200, 100, "%", 60)}
          {num("Position X", "x", -100, 100, 100, "%", 0)}
          {num("Position Y", "y", -100, 100, 100, "%", 0)}
          {num("Rotate", "rotation", -180, 180, 1, "°", 0)}
          <Toggle label="Invert" value={m.invert} onChange={v => (edit("Invert mask", d => void (d.mask = { ...d.mask!, invert: v })), editor.endGroup())} />
        </>
      )}
    </Section>
  );
}

const KEY_COLOURS = ["#00b140", "#0047bb", "#ffffff", "#000000"];

export function KeySection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const edit = useItemEdit(editor, item);
  const tool = useTool(item.id);
  const k = item.chroma;
  const num = (label: string, key: "similarity" | "smoothness" | "spill", reset: number) => (
    <Slider label={label} value={k![key] * 100} min={0} max={100} unit="%" reset={reset} onChange={v => edit("Chroma key", d => void (d.chroma = { ...d.chroma!, [key]: v / 100 }), "key-" + key)} onCommit={() => editor.endGroup()} />
  );
  return (
    <Section title="Chroma key" fold="key">
      <Toggle
        label="Remove a colour"
        value={!!k}
        onChange={v => {
          edit("Chroma key", d => {
            if (v) d.chroma = { color: "#00b140", similarity: 0.35, smoothness: 0.15, spill: 0.5 };
            else delete d.chroma;
          });
          editor.endGroup();
          if (!v && tool === "key") setTool(null);
        }}
      />
      {k && (
        <>
          <div className="keyrow">
            <button className={"tool" + (tool === "key" ? " on" : "")} onClick={() => setTool(tool === "key" ? null : "key", item.id)}>
              <Icon name="eyedropper" size={15} />
              Pick from picture
            </button>
            <input className="colourwell" type="color" value={k.color} aria-label="Key colour" onChange={e => edit("Key colour", d => void (d.chroma = { ...d.chroma!, color: e.target.value }), "key-color")} onBlur={() => editor.endGroup()} />
          </div>
          <div className="swatches">
            {KEY_COLOURS.map(c => (
              <button key={c} className={"swatch" + (k.color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => edit("Key colour", d => void (d.chroma = { ...d.chroma!, color: c }))} />
            ))}
          </div>
          {num("Similarity", "similarity", 35)}
          {num("Smoothness", "smoothness", 15)}
          {num("Spill", "spill", 50)}
        </>
      )}
    </Section>
  );
}

export function BlendSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  return (
    <Section title="Blend" fold="blend">
      <Segmented<BlendMode>
        options={[
          { value: "normal", label: "Normal" },
          { value: "screen", label: "Screen" },
          { value: "multiply", label: "Multiply" },
          { value: "overlay", label: "Overlay" },
        ]}
        value={item.blend ?? "normal"}
        onChange={v => (editor.apply("Blend mode", p => updateItem(p, item.id, { blend: v })), editor.endGroup())}
      />
    </Section>
  );
}
