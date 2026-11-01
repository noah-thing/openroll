import { useEffect, useRef, useState } from "react";
import { useEditor } from "../lib/hooks";
import type { Editor } from "../state/editor";
import { openSmart, smartEvents } from "../state/smart-events";
import { Icon } from "./kit/Icon";
import "../styles/smart.css";

/** The small button beside undo and redo. */
export function HistoryButton({ editor }: { editor: Editor }) {
  const steps = useEditor(editor, e => e.history.undoLabel);
  return (
    <button className="iconbtn" title="Undo history" aria-label="Undo history" disabled={!steps && !editor.history.redoLabel} onClick={() => openSmart("history")}>
      <Icon name="history" />
    </button>
  );
}

/** Every step of this session by name. Click one to be at that point, forward or back. */
export function HistoryPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEditor(editor, e => e.project);

  useEffect(() => {
    const show = () => setOpen(o => !o);
    smartEvents.addEventListener("history", show);
    return () => smartEvents.removeEventListener("history", show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[aria-label="Undo history"]')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!open) return null;
  const { labels, applied } = editor.history.timeline;
  const rows = labels.map((label, k) => ({ label, k })).reverse();
  return (
    <div className="histpanel" ref={ref} role="group" aria-label="Undo history panel">
      <header>
        <h2>Undo history</h2>
        <span>
          {applied} of {labels.length} steps
        </span>
      </header>
      <ol className="histlist" reversed>
        {rows.map(({ label, k }) => (
          <li key={k}>
            <button className={(k < applied ? "done" : "later") + (k === applied - 1 ? " now" : "")} onClick={() => editor.travelTo(k + 1)} aria-current={k === applied - 1 ? "step" : undefined}>
              <span className="histdot" />
              <span className="histname">{label}</span>
              {k === applied - 1 && <small>You are here</small>}
              {k >= applied && <small>Undone</small>}
            </button>
          </li>
        ))}
        <li>
          <button className={"done" + (applied === 0 ? " now" : "")} onClick={() => editor.travelTo(0)} aria-current={applied === 0 ? "step" : undefined}>
            <span className="histdot" />
            <span className="histname">Start of this session</span>
            {applied === 0 && <small>You are here</small>}
          </button>
        </li>
      </ol>
      {!labels.length && <p className="histnote">Edits you make show up here.</p>}
      {labels.length > 0 && <p className="histnote">Steps after the one you pick stay until you make a new edit.</p>}
    </div>
  );
}
