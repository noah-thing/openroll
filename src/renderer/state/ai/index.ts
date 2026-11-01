import { useEffect, useSyncExternalStore } from "react";
import type { Item } from "../../../core/project";
import type { Editor } from "../editor";
import { AiManager, type AiFeature, type AiStatus } from "./manager";

const managers = new WeakMap<Editor, AiManager>();
let active: AiManager | null = null;
const none = () => () => {};

/** The analysis manager for an editor, made on first use and shared by everything that asks. */
export function aiFor(editor: Editor): AiManager {
  let m = managers.get(editor);
  if (!m) managers.set(editor, (m = new AiManager(editor)));
  active = m;
  return m;
}

/** Keeps analysis running for as long as the editor screen is open. */
export function useAiBackground(editor: Editor): void {
  aiFor(editor);
  useEffect(() => {
    const m = aiFor(editor);
    return () => {
      m.dispose();
      managers.delete(editor);
    };
  }, [editor]);
}

export function useAiStatus(editor: Editor, mediaId: string, feature: AiFeature): AiStatus {
  const m = aiFor(editor);
  useSyncExternalStore(m.subscribe, () => m.version);
  return m.status(mediaId, feature);
}

/** True while a clip waits on analysis it needs, for the badge on the timeline. */
export function usePreparing(item: Item): boolean {
  const m = active;
  useSyncExternalStore(m ? m.subscribe : none, () => m?.version ?? 0);
  if (!m || item.type !== "media") return false;
  const busy = (feature: AiFeature) => {
    const s = m.status(item.mediaId, feature).state;
    return s === "queued" || s === "preparing";
  };
  return (!!item.cutout && busy("cutout")) || (!!item.stabilize && busy("stabilize"));
}

export type { AiFeature, AiStatus };
