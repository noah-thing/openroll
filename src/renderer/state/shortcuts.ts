import { useEffect, useRef } from "react";
import type { Editor } from "./editor";
import { COMMANDS, commandById, matches, parseKeys, type Hooks } from "./commands";
import { zoomEvents } from "./events";
import { copySelection, cutSelection, pasteAtPlayhead } from "./timeline-actions";
import { stopTransport } from "./transport";

export { zoomEvents };

export interface ShortcutHooks extends Hooks {
  onHome(): void;
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Close the topmost dialog by pressing its own close button, so it runs its normal cleanup. */
function closeDialog(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const top = dialogs[dialogs.length - 1];
  if (!top) return false;
  const close = top.querySelector<HTMLElement>('[aria-label="Close"], [data-close]');
  if (!close) return false;
  close.click();
  return true;
}

const bindings = COMMANDS.flatMap(c => c.keys.map(k => ({ parsed: parseKeys(k), command: c })));

export function useShortcuts(editor: Editor, hooks: ShortcutHooks): void {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  useEffect(() => {
    const mac = window.openroll.platform === "darwin";
    const live = () => hooksRef.current;

    const run = (id: string): boolean => {
      if (id === "flush-and-close") {
        void editor.save().then(() => window.openroll.setDirty(false));
        return true;
      }
      const c = commandById(id);
      if (!c?.run) return false;
      // Stepping or looping stops on any command that takes over the playhead.
      if (/^(split|delete|undo|redo|start|end)$/.test(c.id)) stopTransport(editor);
      c.run(editor, live());
      return true;
    };

    let keyHandledAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape" && !typing(e.target) && closeDialog()) {
        e.preventDefault();
        return;
      }
      if (typing(e.target)) return;
      // Dialogs and menus own the keyboard while they are open.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const hit = bindings.find(b => matches(b.parsed, e, mac));
      if (hit && run(hit.command.id)) {
        e.preventDefault();
        if (/^(copy|cut|paste)$/.test(hit.command.id)) keyHandledAt = performance.now();
      }
    };

    // Copy, cut and paste also arrive from the Edit menu; the menu item then fires the page event.
    const onClipboard = (e: ClipboardEvent) => {
      if (typing(e.target) || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (performance.now() - keyHandledAt < 200) return e.preventDefault();
      e.preventDefault();
      if (e.type === "copy") copySelection(editor);
      else if (e.type === "cut") cutSelection(editor);
      else pasteAtPlayhead(editor);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("copy", onClipboard);
    window.addEventListener("cut", onClipboard);
    window.addEventListener("paste", onClipboard);
    const offMenu = window.openroll.onMenu(cmd => {
      if (cmd === "settings" || cmd === "report") return;
      if (cmd === "new" || cmd === "open") {
        live().onHome();
        return;
      }
      // Menu items arrive even while typing; route them anyway, the user clicked the menu.
      run(cmd);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copy", onClipboard);
      window.removeEventListener("cut", onClipboard);
      window.removeEventListener("paste", onClipboard);
      offMenu();
    };
  }, [editor]);
}
