import { insertItems } from "../../../core/edit";
import type { Editor } from "../../state/editor";
import { TEXT_DRAG_TYPE, TEXT_PRESETS, textFromPreset, type TextPreset } from "./text-presets";

export function TextPanel({ editor }: { editor: Editor }) {
  function add(preset: TextPreset) {
    const p = editor.project;
    const item = textFromPreset(preset, editor.time, p);
    const textTrack = p.tracks.find(t => t.kind === "text");
    editor.apply("Add text", proj => insertItems(proj, [item], textTrack ? { trackId: textTrack.id } : {}));
    editor.select([item.id]);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Text</h2>
      </div>
      <div className="text-grid">
        {TEXT_PRESETS.map(preset => (
          <button
            key={preset.id}
            className="text-card"
            onClick={() => add(preset)}
            draggable
            onDragStart={e => e.dataTransfer.setData(TEXT_DRAG_TYPE, preset.id)}
            title={`Add ${preset.name.toLowerCase()} at the playhead`}
          >
            <span className="text-specimen" style={specimen(preset)}>
              {preset.sample}
            </span>
            <span className="text-card-name">{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function specimen(p: TextPreset): React.CSSProperties {
  const s = p.style;
  return {
    fontFamily: s.font.includes(",") ? s.font : `"${s.font}"`,
    fontWeight: s.weight,
    fontSize: Math.max(13, Math.min(22, s.size / 4.6)),
    letterSpacing: s.letterSpacing / 4.6,
    color: s.color,
    background: s.background?.color,
    padding: s.background ? `${s.background.padding / 5}px ${s.background.padding / 3.5}px` : undefined,
    borderRadius: s.background ? s.background.radius / 4 : undefined,
    WebkitTextStroke: s.stroke ? `${s.stroke.width / 4}px ${s.stroke.color}` : undefined,
    paintOrder: "stroke fill",
    textShadow: s.shadow ? `0 ${s.shadow.y / 4}px ${s.shadow.blur / 4}px ${s.shadow.color}` : undefined,
  };
}
