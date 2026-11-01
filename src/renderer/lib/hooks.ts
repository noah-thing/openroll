import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Editor } from "../state/editor";

/** Subscribe to the editor and re-render only when the selected slice changes. */
export function useEditor<T>(editor: Editor, pick: (e: Editor) => T): T {
  const last = useRef<{ v: T } | null>(null);
  return useSyncExternalStore(editor.subscribe, () => {
    const v = pick(editor);
    if (last.current && Object.is(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  });
}

export function useFrame(fn: (now: number) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    const tick = (now: number) => {
      ref.current(now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
}
