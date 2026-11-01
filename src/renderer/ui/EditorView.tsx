import { useEffect, useMemo, useState } from "react";
import type { Editor } from "../state/editor";
import { MediaCache } from "../state/media-cache";
import { useAutoAnalysis } from "../state/auto-analyze";
import { useShortcuts } from "../state/shortcuts";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { Timeline } from "./timeline/Timeline";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { Viewer } from "./Viewer";
import { ExportDialog } from "./ExportDialog";

export function EditorView({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const cache = useMemo(() => new MediaCache(m => window.openroll.mediaUrl(m.path)), []);
  const [exporting, setExporting] = useState(false);
  useEffect(() => () => cache.dispose(), [cache]);
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
      {exporting && <ExportDialog editor={editor} onClose={() => setExporting(false)} />}
    </div>
  );
}
