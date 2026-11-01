import { EASINGS, keyIndexAt, neighbourKey, removeKey, setEase } from "../../../core/look/keyframes";
import { effectDef } from "../../../core/look/effects";
import type { Easing, Item, KeyframeMap } from "../../../core/project";
import { updateItem } from "../../../core/edit";
import { shortTime } from "../../lib/format";
import type { Editor } from "../../state/editor";
import { Icon } from "../kit/Icon";
import { Section } from "../kit/Field";
import type { Anim } from "./anim";

const NAMES: Record<string, string> = {
  "transform.x": "Position X",
  "transform.y": "Position Y",
  "transform.scale": "Scale",
  "transform.rotation": "Rotate",
  "transform.opacity": "Opacity",
  "filter.amount": "Filter strength",
};

const PERCENT = new Set(["transform.scale", "transform.opacity", "filter.amount"]);

function labelFor(item: Item, path: string): string {
  if (NAMES[path]) return NAMES[path];
  if (path.startsWith("adjust.")) return path.slice(7)[0].toUpperCase() + path.slice(8);
  const fx = /^fx:([^:]+):amount$/.exec(path);
  if (fx && item.type === "media") {
    const e = item.effects?.find(x => x.id === fx[1]);
    return `${effectDef(e?.kind ?? "")?.name ?? "Effect"} amount`;
  }
  return path;
}

function setKeys(editor: Editor, item: Item, label: string, keyframes: KeyframeMap | undefined) {
  editor.apply(label, p => updateItem(p, item.id, { keyframes } as Partial<Item>));
}

/** Previous and next keyframe, and the easing of whatever is under the playhead. */
export function KeyNav({ editor, item, anim }: { editor: Editor; item: Item; anim: Anim }) {
  const map = item.keyframes;
  if (!map || !Object.keys(map).length) return null;
  const here = Object.entries(map).filter(([, keys]) => keyIndexAt(keys, anim.local) >= 0);
  const go = (dir: -1 | 1) => {
    const t = neighbourKey(map, anim.local, dir);
    if (t !== null) editor.seek(item.start + t);
  };
  const ease = here.length ? map[here[0][0]][keyIndexAt(map[here[0][0]], anim.local)].ease : null;
  return (
    <div className="keynav">
      <div className="keynav-row">
        <button className="iconbtn" title="Previous keyframe" disabled={neighbourKey(map, anim.local, -1) === null} onClick={() => go(-1)}>
          <Icon name="chevron" size={15} className="flip" />
        </button>
        <span className="keynav-label">{here.length ? `${here.length} keyframe${here.length > 1 ? "s" : ""} here` : "Keyframes"}</span>
        <button className="iconbtn" title="Next keyframe" disabled={neighbourKey(map, anim.local, 1) === null} onClick={() => go(1)}>
          <Icon name="chevron" size={15} />
        </button>
      </div>
      {ease && (
        <div className="chips">
          {EASINGS.map(e => (
            <button
              key={e.value}
              className={"chip" + (ease === e.value ? " on" : "")}
              onClick={() => {
                let next: KeyframeMap | undefined = map;
                for (const [path] of here) next = setEase(next, path, anim.local, e.value);
                setKeys(editor, item, "Keyframe easing", next);
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function shown(path: string, v: number): string {
  const n = PERCENT.has(path) || path.startsWith("fx:") ? v * 100 : v;
  return `${Math.round(n * 10) / 10}${PERCENT.has(path) || path.startsWith("fx:") ? "%" : ""}`;
}

/** Every keyframe on the clip, for checking and for changing easing precisely. */
export function KeyframeList({ editor, item }: { editor: Editor; item: Item }) {
  const entries = Object.entries(item.keyframes ?? {}).filter(([, k]) => k.length);
  return (
    <Section title="Keyframes" fold="keyframes">
      {!entries.length && <p className="insp-note">Click the diamond beside any value to add a keyframe at the playhead. Change the value somewhere else on the clip and it animates between them.</p>}
      {entries.map(([path, keys]) => (
        <div key={path} className="kflist">
          <div className="kflist-name">{labelFor(item, path)}</div>
          {keys.map(k => (
            <div key={k.t} className="kfrow">
              <button className="kfrow-time num" title="Go to this keyframe" onClick={() => editor.seek(item.start + k.t)}>
                {shortTime(k.t)}
              </button>
              <span className="kfrow-value num">{shown(path, k.v)}</span>
              <select
                className="kfrow-ease"
                value={k.ease}
                aria-label="Easing to the next keyframe"
                onChange={e => setKeys(editor, item, "Keyframe easing", setEase(item.keyframes, path, k.t, e.target.value as Easing))}
              >
                {EASINGS.map(e => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
              <button className="iconbtn" title="Delete keyframe" onClick={() => setKeys(editor, item, "Delete keyframe", removeKey(item.keyframes, path, k.t))}>
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}
