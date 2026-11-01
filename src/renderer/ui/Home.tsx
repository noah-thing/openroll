import { useEffect, useState } from "react";
import { readProject } from "../../core/load";
import type { Project } from "../../core/project";
import type { FileInfo, RecentProject } from "../../shared/api";
import { HistoryDialog } from "./HistoryDialog";
import { Icon } from "./kit/Icon";
import { Credit } from "./Credit";
import { InboxButton } from "./Inbox";

interface Props {
  onOpen(project: Project, path: string): void;
  onNew(files?: FileInfo[], shape?: { width: number; height: number }): void;
}

const SHAPES = [
  { label: "Widescreen", note: "YouTube, TV", width: 1920, height: 1080 },
  { label: "Vertical", note: "TikTok, Shorts, Reels", width: 1080, height: 1920 },
  { label: "Square", note: "Feeds", width: 1080, height: 1080 },
  { label: "Portrait", note: "Instagram posts", width: 1080, height: 1350 },
];

export function Home({ onOpen, onNew }: Props) {
  const [projects, setProjects] = useState<RecentProject[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; project: RecentProject } | null>(null);
  const [history, setHistory] = useState<RecentProject | null>(null);

  useEffect(() => {
    void window.openroll.projects.list().then(setProjects);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  async function open(r: RecentProject) {
    const read = readProject((await window.openroll.projects.load(r.path)) ?? "");
    if (read.ok) onOpen(read.project, r.path);
    else setError(`${r.name} could not be opened. ${read.error} Use Restore an earlier version from its menu, or find the backup next to it as ${r.name}.openroll.bak.`);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = await window.openroll.pathsForDropped([...e.dataTransfer.files]);
    if (files.length) onNew(files);
  }

  return (
    <div
      className={"home" + (dragging ? " home-drop" : "")}
      onDragOver={e => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={e => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="home-bar drag-region">
        <div className="mark">
          <Logo />
          OpenRoll
        </div>
        <span className="spacer" />
        <Credit />
        <InboxButton />
      </header>
      <main className="home-main">
        <section className="home-start">
          <h2>New project</h2>
          <div className="home-shapes">
            <button
              className="home-shape home-shape-clips"
              onClick={async () => {
                const files = await window.openroll.pickMedia();
                if (files.length) onNew(files);
              }}
            >
              <span className="home-shape-frame">
                <Icon name="plus" size={22} />
              </span>
              <b>From clips</b>
              <small>Shape follows the first clip</small>
            </button>
            {SHAPES.map(shape => (
              <button key={shape.label} className="home-shape" onClick={() => onNew(undefined, shape)}>
                <span className="home-shape-frame">
                  <i style={{ aspectRatio: `${shape.width} / ${shape.height}` }} />
                </span>
                <b>{shape.label}</b>
                <small>{shape.note}</small>
              </button>
            ))}
          </div>
          <p className="home-hint">You can also drop clips anywhere on this window.</p>
        </section>

        {error && <p className="home-error">{error}</p>}

        <section className="home-projects">
          <h2>Projects</h2>
          {projects && !projects.length && <p className="home-empty">Projects you make show up here. They save as you work, there is no save button.</p>}
          <div className="home-grid">
            {projects?.map(p => (
              <div key={p.path} className="home-card-wrap" onContextMenu={e => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, project: p }))}>
                <button className="home-card" onClick={() => void open(p)}>
                  <span className="home-thumb">{p.thumb ? <img src={window.openroll.mediaUrl(p.thumb)} alt="" draggable={false} /> : null}</span>
                  <span className="home-name">{p.name}</span>
                  <span className="home-date">{relative(p.modified)}</span>
                </button>
                <button
                  className="iconbtn home-more"
                  aria-label={`More options for ${p.name}`}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.right, y: r.bottom + 4, project: p });
                  }}
                >
                  <Icon name="more" size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 90) }} onPointerDown={e => e.stopPropagation()}>
          <button
            role="menuitem"
            onClick={() => {
              setHistory(menu.project);
              setMenu(null);
            }}
          >
            Restore an earlier version…
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void window.openroll.revealInFolder(menu.project.path);
              setMenu(null);
            }}
          >
            Show in folder
          </button>
        </div>
      )}
      {history && (
        <HistoryDialog
          path={history.path}
          name={history.name}
          onClose={() => setHistory(null)}
          onRestored={() => {
            const project = history;
            setHistory(null);
            void open(project);
          }}
        />
      )}
      {dragging && <div className="home-drop-hint">Drop to start a new project with these clips</div>}
    </div>
  );
}

export function Logo() {
  // Same drawing as the app icon: a strip of film folded into a play button.
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.2 4.3c0-1.1 1.2-1.8 2.2-1.2l12.7 7.6c.5.3.7.8.7 1.3H5.2V4.3Zm2 1.8v2h2.1v-2H7.2Zm0 3.2v1.7h2.1V9.3H7.2Z"
      />
      <path fill="#4b8bf5" d="M5.2 12h15.6c0 .5-.2 1-.7 1.3L7.4 20.9c-1 .6-2.2-.1-2.2-1.2V12Z" />
    </svg>
  );
}

function relative(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "Just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
