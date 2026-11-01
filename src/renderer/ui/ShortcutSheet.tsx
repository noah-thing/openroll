import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, keyCaps, shortcutEvents, type Command } from "../state/commands";
import { Icon } from "./kit/Icon";
import "./menu/menu.css";

const ORDER: Command["group"][] = ["Playback", "Editing", "Selection", "Clipboard", "Trimming", "Markers and range", "Timeline view", "Project", "Mouse"];

/** Cmd+/ and Help > Keyboard Shortcuts. Reads the same table the key handler uses. */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(window.openroll.platform === "darwin");
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => {
      setQuery("");
      setOpen(true);
    };
    shortcutEvents.addEventListener("open", show);
    return () => shortcutEvents.removeEventListener("open", show);
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDER.map(group => ({
      group,
      rows: COMMANDS.filter(c => c.group === group && (c.keys.length > 0 || c.gesture)).filter(c => {
        if (!q) return true;
        const keys = c.keys.map(k => keyCaps(k, mac).join(" ")).join(" ");
        return `${c.label} ${c.group} ${keys} ${c.gesture ?? ""}`.toLowerCase().includes(q);
      }),
    })).filter(g => g.rows.length);
  }, [query, mac]);

  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="modal keysheet" role="dialog" aria-label="Keyboard shortcuts">
        <header className="keysheet-head">
          <h2>Keyboard shortcuts</h2>
          <input
            ref={input}
            className="keysheet-search"
            autoFocus
            placeholder="Search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              if (query) setQuery("");
              else close();
            }}
            aria-label="Search shortcuts"
          />
          <div className="keysheet-os" role="group" aria-label="Key labels">
            <button aria-pressed={mac} onClick={() => setMac(true)}>
              Mac
            </button>
            <button aria-pressed={!mac} onClick={() => setMac(false)}>
              Windows
            </button>
          </div>
          <button className="iconbtn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="keysheet-body">
          {groups.map(({ group, rows }) => (
            <section key={group} className="keysheet-group">
              <h3>{group}</h3>
              {rows.map(c => (
                <div key={c.id} className="keysheet-row">
                  <span>{c.label}</span>
                  {c.gesture ? (
                    <span className="keysheet-gesture">{mac ? c.gesture : c.gesture.replace(/Cmd/g, "Ctrl")}</span>
                  ) : (
                    <span className="keysheet-keys">
                      {c.keys.map(k => (
                        <span className="combo" key={k}>
                          {keyCaps(k, mac).map((cap, i) => (
                            <kbd key={i}>{cap}</kbd>
                          ))}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </section>
          ))}
          {!groups.length && <p className="keysheet-empty">No shortcut matches that.</p>}
        </div>
      </div>
    </div>
  );
}
