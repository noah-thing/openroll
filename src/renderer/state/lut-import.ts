import { addLut, setFilter } from "../../core/look/edit";
import { CubeError, parseCube } from "../../core/look/lut";
import type { Editor } from "./editor";

/** Parse a .cube file, store it in the project and, when a clip is given, put it on that clip. */
export function importLut(editor: Editor, file: { name: string; text: string }, itemId?: string): void {
  try {
    const lut = parseCube(file.text);
    const name = lut.title || file.name;
    let id = "";
    editor.apply("Import LUT", p => {
      const r = addLut(p, name, lut);
      id = r.id;
      return r.project;
    });
    if (itemId) editor.apply("Add filter", p => setFilter(p, itemId, id, 1));
    else editor.toast(`Added ${name}. Select a clip to use it.`);
  } catch (err) {
    editor.toast(err instanceof CubeError ? `That LUT could not be read: ${err.message}` : "That LUT could not be read", { tone: "error" });
  }
}
