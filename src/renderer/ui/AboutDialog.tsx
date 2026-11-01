import { useEffect } from "react";
import { REPO_PUBLIC, REPO_URL } from "../../shared/links";
import { Logo } from "./Home";
import { Icon } from "./kit/Icon";

export function AboutDialog({ onClose, onReport }: { onClose(): void; onReport(): void }) {
  const v = window.openroll.versions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-narrow about" role="dialog" aria-label="About OpenRoll">
        <header className="modal-head">
          <span />
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body about-body">
          <div className="about-mark">
            <Logo />
          </div>
          <h2>OpenRoll</h2>
          <p className="about-version num">Version {v.app}</p>
          <p className="about-line">A free, open source video editor. It runs on your computer, needs no account and adds no watermark.</p>
          <p className="about-line">Licensed under the GNU General Public License, version 3 or later.</p>
          <p className="about-fine num">
            Electron {v.electron}, Chrome {v.chrome}
          </p>
          <div className="about-links">
            <button className="textbtn" onClick={() => void window.openroll.updates.check()}>
              Check for updates
            </button>
            <button className="textbtn" onClick={onReport}>
              Report a problem
            </button>
            {REPO_PUBLIC && (
              <button className="textbtn" onClick={() => window.open(REPO_URL, "_blank")}>
                Source code
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
