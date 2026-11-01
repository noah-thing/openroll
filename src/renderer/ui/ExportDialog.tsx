import { useEffect, useState } from "react";
import { canEncodeVideo } from "mediabunny";
import { projectDuration } from "../../core/project";
import { estimateBytes, formatInfo, gifFrame, hasNoBackground, type FormatInfo } from "../../engine/export-formats";
import type { ExportFormat, ExportSettings } from "../../engine/export-protocol";
import type { ExportProgress } from "../../engine/exporter";
import { bytes, span } from "../lib/format";
import { derived, useDerivedVersion } from "../state/derived-media";
import type { Editor } from "../state/editor";
import { exportQueue, useExportJobs, type ExportJob } from "../state/export-queue";
import { Segmented, Toggle } from "./kit/Field";
import { Icon } from "./kit/Icon";

type Quality = "small" | "balanced" | "best";
type Kind = "video" | "audio" | "still";

/** Bits per pixel per frame for H.264; HEVC gets about 60% of this for the same look. */
const BPP: Record<Quality, number> = { small: 0.06, balanced: 0.1, best: 0.16 };

const VIDEO_FORMATS: ExportFormat[] = ["mp4", "webm", "prores422", "prores4444", "gif"];
const AUDIO_FORMATS: ExportFormat[] = ["m4a", "wav"];

