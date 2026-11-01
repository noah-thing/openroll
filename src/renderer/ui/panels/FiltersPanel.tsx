import { setFilter } from "../../../core/look/edit";
import { FILTER_GROUPS, FILTERS } from "../../../core/look/filters";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { importLut } from "../../state/lut-import";
import { Icon } from "../kit/Icon";
import { Slider } from "../kit/Field";
import { LookCard } from "./LookCard";
import { drawLook, lookTarget, useFootage } from "./look-preview";

/** 1 at rest, dips toward 0 and returns, so hovering shows what the filter does to the picture. */
const pulse = (t: number) => 0.5 + 0.5 * Math.cos(t * 2.4);

export function FiltersPanel({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const footage = useFootage(editor);
  const target = lookTarget(project, selection, editor.time);
  const current = target?.item.filter;
  const luts = Object.entries(project.luts ?? {});

  function pick(id: string | null) {
    if (!target) {
      editor.toast("Select a clip first");
      return;
    }
    const keep = id && current ? current.amount : 1;
    editor.apply(id ? "Add filter" : "Remove filter", p => setFilter(p, target.item.id, id, keep));
    if (!selection.includes(target.item.id)) editor.select([target.item.id]);
  }

  async function pickLut() {
    const file = await window.openroll.pickLut();
    if (file) importLut(editor, file, target?.item.id);
  }

  const card = (id: string, name: string) => (
    <LookCard
      key={id}
      name={name}
      active={current?.id === id}
      deps={[footage.key, project.luts]}
      paint={(canvas, t) => drawLook(canvas, footage.source, { filter: { id, amount: t === null ? 1 : pulse(t) } }, project)}
      onPick={() => pick(id)}
    />
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Filters</h2>
        <button className="textbtn" onClick={() => void pickLut()} title="Import a .cube LUT">
          <Icon name="plus" size={16} />
          LUT
        </button>
      </div>
      <div className="panel-scroll">
        <p className="panel-note">{footage.own ? "Previews use your footage." : "Add a clip to preview filters on your own footage."}</p>
        {current && (
          <div className="panel-strength">
            <Slider
              label="Strength"
              value={current.amount * 100}
              min={0}
              max={100}
              unit="%"
              reset={100}
              onChange={v => editor.apply("Filter strength", p => setFilter(p, target!.item.id, current.id, v / 100), `${target!.item.id}:filter-amount`)}
              onCommit={() => editor.endGroup()}
            />
          </div>
        )}
        <div className="fx-grid">
          <button className={"fx-card" + (target && !current ? " on" : "")} onClick={() => pick(null)}>
            <span className="fx-none">None</span>
            <span className="fx-name">None</span>
          </button>
        </div>
        {luts.length > 0 && (
          <>
            <h3 className="fx-group">Imported</h3>
            <div className="fx-grid">{luts.map(([id, l]) => card(id, l.name))}</div>
          </>
        )}
        {FILTER_GROUPS.map(g => (
          <section key={g}>
            <h3 className="fx-group">{g}</h3>
            <div className="fx-grid">{FILTERS.filter(f => f.group === g).map(f => card(f.id, f.name))}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
