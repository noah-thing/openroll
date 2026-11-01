import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../shared/api";
import { bytes } from "../lib/format";
import { Icon } from "./kit/Icon";

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

interface Props {
  path: string;
  name: string;
  /** Shown above the list, for the case where the project would not open. */
  note?: string;
  onClose(): void;
  /** Called after a version was put back, so the caller can open it or refresh. */
  onRestored(): void;
}

export function HistoryDialog({ path, name, note, onClose, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void window.openroll.history.list(path).then(list => {
      setEntries(list);
      setChosen(list[0]?.file ?? null);
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose]);

  async function restore() {
    if (!chosen) return;
    setBusy(true);
    const ok = await window.openroll.history.restore(path, chosen);
    setBusy(false);
    if (ok) onRestored();
    else setFailed(true);
  }

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Restore an earlier version">
        <header className="modal-head">
          <h2>Restore an earlier version</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <p className="modal-summary">{note ?? `OpenRoll keeps recent versions of ${name} while you work. Pick one to go back to.`}</p>
          {entries && !entries.length && <p className="insp-note">No earlier versions yet. They appear as you edit.</p>}
          {!!entries?.length && (
            <ul className="history-list" role="listbox" aria-label="Versions">
              {entries.map((e, i) => (
                <li key={e.file}>
                  <button role="option" aria-selected={e.file === chosen} className={e.file === chosen ? "on" : ""} onClick={() => setChosen(e.file)}>
                    <span>{when(e.time)}</span>
                    <small>{i === 0 ? "Latest, " : ""}{bytes(e.bytes)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {failed && <p className="modal-warn">That version could not be restored.</p>}
          <p className="insp-note">The version you have now is kept in this list, so you can switch back.</p>
          <div className="modal-actions">
            <button className="textbtn" onClick={onClose}>
              Cancel
            </button>
            <button className="export" disabled={!chosen || busy} onClick={restore}>
              Restore this version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
