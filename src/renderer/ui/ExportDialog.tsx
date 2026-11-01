import { useEffect, useRef, useState } from "react";
import { canEncodeVideo } from "mediabunny";
import { projectDuration } from "../../core/project";
import { Exporter, type ExportProgress } from "../../engine/exporter";
import type { ExportSettings } from "../../engine/export-protocol";
import { bytes, span } from "../lib/format";
import type { Editor } from "../state/editor";
import { Segmented } from "./kit/Field";
import { Icon } from "./kit/Icon";

type Quality = "small" | "balanced" | "best";

/** Bits per pixel per frame for H.264; HEVC gets about 60% of this for the same look. */
const BPP: Record<Quality, number> = { small: 0.06, balanced: 0.1, best: 0.16 };

type Phase = { kind: "setup" } | { kind: "running"; progress: ExportProgress | null } | { kind: "done"; path: string; bytes: number; seconds: number } | { kind: "error"; message: string };

export function ExportDialog({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const p = editor.project;
  const longSide = Math.max(p.settings.width, p.settings.height);
  const sizes = [720, 1080, 1440, 2160].filter(s => s <= Math.max(1080, longSide >= 3840 ? 2160 : longSide >= 2560 ? 1440 : 1080));
  const [size, setSize] = useState(Math.min(1080, Math.min(p.settings.width, p.settings.height)) === 1080 ? 1080 : sizes.at(-1)!);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [codec, setCodec] = useState<"avc" | "hevc">("avc");
  const [hevcOk, setHevcOk] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const exporter = useRef<Exporter | null>(null);
  const duration = projectDuration(p);
  const fps = p.settings.fps.num / p.settings.fps.den;

  const short = Math.min(p.settings.width, p.settings.height);
  const k = size / short;
  const width = even(p.settings.width * k);
  const height = even(p.settings.height * k);
  const bitrate = Math.round(width * height * fps * BPP[quality] * (codec === "hevc" ? 0.6 : 1));
  const estimate = ((bitrate + 192_000) / 8) * (duration / 1e6);

  useEffect(() => {
    void canEncodeVideo("hevc", { width: 1920, height: 1080 }).then(setHevcOk).catch(() => setHevcOk(false));
  }, []);

  useEffect(() => () => exporter.current?.dispose(), []);

  async function start() {
    const writer = await window.openroll.createWriter(p.name, "video");
    if (!writer) return;
    const settings: ExportSettings = { width, height, fps, codec, bitrate, hardware: true, audio: true };
    const ex = new Exporter(p, editor.urls(), writer.id);
    exporter.current = ex;
    setPhase({ kind: "running", progress: null });
    try {
      const r = await ex.run(settings, { onProgress: progress => setPhase({ kind: "running", progress }) });
      await window.openroll.closeWriter(writer.id);
      setPhase({ kind: "done", path: writer.path, ...r });
    } catch (err) {
      await window.openroll.closeWriter(writer.id, true);
      const message = (err as Error).message;
      if (message === "cancelled") setPhase({ kind: "setup" });
      else setPhase({ kind: "error", message });
    } finally {
      ex.dispose();
      exporter.current = null;
    }
  }

  const running = phase.kind === "running";
  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" role="dialog" aria-label="Export">
        <header className="modal-head">
          <h2>Export</h2>
          {!running && (
            <button className="iconbtn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </header>

        {phase.kind === "setup" && (
          <div className="modal-body">
            {!duration && <p className="modal-warn">The timeline is empty. Add a clip first.</p>}
            <label className="modal-row">
              <span>Resolution</span>
              <Segmented options={sizes.map(s => ({ value: String(s), label: s === 2160 ? "4K" : `${s}p` }))} value={String(size)} onChange={v => setSize(Number(v))} />
            </label>
            <label className="modal-row">
              <span>Quality</span>
              <Segmented<Quality>
                options={[
                  { value: "small", label: "Smaller file" },
                  { value: "balanced", label: "Balanced" },
                  { value: "best", label: "Best" },
                ]}
                value={quality}
                onChange={setQuality}
              />
            </label>
            <label className="modal-row">
              <span>Format</span>
              <Segmented<"avc" | "hevc">
                options={[{ value: "avc", label: "MP4, plays anywhere" }, ...(hevcOk ? [{ value: "hevc" as const, label: "MP4 HEVC, smaller" }] : [])]}
                value={codec}
                onChange={setCodec}
              />
            </label>
            <p className="modal-summary num">
              {width} × {height}, {Math.round(fps * 100) / 100} fps, {span(duration)}, about {bytes(estimate)}. No watermark.
            </p>
            <div className="modal-actions">
              <button className="textbtn" onClick={onClose}>
                Cancel
              </button>
              <button className="export" disabled={!duration} onClick={start}>
                Export video
              </button>
            </div>
          </div>
        )}

        {phase.kind === "running" && (
          <div className="modal-body">
            <ProgressView progress={phase.progress} />
            <div className="modal-actions">
              <button className="textbtn" onClick={() => exporter.current?.cancel()}>
                Stop
              </button>
            </div>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="modal-body">
            <p className="modal-done">
              <Icon name="check" /> Saved {bytes(phase.bytes)} in {phase.seconds < 60 ? `${Math.round(phase.seconds)} s` : `${Math.floor(phase.seconds / 60)} min ${Math.round(phase.seconds % 60)} s`}.
            </p>
            <p className="modal-path">{phase.path}</p>
            <div className="modal-actions">
              <button className="textbtn" onClick={() => window.openroll.revealInFolder(phase.path)}>
                Show in folder
              </button>
              <button className="export" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="modal-body">
            <p className="modal-warn">The export stopped: {phase.message}</p>
            <p className="insp-note">Your project is untouched. Trying again with a smaller resolution often works when the graphics card runs out of memory.</p>
            <div className="modal-actions">
              <button className="textbtn" onClick={onClose}>
                Close
              </button>
              <button className="export" onClick={() => setPhase({ kind: "setup" })}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressView({ progress }: { progress: ExportProgress | null }) {
  const frac = progress ? progress.frame / progress.frames : 0;
  const left = progress && frac > 0.02 ? (progress.elapsed / frac) * (1 - frac) : null;
  const speed = progress && progress.elapsed > 0 ? progress.frame / progress.elapsed : 0;
  return (
    <div className="progress">
      <div className="progress-bar">
        <span style={{ transform: `scaleX(${frac})` }} />
      </div>
      <div className="progress-meta num">
        <span>{Math.floor(frac * 100)}%</span>
        <span>{left === null ? "Starting" : left < 60 ? `${Math.ceil(left)} s left` : `${Math.ceil(left / 60)} min left`}</span>
        <span>{speed ? `${Math.round(speed)} frames/s` : ""}</span>
      </div>
    </div>
  );
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}
