import { useEffect, useState } from "react";
import type { Editor } from "../state/editor";
import type { MediaCache } from "../state/media-cache";
import { Icon, type IconName } from "./kit/Icon";
import { AudioPanel } from "./panels/AudioPanel";
import { CaptionsPanel } from "./captions/CaptionsPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { TextPanel } from "./panels/TextPanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { FiltersPanel } from "./panels/FiltersPanel";
import { TransitionsPanel } from "./panels/TransitionsPanel";
import { StickersPanel } from "./panels/StickersPanel";
import { SmartPanel } from "./panels/SmartPanel";
import { railEvents } from "../state/smart-events";

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "media" },
  { id: "audio", label: "Audio", icon: "audio" },
  { id: "text", label: "Text", icon: "text" },
  { id: "captions", label: "Captions", icon: "captions" },
  { id: "transitions", label: "Transitions", icon: "transitions" },
  { id: "filters", label: "Filters", icon: "filters" },
  { id: "effects", label: "Effects", icon: "effects" },
  { id: "stickers", label: "Stickers", icon: "shapes" },
  { id: "smart", label: "Smart", icon: "wand" },
];

export function Library({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const [tab, setTab] = useState("media");
  const index = TABS.findIndex(t => t.id === tab);
  useEffect(() => {
    const show = (e: Event) => setTab((e as CustomEvent<string>).detail);
    railEvents.addEventListener("show", show);
    return () => railEvents.removeEventListener("show", show);
  }, []);
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
        {tab === "audio" && <AudioPanel editor={editor} />}
        {tab === "text" && <TextPanel editor={editor} />}
        {tab === "captions" && <CaptionsPanel editor={editor} />}
        {tab === "transitions" && <TransitionsPanel editor={editor} />}
        {tab === "filters" && <FiltersPanel editor={editor} />}
        {tab === "effects" && <EffectsPanel editor={editor} />}
        {tab === "stickers" && <StickersPanel editor={editor} />}
        {tab === "smart" && <SmartPanel editor={editor} cache={cache} />}
      </section>
    </>
  );
}
