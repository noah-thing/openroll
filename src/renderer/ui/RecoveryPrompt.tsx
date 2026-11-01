import { useEffect } from "react";
import type { SessionNotice } from "../../shared/api";
import { Icon } from "./kit/Icon";

interface Props {
  notice: SessionNotice;
  onReopen(): void;
  onEarlier(): void;
  onDismiss(): void;
}

export function RecoveryPrompt({ notice, onReopen, onEarlier, onDismiss }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onDismiss()}>
      <div className="modal" role="alertdialog" aria-label="OpenRoll did not close properly">
        <header className="modal-head">
          <h2>OpenRoll did not close properly</h2>
          <button className="iconbtn" onClick={onDismiss} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <p className="modal-summary">
            {notice.name} was open. Changes are saved as you work, so it should be up to date. If something looks wrong, go back to an earlier version.
          </p>
          <div className="modal-actions">
            <button className="textbtn" onClick={onDismiss}>
              Not now
            </button>
            <button className="textbtn" onClick={onEarlier}>
              Earlier version
            </button>
            <button className="export" onClick={onReopen}>
              Reopen {notice.name}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
