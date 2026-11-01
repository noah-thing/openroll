import type { Project } from "../../core/project";

/** Opens the smart panels from anywhere: the menu, the command bar and the buttons. */
export const smartEvents = new EventTarget();

export type SmartPanel = "palette" | "history" | "save-version" | "versions";

export function openSmart(which: SmartPanel): void {
  smartEvents.dispatchEvent(new Event(which));
}

/** Asks the library to show a rail tab, e.g. from the command bar. */
export const railEvents = new EventTarget();

export function showRail(tab: string): void {
  railEvents.dispatchEvent(new CustomEvent("show", { detail: tab }));
}

export interface OpenRequest {
  project: Project;
  path: string;
  /** Shown once the project is open. */
  note?: string;
}

/** The app listens for this and swaps the editor to the project. */
export const openEvents = new EventTarget();

export function requestOpen(project: Project, path: string, note?: string): void {
  openEvents.dispatchEvent(new CustomEvent<OpenRequest>("open", { detail: { project, path, note } }));
}
