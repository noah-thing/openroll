import { useSyncExternalStore } from "react";
import type { GuideId } from "../../core/safe-zones";

// Which viewer guides are showing. A per person preference, not part of the project.
const STORE = "openroll.guides";

function read(): GuideId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let on: GuideId[] = read();
const listeners = new Set<() => void>();

function set(next: GuideId[]): void {
  on = next;
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* blocked storage: the guides still work for this session */
  }
  for (const fn of listeners) fn();
}

export function toggleGuide(id: GuideId): void {
  set(on.includes(id) ? on.filter(g => g !== id) : [...on, id]);
}

/** The three app guides overlap each other and make a mess, so choosing one drops the others. */
export function chooseApp(id: GuideId): void {
  const apps: GuideId[] = ["tiktok", "shorts", "reels"];
  const rest = on.filter(g => !apps.includes(g));
  set(on.includes(id) ? rest : [...rest, id]);
}

export function clearGuides(): void {
  set([]);
}

export function useGuides(): GuideId[] {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => on,
  );
}
