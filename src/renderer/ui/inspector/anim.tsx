import { useState } from "react";
import { readAt, setAnimated, toggleDiamond } from "../../../core/look/animated";
import { isAnimated, keyIndexAt } from "../../../core/look/keyframes";
import { findItem, type Item, type MediaItem, type Micros, type Project } from "../../../core/project";
import { useFrame } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { Icon } from "../kit/Icon";
import { Slider } from "../kit/Field";

export interface Anim {
  editor: Editor;
  item: Item;
  /** Playhead position inside the item. Only kept current while the item has keyframes. */
  local: Micros;
  value(path: string): number;
  animated(path: string): boolean;
  keyed(path: string): boolean;
  set(label: string, path: string, v: number): void;
  toggle(path: string): void;
}

/** Playhead position relative to the item, polled only when something on the item is animated. */
function usePlayheadLocal(editor: Editor, item: Item, enabled: boolean): Micros {
  const [local, setLocal] = useState(0);
  useFrame(() => {
    if (!enabled) return;
    const l = Math.round((editor.time - item.start) / 1000) * 1000;
    if (l !== local) setLocal(l);
  });
  return enabled ? local : 0;
}

export function useAnim(editor: Editor, item: Item): Anim {
  const any = !!item.keyframes && Object.keys(item.keyframes).length > 0;
  const polled = usePlayheadLocal(editor, item, any);
  // Un animated items read their stored values, so the playhead is not needed.
  const local = any ? polled : 0;
  const now = () => Math.min(item.duration, Math.max(0, editor.time - item.start));
  return {
    editor,
    item,
    local,
    value: path => readAt(item, path, local),
    animated: path => isAnimated(item, path),
    keyed: path => keyIndexAt(item.keyframes?.[path], local) >= 0,
    set: (label, path, v) => editor.apply(label, p => setAnimated(p, item.id, path, now(), v), `${item.id}:${path}`),
    toggle: path => {
      if (editor.time < item.start || editor.time > item.start + item.duration) {
        editor.toast("Move the playhead over this clip to set a keyframe");
        return;
      }
      editor.apply("Keyframe", p => toggleDiamond(p, item.id, path, now()));
    },
  };
}

export function Diamond({ anim, path }: { anim: Anim; path: string }) {
  const on = anim.keyed(path);
  const has = anim.animated(path);
  return (
    <button
      className={"kf" + (on ? " on" : has ? " has" : "")}
      title={on ? "Remove keyframe" : "Add keyframe at the playhead"}
      aria-pressed={on}
      onClick={() => anim.toggle(path)}
    >
      <Icon name="keyframe" size={12} />
    </button>
  );
}

interface AnimSliderProps {
  anim: Anim;
  path: string;
  label: string;
  /** Edit label for undo, defaults to the field label. */
  undo?: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  reset?: number;
  /** Displayed value is the stored one times this: 100 for a fraction shown as a percent. */
  scale?: number;
  format?(v: number): string;
}

export function AnimSlider({ anim, path, label, undo, min, max, step, unit, reset, scale = 1, format }: AnimSliderProps) {
  return (
    <Slider
      label={label}
      lead={<Diamond anim={anim} path={path} />}
      value={anim.value(path) * scale}
      min={min}
      max={max}
      step={step}
      unit={unit}
      reset={reset}
      format={format}
      onChange={v => anim.set(undo ?? label, path, v / scale)}
      onCommit={() => anim.editor.endGroup()}
    />
  );
}

/** Edit one media item in place; the mutator gets a draft copy. */
export function useItemEdit(editor: Editor, item: MediaItem) {
  return (label: string, mutate: (draft: MediaItem) => void, group?: string) =>
    editor.apply(
      label,
      (p: Project) => {
        const next = structuredClone(p);
        const hit = findItem(next, item.id);
        if (!hit || hit.item.type !== "media") return p;
        mutate(hit.item);
        return next;
      },
      group ? `${item.id}:${group}` : undefined,
    );
}
