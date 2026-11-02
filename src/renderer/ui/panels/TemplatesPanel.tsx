import { useEffect, useMemo, useRef, useState } from "react";
import { frameRatio, type Template } from "../../../core/template";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { useSettings } from "../../state/settings";
import {
  applyToEditor,
  describeFill,
  exportTemplate,
  importFromDialog,
  keepCommunityTemplate,
  removeTemplate,
  saveAsTemplate,
  templateStore,
  useTemplates,
  type TemplateSource,
} from "../../state/templates";
import { Segmented } from "../kit/Field";
import { Icon } from "../kit/Icon";
import { drawPreview, previewFontsReady, previewOf } from "./template-preview";
import "../../styles/templates.css";

type View = "starter" | "mine" | "community";

const VIEWS: { value: View; label: string }[] = [
  { value: "starter", label: "Starters" },
  { value: "mine", label: "Yours" },
  { value: "community", label: "Community" },
];

function matches(t: Template, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.name, t.description ?? "", t.author ?? "", ...(t.tags ?? []), t.kind === "captions" ? "captions style" : "timeline"].join(" ").toLowerCase().includes(q);
}

export function TemplatesPanel({ editor }: { editor: Editor }) {
  const snap = useTemplates();
  const online = useSettings().communityTemplates;
  const selection = useEditor(editor, e => e.selection);
  const [view, setView] = useState<View>("starter");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => void templateStore.start(), []);
  const mineCount = useRef(snap.mine.length);
  useEffect(() => {
    // Something was added to the person's list, by import or by a drop: show where it went.
    if (snap.mine.length > mineCount.current) setView("mine");
    mineCount.current = snap.mine.length;
  }, [snap.mine.length]);
  useEffect(() => {
    if (view === "community" && online) void templateStore.refreshCommunity();
  }, [view, online]);

  const list: Template[] = view === "starter" ? snap.starters : view === "mine" ? snap.mine : templateStore.communityOnly();
  const shown = useMemo(() => list.filter(t => matches(t, query)), [list, query]);

  return (
    <div
      className={"panel" + (over ? " panel-drop" : "")}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={e => e.currentTarget === e.target && setOver(false)}
      onDrop={e => {
        // Template files are caught for the whole window; anything else landing here is not ours.
        e.preventDefault();
        setOver(false);
        editor.toast("Drop a file that ends in .openrolltemplate");
      }}
    >
      <div className="panel-head">
        <h2>Templates</h2>
        <div className="tpl-actions">
          <button className="textbtn" onClick={() => void importFromDialog(editor)} title="Import a template file">
            <Icon name="plus" size={16} />
            Import
          </button>
          <button className="textbtn" onClick={() => setSaving(s => !s)} aria-expanded={saving} title="Keep the selected clips, or the whole timeline, as a template">
            <Icon name="version" size={16} />
            Save
          </button>
        </div>
      </div>

      {saving && (
        <SaveForm
          editor={editor}
          selected={selection.length}
          onDone={saved => {
            setSaving(false);
            if (saved) setView("mine");
          }}
        />
      )}

      <div className="tpl-tools">
        <label className="cap-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
        </label>
        <Segmented options={VIEWS} value={view} onChange={v => setView(v)} />
      </div>

      <div className="panel-scroll">
        {view === "community" && !online && <p className="tpl-empty">Community templates are off. Turn them on in Settings to browse what others have shared.</p>}
        {view === "community" && online && snap.reading && !shown.length && <p className="tpl-empty">Looking for community templates</p>}
        {view === "community" && online && !snap.reading && !shown.length && (
          <p className="tpl-empty">{snap.community.updated ? "Nothing new here yet. The starters are already in your list." : "Could not reach the community list. Check your connection and open this tab again."}</p>
        )}
        {view === "mine" && !list.length && <p className="tpl-empty">Nothing saved yet. Select clips on the timeline, press Save, and they become a template. You can also import a file.</p>}
        {view !== "community" && list.length > 0 && !shown.length && <p className="tpl-empty">No template matches “{query}”.</p>}
        {view === "community" && shown.length > 0 && <p className="panel-note">Made by other people. Check what a template does before you share a project that uses it.</p>}
        <div className="tpl-grid">
          {shown.map(t => (
            <TemplateCard key={t.id} editor={editor} template={t} source={view as TemplateSource} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SaveForm({ editor, selected, onDone }: { editor: Editor; selected: number; onDone(saved: boolean): void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"selection" | "timeline">(selected ? "selection" : "timeline");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await saveAsTemplate(editor, name, scope);
    setBusy(false);
    if (ok) onDone(true);
  }

  return (
    <form
      className="tpl-save"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <input className="text-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Template name" aria-label="Template name" maxLength={60} style={{ minHeight: 0 }} />
      <Segmented
        options={[
          { value: "selection", label: selected ? `Selected (${selected})` : "Selected" },
          { value: "timeline", label: "Whole timeline" },
        ]}
        value={scope}
        onChange={v => setScope(v)}
      />
      <p className="tpl-hint">Your clips are not kept. Each one becomes an empty slot, and the titles, shapes, looks and timing stay.</p>
      <div className="tpl-save-row">
        <button type="button" className="textbtn" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button type="submit" className="tpl-primary" disabled={!name.trim() || busy || (scope === "selection" && !selected)}>
          Save template
        </button>
      </div>
    </form>
  );
}

function TemplateCard({ editor, template: t, source }: { editor: Editor; template: Template; source: TemplateSource }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(true);
  const pv = useMemo(() => previewOf(t), [t]);

  useEffect(() => {
    let live = true;
    void previewFontsReady().then(() => live && setReady(true));
    return () => {
      live = false;
      cancelAnimationFrame(raf.current);
    };
  }, []);

  useEffect(() => {
    if (ready && ref.current) setDrawn(drawPreview(ref.current, pv, pv.poster));
  }, [ready, pv]);

  function play() {
    if (document.documentElement.dataset.reduceMotion === "true") return;
    const start = performance.now();
    const tick = (now: number) => {
      const loop = pv.length + 600_000;
      const at = Math.min(pv.length - 1, ((now - start) * 1000) % loop);
      if (ref.current) drawPreview(ref.current, pv, at);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf.current);
    if (ref.current) drawPreview(ref.current, pv, pv.poster);
  }

  const seconds = Math.round((pv.length / 1_000_000) * 10) / 10;
  const detail = t.kind === "captions" ? "Caption style" : `${frameRatio(t.frame)}, ${seconds} s`;

  return (
    <div className="tpl-card">
      <button className="tpl-tile" onClick={() => applyToEditor(editor, t)} onPointerEnter={play} onPointerLeave={stop} onFocus={play} onBlur={stop} title={`${t.description ?? t.name}\n${describeFill(editor, t)}`} aria-label={`Apply ${t.name}`}>
        <span className="tpl-stage">{drawn ? <canvas ref={ref} /> : <span className="tpl-nogl">{t.name}</span>}</span>
      </button>
      <div className="tpl-meta">
        <span className="tpl-name" title={t.name}>
          {t.name}
        </span>
        <span className="tpl-tools-row">
          {source === "community" && (
            <button className="tpl-icon" onClick={() => void keepCommunityTemplate(editor, t)} title="Add to your templates" aria-label={`Add ${t.name} to your templates`}>
              <Icon name="plus" size={15} />
            </button>
          )}
          <button className="tpl-icon" onClick={() => void exportTemplate(editor, t)} title="Export as a file" aria-label={`Export ${t.name}`}>
            <Icon name="export" size={15} />
          </button>
          {source === "mine" && (
            <button className="tpl-icon tpl-danger" onClick={() => void removeTemplate(editor, t)} title="Remove from your templates" aria-label={`Remove ${t.name}`}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </span>
        <span className="tpl-detail">{detail}</span>
      </div>
    </div>
  );
}
