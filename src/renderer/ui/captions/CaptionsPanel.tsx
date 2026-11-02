import { useRef, useState, useSyncExternalStore } from "react";
import { captionsFromCues, cuesFromCaptions, parseSubtitles, placeCaptions, restyleCaptions, toSrt, toVtt, allCaptions } from "../../../core/captions";
import { CAPTION_PRESETS, DEFAULT_CHOICE, HIGHLIGHT_COLORS, presetById, templateFor, type CaptionChoice, type CaptionPosition } from "../../../core/caption-styles";
import { SPEECH_LANGUAGES, SPEECH_MODELS, type SpeechModel } from "../../../engine/speech-protocol";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { captionService, listenTargets, type ListenSettings } from "../../state/captions";
import { Icon } from "../kit/Icon";
import { Segmented } from "../kit/Field";
import { FontPicker } from "../kit/FontPicker";
import { SmartCut } from "./SmartCut";
import { Specimen } from "./Specimen";
import { Transcript } from "./Transcript";

type View = "styles" | "transcript" | "cut";

const STORE = "openroll.captions";

export interface Remembered {
  choice: CaptionChoice;
  language: string;
  model: SpeechModel;
}

export function recall(): Remembered {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (raw?.choice && raw.model) return raw;
  } catch {
    /* private window or blocked storage: start fresh */
  }
  return { choice: DEFAULT_CHOICE, language: "auto", model: "base" };
}

function remember(r: Remembered): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(r));
  } catch {
    /* nothing to do */
  }
}

