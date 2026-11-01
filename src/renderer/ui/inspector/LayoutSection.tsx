import { LAYOUTS, type Layout } from "../../../core/layouts";
import type { MediaItem } from "../../../core/project";
import type { Editor } from "../../state/editor";
import { setLayout } from "../../state/smart-actions";
import { freezeAtPlayhead } from "../../state/timeline-actions";
import { Icon } from "../kit/Icon";
import { Section } from "../kit/Field";

/** Where the lit area sits inside a small frame, as x, y, width, height out of 28 by 16. */
const DIAGRAM: Record<Layout, [number, number, number, number]> = {
  full: [1, 1, 26, 14],
  "pip-tl": [2, 2, 9, 5],
  "pip-tr": [17, 2, 9, 5],
  "pip-bl": [2, 9, 9, 5],
  "pip-br": [17, 9, 9, 5],
  top: [1, 1, 26, 6.5],
  bottom: [1, 8.5, 26, 6.5],
  left: [1, 1, 12.5, 14],
  right: [14.5, 1, 12.5, 14],
};

const SHORT: Record<Layout, string> = {
  full: "Full",
  "pip-tl": "Top left",
  "pip-tr": "Top right",
  "pip-bl": "Bottom left",
  "pip-br": "Bottom right",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

/** One click picture in picture and split screen, plus a freeze frame button. */
export function LayoutSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const group = (ids: Layout[]) =>
    ids.map(id => {
      const [x, y, w, h] = DIAGRAM[id];
      const label = LAYOUTS.find(l => l.id === id)!.label;
      return (
        <button key={id} className="layout-btn" title={label} aria-label={label} onClick={() => setLayout(editor, id, label)}>
          <svg viewBox="0 0 28 16" aria-hidden="true">
            <rect x="0.5" y="0.5" width="27" height="15" rx="2" className="layout-frame" />
            <rect x={x} y={y} width={w} height={h} rx="1.2" className="layout-lit" />
          </svg>
          <span>{SHORT[id]}</span>
        </button>
      );
    });
  return (
    <Section title="Layout" fold="layout">
      <p className="layout-label">Picture in picture</p>
      <div className="layout-grid">{group(["pip-tl", "pip-tr", "pip-bl", "pip-br"])}</div>
      <p className="layout-label">Split screen</p>
      <div className="layout-grid">{group(["top", "bottom", "left", "right"])}</div>
      <div className="btnrow">
        <button className="tool" onClick={() => setLayout(editor, "full", "Full frame")}>
          Full frame
        </button>
        <button className="tool" onClick={() => freezeAtPlayhead(editor, item.id)} title="Hold the frame under the playhead for two seconds">
          <Icon name="freeze" size={15} />
          Freeze frame
        </button>
      </div>
      <p className="insp-note">A split puts the clip underneath it in the other half.</p>
    </Section>
  );
}
