import { useCallback, useEffect, useState } from "react";
import { createProject, type Project } from "../../core/project";
import { Editor } from "../state/editor";
import { importFiles } from "../state/importer";
import { importLut } from "../state/lut-import";
import type { FileInfo } from "../../shared/api";
import { EditorView } from "./EditorView";
import { Home } from "./Home";

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);

  const open = useCallback((project: Project, path: string | null, files?: FileInfo[]) => {
    const e = new Editor(project, path);
    setEditor(e);
    if (files?.length) void importFiles(e, files);
  }, []);

  const close = useCallback(async () => {
    if (!editor) return;
    await editor.save();
    editor.dispose();
    setEditor(null);
  }, [editor]);

  useEffect(() => {
    if (!window.openroll.qa) return;
    Object.assign(window, { __or: { editor, newProject: (files: FileInfo[]) => open(createProject(), null, files), importFiles, importLut } });
  }, [editor, open]);

  useEffect(() => {
    window.openroll.setTitle(editor ? editor.project.name : "OpenRoll");
  }, [editor]);

  if (editor) return <EditorView key={editor.project.id} editor={editor} onClose={close} />;
  return <Home onOpen={open} onNew={files => open(createProject(), null, files)} />;
}
