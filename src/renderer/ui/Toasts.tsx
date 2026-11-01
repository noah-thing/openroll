import { useEditor } from "../lib/hooks";
import type { Editor } from "../state/editor";

export function Toasts({ editor }: { editor: Editor }) {
  const toasts = useEditor(editor, e => e.toasts);
  const mod = window.openroll.platform === "darwin" ? "⌘" : "Ctrl ";
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={"toast" + (t.tone === "error" ? " toast-error" : "")}>
          <span>{t.message}</span>
          {t.action && (
            <button className="toast-undo" onClick={() => t.action!.run()}>
              {t.action.label}
            </button>
          )}
          {t.undo && (
            <button className="toast-undo" onClick={() => editor.undo()}>
              Undo <kbd>{mod}Z</kbd>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
