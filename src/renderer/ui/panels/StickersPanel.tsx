import { useState } from "react";
import { STICKERS, STICKER_GROUPS, stickerSvg, type StickerDef } from "../../../core/stickers";
import type { Editor } from "../../state/editor";
import { addShape } from "../../state/smart-actions";
import "../../styles/smart.css";

/** null keeps each sticker's own colour. */
const INKS: (string | null)[] = [null, "#ffffff", "#14130e", "#f2c23a", "#e2674f", "#8fbf8a", "#7fb4e8", "#ff8fb1"];

export function StickersPanel({ editor }: { editor: Editor }) {
  const [ink, setInk] = useState<string | null>(null);

  const add = (s: StickerDef) => addShape(editor, { kind: "sticker", sticker: s.id, ...(ink && s.group !== "Faces" ? { color: ink } : {}) });

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Stickers and shapes</h2>
      </div>
      <div className="panel-scroll">
        <div className="shape-row">
          <button onClick={() => addShape(editor, { kind: "rect", ...(ink ? { color: ink } : {}) }, "Add shape")} title="Add a rectangle at the playhead">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="2.5" fill="currentColor" /></svg>
            Rectangle
          </button>
          <button onClick={() => addShape(editor, { kind: "ellipse", ...(ink ? { color: ink } : {}) }, "Add shape")} title="Add an ellipse at the playhead">
            <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="7" fill="currentColor" /></svg>
            Ellipse
          </button>
          <button onClick={() => addShape(editor, { kind: "line", ...(ink ? { color: ink } : {}) }, "Add shape")} title="Add a line at the playhead">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" /></svg>
            Line
          </button>
        </div>
        <div className="swatches ink-row" role="group" aria-label="Colour for new stickers">
          {INKS.map(c => (
            <button key={c ?? "own"} className={"swatch" + (ink === c ? " on" : "") + (c === null ? " swatch-own" : "")} style={c ? { background: c } : undefined} title={c ?? "Each sticker's own colour"} onClick={() => setInk(c)} />
          ))}
        </div>
        {STICKER_GROUPS.map(group => (
          <section key={group} className="sticker-group">
            <h3>{group}</h3>
            <div className="sticker-grid">
              {STICKERS.filter(s => s.group === group).map(s => (
                <button key={s.id} className="sticker" title={`Add ${s.name.toLowerCase()} at the playhead`} onClick={() => add(s)}>
                  <svg viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: stickerSvg(s, ink && s.group !== "Faces" ? ink : s.color) }} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
