import { useEffect } from "react";
import { addEffectTo } from "../../../core/look/edit";
import { EFFECT_GROUPS, EFFECTS, effectDef, type EffectDef } from "../../../core/look/effects";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { LookCard } from "./LookCard";
import { drawLook, lookTarget, useFootage } from "./look-preview";

export const EFFECT_DRAG = "application/x-openroll-effect";

export function EffectsPanel({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const footage = useFootage(editor);
  const target = lookTarget(project, selection, editor.time);

  function add(kind: string, itemId = target?.item.id) {
    if (!itemId) {
      editor.toast("Select a clip first");
      return;
    }
    let added = false;
    editor.apply(`Add ${effectDef(kind)?.name.toLowerCase() ?? "effect"}`, p => {
      const r = addEffectTo(p, itemId, kind);
      added = !!r.effect;
      return r.project;
    });
    if (added) editor.select([itemId]);
  }

  // Dropping on a clip is handled here rather than in the timeline, so the timeline stays unaware of effects.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(EFFECT_DRAG)) return;
      if ((e.target as HTMLElement).closest?.(".clip[data-id]")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (e: DragEvent) => {
      const kind = e.dataTransfer?.getData(EFFECT_DRAG);
      const clip = (e.target as HTMLElement).closest?.(".clip[data-id]") as HTMLElement | null;
      if (!kind || !clip) return;
      e.preventDefault();
      add(kind, clip.dataset.id);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  });

  const paint = (def: EffectDef) => (canvas: HTMLCanvasElement, t: number | null) =>
    drawLook(
      canvas,
      footage.source,
      {
        effects: [{ id: "preview", kind: def.kind, amount: def.amount, speed: def.speed ?? 1, style: 0 }],
        time: def.poster + (t ?? 0),
        // Trails need something to trail, so the slow shutter card slides the picture.
        x: def.kind === "slow-shutter" && t !== null ? Math.sin(t * 3.2) * 70 : 0,
      },
      project,
      t !== null,
    );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Effects</h2>
      </div>
      <div className="panel-scroll">
        <p className="panel-note">{target ? "Click to add to the clip, or drag onto one." : "Select a clip, then click or drag an effect."}</p>
        {EFFECT_GROUPS.map(g => (
          <section key={g}>
            <h3 className="fx-group">{g}</h3>
            <div className="fx-grid">
              {EFFECTS.filter(e => e.group === g && !e.internal).map(def => (
                <LookCard
                  key={def.kind}
                  name={def.name}
                  deps={[footage.key]}
                  paint={paint(def)}
                  onPick={() => add(def.kind)}
                  drag={{ type: EFFECT_DRAG, value: def.kind }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
