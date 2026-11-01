import { useEffect, useState } from "react";
import { captionText, retimeWords } from "../../../core/captions";
import { updateItem } from "../../../core/edit";
import { findItem, type CaptionItem } from "../../../core/project";
import type { Editor } from "../../state/editor";

interface Props {
  editor: Editor;
  item: CaptionItem;
  rows?: number;
  className?: string;
  placeholder?: string;
}

const collapse = (s: string) => s.trim().split(/\s+/).filter(Boolean).join(" ");

/**
 * Text box for the words of one caption. What is typed is kept as typed (a trailing space
 * must survive) while the caption's words are re-timed underneath on every change.
 */
export function CaptionTextField({ editor, item, rows = 3, className = "text-input", placeholder = "Say something" }: Props) {
  const joined = captionText(item);
  const [draft, setDraft] = useState(joined);

  // Undo, redo or an edit from elsewhere changes the words under us.
  useEffect(() => {
    setDraft(d => (collapse(d) === joined ? d : joined));
  }, [joined]);

  const change = (text: string) => {
    setDraft(text);
    editor.apply(
      "Edit caption",
      p => {
        const current = findItem(p, item.id)?.item;
        if (current?.type !== "caption") return p;
        return updateItem(p, item.id, { words: retimeWords(current.words, text, current.duration) } as Partial<CaptionItem>);
      },
      `${item.id}:words`,
    );
  };

  return (
    <textarea
      className={className}
      value={draft}
      rows={rows}
      placeholder={placeholder}
      onChange={e => change(e.target.value)}
      onBlur={() => editor.endGroup()}
    />
  );
}
