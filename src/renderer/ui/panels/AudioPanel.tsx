import { useEffect, useRef, useState } from "react";
import { setAutoBeat } from "../../../core/audio-edit";
import { insertItems, mediaItem } from "../../../core/edit";
import type { MediaRef } from "../../../core/project";
import { SFX } from "../../../engine/sfx";
import { shortTime } from "../../lib/format";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { importFiles } from "../../state/importer";
import { addEffect } from "../../state/sounds";
import { placeRecording, VoiceRecorder } from "../../state/voiceover";
import { Icon } from "../kit/Icon";
import { Toggle } from "../kit/Field";
import "../../styles/audio.css";

type Phase = { name: "idle" } | { name: "count"; n: number } | { name: "recording"; at: number };

export function AudioPanel({ editor }: { editor: Editor }) {
  const media = useEditor(editor, e => e.project.media);
  const autoBeat = useEditor(editor, e => !!e.project.settings.autoBeat);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const recorder = useRef<VoiceRecorder | null>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const cancelled = useRef(false);
  const sounds = Object.values(media).filter(m => m.kind === "audio");

  useEffect(() => () => recorder.current?.close(), []);

  // Level meter, driven outside React so it does not re-render the panel 60 times a second.
  useEffect(() => {
    if (phase.name === "idle") return;
    let id = 0;
    const tick = () => {
      if (meter.current && recorder.current) meter.current.style.transform = `scaleX(${recorder.current.level()})`;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase.name]);

  async function record() {
    const rec = new VoiceRecorder();
    try {
      await rec.open();
    } catch {
      editor.toast("OpenRoll cannot hear a microphone. Check that one is connected and allowed.", { tone: "error" });
      return;
    }
    recorder.current = rec;
    cancelled.current = false;
    const at = editor.time;
    for (const n of [3, 2, 1]) {
      setPhase({ name: "count", n });
      await new Promise(r => setTimeout(r, 1000));
      if (cancelled.current) return void rec.close();
    }
    rec.start();
    // Play the edit from the playhead so the voice can follow what is on screen.
    if (at < editor.player!.duration - 1000) void editor.player!.play();
    setPhase({ name: "recording", at });
  }

  async function stop() {
    if (phase.name === "count") {
      cancelled.current = true;
      recorder.current?.close();
      setPhase({ name: "idle" });
      return;
    }
    if (phase.name !== "recording") return;
    const at = phase.at;
    editor.player?.pause();
    setPhase({ name: "idle" });
    const take = await recorder.current!.stop();
    recorder.current = null;
    await placeRecording(editor, take, at);
  }

  function add(m: MediaRef) {
    const item = mediaItem(m, editor.time);
    editor.apply("Add sound", p => insertItems(p, [item]));
    editor.select([item.id]);
  }

  async function importAudio() {
    const files = await window.openroll.pickMedia();
    if (files.length) await importFiles(editor, files);
  }

  const busy = phase.name !== "idle";
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Audio</h2>
        <button className="textbtn" onClick={importAudio}>
          <Icon name="plus" size={16} />
          Import
        </button>
      </div>

      <div className="aud-scroll">
        <button className={"aud-rec" + (busy ? " live" : "")} onClick={busy ? stop : record} aria-label={busy ? "Stop recording" : "Record voiceover"}>
          <span className="aud-rec-dot">{phase.name === "count" ? phase.n : <Icon name="mic" size={16} />}</span>
          <span className="aud-rec-text">
            <b>{phase.name === "idle" ? "Record voiceover" : phase.name === "count" ? "Get ready" : "Recording, click to stop"}</b>
            <span>{phase.name === "idle" ? "Starts at the playhead after 3, 2, 1" : "Headphones keep the edit out of the take"}</span>
          </span>
          {busy && (
            <span className="aud-meter" aria-hidden>
              <span ref={meter} />
            </span>
          )}
        </button>

        <Toggle label="Auto beat" value={autoBeat} onChange={v => editor.apply(v ? "Turn on auto beat" : "Turn off auto beat", p => setAutoBeat(p, v))} />
        <p className="panel-note aud-note">{autoBeat ? "Beats show on music clips and edits snap to them." : "Marks the beat on music and snaps edits to it."}</p>

        <h3 className="aud-h">Sound effects</h3>
        <div className="aud-fx">
          {SFX.map(s => (
            <button key={s.id} className="aud-fx-card" onClick={() => void addEffect(editor, s.id)} title={`Add ${s.name.toLowerCase()} at the playhead`}>
              <Icon name="speaker" size={16} />
              {s.name}
            </button>
          ))}
        </div>

        <h3 className="aud-h">Your sounds</h3>
        {!sounds.length ? (
          <p className="panel-note">Music, recordings and effects you add appear here.</p>
        ) : (
          <ul className="aud-list">
            {sounds.map(m => (
              <li key={m.id}>
                <button className="aud-row" onClick={() => add(m)} title="Add at the playhead">
                  <Icon name={m.origin === "recording" ? "mic" : "audio"} size={16} />
                  <span className="aud-name">{m.name}</span>
                  <span className="aud-meta num">{m.bpm ? `${Math.round(m.bpm)} BPM` : ""}</span>
                  <span className="aud-meta num">{shortTime(m.duration)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {phase.name === "count" && <div className="aud-count" aria-live="assertive">{phase.n}</div>}
    </div>
  );
}
