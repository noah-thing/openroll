import { useEffect, useRef, useState } from "react";
import { aiFor } from "../../state/ai";
import type { Editor } from "../../state/editor";
import { Icon } from "../kit/Icon";
import { AiStatusRow } from "./AiStatusRow";

type Pair = { before: ImageBitmap; after: ImageBitmap; seconds: number };

/** Runs the upscaler on a window of the picture at the playhead and shows plain against enhanced with a slider. */
export function EnhanceCompare({ editor, itemId, onClose }: { editor: Editor; itemId: string; onClose(): void }) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 1, label: "Starting" });
  const [split, setSplit] = useState(0.5);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const job = aiFor(editor).enhancePreview(itemId, (done, total, label) => setProgress({ done, total, label: label ? `Downloading ${label}` : "Upscaling" }));
    let alive = true;
    job.result.then(
      r => alive && setPair(r),
      e => alive && (e as Error).message !== "cancelled" && setError((e as Error).message),
    );
    return () => {
      alive = false;
      job.cancel();
    };
  }, [editor, itemId]);

  useEffect(() => {
    if (!pair) return;
    for (const [ref, bmp] of [[beforeRef, pair.before], [afterRef, pair.after]] as const) {
      const c = ref.current;
      if (!c) continue;
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
    }
  }, [pair]);

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const at = (x: number) => {
      const r = el.getBoundingClientRect();
      setSplit(Math.min(1, Math.max(0, (x - r.left) / r.width)));
    };
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <div className="modal-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-compare-modal" role="dialog" aria-label="Compare enhanced picture">
        <header className="modal-head">
          <h2>Before and after</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          {error ? (
            <p className="modal-warn">{error}</p>
          ) : !pair ? (
            <div className="ai-waiting">
              <AiStatusRow status={{ state: "preparing", progress: progress.done / Math.max(1, progress.total), label: progress.label }} onStop={onClose} />
            </div>
          ) : (
            <>
              <div className="ai-compare" style={{ ["--split" as string]: `${split * 100}%`, ["--ratio" as string]: `${pair.after.width} / ${pair.after.height}` }} onPointerDown={drag}>
                <canvas ref={beforeRef} />
                <canvas ref={afterRef} className="after" />
                <span className="grip" />
                <span className="tag l">Plain</span>
                <span className="tag r">Enhanced</span>
              </div>
              <p className="insp-note num">A window from the middle of the picture, four times larger. Took {pair.seconds.toFixed(1)} s on this computer.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
