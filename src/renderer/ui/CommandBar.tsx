import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { rank, type Ranked } from "../../core/fuzzy";
import type { Editor } from "../state/editor";
import { keyCaps, type Hooks } from "../state/commands";
import { buildActions, noteRecent, recentIds, type Action } from "../state/palette";
import { smartEvents } from "../state/smart-events";
import { Icon } from "./kit/Icon";
import "../styles/smart.css";

const ROW = 36;

/** Cmd+K: search every command and action, run one without leaving the keyboard. */
export function CommandBar({ editor, hooks }: { editor: Editor; hooks: Hooks }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const show = () => {
    setClosing(false);
    setOpen(true);
  };
  const hide = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 110);
  };

  useEffect(() => {
    const onOpen = () => show();
    smartEvents.addEventListener("palette", onOpen);
    // Capture phase so it works while a text field has focus, and so the shortcut table never sees it too.
    const onKey = (e: KeyboardEvent) => {
      const mac = window.openroll.platform === "darwin";
      if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        if (open && !closing) hide();
        else show();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      smartEvents.removeEventListener("palette", onOpen);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  if (!open) return null;
  return <Bar editor={editor} hooksRef={hooksRef} closing={closing} onClose={hide} />;
}

function Bar({ editor, hooksRef, closing, onClose }: { editor: Editor; hooksRef: React.MutableRefObject<Hooks>; closing: boolean; onClose(): void }) {
  const mac = window.openroll.platform === "darwin";
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const bead = useRef<HTMLSpanElement>(null);
  const recents = useMemo(recentIds, []);
  const actions = useMemo(() => buildActions(editor).filter(a => !a.enabled || a.enabled(editor)), [editor]);
  const results = useMemo(() => rank(actions.map(a => ({ ...a })), query, recents), [actions, query, recents]);
  const recentCount = !query.trim() ? results.filter(r => recents.includes(r.item.id)).length : 0;

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  // Slide the highlight to the chosen row, and keep the row in view.
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (!row || !bead.current || !list.current) return;
    bead.current.style.transform = `translateY(${row.offsetTop}px)`;
    bead.current.style.opacity = "1";
    const top = row.offsetTop, bottom = top + row.offsetHeight, view = list.current;
    if (top < view.scrollTop + 4) view.scrollTop = Math.max(0, top - 30);
    else if (bottom > view.scrollTop + view.clientHeight - 4) view.scrollTop = bottom - view.clientHeight + 8;
  }, [index, results]);

  const run = (r: Ranked<Action> | undefined) => {
    if (!r) return;
    const action = r.item;
    noteRecent(action.id);
    onClose();
    // Let the bar leave and focus return to the editor first, so actions that read focus see the editor.
    window.setTimeout(() => void action.run(editor, hooksRef.current), 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setIndex(i => (n ? (i + 1) % n : 0));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setIndex(i => (n ? (i - 1 + n) % n : 0));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setIndex(i => Math.min(n - 1, i + 6));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setIndex(i => Math.max(0, i - 6));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[index]);
    }
  };

  return (
    <div className={"cmdbar-back" + (closing ? " closing" : "")} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="cmdbar" role="dialog" aria-label="Command bar" onKeyDown={onKey}>
        <div className="cmdbar-input">
          <Icon name="search" size={17} />
          <input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Type a command, like split, speed 2x or captions" spellCheck={false} autoComplete="off" role="combobox" aria-expanded="true" aria-controls="cmdbar-list" aria-activedescendant={`cmd-${index}`} />
          <button className="iconbtn" aria-label="Close" onClick={onClose} tabIndex={-1}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="cmdbar-list" ref={list} id="cmdbar-list" role="listbox">
          <span className="cmdbar-bead" ref={bead} style={{ height: ROW }} />
          {results.length === 0 && <p className="cmdbar-empty">Nothing matches “{query}”. Try fewer words.</p>}
          {results.map((r, i) => (
            <Fragment key={r.item.id}>
              {!query.trim() && (i === 0 || i === recentCount) && <h3 className="cmdbar-head">{i === 0 && recentCount > 0 ? "Recent" : "Commands"}</h3>}
              <Row r={r} i={i} on={i === index} mac={mac} onHover={() => setIndex(i)} onRun={() => run(r)} />
            </Fragment>
          ))}
        </div>
        <footer className="cmdbar-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↩</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}

function Row({ r, i, on, mac, onHover, onRun }: { r: Ranked<Action>; i: number; on: boolean; mac: boolean; onHover(): void; onRun(): void }) {
  const a = r.item;
  const caps = a.keys?.[0] ? keyCaps(a.keys[0], mac) : null;
  return (
    <div id={`cmd-${i}`} data-i={i} role="option" aria-selected={on} className={"cmdbar-row" + (on ? " on" : "")} style={{ height: ROW }} onPointerMove={onHover} onClick={onRun}>
      <span className="cmdbar-label">{marked(a.label, r.match.hits)}</span>
      <span className="cmdbar-meta">
        {caps ? (
          <span className="cmdbar-keys">
            {caps.map((c, k) => (
              <kbd key={k}>{c}</kbd>
            ))}
          </span>
        ) : (
          <span className="cmdbar-group">{a.group}</span>
        )}
      </span>
    </div>
  );
}

/** The label with matched letters set in full ink. */
function marked(label: string, hits: number[]) {
  if (!hits.length) return label;
  const set = new Set(hits);
  const out: React.ReactNode[] = [];
  let run = "", hot = false;
  const flush = () => {
    if (run) out.push(hot ? <b key={out.length}>{run}</b> : run);
    run = "";
  };
  [...label].forEach((ch, k) => {
    const h = set.has(k);
    if (h !== hot) {
      flush();
      hot = h;
    }
    run += ch;
  });
  flush();
  return out;
}
