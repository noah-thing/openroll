import { useEffect, useMemo, useRef } from "react";
import { setTransition } from "../../../core/edit";
import { itemEnd, type Project } from "../../../core/project";
import { TRANSITIONS } from "../../../engine/shaders";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { abstractFrames, drawTransition } from "./transition-preview";

const NAMES: Record<string, string> = {
  dissolve: "Dissolve", "dip-black": "Dip to black", "dip-white": "Dip to white", "wipe-left": "Wipe left", "wipe-right": "Wipe right",
  "wipe-up": "Wipe up", "wipe-down": "Wipe down", "slide-left": "Slide left", "slide-right": "Slide right", "push-up": "Push up",
  "zoom-in": "Zoom in", "zoom-out": "Zoom out", blur: "Blur", circle: "Circle", flash: "Flash", split: "Split",
};

/** The cut a transition would go on: the selected clip's start, or the cut nearest the playhead. */
function targetCut(p: Project, selection: string[], t: number): { id: string; kind?: string } | null {
  const main = p.tracks.find(tr => tr.main);
  if (!main) return null;
  const items = main.items;
  const sel = items.findIndex(i => selection.includes(i.id));
  if (sel > 0) return { id: items[sel].id, kind: items[sel].transitionIn?.kind };
  let best: { id: string; kind?: string } | null = null;
  let dist = Infinity;
  for (let i = 1; i < items.length; i++) {
    const d = Math.abs(items[i].start - t);
    if (d < dist && itemEnd(items[i - 1]) === items[i].start) {
      dist = d;
      best = { id: items[i].id, kind: items[i].transitionIn?.kind };
    }
  }
  return best;
}

export function TransitionsPanel({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const cut = targetCut(project, selection, editor.time);
  const frames = useMemo(() => abstractFrames(), []);

  function apply(kind: string | null) {
    if (!cut) {
      editor.toast("Put two clips next to each other on the main track first");
      return;
    }
    editor.apply(kind ? `Add ${NAMES[kind].toLowerCase()}` : "Remove transition", p => setTransition(p, cut.id, kind, 500_000));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Transitions</h2>
      </div>
      <p className="panel-note">{cut ? "Click to put one on the cut nearest the playhead." : "Transitions go between two clips on the main track."}</p>
      <div className="fx-grid">
        <button className={"fx-card" + (cut && !cut.kind ? " on" : "")} onClick={() => apply(null)}>
          <span className="fx-none">None</span>
          <span className="fx-name">None</span>
        </button>
        {TRANSITIONS.map(kind => (
          <TransitionCard key={kind} kind={kind} active={cut?.kind === kind} frames={frames} onPick={() => apply(kind)} />
        ))}
      </div>
    </div>
  );
}

function TransitionCard({ kind, active, frames, onPick }: { kind: string; active: boolean; frames: [OffscreenCanvas, OffscreenCanvas]; onPick(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    drawTransition(ref.current!, kind, 0.5, frames[0], frames[1]);
    return () => cancelAnimationFrame(raf.current);
  }, [kind, frames]);

  function play() {
    const start = performance.now();
    const tick = (now: number) => {
      // 1.4 s loop: hold A, transition, hold B
      const t = ((now - start) % 1400) / 1400;
      const p = Math.min(1, Math.max(0, (t - 0.15) / 0.7));
      drawTransition(ref.current!, kind, p, frames[0], frames[1]);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf.current);
    drawTransition(ref.current!, kind, 0.5, frames[0], frames[1]);
  }

  return (
    <button className={"fx-card" + (active ? " on" : "")} onClick={onPick} onPointerEnter={play} onPointerLeave={stop}>
      <canvas ref={ref} className="fx-canvas" />
      <span className="fx-name">{NAMES[kind] ?? kind}</span>
    </button>
  );
}
