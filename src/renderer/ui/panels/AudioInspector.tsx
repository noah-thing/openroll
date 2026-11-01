import { detachAudio, setCleanup, setVoiceFx } from "../../../core/audio-edit";
import { updateItem } from "../../../core/edit";
import type { AudioCleanup, Item, MediaItem, Project, TextItem, VoiceFx } from "../../../core/project";
import { useState } from "react";
import type { Editor } from "../../state/editor";
import { readAloud, VOICES, type SpeakProgress } from "../../state/speech";
import { Section, Slider, Toggle } from "../kit/Field";
import "../../styles/audio.css";

const EFFECTS: { id: VoiceFx | "none"; label: string }[] = [
  { id: "none", label: "None" },
  { id: "pitchUp", label: "Pitch up" },
  { id: "pitchDown", label: "Pitch down" },
  { id: "robot", label: "Robot" },
  { id: "radio", label: "Radio" },
  { id: "echo", label: "Echo" },
  { id: "bigRoom", label: "Big room" },
];

export function AudioInspector({ editor, item, project }: { editor: Editor; item: MediaItem; project: Project }) {
  const media = project.media[item.mediaId];
  const a = item.audio ?? {};
  const set = (label: string, patch: Partial<Item>, group: string) => editor.apply(label, p => updateItem(p, item.id, patch), `${item.id}:${group}`);
  const done = () => editor.endGroup();
  const clean = (label: string, patch: Partial<AudioCleanup>, group?: string) => editor.apply(label, p => setCleanup(p, item.id, patch), group && `${item.id}:${group}`);
  const canDetach = media?.kind === "video" && media.hasAudio && !item.muteAudio && !item.reversed && !item.freeze;
  const otherSpeech = project.tracks.some(t => !t.muted && t.items.some(i => i.id !== item.id && ((i.type === "media" && !i.audio?.duckUnder && project.media[i.mediaId]?.speech?.length) || i.type === "caption")));

  return (
    <>
      <Section title="Sound">
        <Slider label="Volume" value={item.volume * 100} min={0} max={200} unit="%" reset={100} onChange={v => set("Volume", { volume: v / 100 }, "vol")} onCommit={done} />
        <Slider label="Fade in" value={item.fadeIn / 1e6} min={0} max={Math.min(10, item.duration / 2e6)} step={0.1} unit="s" reset={0} onChange={v => set("Fade in", { fadeIn: Math.round(v * 1e6) }, "fin")} onCommit={done} />
        <Slider label="Fade out" value={item.fadeOut / 1e6} min={0} max={Math.min(10, item.duration / 2e6)} step={0.1} unit="s" reset={0} onChange={v => set("Fade out", { fadeOut: Math.round(v * 1e6) }, "fout")} onCommit={done} />
        {item.muteAudio && <p className="insp-note">This clip is silent. Its sound was detached to its own track.</p>}
      </Section>

      <Section title="Clean up">
        <Slider label="Noise" value={(a.denoise ?? 0) * 100} min={0} max={100} unit="%" reset={0} onChange={v => clean("Reduce noise", { denoise: v / 100 }, "denoise")} onCommit={done} />
        <Toggle label="Enhance voice" value={!!a.voice} onChange={v => clean(v ? "Enhance voice" : "Stop enhancing voice", { voice: v })} />
        <Toggle label="Normalise loudness" value={!!a.normalize} onChange={v => clean(v ? "Normalise loudness" : "Stop normalising", { normalize: v })} />
        {a.normalize && (
          <p className="insp-note">{media?.loudness === undefined ? "Measuring loudness…" : `${media.loudness.toFixed(1)} LUFS now, brought to −16 LUFS.`}</p>
        )}
        <Toggle label="Lower under speech" value={!!a.duckUnder} onChange={v => clean(v ? "Lower under speech" : "Stop lowering under speech", { duckUnder: v })} />
        {a.duckUnder && !otherSpeech && <p className="insp-note">No speech found on other tracks yet. Put a voice or captions on the timeline and this clip will dip under it.</p>}
      </Section>

      <Section title="Voice changer">
        <div className="aud-chips">
          {EFFECTS.map(e => (
            <button key={e.id} className="aud-chip" aria-pressed={(item.voiceFx ?? "none") === e.id} onClick={() => editor.apply(e.id === "none" ? "Remove voice effect" : `Voice ${e.label.toLowerCase()}`, p => setVoiceFx(p, item.id, e.id === "none" ? undefined : e.id))}>
              {e.label}
            </button>
          ))}
        </div>
      </Section>

      {canDetach && (
        <Section title="Separate">
          <button className="textbtn aud-action" onClick={() => editor.apply("Detach audio", p => detachAudio(p, item.id))}>
            Detach audio
          </button>
          <p className="insp-note">Moves the sound to its own track so you can trim, fade or replace it on its own.</p>
        </Section>
      )}
    </>
  );
}

export function ReadAloudSection({ editor, item }: { editor: Editor; item: TextItem }) {
  const [voice, setVoice] = useState(VOICES[0].id);
  const [progress, setProgress] = useState<SpeakProgress | null>(null);
  const busy = progress !== null;
  const empty = !item.style.text.trim();
  return (
    <Section title="Read aloud">
      <div className="aud-chips">
        {VOICES.map(v => (
          <button key={v.id} className="aud-chip" aria-pressed={voice === v.id} onClick={() => setVoice(v.id)}>
            {v.name}
          </button>
        ))}
      </div>
      <button className="textbtn aud-action" disabled={busy || empty} onClick={() => void readAloud(editor, item, voice, setProgress)}>
        {busy ? (progress.stage === "download" ? "Downloading voice…" : "Speaking…") : "Read aloud"}
      </button>
      {busy && (
        <div className="aud-progress" role="progressbar" aria-valuenow={Math.round(progress.fraction * 100)}>
          <span style={{ transform: `scaleX(${progress.fraction})` }} />
        </div>
      )}
      <p className="insp-note">{busy && progress.stage === "download" ? `${Math.round(progress.fraction * 100)}% of the voice model` : "Speaks this text with a voice that runs on your computer. The first time downloads about 90 MB."}</p>
    </Section>
  );
}
