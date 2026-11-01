import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { insertItems, mediaItem, moveItem, trim, type Edge } from "../../../core/edit";
import { findItem, itemEnd, projectDuration, type Item, type Micros, type Project } from "../../../core/project";
import { useEditor, useFrame } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { importFiles } from "../../state/importer";
import type { MediaCache } from "../../state/media-cache";
import { zoomEvents } from "../../state/shortcuts";
import { Icon } from "../kit/Icon";
import { ClipView } from "./ClipView";
import { HEAD_W, laneAt, lanes, RULER_H, snap, snapPoints, type LaneBox } from "./layout";
import { Ruler } from "./Ruler";
import { TrackHead } from "./TrackHead";
import { TEXT_DRAG_TYPE, TEXT_PRESETS, textFromPreset } from "../panels/text-presets";

export const MEDIA_DRAG_TYPE = "application/x-openroll-media";

const MIN_PPS = 2;
const MAX_PPS = 1200;
const SNAP_PX = 8;

type Gesture =
  | { kind: "move"; id: string; origin: Project; grab: Micros; preview: Project; floatT: Micros; floatY: number; moved: boolean }
  | { kind: "trim"; id: string; edge: Edge; origin: Project; startX: number; preview: Project; moved: boolean }
  | { kind: "scrub" };

