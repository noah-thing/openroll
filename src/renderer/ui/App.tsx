import { useCallback, useEffect, useRef, useState } from "react";
import { createProject, type Project } from "../../core/project";
import { Editor } from "../state/editor";
import { importFiles } from "../state/importer";
import { startSettings } from "../state/settings";
import { openEvents, type OpenRequest } from "../state/smart-events";
import { importLut } from "../state/lut-import";
import type { FileInfo, SessionNotice } from "../../shared/api";
import { EditorView } from "./EditorView";
import { HistoryDialog } from "./HistoryDialog";
import { Home } from "./Home";
import { Overlays } from "./Overlays";
import { RecoveryPrompt } from "./RecoveryPrompt";

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  const [earlier, setEarlier] = useState<{ path: string; name: string; note?: string } | null>(null);
  const hadEditor = useRef(false);

  const open = useCallback((project: Project, path: string | null, files?: FileInfo[]) => {
    const e = new Editor(project, path);
    setEditor(e);
    if (files?.length) void importFiles(e, files);
    return e;
  }, []);

  const close = useCallback(async () => {
    if (!editor) return;
    await editor.save();
    editor.dispose();
    setEditor(null);
  }, [editor]);

  // The shorts maker asks for the project it just saved to be opened in place of this one.
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const { project, path, note } = (ev as CustomEvent<OpenRequest>).detail;
      void (async () => {
        await editor?.save();
        editor?.dispose();
        const next = open(project, path);
        if (note) next.toast(note);
      })();
    };
    openEvents.addEventListener("open", onOpen);
    return () => openEvents.removeEventListener("open", onOpen);
  }, [editor, open]);

  const reopen = useCallback(
    async (n: SessionNotice, recovered: boolean) => {
      const text = await window.openroll.projects.load(n.path);
      try {
        const p = JSON.parse(text ?? "") as Project;
        if (p.format !== "openroll") throw new Error();
        const e = open(p, n.path);
        if (recovered) e.toast("OpenRoll hit a problem and reopened your project");
      } catch {
        setEarlier({ path: n.path, name: n.name, note: `${n.name} could not be opened. Pick an earlier version to go back to.` });
      }
    },
    [open],
  );

  useEffect(() => {
    startSettings();
    void window.openroll.session.take().then(n => {
      if (!n) return;
      // After a crash the window reloaded on purpose; put the person back where they were.
      if (n.reason === "crash") void reopen(n, true);
      else setNotice(n);
    });
  }, [reopen]);

  useEffect(() => {
    if (!window.openroll.qa) return;
    Object.assign(window, { __or: { editor, newProject: (files: FileInfo[]) => open(createProject(), null, files), importFiles, importLut } });
  }, [editor, open]);

  useEffect(() => {
    window.openroll.setTitle(editor ? editor.project.name : "OpenRoll");
    if (editor) hadEditor.current = true;
    else if (hadEditor.current) {
      hadEditor.current = false;
      window.openroll.session.projectClosed();
    }
  }, [editor]);

  return (
    <>
      {editor ? <EditorView key={editor.project.id} editor={editor} onClose={close} /> : <Home onOpen={open} onNew={files => open(createProject(), null, files)} />}
      <Overlays />
      {notice && !editor && (
        <RecoveryPrompt
          notice={notice}
          onReopen={() => {
            setNotice(null);
            void reopen(notice, false);
          }}
          onEarlier={() => {
            setNotice(null);
            setEarlier({ path: notice.path, name: notice.name });
          }}
          onDismiss={() => setNotice(null)}
        />
      )}
      {earlier && (
        <HistoryDialog
          {...earlier}
          onClose={() => setEarlier(null)}
          onRestored={() => {
            const n = earlier;
            setEarlier(null);
            void reopen({ reason: "unclean", path: n.path, name: n.name }, false);
          }}
        />
      )}
    </>
  );
}
