import { useState } from "react";
import { renameProject } from "../../core/edit";
import { useEditor } from "../lib/hooks";
import type { Editor } from "../state/editor";
import { Logo } from "./Home";
import { Icon } from "./kit/Icon";
import { RatioPicker } from "./RatioPicker";

export function TopBar({ editor, onHome, onExport }: { editor: Editor; onHome(): void; onExport(): void }) {
  const name = useEditor(editor, e => e.project.name);
  const saveState = useEditor(editor, e => e.saveState);
  const undoLabel = useEditor(editor, e => e.history.undoLabel);
  const redoLabel = useEditor(editor, e => e.history.redoLabel);
  const [editing, setEditing] = useState(false);

  return (
    <header className="top drag-region">
      <button className="mark no-drag" onClick={onHome} title="All projects">
        <Logo />
        <span>OpenRoll</span>
      </button>
      <div className="proj no-drag">
        {editing ? (
          <input
            className="proj-name-input"
            autoFocus
            defaultValue={name}
            onFocus={e => e.currentTarget.select()}
            onBlur={e => {
              editor.apply("Rename project", p => renameProject(p, e.currentTarget.value));
              setEditing(false);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button className="proj-name" onClick={() => setEditing(true)} title="Rename">
            {name}
          </button>
        )}
        <span className={"saved saved-" + saveState}>{saveState === "error" ? "Not saved" : saveState === "saved" ? "Saved" : "Saving…"}</span>
      </div>
      <div className="spacer" />
      <div className="top-actions no-drag">
        <button className="iconbtn" disabled={!undoLabel} onClick={() => editor.undo()} title={undoLabel ? `Undo ${undoLabel.toLowerCase()}` : "Nothing to undo"}>
          <Icon name="undo" />
        </button>
        <button className="iconbtn" disabled={!redoLabel} onClick={() => editor.redo()} title={redoLabel ? `Redo ${redoLabel.toLowerCase()}` : "Nothing to redo"}>
          <Icon name="redo" />
        </button>
        <RatioPicker editor={editor} />
        <button className="export" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  );
}