export function Timeline({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [pps, setPps] = useState(60);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [dropHint, setDropHint] = useState<{ t: Micros; lane: LaneBox | null } | null>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  const shown = gesture && gesture.kind !== "scrub" ? gesture.preview : project;
  const boxes = useMemo(() => lanes(shown), [shown]);
  const duration = projectDuration(shown);
  const contentW = Math.max(view.width, (duration / 1e6) * pps + view.width * 0.6);
  const contentH = (boxes.at(-1)?.top ?? RULER_H) + (boxes.at(-1)?.height ?? 0) + 40;

  const tAt = useCallback((clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, ((clientX - r.left - HEAD_W + el.scrollLeft) / ppsRef.current) * 1e6);
  }, []);
  const yAt = (clientY: number) => {
    const el = scrollRef.current!;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  };

  // ---- zoom
  const zoomTo = useCallback((next: number, anchorClientX?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
    const r = el.getBoundingClientRect();
    const x = anchorClientX !== undefined ? anchorClientX - r.left - HEAD_W : Math.max(0, ((editor.time / 1e6) * ppsRef.current) - el.scrollLeft);
    const t = (el.scrollLeft + x) / ppsRef.current;
    setPps(clamped);
    requestAnimationFrame(() => {
      el.scrollLeft = t * clamped - x;
    });
  }, [editor]);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    const d = projectDuration(editor.project) / 1e6;
    if (!el || !d) return;
    setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, ((el.clientWidth - HEAD_W) * 0.92) / d)));
    el.scrollLeft = 0;
  }, [editor]);

  useEffect(() => {
    const on = (e: Event) => {
      if (e.type === "zoom-in") zoomTo(ppsRef.current * 1.5);
      else if (e.type === "zoom-out") zoomTo(ppsRef.current / 1.5);
      else if (e.type === "zoom-fit") fit();
      else if (e.type === "snapping") setSnapping(s => {
        editor.toast(s ? "Snapping off" : "Snapping on");
        return !s;
      });
    };
    for (const t of ["zoom-in", "zoom-out", "zoom-fit", "snapping"]) zoomEvents.addEventListener(t, on);
    return () => {
      for (const t of ["zoom-in", "zoom-out", "zoom-fit", "snapping"]) zoomEvents.removeEventListener(t, on);
    };
  }, [zoomTo, fit, editor]);

  // First clips in: frame them.
  const hadContent = useRef(duration > 0);
  useEffect(() => {
    if (!hadContent.current && duration > 0) fit();
    hadContent.current = duration > 0;
  }, [duration, fit]);

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(ppsRef.current * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.012 : 0.004)), e.clientX);
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaMode === 0 && el.scrollHeight <= el.clientHeight + 2) {
        // A plain vertical wheel over a short timeline scrolls time, which is what a mouse user wants.
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const onScroll = () => setView({ left: el.scrollLeft, width: el.clientWidth - HEAD_W });
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [zoomTo]);

  // ---- playhead, moved without React on every frame
  useFrame(() => {
    const el = scrollRef.current, ph = playheadRef.current;
    if (!el || !ph) return;
    const x = (editor.time / 1e6) * ppsRef.current;
    ph.style.transform = `translate3d(${x + HEAD_W}px,0,0)`;
    if (editor.player?.playing && !gesture) {
      const visible = el.clientWidth - HEAD_W;
      if (x > el.scrollLeft + visible * 0.88 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - visible * 0.12);
    }
  });

  // ---- gestures
  const points = useCallback((exclude: string[]) => (snapping ? snapPoints(editor.project, editor.time, new Set(exclude)) : []), [editor, snapping]);

  function beginClip(e: React.PointerEvent, item: Item, edge: Edge | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) editor.select(selection.includes(item.id) ? selection.filter(id => id !== item.id) : [...selection, item.id]);
    else if (!selection.includes(item.id)) editor.select([item.id]);
    const track = findItem(editor.project, item.id)?.track;
    if (track?.locked) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const origin = editor.project;
    if (edge) setGesture({ kind: "trim", id: item.id, edge, origin, startX: e.clientX, preview: origin, moved: false });
    else setGesture({ kind: "move", id: item.id, origin, grab: tAt(e.clientX) - item.start, preview: origin, floatT: item.start, floatY: yAt(e.clientY), moved: false });
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture;
    if (!g) return;
    const noSnap = e.metaKey || e.ctrlKey;
    if (g.kind === "scrub") {
      editor.seek(tAt(e.clientX));
      return;
    }
    if (g.kind === "trim") {
      if (!g.moved && Math.abs(e.clientX - g.startX) < 2) return;
      const item = findItem(g.origin, g.id)!.item;
      let delta = ((e.clientX - g.startX) / ppsRef.current) * 1e6;
      const edgeT = g.edge === "start" ? item.start + delta : itemEnd(item) + delta;
      const s = noSnap ? { shift: 0, at: null } : snap([edgeT], points([g.id]), (SNAP_PX / ppsRef.current) * 1e6);
      delta += s.shift;
      setSnapAt(s.at);
      const preview = trim(g.origin, g.id, g.edge, Math.round(delta));
      setGesture({ ...g, preview, moved: true });
      return;
    }
    const item = findItem(g.origin, g.id)!.item;
    const pointerT = tAt(e.clientX);
    let start = Math.max(0, pointerT - g.grab);
    const s = noSnap ? { shift: 0, at: null } : snap([start, start + item.duration], points([g.id]), (SNAP_PX / ppsRef.current) * 1e6);
    start = Math.max(0, start + s.shift);
    if (!g.moved && Math.abs(start - item.start) < (3 / ppsRef.current) * 1e6 && Math.abs(yAt(e.clientY) - g.floatY) < 4) return;
    setSnapAt(s.at);
    const lane = laneAt(lanes(g.origin), yAt(e.clientY));
    const trackId = lane?.track.id ?? findItem(g.origin, g.id)!.track.id;
    // On the main track the pointer picks the slot; elsewhere the clip lands where it is.
    const preview = moveItem(g.origin, g.id, { trackId, start: lane?.track.main ? pointerT : start });
    setGesture({ ...g, preview, floatT: start, floatY: yAt(e.clientY), moved: true });
    autoScroll(e.clientX);
  }

  function onPointerUp() {
    const g = gesture;
    setGesture(null);
    setSnapAt(null);
    stopAutoScroll();
    if (!g || g.kind === "scrub" || !g.moved) return;
    editor.apply(g.kind === "move" ? "Move clip" : "Trim clip", () => g.preview);
  }

  const scrollTimer = useRef(0);
  function autoScroll(clientX: number) {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const edge = 40;
    const speed = clientX > r.right - edge ? 12 : clientX < r.left + HEAD_W + edge ? -12 : 0;
    cancelAnimationFrame(scrollTimer.current);
    if (!speed) return;
    const step = () => {
      el.scrollLeft += speed;
      scrollTimer.current = requestAnimationFrame(step);
    };
    scrollTimer.current = requestAnimationFrame(step);
  }
  function stopAutoScroll() {
    cancelAnimationFrame(scrollTimer.current);
  }

  function beginScrub(e: React.PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (!(e.shiftKey || e.metaKey)) editor.select([]);
    editor.player?.pause();
    editor.seek(tAt(e.clientX));
    setGesture({ kind: "scrub" });
  }

  // ---- drops from the library and from the file system
  function onDragOver(e: React.DragEvent) {
    const fromLibrary = e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) || e.dataTransfer.types.includes(TEXT_DRAG_TYPE);
    if (!fromLibrary && !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropHint({ t: tAt(e.clientX), lane: laneAt(boxes, yAt(e.clientY)) });
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const hint = dropHint;
    setDropHint(null);
    const t = tAt(e.clientX);
    const lane = laneAt(boxes, yAt(e.clientY));
    const presetId = e.dataTransfer.getData(TEXT_DRAG_TYPE);
    const preset = TEXT_PRESETS.find(p => p.id === presetId);
    if (preset) {
      const item = textFromPreset(preset, t, editor.project);
      editor.apply("Add text", p => insertItems(p, [item], lane?.track.kind === "text" ? { trackId: lane.track.id } : {}));
      editor.select([item.id]);
      return;
    }
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (mediaId) {
      const ref = editor.project.media[mediaId];
      if (!ref) return;
      const item = mediaItem(ref, t);
      const target = lane && (lane.track.kind === "audio") === (ref.kind === "audio") ? lane.track.id : undefined;
      editor.apply("Add clip", p => insertItems(p, [item], target ? { trackId: target } : {}));
      editor.select([item.id]);
      return;
    }
    const files = await window.openroll.pathsForDropped([...e.dataTransfer.files]);
    void importFiles(editor, files, { at: hint?.t ?? t, trackId: lane?.track.main ? undefined : lane?.track.id });
  }

  const floating = gesture?.kind === "move" && gesture.moved ? gesture : null;
  const firstVisible = view.left / pps;
  const lastVisible = (view.left + view.width) / pps;

  useLayoutEffect(() => {
    if (!dropHint) return;
    const clear = () => setDropHint(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [dropHint]);

  return (
    <section className="tl">
      <div className="tl-bar">
        <button className="iconbtn" title="Split at playhead (S)" onClick={() => editor.splitAtPlayhead()}>
          <Icon name="split" />
        </button>
        <button className="iconbtn" title="Delete (Delete)" disabled={!selection.length} onClick={() => editor.deleteSelection()}>
          <Icon name="trash" />
        </button>
        <button className="iconbtn" title="Duplicate (⌘D)" disabled={!selection.length} onClick={() => editor.duplicateSelection()}>
          <Icon name="duplicate" />
        </button>
        <span className="sep" />
        <button className="iconbtn" title="Snapping (N)" aria-pressed={snapping} onClick={() => setSnapping(s => !s)}>
          <Icon name="snap" />
        </button>
        <span className="spacer" />
        <button className="iconbtn" title="Zoom out (⌘−)" onClick={() => zoomTo(pps / 1.5)}>
          <Icon name="zoomOut" />
        </button>
        <input
          className="zoom"
          type="range"
          min={0}
          max={1000}
          value={Math.round((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000)}
          onChange={e => zoomTo(MIN_PPS * (MAX_PPS / MIN_PPS) ** (Number(e.target.value) / 1000))}
          aria-label="Timeline zoom"
        />
        <button className="iconbtn" title="Zoom in (⌘=)" onClick={() => zoomTo(pps * 1.5)}>
          <Icon name="zoomIn" />
        </button>
        <button className="textbtn" title="Fit (Shift Z)" onClick={fit}>
          Fit
        </button>
      </div>

      <div
        className={"tl-scroll" + (gesture?.kind === "move" && gesture.moved ? " tl-dragging" : "")}
        ref={scrollRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDragLeave={e => e.currentTarget === e.target && setDropHint(null)}
        onDrop={onDrop}
      >
        <div className="tl-content" style={{ width: contentW + HEAD_W, height: contentH }}>
          <div className="tl-ruler-row">
            <div className="tl-corner" />
            <Ruler pps={pps} left={view.left} width={view.width} markers={shown.markers} onPointerDown={beginScrub} />
          </div>

          {boxes.map(box => (
            <div key={box.track.id} className={"tl-row" + (box.track.main ? " tl-row-main" : "")} style={{ top: box.top, height: box.height }}>
              <TrackHead editor={editor} track={box.track} />
              <div className="tl-lane" onPointerDown={beginScrub}>
                {box.track.items.map(item => {
                  if (floating && item.id === floating.id) return null;
                  const end = itemEnd(item) / 1e6;
                  if (end < firstVisible - 2 || item.start / 1e6 > lastVisible + 2) return null;
                  return (
                    <ClipView
                      key={item.id}
                      item={item}
                      project={shown}
                      track={box.track}
                      pps={pps}
                      view={view}
                      selected={selection.includes(item.id)}
                      cache={cache}
                      animate={!!gesture && gesture.kind === "move"}
                      onPointerDown={beginClip}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {!duration && (
            <div className="tl-empty" style={{ left: HEAD_W, top: boxes.find(b => b.track.main)?.top }}>
              Drag clips here, or
              <button
                className="textbtn"
                onClick={async () => {
                  const files = await window.openroll.pickMedia();
                  void importFiles(editor, files);
                }}
              >
                import from your computer
              </button>
            </div>
          )}

          {floating && (() => {
            const found = findItem(floating.origin, floating.id)!;
            const box = laneAt(boxes, floating.floatY) ?? boxes.find(b => b.track.id === found.track.id)!;
            return (
              <div className="tl-float" style={{ top: box.top, height: box.height, left: HEAD_W }}>
                <ClipView
                  item={{ ...found.item, start: floating.floatT }}
                  project={floating.origin}
                  track={found.track}
                  pps={pps}
                  view={view}
                  selected
                  lifted
                  cache={cache}
                  onPointerDown={() => {}}
                />
              </div>
            );
          })()}

          {snapAt !== null && <div className="tl-snap" style={{ transform: `translateX(${HEAD_W + (snapAt / 1e6) * pps}px)` }} />}
          {dropHint && dropHint.lane && (
            <div className="tl-drop" style={{ top: dropHint.lane.top, height: dropHint.lane.height, transform: `translateX(${HEAD_W + (dropHint.t / 1e6) * pps}px)` }} />
          )}
          <div className="tl-playhead" ref={playheadRef} />
        </div>
      </div>
    </section>
  );
}
