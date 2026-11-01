import { useEffect, useMemo, useState } from "react";
import type { Editor } from "../state/editor";
import { MediaCache } from "../state/media-cache";
import { derived } from "../state/derived-media";
import { checkMissing } from "../state/relink";
import { useSettings } from "../state/settings";
import { useAutoAnalysis } from "../state/auto-analyze";
import { useShortcuts } from "../state/shortcuts";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { Timeline } from "./timeline/Timeline";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { Viewer } from "./Viewer";
import { ExportDialog } from "./ExportDialog";
import { ShortcutSheet } from "./ShortcutSheet";

export function EditorView({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const cache = useMemo(() => new MediaCache(m => derived.decodeUrl(m)), []);
  const [exporting, setExporting] = useState(false);
  const proxyMode = useSettings().proxyMode;
  useEffect(() => () => cache.dispose(), [cache]);
  useEffect(() => {
    const stop = derived.subscribe(() => cache.refresh());
    return () => void stop();
  }, [cache]);
  // On open: find missing files, pick up copies made earlier, and start any a reopened project still needs.
  useEffect(() => {
    derived.start();
    void checkMissing(editor).then(() => derived.restore(Object.values(editor.project.media)));
  }, [editor, proxyMode]);
  useAutoAnalysis(editor, cache);
  useShortcuts(editor, { onExport: () => setExporting(true), onHome: onClose });

  return (
    <div className="editor">
      <TopBar editor={editor} onHome={onClose} onExport={() => setExporting(true)} />
      <Library editor={editor} cache={cache} />
      <Viewer editor={editor} />
      <Inspector editor={editor} />
      <Timeline editor={editor} cache={cache} />
      <Toasts editor={editor} />
      <ShortcutSheet />
      {exporting && <ExportDialog editor={editor} onClose={() => setExporting(false)} />}
    </div>
  );
}
