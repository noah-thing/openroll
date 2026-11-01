import { useEffect, useRef } from "react";
import { addMarker } from "../../core/edit";
import { frameDuration } from "../../core/project";
import type { Editor } from "./editor";
import { importFiles } from "./importer";

export interface ShortcutHooks {
  onExport(): void;
  onHome(): void;
}

/** Timeline zoom lives in the timeline component; it listens for these. */
export const zoomEvents = new EventTarget();

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function useShortcuts(editor: Editor, hooks: ShortcutHooks): void {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  useEffect(() => {
    const hooks = {
      onExport: () => hooksRef.current.onExport(),
      onHome: () => hooksRef.current.onHome(),
    };
    const mac = window.openroll.platform === "darwin";

    const run = (cmd: string): boolean => {
      const step = frameDuration(editor.project);
      switch (cmd) {
        case "play": editor.player?.toggle(); break;
        case "split": editor.splitAtPlayhead(); break;
        case "delete": editor.deleteSelection(); break;
        case "undo": editor.undo(); break;
        case "redo": editor.redo(); break;
        case "duplicate": editor.duplicateSelection(); break;
        case "select-all": editor.selectAll(); break;
        case "deselect": editor.select([]); break;
        case "frame-back": editor.seek(editor.time - step); break;
        case "frame-forward": editor.seek(editor.time + step); break;
        case "second-back": editor.seek(editor.time - 1_000_000); break;
        case "second-forward": editor.seek(editor.time + 1_000_000); break;
        case "prev-edit": editor.jumpEdit(-1); break;
        case "next-edit": editor.jumpEdit(1); break;
        case "start": editor.seek(0); break;
        case "end": editor.seek(editor.player?.duration ?? 0); break;
        case "marker": editor.apply("Add marker", p => addMarker(p, editor.time)); break;
        case "export": hooks.onExport(); break;
        case "import": void window.openroll.pickMedia().then(f => importFiles(editor, f)); break;
        case "zoom-in":
        case "zoom-out":
        case "zoom-fit":
        case "snapping":
          zoomEvents.dispatchEvent(new Event(cmd));
          break;
        case "flush-and-close": void editor.save().then(() => window.openroll.setDirty(false)); break;
        default: return false;
      }
      return true;
    };

    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = mac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      let cmd: string | null = null;
      if (mod) {
        if (k === "z") cmd = e.shiftKey ? "redo" : "undo";
        else if (k === "y" && !mac) cmd = "redo";
        else if (k === "b") cmd = "split";
        else if (k === "d") cmd = "duplicate";
        else if (k === "a") cmd = "select-all";
        else if (k === "e") cmd = "export";
        else if (k === "i") cmd = "import";
        else if (k === "=" || k === "+") cmd = "zoom-in";
        else if (k === "-") cmd = "zoom-out";
      } else if (!e.altKey) {
        if (e.code === "Space") cmd = "play";
        else if (k === "s") cmd = "split";
        else if (k === "delete" || k === "backspace") cmd = "delete";
        else if (k === "escape") cmd = "deselect";
        else if (k === "arrowleft") cmd = e.shiftKey ? "second-back" : "frame-back";
        else if (k === "arrowright") cmd = e.shiftKey ? "second-forward" : "frame-forward";
        else if (k === "arrowup") cmd = "prev-edit";
        else if (k === "arrowdown") cmd = "next-edit";
        else if (k === "home") cmd = "start";
        else if (k === "end") cmd = "end";
        else if (k === "m") cmd = "marker";
        else if (k === "n") cmd = "snapping";
        else if (k === "z" && e.shiftKey) cmd = "zoom-fit";
      }
      if (cmd && run(cmd)) e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    const offMenu = window.openroll.onMenu(cmd => {
      if (cmd === "settings" || cmd === "shortcuts" || cmd === "report" || cmd === "new" || cmd === "open") {
        if (cmd === "new" || cmd === "open") hooks.onHome();
        return;
      }
      // Menu items arrive even while typing; route them anyway, the user clicked the menu.
      run(cmd);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      offMenu();
    };
  }, [editor]);
}
