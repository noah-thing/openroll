import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { inbox, type InboxEntry } from "../state/inbox";
import { Icon } from "./kit/Icon";
import { NoteBody } from "./NoteBody";

function useInbox(): number {
  return useSyncExternalStore(inbox.subscribe, () => inbox.version);
}

/** The bell. Unread messages show as a count; opening the panel marks what you saw as read. */
export function InboxButton() {
  useInbox();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = inbox.unread().length;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    // Read means seen for a moment, not merely opened by accident.
    const t = setTimeout(() => inbox.markRead(inbox.entries().map(e => e.id)), 1200);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="inbox no-drag" ref={ref}>
      <button className="iconbtn inbox-bell" aria-label={unread ? `${unread} unread messages` : "Messages"} title="Messages" onClick={() => setOpen(o => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="inbox-count num">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && <InboxPanel />}
    </div>
  );
}

function InboxPanel() {
  useInbox();
  const entries = inbox.entries();
  return (
    <div className="inbox-panel" role="dialog" aria-label="Messages">
      <header>
        <b>Messages</b>
      </header>
      {!entries.length ? (
        <p className="inbox-empty">Nothing new. Updates and news from the OpenRoll team show up here.</p>
      ) : (
        <div className="inbox-list">
          {entries.map(e => (
            <Entry key={e.id} entry={e} unread={!inbox.read.has(e.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Entry({ entry, unread }: { entry: InboxEntry; unread: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <article className={"inbox-entry" + (unread ? " unread" : "") + (entry.kind === "release" ? " release" : "")}>
      <div className="inbox-entry-head">
        <h3>{entry.title}</h3>
        <time className="num">{formatDate(entry.date)}</time>
      </div>
      {entry.body && <NoteBody body={entry.body} />}
      <div className="inbox-actions">
        {entry.action === "install" && (
          <button
            className="export"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await window.openroll.updates.download();
              setBusy(false);
            }}
          >
            {busy ? "Downloading…" : "Install update"}
          </button>
        )}
        {entry.action === "restart" && (
          <button className="export" onClick={() => void window.openroll.updates.installNow()}>
            Restart now
          </button>
        )}
        {entry.buttons?.map((b, i) => (
          <a key={b.url} className={i === 0 && !entry.action ? "export link-button" : "textbtn"} href={b.url} target="_blank" rel="noreferrer">
            {b.label}
          </a>
        ))}
      </div>
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Messages marked "toast" slide in at the top right, one at a time, and stay until closed.
 * They remain in the bell afterwards.
 */
export function NewsToasts() {
  useInbox();
  const [current, setCurrent] = useState<InboxEntry | null>(null);
  const [leaving, setLeaving] = useState(false);
  const unread = inbox.unread();
  const louder = unread.some(e => e.level === "popup") || (!!inbox.whatsNew && unread.some(e => e.id === `release-${inbox.whatsNew!.version}`));
  // A toast waits its turn behind a popup or the notes for a fresh update.
  const next = louder ? undefined : unread.find(e => e.level === "toast");

  useEffect(() => {
    if (current || !next) return;
    setCurrent(next);
    setLeaving(false);
  }, [current, next]);

  function dismiss() {
    if (!current) return;
    setLeaving(true);
    inbox.markRead([current.id]);
    setTimeout(() => setCurrent(null), 260);
  }

  if (!current) return null;
  return (
    <div
      className={"news-toast" + (leaving ? " leaving" : "")}
      role="status"
    >
      {current.image && <img className="news-toast-image" src={current.image.url} alt={current.image.alt} draggable={false} />}
      <div className="news-toast-text">
        <b>{current.title}</b>
        {current.body && <NoteBody body={current.body} />}
        {current.buttons?.length ? (
          <div className="news-toast-actions">
            {current.buttons.map(b => (
              <a key={b.url} className="toast-undo" href={b.url} target="_blank" rel="noreferrer" onClick={dismiss}>
                {b.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <button className="iconbtn sm news-toast-close" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/**
 * The loudest level: a centred card for launches, events and big changes. Shown once, and never
 * on top of another dialog or the first run after an update.
 */
export function NewsPopup() {
  useInbox();
  const [closing, setClosing] = useState(false);
  const blockedByWhatsNew = !!inbox.whatsNew && !inbox.read.has(`release-${inbox.whatsNew.version}`);
  const item = blockedByWhatsNew ? undefined : inbox.unread().find(e => e.level === "popup");
  if (!item) return null;
  const close = () => {
    setClosing(true);
    setTimeout(() => {
      inbox.markRead([item.id]);
      setClosing(false);
    }, 220);
  };
  return (
    <div className={"modal-back popup-back" + (closing ? " closing" : "")} onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="modal news-popup" role="dialog" aria-label={item.title}>
        {item.image && (
          <div className="news-popup-image" style={item.image.aspect ? { aspectRatio: String(item.image.aspect) } : undefined}>
            <img src={item.image.url} alt={item.image.alt} draggable={false} />
          </div>
        )}
        <button className="iconbtn news-popup-close" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="news-popup-body">
          <h2>{item.title}</h2>
          {item.body && <NoteBody body={item.body} />}
          <div className="news-popup-actions">
            {item.buttons?.map((b, i) => (
              <a key={b.url} className={i === 0 ? "export link-button" : "textbtn"} href={b.url} target="_blank" rel="noreferrer" onClick={close}>
                {b.label}
              </a>
            ))}
            <button className="textbtn" onClick={close}>
              {item.buttons?.length ? "Not now" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown once on the first launch after an update. */
export function WhatsNewDialog() {
  useInbox();
  const [closed, setClosed] = useState(false);
  const w = inbox.whatsNew;
  if (!w || closed || inbox.read.has(`release-${w.version}`)) return null;
  const close = () => {
    setClosed(true);
    inbox.markRead([`release-${w.version}`]);
  };
  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="modal whats-new" role="dialog" aria-label={`What's new in ${w.version}`}>
        <header className="modal-head">
          <h2>What's new in {w.version}</h2>
          <button className="iconbtn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <NoteBody body={w.notes || "This version has fixes and small improvements."} />
          <div className="modal-actions">
            <button className="export" onClick={close}>
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
