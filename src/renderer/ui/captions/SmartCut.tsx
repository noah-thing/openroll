import { useMemo, useState, useSyncExternalStore } from "react";
import { applyCuts, describePlan, planCuts } from "../../../core/smartcut";
import { findItem, itemEnd } from "../../../core/project";
import { useEditor } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { captionService, type ListenSettings } from "../../state/captions";
import { Section, Slider, Toggle } from "../kit/Field";

export function SmartCut({ editor, settings }: { editor: Editor; settings: ListenSettings }) {
  const service = captionService(editor);
  const job = useSyncExternalStore(service.subscribe, () => service.state);
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [pauses, setPauses] = useState(true);
  const [fillers, setFillers] = useState(true);
  const [minPause, setMinPause] = useState(0.6);

  const found = selection.length === 1 ? findItem(project, selection[0]) : null;
  const item = found?.track.main && found.item.type === "media" ? found.item : null;
  const media = item ? project.media[item.mediaId] : undefined;
  const usable = !!item && !!media?.hasAudio && !item.reversed && !item.freeze && !item.ramp;

  // A fresh listen is exact; captions already on the timeline do for clips heard in an earlier session.
  const words = usable && item ? (service.heard(item, settings) ?? service.fromCaptions(item)) : null;
  const plan = useMemo(
    () => (words && item ? planCuts(words, { from: item.start, to: itemEnd(item) }, { pauses, fillers, minPause: Math.round(minPause * 1e6), language: settings.language ?? (item ? service.spokenLanguage(item) : null) ?? undefined }) : null),
    // job.summary changes when a listen finishes, which is when service.heard starts returning words.
    [words, item?.id, item?.start, item?.duration, pauses, fillers, minPause, settings.language, job.summary],
  );

  if (!usable || !item)
    return <p className="cap-empty">Select one clip on the main track that has speech in it. Smart cut finds the pauses and filler words and takes them out in one step.</p>;

  const apply = () => {
    if (!plan?.ranges.length) return;
    const label = describePlan(plan).replace(/^Removes/, "Removed");
    if (editor.apply("Remove pauses and fillers", p => applyCuts(p, plan.ranges))) editor.toast(label, { undo: true });
  };

  return (
    <div className="cap-cut">
      {!words ? (
        <>
          <p className="cap-hint">Listen to this clip first to find where the words are.</p>
          {job.phase === "working" ? (
            <p className="cap-hint">Listening, {Math.round(job.fraction * 100)}%</p>
          ) : (
            <button className="export cap-go" onClick={() => void service.listen([{ item, media: media! }], settings)}>
              Listen to clip
            </button>
          )}
        </>
      ) : (
        <>
          <Section title="Take out">
            <Toggle label="Long pauses" value={pauses} onChange={setPauses} />
            <Toggle label="Filler words" value={fillers} onChange={setFillers} />
          </Section>
          {pauses && <Slider label="Pause over" value={minPause} min={0.3} max={2} step={0.1} unit=" s" reset={0.6} onChange={setMinPause} />}
          <div className="cap-plan" role="status" data-count={plan?.ranges.length ?? 0}>
            {plan ? describePlan(plan) : ""}
          </div>
          <button className="export cap-go" disabled={!plan?.ranges.length} onClick={apply}>
            Remove from clip
          </button>
          <p className="cap-hint">Everything on tracks that are not locked moves with the cut. Lock a music track to leave it as it is. Undo brings it all back.</p>
        </>
      )}
    </div>
  );
}
