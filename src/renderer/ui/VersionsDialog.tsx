import { useCallback, useEffect, useRef, useState } from "react";
import { readProject } from "../../core/load";
import type { VersionEntry } from "../../shared/api";
import { bytes } from "../lib/format";
import type { Editor } from "../state/editor";
import { smartEvents } from "../state/smart-events";
import { Icon } from "./kit/Icon";
import "../styles/smart.css";

function when(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** Named versions of this project: save one, see them, put one back. */
export function VersionsDialog({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    smartEvents.addEventListener("save-version", show);
    smartEvents.addEventListener("versions", show);
    return () => {
      smartEvents.removeEventListener("save-version", show);
      smartEvents.removeEventListener("versions", show);
    };
  }, []);
  return open ? <Dialog editor={editor} onClose={() => setOpen(false)} /> : null;
}

function Dialog({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const [entries, setEntries] = useState<VersionEntry[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = editor.project.id;

  const refresh = useCallback(() => void window.openroll.snapshots.list(id).then(setEntries), [id]);
  useEffect(() => {
    refresh();
    input.current?.focus();
  }, [refresh]);

  async function save() {
    setBusy(true);
    setFailed("");
    const label = name.trim() || `Version ${(entries?.length ?? 0) + 1}`;
    const saved = await window.openroll.snapshots.save(label, JSON.stringify(editor.project));
    setBusy(false);
    if (!saved) return setFailed("That version could not be saved.");
    setName("");
    editor.toast(`Saved “${saved.name}”`);
    refresh();
  }

  async function restore(e: VersionEntry) {
    const text = await window.openroll.snapshots.read(id, e.file);
    try {
      const read = readProject(text ?? "");
      if (!read.ok || read.project.id !== id) throw new Error();
      const parsed = read.project;
      // An ordinary edit, so Undo brings the current state back.
      editor.apply(`Restore ${e.name}`, () => ({ ...parsed, modified: Date.now() }));
      editor.toast(`Restored “${e.name}”. Undo goes back.`);
      onClose();
    } catch {
      setFailed("That version could not be read.");
    }
  }

  async function remove(e: VersionEntry) {
    await window.openroll.snapshots.remove(id, e.file);
    refresh();
  }

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal versions" role="dialog" aria-label="Saved versions">
        <header className="modal-head">
          <h2>Saved versions</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <form
            className="versions-new"
            onSubmit={e => {
              e.preventDefault();
              void save();
            }}
          >
            <input ref={input} value={name} onChange={e => setName(e.target.value)} placeholder="Name this version, like first cut" maxLength={80} aria-label="Version name" />
            <button className="export" type="submit" disabled={busy}>
              Save version
            </button>
          </form>
          {entries && !entries.length && <p className="insp-note">No saved versions yet. Save one before a risky change and come back to it any time.</p>}
          {!!entries?.length && (
            <ul className="versions-list">
              {entries.map(e => (
                <li key={e.file}>
                  <span className="versions-name">{e.name}</span>
                  <small>
                    {when(e.time)}, {bytes(e.bytes)}
                  </small>
                  <button className="textbtn sm" onClick={() => void restore(e)}>
                    Restore
                  </button>
                  <button className="iconbtn" aria-label={`Delete ${e.name}`} title="Delete" onClick={() => void remove(e)}>
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {failed && <p className="modal-warn">{failed}</p>}
          <p className="insp-note">OpenRoll also keeps a rolling set of automatic versions of the saved file. Saved versions here stay until you delete them.</p>
        </div>
      </div>
    </div>
  );
}
