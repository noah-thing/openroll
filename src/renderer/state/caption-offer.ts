import { useEffect, useState } from "react";
import { captionOffers } from "../../core/caption-offer";
import { useEditor } from "../lib/hooks";
import { recall } from "../ui/captions/CaptionsPanel";
import { captionService } from "./captions";
import type { Editor } from "./editor";
import { useSettings } from "./settings";

/** Files brought in during this session. Older footage in a reopened project is never asked about. */
const arrived = new Set<string>();

export function noteArrived(ids: string[]): void {
  for (const id of ids) arrived.add(id);
}

/** Speech measurements for a batch of clips finish within moments of each other; one question covers them. */
const SETTLE_MS = 800;

/**
 * Once a clip with speech has been measured, asks in a toast whether to caption it. The
 * answer is not remembered beyond a flag on the file, so "Not now" means never again for it.
 */
export function useCaptionOffer(editor: Editor): void {
  const media = useEditor(editor, e => e.project.media);
  const tracks = useEditor(editor, e => e.project.tracks);
  const enabled = useSettings().offerCaptions;
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!enabled || asking) return;
    const timer = window.setTimeout(() => {
      const offers = captionOffers(editor.project, arrived);
      if (!offers.length) return;
      for (const o of offers) editor.annotateMedia(o.media.id, { captionsAsked: true });
      setAsking(true);
      const ids = offers.map(o => o.item.id);
      editor.toast(offers.length === 1 ? "This clip has speech. Add captions?" : `${offers.length} clips have speech. Add captions?`, {
        action: { label: "Add captions", run: () => void addCaptions(editor, ids) },
        decline: "Not now",
        onClose: () => setAsking(false),
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [editor, enabled, asking, media, tracks]);
}

async function addCaptions(editor: Editor, ids: string[]): Promise<void> {
  const service = captionService(editor);
  if (service.busy) {
    editor.toast("Captions are already being made. Try again when they finish.", { tone: "error" });
    return;
  }
  const { choice, language, model } = recall();
  editor.toast("Listening for speech");
  await service.generate(ids, { language: language === "auto" ? null : language, model }, choice);
  if (service.state.phase === "error") editor.toast(service.state.message, { tone: "error" });
}
