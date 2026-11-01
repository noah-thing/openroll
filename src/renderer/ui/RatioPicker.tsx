import { useEditor } from "../lib/hooks";
import type { Editor } from "../state/editor";
import type { Project } from "../../core/project";

const RATIOS = [
  { label: "16:9", w: 1920, h: 1080 },
  { label: "9:16", w: 1080, h: 1920 },
  { label: "1:1", w: 1080, h: 1080 },
  { label: "4:5", w: 1080, h: 1350 },
];

export function RatioPicker({ editor }: { editor: Editor }) {
  const settings = useEditor(editor, e => e.project.settings);
  const current = RATIOS.find(r => Math.abs(r.w / r.h - settings.width / settings.height) < 0.01);
  return (
    <div className="ratio" role="group" aria-label="Frame shape">
      {RATIOS.map(r => (
        <button
          key={r.label}
          aria-pressed={current === r}
          onClick={() =>
            editor.apply(`Change frame to ${r.label}`, p => {
              if (p.settings.width === r.w && p.settings.height === r.h) return p;
              // keep the long side when the project is larger than 1080p
              const k = Math.max(1, Math.max(p.settings.width, p.settings.height) / Math.max(r.w, r.h));
              const next: Project = { ...p, settings: { ...p.settings, width: Math.round((r.w * k) / 2) * 2, height: Math.round((r.h * k) / 2) * 2 } };
              return next;
            })
          }
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