export function ExportDialog({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const p = editor.project;
  const jobs = useExportJobs();
  useDerivedVersion();
  const longSide = Math.max(p.settings.width, p.settings.height);
  const sizes = [720, 1080, 1440, 2160].filter(s => s <= Math.max(1080, longSide >= 3840 ? 2160 : longSide >= 2560 ? 1440 : 1080));
  const [size, setSize] = useState(Math.min(1080, Math.min(p.settings.width, p.settings.height)) === 1080 ? 1080 : sizes.at(-1)!);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [kind, setKind] = useState<Kind>("video");
  const [videoFormat, setVideoFormat] = useState<ExportFormat>("mp4");
  const [audioFormat, setAudioFormat] = useState<ExportFormat>("m4a");
  const [codec, setCodec] = useState<"avc" | "hevc">("avc");
  const [hevcOk, setHevcOk] = useState(false);
  const [ffmpeg, setFfmpeg] = useState(false);
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);
  const duration = projectDuration(p);
  const fps = p.settings.fps.num / p.settings.fps.den;

  const format = kind === "still" ? "png" : kind === "audio" ? audioFormat : videoFormat;
  const info = formatInfo(format);
  const canAlpha = info.alpha && hasNoBackground(p.settings.background);
  const wantAlpha = canAlpha && transparent;

  const short = Math.min(p.settings.width, p.settings.height);
  const k = size / short;
  const baseW = even(p.settings.width * k);
  const baseH = even(p.settings.height * k);
  const gif = format === "gif" ? gifFrame(baseW, baseH, fps) : null;
  const width = gif?.width ?? baseW;
  const height = gif?.height ?? baseH;
  const outFps = gif?.fps ?? fps;
  const bitrate = Math.round(width * height * fps * BPP[quality] * (codec === "hevc" && format === "mp4" ? 0.6 : 1));
  const estimate = estimateBytes({ format, width, height, fps: outFps, bitrate }, duration / 1e6, wantAlpha);

  useEffect(() => {
    void canEncodeVideo("hevc", { width: 1920, height: 1080 }).then(setHevcOk).catch(() => setHevcOk(false));
    void window.openroll.convert.status().then(s => setFfmpeg(s.available));
    exportQueue.markSeen();
  }, []);
  useEffect(() => {
    if (jobs.some(j => !j.seen && (j.status === "done" || j.status === "error"))) exportQueue.markSeen();
  }, [jobs]);

  // Clips still being prepared, or missing, cannot be rendered yet.
  const blocked = Object.values(p.media).filter(m => derived.isMissing(m) || (m.prepared && !derived.decodeUrl(m)));
  const usable = (f: FormatInfo) => !f.needsFfmpeg || ffmpeg;

  async function start() {
    setBusy(true);
    const ext = info.extension;
    const writer = await window.openroll.createWriter(`${p.name}.${ext}`, kind === "audio" ? "audio" : kind === "still" ? "image" : "video");
    setBusy(false);
    if (!writer) return;
    const settings: ExportSettings = {
      format,
      width,
      height,
      fps: outFps,
      codec: format === "webm" ? "vp9" : codec,
      bitrate,
      encoder: "hardware",
      audio: info.video && format !== "gif",
      transparent: wantAlpha,
      at: editor.time,
    };
    // The project is immutable, so holding this reference is a snapshot: edits made while it renders do not reach it.
    exportQueue.add({ name: p.name, label: info.label, project: p, urls: editor.exportUrls(p), settings, writer });
  }

  const active = jobs.filter(j => j.status === "queued" || j.status === "running");
  const ready = !blocked.length && duration > 0;

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Export">
        <header className="modal-head">
          <h2>Export</h2>
          <button className="iconbtn" onClick={onClose} aria-label={active.length ? "Minimise" : "Close"} title={active.length ? "Keep exporting in the background" : "Close"}>
            <Icon name="close" />
          </button>
        </header>

        {jobs.length > 0 && (
          <div className="modal-body export-jobs">
            {jobs.map(j => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}

        <div className="modal-body">
          {!duration && <p className="modal-warn">The timeline is empty. Add a clip first.</p>}
          {blocked.length > 0 && <p className="modal-warn">{blocked.some(m => derived.isMissing(m)) ? "Some files are missing. Find them in the media panel first." : "Some clips are still being prepared. Export is ready when they finish."}</p>}
          <label className="modal-row">
            <span>Export</span>
            <Segmented<Kind> options={[{ value: "video", label: "Video" }, { value: "audio", label: "Audio" }, { value: "still", label: "Still frame" }]} value={kind} onChange={setKind} />
          </label>
          {kind === "video" && (
            <label className="modal-row">
              <span>Format</span>
              <Segmented<ExportFormat> options={VIDEO_FORMATS.filter(f => usable(formatInfo(f))).map(f => ({ value: f, label: formatInfo(f).label }))} value={videoFormat} onChange={setVideoFormat} />
            </label>
          )}
          {kind === "audio" && (
            <label className="modal-row">
              <span>Format</span>
              <Segmented<ExportFormat> options={AUDIO_FORMATS.map(f => ({ value: f, label: f === "m4a" ? "M4A" : "WAV" }))} value={audioFormat} onChange={setAudioFormat} />
            </label>
          )}
          {kind !== "audio" && (
            <label className="modal-row">
              <span>Resolution</span>
              <Segmented options={sizes.map(s => ({ value: String(s), label: s === 2160 ? "4K" : `${s}p` }))} value={String(size)} onChange={v => setSize(Number(v))} />
            </label>
          )}
          {kind === "video" && info.lossy && (
            <>
              <label className="modal-row">
                <span>Quality</span>
                <Segmented<Quality> options={[{ value: "small", label: "Smaller file" }, { value: "balanced", label: "Balanced" }, { value: "best", label: "Best" }]} value={quality} onChange={setQuality} />
              </label>
              {format === "mp4" && (
                <label className="modal-row">
                  <span>Codec</span>
                  <Segmented<"avc" | "hevc"> options={[{ value: "avc", label: "H.264, plays anywhere" }, ...(hevcOk ? [{ value: "hevc" as const, label: "HEVC, smaller" }] : [])]} value={codec} onChange={setCodec} />
                </label>
              )}
            </>
          )}
          {canAlpha && (
            <div className="modal-row">
              <span>Background</span>
              <Toggle label="Transparent background" value={transparent} onChange={setTransparent} />
            </div>
          )}
          <p className="modal-summary num">{summary(kind, format, width, height, outFps, duration, estimate, editor.time, wantAlpha)}</p>
          <div className="modal-actions">
            <button className="textbtn" onClick={onClose}>
              {active.length ? "Minimise" : "Cancel"}
            </button>
            <button className="export" disabled={!ready || busy} onClick={start}>
              {active.length ? "Add to queue" : kind === "still" ? "Export frame" : kind === "audio" ? "Export audio" : "Export video"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function summary(kind: Kind, format: ExportFormat, w: number, h: number, fps: number, duration: number, estimate: number, at: number, alpha: boolean): string {
  const a = alpha ? ", transparent" : "";
  if (kind === "still") return `${w} × ${h} PNG of the frame at ${span(at)}${a}.`;
  if (kind === "audio") return `${format === "wav" ? "WAV" : "M4A"}, ${span(duration)}, about ${bytes(estimate)}.`;
  return `${w} × ${h}, ${Math.round(fps * 100) / 100} fps, ${span(duration)}, about ${bytes(estimate)}${a}. No watermark.`;
}

function JobRow({ job }: { job: ExportJob }) {
  return (
    <div className="job">
      <div className="job-head">
        <b>{job.name}</b>
        <small>{job.label}</small>
        <span className="spacer" />
        {(job.status === "running" || job.status === "queued") && (
          <button className="textbtn" onClick={() => exportQueue.cancel(job.id)}>
            {job.status === "queued" ? "Remove" : "Stop"}
          </button>
        )}
        {(job.status === "done" || job.status === "error") && (
          <button className="textbtn" onClick={() => exportQueue.dismiss(job.id)}>
            Dismiss
          </button>
        )}
      </div>
      {job.status === "queued" && <p className="insp-note">Waiting for the export before it.</p>}
      {job.status === "running" && <ProgressView progress={job.progress} />}
      {job.status === "done" && (
        <>
          <p className="modal-done">
            <Icon name="check" /> Saved {bytes(job.bytes)} in {job.seconds < 60 ? `${Math.round(job.seconds)} s` : `${Math.floor(job.seconds / 60)} min ${Math.round(job.seconds % 60)} s`}.
          </p>
          <p className="modal-path">{job.path}</p>
          <button className="textbtn" onClick={() => window.openroll.revealInFolder(job.path)}>
            Show in folder
          </button>
        </>
      )}
      {job.status === "error" && <p className="modal-warn">The export stopped: {job.error}. Your project is untouched.</p>}
    </div>
  );
}

export function ProgressView({ progress }: { progress: ExportProgress | null }) {
  const frac = progress ? progress.frame / progress.frames : 0;
  const left = progress && frac > 0.02 && !progress.note ? (progress.elapsed / frac) * (1 - frac) : null;
  const speed = progress && progress.elapsed > 0 ? progress.frame / progress.elapsed : 0;
  return (
    <div className="progress">
      <div className="progress-bar">
        <span style={{ transform: `scaleX(${frac})` }} />
      </div>
      <div className="progress-meta num">
        <span>{progress?.note ?? `${Math.floor(frac * 100)}%`}</span>
        <span>{left === null ? (progress?.note ? "" : "Starting") : left < 60 ? `${Math.ceil(left)} s left` : `${Math.ceil(left / 60)} min left`}</span>
        <span>{speed && !progress?.note ? `${Math.round(speed)} frames/s` : ""}</span>
      </div>
    </div>
  );
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}
