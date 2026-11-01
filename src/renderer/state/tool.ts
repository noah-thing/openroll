import { useSyncExternalStore } from "react";

export type ViewerTool = "crop" | "mask" | "key";

interface ToolState {
  tool: ViewerTool | null;
  /** The clip the tool was opened for; the tool is off when the selection moves elsewhere. */
  itemId: string | null;
}

let state: ToolState = { tool: null, itemId: null };
const listeners = new Set<() => void>();

export function setTool(tool: ViewerTool | null, itemId: string | null = null): void {
  state = { tool, itemId };
  for (const fn of listeners) fn();
}

export function useTool(selected: string | null): ViewerTool | null {
  const s = useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
  return s.tool && s.itemId === selected ? s.tool : null;
}