export function CaptionsPanel({ editor }: { editor: Editor }) {
  const service = captionService(editor);
  const job = useSyncExternalStore(service.subscribe, () => service.state);
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [saved, setSaved] = useState(recall);
  const [view, setView] = useState<View>("styles");
  const fileInput = useRef<HTMLInputElement>(null);

  const { choice, language, model } = saved;
  const update = (patch: Partial<Remembered>) => {
    const next = { ...saved, ...patch };
    setSaved(next);
    remember(next);
  };
  const settings: ListenSettings = { language: language === "auto" ? null : language, model };

  const captions = allCaptions(project);
  const picked = selection.length ? listenTargets(project, selection) : [];
  const scope = picked.length ? selection : null;
  const count = picked.length ? picked.length : listenTargets(project, null).length;
  const working = job.phase === "working";

  function restyle(next: CaptionChoice) {
    update({ choice: next });
    if (captions.length) editor.apply("Caption style", p => restyleCaptions(p, templateFor(next, p)));
  }

  async function importFile(file: File) {
    const cues = parseSubtitles(await file.text());
    if (!cues.length) {
      editor.toast("That file has no captions in it", { tone: "error" });
      return;
    }
    const items = captionsFromCues(cues, templateFor(choice, editor.project));
    editor.apply("Import captions", p => placeCaptions(p, items));
    editor.toast(`Imported ${items.length} captions`, { undo: true });
    setView("transcript");
  }

  async function exportAs(kind: "srt" | "vtt") {
    const cues = cuesFromCaptions(allCaptions(editor.project));
    if (!cues.length) {
      editor.toast("There are no captions to export");
      return;
    }
    const w = await window.openroll.createWriter(`${editor.project.name}.${kind}`, "subtitles");
    if (!w) return;
    try {
      await window.openroll.write(w.id, 0, new TextEncoder().encode(kind === "srt" ? toSrt(cues) : toVtt(cues)));
      await window.openroll.closeWriter(w.id);
      editor.toast(`Saved ${kind.toUpperCase()} with ${cues.length} captions`);
    } catch (err) {
      await window.openroll.closeWriter(w.id, true);
      editor.toast(`Could not save: ${(err as Error).message}`, { tone: "error" });
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Captions</h2>
        <button className="textbtn" onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={16} />
          Import SRT or VTT
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".srt,.vtt,text/vtt"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
      </div>

      <div className="cap-scroll">
        <section className="cap-gen">
          <div className="cap-pickers">
            <label className="cap-select">
              <span>Spoken language</span>
              <select value={language} disabled={working} onChange={e => update({ language: e.target.value })}>
                <option value="auto">Detect</option>
                {SPEECH_LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="cap-model">
              <span>Accuracy</span>
              <Segmented
                options={(Object.keys(SPEECH_MODELS) as SpeechModel[]).map(m => ({ value: m, label: SPEECH_MODELS[m].label }))}
                value={model}
                onChange={v => !working && update({ model: v })}
              />
            </div>
          </div>
          <p className="cap-hint">{SPEECH_MODELS[model].note}. Runs on this computer.</p>

          {working ? (
            <div className="cap-progress" role="status">
              <div className="progress-bar">
                <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, job.fraction))})` }} />
              </div>
              <div className="progress-meta">
                <span>{stageLabel(job)}</span>
                <button className="textbtn sm" onClick={() => service.cancel()}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="export cap-go" disabled={!count} onClick={() => void service.generate(scope, settings, choice)}>
              Generate captions
            </button>
          )}
          {!working && (
            <p className="cap-hint">
              {!count ? "Add a clip with sound first." : scope ? `Listens to ${count === 1 ? "the selected clip" : `${count} selected clips`}.` : `Listens to ${count === 1 ? "the clip" : `all ${count} clips`} on the timeline.`}
            </p>
          )}
          {job.phase === "error" && <p className="cap-error">{job.message}</p>}
          {job.phase === "idle" && job.summary && <p className="cap-hint cap-summary">{job.summary}</p>}
        </section>

        <div className="cap-views">
          <Segmented<View>
            options={[
              { value: "styles", label: "Style" },
              { value: "transcript", label: `Transcript${captions.length ? ` ${captions.length}` : ""}` },
              { value: "cut", label: "Smart cut" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>

        {view === "styles" && <StylePicker choice={choice} onChange={restyle} hasCaptions={captions.length > 0} />}
        {view === "transcript" && (
          <>
            <Transcript editor={editor} />
            <div className="cap-files">
              <button className="textbtn" onClick={() => void exportAs("srt")} disabled={!captions.length}>
                Export SRT
              </button>
              <button className="textbtn" onClick={() => void exportAs("vtt")} disabled={!captions.length}>
                Export VTT
              </button>
            </div>
          </>
        )}
        {view === "cut" && <SmartCut editor={editor} settings={settings} />}
      </div>
    </div>
  );
}

function stageLabel(job: ReturnType<typeof captionService>["state"]): string {
  const clip = job.clip.count > 1 ? `Clip ${job.clip.index + 1} of ${job.clip.count}. ` : "";
  if (job.stage === "model") return job.downloading ? `Downloading the speech model, once only. ${Math.round(job.fraction * 100)}%` : "Loading the speech model";
  if (job.stage === "decode") return `${clip}Reading the sound`;
  const eta = job.etaSeconds === null ? "" : `, ${eta2(job.etaSeconds)} left`;
  return `${clip}Listening, ${Math.round(job.fraction * 100)}%${eta}`;
}

function eta2(s: number): string {
  return s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;
}

function StylePicker({ choice, onChange, hasCaptions }: { choice: CaptionChoice; onChange(c: CaptionChoice): void; hasCaptions: boolean }) {
  const preset = presetById(choice.preset);
  return (
    <div className="cap-styles">
      <div className="cap-grid">
        {CAPTION_PRESETS.map(p => (
          <Specimen key={p.id} preset={p} font={choice.font} highlight={choice.preset === p.id ? choice.highlight : p.highlight ?? null} selected={choice.preset === p.id} onPick={() => onChange({ ...choice, preset: p.id, highlight: p.highlight ?? choice.highlight })} />
        ))}
      </div>
      <section className="group">
        <h3>
          Font
          {choice.font && (
            <button className="reset" onClick={() => onChange({ ...choice, font: undefined })}>
              Use the look's font
            </button>
          )}
        </h3>
        <FontPicker value={choice.font ?? preset.style.font} onChange={font => onChange({ ...choice, font })} />
      </section>
      <section className="group">
        <h3>Spoken word</h3>
        <div className="swatches">
          <button className={"swatch swatch-none" + (choice.highlight === null ? " on" : "")} title="No highlight" aria-label="No highlight" onClick={() => onChange({ ...choice, highlight: null })} />
          {HIGHLIGHT_COLORS.map(c => (
            <button key={c} className={"swatch" + (choice.highlight === c ? " on" : "")} style={{ background: c }} title={c} aria-label={`Highlight ${c}`} onClick={() => onChange({ ...choice, highlight: c })} />
          ))}
        </div>
      </section>
      <section className="group">
        <h3>Position</h3>
        <Segmented<CaptionPosition>
          options={[
            { value: "top", label: "Top" },
            { value: "middle", label: "Middle" },
            { value: "lower", label: "Lower" },
          ]}
          value={choice.position}
          onChange={position => onChange({ ...choice, position })}
        />
      </section>
      <p className="cap-hint">
        {hasCaptions ? `${preset.name} applies to every caption.` : "New captions will use this look."}
      </p>
    </div>
  );
}
