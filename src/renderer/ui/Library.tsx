import { useState } from "react";
import type { Editor } from "../state/editor";
import type { MediaCache } from "../state/media-cache";
import { Icon, type IconName } from "./kit/Icon";
import { CaptionsPanel } from "./captions/CaptionsPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { TextPanel } from "./panels/TextPanel";
import { TransitionsPanel } from "./panels/TransitionsPanel";

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "media" },
  { id: "text", label: "Text", icon: "text" },
  { id: "captions", label: "Captions", icon: "captions" },
  { id: "transitions", label: "Transitions", icon: "transitions" },
];

export function Library({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const [tab, setTab] = useState("media");
  const index = TABS.findIndex(t => t.id === tab);
  return (
    <>
      <nav className="rail" aria-label="Library">
        <span className="rail-bead" style={{ transform: `translateY(${index * 58}px)` }} />
        {TABS.map(t => (
          <button key={t.id} aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={20} />
            {t.label}
          </button>
        ))}
      </nav>
      <section className="pane lib">
        {tab === "media" && <MediaPanel editor={editor} cache={cache} />}
        {tab === "text" && <TextPanel editor={editor} />}
        {tab === "captions" && <CaptionsPanel editor={editor} />}
        {tab === "transitions" && <TransitionsPanel editor={editor} />}
      </section>
    </>
  );
}
