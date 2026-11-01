import { updateItem } from "../../../core/edit";
import type { ShapeItem, ShapeStyle } from "../../../core/project";
import type { Editor } from "../../state/editor";
import { Section, Slider, Toggle } from "../kit/Field";

const COLORS = ["#ffffff", "#14130e", "#f2c23a", "#e2674f", "#8fbf8a", "#7fb4e8", "#c9a7e8", "#ff8fb1"];

/** Colour, size and outline of a shape or sticker. Placement is the ordinary Transform section. */
export function ShapeInspector({ editor, item }: { editor: Editor; item: ShapeItem }) {
  const s = item.shape;
  const group = (g: string) => `${item.id}:${g}`;
  const style = (label: string, patch: Partial<ShapeStyle>, g: string) => editor.apply(label, p => updateItem(p, item.id, { shape: { ...s, ...patch } } as Partial<ShapeItem>), group(g));
  const size = (label: string, patch: Partial<Pick<ShapeItem, "width" | "height">>, g: string) => editor.apply(label, p => updateItem(p, item.id, patch), group(g));
  const done = () => editor.endGroup();
  const solid = s.kind === "rect" || s.kind === "ellipse";
  const label = s.kind === "sticker" ? "Ink" : s.kind === "line" ? "Colour" : "Fill";

  return (
    <>
      <Section title={label}>
        {solid && <Toggle label="Filled" value={!s.noFill} onChange={v => (style("Fill", { noFill: v ? undefined : true }, "nofill"), done())} />}
        {(!solid || !s.noFill) && (
          <div className="swatches">
            {COLORS.map(c => (
              <button key={c} className={"swatch" + (s.color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => (style("Shape colour", { color: c }, "color"), done())} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Size">
        <Slider label="Width" value={item.width} min={20} max={2400} onChange={v => size("Resize", { width: v }, "w")} onCommit={done} />
        {s.kind !== "line" && <Slider label="Height" value={item.height} min={20} max={2400} onChange={v => size("Resize", { height: v }, "h")} onCommit={done} />}
        {s.kind === "rect" && <Slider label="Corners" value={s.radius ?? 0} min={0} max={Math.round(Math.min(item.width, item.height) / 2)} reset={24} onChange={v => style("Corner radius", { radius: v }, "radius")} onCommit={done} />}
        {s.kind === "line" && <Slider label="Thickness" value={s.thickness ?? 10} min={2} max={80} reset={10} onChange={v => style("Line thickness", { thickness: v }, "thick")} onCommit={done} />}
        {s.kind === "sticker" && <Slider label="Line weight" value={s.weight ?? 1} min={0.5} max={2} step={0.05} reset={1} format={v => `${Math.round(v * 100)}%`} onChange={v => style("Line weight", { weight: v }, "weight")} onCommit={done} />}
      </Section>
      {solid && (
        <Section title="Outline">
          <Toggle label="Outline" value={!!s.stroke} onChange={v => (style("Outline", { stroke: v ? { color: "#ffffff", width: 8 } : undefined }, "stroke"), done())} />
          {s.stroke && (
            <>
              <Slider label="Thickness" value={s.stroke.width} min={1} max={60} onChange={v => style("Outline", { stroke: { ...s.stroke!, width: v } }, "strokew")} onCommit={done} />
              <div className="swatches">
                {COLORS.map(c => (
                  <button key={c} className={"swatch" + (s.stroke!.color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => (style("Outline colour", { stroke: { ...s.stroke!, color: c } }, "strokec"), done())} />
                ))}
              </div>
            </>
          )}
        </Section>
      )}
    </>
  );
}
