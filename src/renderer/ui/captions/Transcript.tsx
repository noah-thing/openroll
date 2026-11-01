import { useEffect, useMemo, useRef, useState } from "react";
import { allCaptions, captionText, retimeWords } from "../../../core/captions";
import { deleteItems, updateItem } from "../../../core/edit";
import { findItem, itemEnd, type CaptionItem } from "../../../core/project";
import { useEditor, useFrame } from "../../lib/hooks";
import { shortTime } from "../../lib/format";
import type { Editor } from "../../state/editor";
import { Icon } from "../kit/Icon";

const collapse = (s: string) => s.trim().split(/\s+/).filter(Boolean).join(" ");

export function Transcript({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(-1);
  const list = useMemo(() => allCaptions(project).sort((a, b) => a.start - b.start), [project]);
  const rows = useRef(new Map<string, HTMLElement>());

  // The row under the playhead; only a change of row costs a render.
  useFrame(() => {
    const t = editor.time;
    const at = list.findIndex(c => t >= c.start && t < itemEnd(c));
    if (at !== now) setNow(at);
  });

  const activeId = now >= 0 ? list[now]?.id : undefined;
  useEffect(() => {
    if (!activeId || !editor.player?.playing) return;
    rows.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, editor]);

  const q = query.trim().toLowerCase();
  const shown = q ? list.filter(c => captionText(c).toLowerCase().includes(q)) : list;

  if (!list.length)
    return <p className="cap-empty">Captions you make or import show up here, with their times. Click a line to jump to it.</p>;

  return (
    <div className="cap-transcript">
      <label className="cap-search">
        <Icon name="search" size={14} />
        <input value={query} placeholder="Find in captions" onChange={e => setQuery(e.target.value)} />
      </label>
      <ol>
        {shown.map(c => (
          <Row key={c.id} editor={editor} item={c} active={c.id === activeId} selected={selection.includes(c.id)} query={q} register={el => (el ? rows.current.set(c.id, el) : rows.current.delete(c.id))} />
        ))}
      </ol>
      {!shown.length && <p className="cap-empty">No captions say that.</p>}
    </div>
  );
}

function Row({ editor, item, active, selected, query, register }: { editor: Editor; item: CaptionItem; active: boolean; selected: boolean; query: string; register(el: HTMLElement | null): void }) {
  const joined = captionText(item);
  const [draft, setDraft] = useState(joined);
  useEffect(() => setDraft(d => (collapse(d) === joined ? d : joined)), [joined]);

  const change = (text: string) => {
    setDraft(text);
    editor.apply(
      "Edit caption",
      p => {
        const cur = findItem(p, item.id)?.item;
        if (cur?.type !== "caption") return p;
        return updateItem(p, item.id, { words: retimeWords(cur.words, text, cur.duration) } as Partial<CaptionItem>);
      },
      `${item.id}:words`,
    );
  };

  return (
    <li ref={register} className={"cap-row" + (active ? " now" : "") + (selected ? " sel" : "")} data-query={query || undefined}>
      <button className="cap-time num" title="Jump here" onClick={() => (editor.seek(item.start), editor.select([item.id]))}>
        {shortTime(item.start)}
      </button>
      <input
        value={draft}
        aria-label={`Caption at ${shortTime(item.start)}`}
        onFocus={() => editor.select([item.id])}
        onChange={e => change(e.target.value)}
        onBlur={() => {
          editor.endGroup();
          if (!collapse(draft)) editor.apply("Delete caption", p => deleteItems(p, [item.id]));
        }}
        onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
      />
    </li>
  );
}
