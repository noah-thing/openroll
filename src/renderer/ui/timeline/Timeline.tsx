import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { insertItems, mediaItem, moveItem, trim, type Edge } from "../../../core/edit";
import { moveGroup, moveTrack, rippleTrim, rollTrim, setTrackHeight, slip, updateMarker } from "../../../core/timeline-edit";
import { findItem, itemEnd, projectDuration, type Item, type Marker, type Micros, type Project, type Track } from "../../../core/project";
import { useEditor, useFrame } from "../../lib/hooks";
import type { Editor } from "../../state/editor";
import { importFiles } from "../../state/importer";
import type { MediaCache } from "../../state/media-cache";
import { zoomEvents } from "../../state/events";
import { renameItem } from "../../state/timeline-actions";
import { Icon } from "../kit/Icon";
import { useContextMenu } from "../menu/ContextMenu";
import { ClipView } from "./ClipView";
import { HEAD_W, itemsInRect, laneAt, lanes, RULER_H, snap, snapPoints, type LaneBox } from "./layout";
import { addTrackMenu, clipMenu, laneMenu, markerMenu, rulerMenu, trackHeadMenu } from "./menus";
import { Ruler } from "./Ruler";
import { TrackHead } from "./TrackHead";
import { TEXT_DRAG_TYPE, TEXT_PRESETS, textFromPreset } from "../panels/text-presets";
import "./timeline.css";

export const MEDIA_DRAG_TYPE = "application/x-openroll-media";

const MIN_PPS = 2;
const MAX_PPS = 1200;
const SNAP_PX = 8;
const DRAG_PX = 4;
const EDGE_ZONE = 56;

type Gesture =
  | { kind: "move"; ids: string[]; leadId: string; origin: Project; grab: Micros; preview: Project; floatT: Micros; floatY: number; moved: boolean; collapse?: string }
  | { kind: "trim"; id: string; edge: Edge; ripple: boolean; origin: Project; startX: number; preview: Project; moved: boolean }
  | { kind: "roll"; leftId: string; rightId: string; origin: Project; startX: number; preview: Project; moved: boolean }
  | { kind: "slip"; id: string; origin: Project; startX: number; preview: Project; moved: boolean }
  | { kind: "marker"; id: string; origin: Project; startX: number; preview: Project; moved: boolean }
  | { kind: "resize"; id: string; origin: Project; startY: number; startH: number; preview: Project }
  | { kind: "reorder"; id: string; to: number; line: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; base: string[]; additive: boolean; moved: boolean }
  | { kind: "range"; which: "in" | "out" }
  | { kind: "scrub" };

function previewOf(g: Gesture | null): Project | null {
  return g && "preview" in g ? g.preview : null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clampPps = (v: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));

export function Timeline({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const range = useEditor(editor, e => e.range);
  const shuttle = useEditor(editor, e => e.shuttle);
  const looping = useEditor(editor, e => e.looping);
  const [pps, setPps] = useState(60);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [follow, setFollow] = useState(true);
  const [altDown, setAltDown] = useState(false);
  const [dropHint, setDropHint] = useState<{ t: Micros; lane: LaneBox | null } | null>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const [renamingMarker, setRenamingMarker] = useState<string | null>(null);
  const [renamingClip, setRenamingClip] = useState<string | null>(null);
  const menu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const gref = useRef<Gesture | null>(null);
  const pointer = useRef({ x: 0, y: 0, meta: false });
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const followRef = useRef(follow);
  followRef.current = follow;

  const setGesture = (g: Gesture | null) => {
    gref.current = g;
    setGestureState(g);
  };

  const shown = previewOf(gesture) ?? project;
  const boxes = useMemo(() => lanes(shown), [shown]);
  const duration = projectDuration(shown);
  const contentW = Math.max(view.width, (duration / 1e6) * pps + view.width * 0.6);
  const contentH = Math.max((boxes.at(-1)?.top ?? RULER_H) + (boxes.at(-1)?.height ?? 0) + 40, 0);

  const tAt = useCallback((clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, ((clientX - r.left - HEAD_W + el.scrollLeft) / ppsRef.current) * 1e6);
  }, []);
  const yAt = (clientY: number) => {
    const el = scrollRef.current!;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  };
  const xContent = (clientX: number) => {
    const el = scrollRef.current!;
    return clientX - el.getBoundingClientRect().left + el.scrollLeft;
  };

  // Every change keeps one time under one screen x, so nothing slides away.
  const anim = useRef(0);
  const zoomTarget = useRef<number | null>(null);
  const pendingScroll = useRef<{ t: number; x: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingScroll.current;
    pendingScroll.current = null;
    if (el && p) el.scrollLeft = Math.max(0, p.t * pps - p.x);
  }, [pps]);

  const showView = useCallback((nextPps: number, t: number, x: number) => {
    pendingScroll.current = { t, x };
    setPps(clampPps(nextPps));
  }, []);

  const anchorFor = useCallback(
    (anchorClientX?: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      const visible = el.clientWidth - HEAD_W;
      const x = anchorClientX !== undefined ? anchorClientX - r.left - HEAD_W : (editor.time / 1e6) * ppsRef.current - el.scrollLeft;
      const clamped = Math.min(visible, Math.max(0, x));
      return { x: clamped, t: (el.scrollLeft + clamped) / ppsRef.current };
    },
    [editor],
  );

  const tween = useCallback(
    (to: number, t0: number, t1: number, x: number) => {
      cancelAnimationFrame(anim.current);
      const target = clampPps(to);
      zoomTarget.current = target;
      const from = ppsRef.current;
      if (reducedMotion() || Math.abs(Math.log(target / from)) < 0.002) {
        showView(target, t1, x);
        zoomTarget.current = null;
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - start) / 200);
        const k = 1 - (1 - u) ** 3;
        showView(from * (target / from) ** k, t0 + (t1 - t0) * k, x);
        if (u < 1) anim.current = requestAnimationFrame(step);
        else zoomTarget.current = null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [showView],
  );

  const zoomBy = useCallback(
    (factor: number, anchorClientX?: number) => {
      const a = anchorFor(anchorClientX);
      tween((zoomTarget.current ?? ppsRef.current) * factor, a.t, a.t, a.x);
    },
    [anchorFor, tween],
  );

  const zoomNow = useCallback(
    (next: number, anchorClientX?: number) => {
      cancelAnimationFrame(anim.current);
      zoomTarget.current = null;
      const a = anchorFor(anchorClientX);
      showView(next, a.t, a.x);
    },
    [anchorFor, showView],
  );

  const fit = useCallback(() => {
    const el = scrollRef.current;
    const d = projectDuration(editor.project) / 1e6;
    if (!el || !d) return;
    const target = ((el.clientWidth - HEAD_W) * 0.92) / d;
    tween(target, el.scrollLeft / ppsRef.current, 0, 0);
  }, [editor, tween]);

  useEffect(() => {
    const on = (e: Event) => {
      if (e.type === "zoom-in") zoomBy(1.5);
      else if (e.type === "zoom-out") zoomBy(1 / 1.5);
      else if (e.type === "zoom-fit") fit();
      else if (e.type === "follow") setFollow(f => !f);
      else if (e.type === "snapping")
        setSnapping(s => {
          editor.toast(s ? "Snapping off" : "Snapping on");
          return !s;
        });
    };
    const names = ["zoom-in", "zoom-out", "zoom-fit", "snapping", "follow"];
    for (const t of names) zoomEvents.addEventListener(t, on);
    return () => {
      for (const t of names) zoomEvents.removeEventListener(t, on);
    };
  }, [zoomBy, fit, editor]);

  // First clips in: frame them.
  const hadContent = useRef(duration > 0);
  useEffect(() => {
    if (!hadContent.current && duration > 0) {
      const el = scrollRef.current;
      if (el) showView(((el.clientWidth - HEAD_W) * 0.92) / (duration / 1e6), 0, 0);
    }
    hadContent.current = duration > 0;
  }, [duration, showView]);

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // A pinch arrives as many small ctrl wheel events; a mouse notch is one big one and gets eased.
        const pinch = e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 40 && e.deltaMode === 0;
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.012 : 0.004));
        if (pinch) zoomNow(ppsRef.current * factor, e.clientX);
        else zoomBy(factor, e.clientX);
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
      cancelAnimationFrame(anim.current);
    };
  }, [zoomNow, zoomBy]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => setAltDown(e.altKey);
    const off = () => setAltDown(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", off);
    };
  }, []);

  useFrame(() => {
    const el = scrollRef.current, ph = playheadRef.current;
    if (!el || !ph) return;
    const x = (editor.time / 1e6) * ppsRef.current;
    ph.style.transform = `translate3d(${x + HEAD_W}px,0,0)`;
    if ((editor.player?.playing || editor.shuttle !== 0) && followRef.current && !gref.current) {
      const visible = el.clientWidth - HEAD_W;
      if (x > el.scrollLeft + visible * 0.88 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - visible * 0.12);
    }
  });

  const points = useCallback((exclude: string[]) => (snapping ? snapPoints(editor.project, editor.time, new Set(exclude)) : []), [editor, snapping]);
  const tol = () => (SNAP_PX / ppsRef.current) * 1e6;

  function beginClip(e: React.PointerEvent, item: Item, edge: Edge | null) {
    if (e.button !== 0) return;
    if (e.ctrlKey && window.openroll.platform === "darwin") return; // a context click, the menu event follows
    e.stopPropagation();
    const found = findItem(editor.project, item.id);
    if (!found) return;
    const track = found.track;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const rippleTrimming = !!edge && e.shiftKey && !track.main;
    let collapse: string | undefined;
    if (rippleTrimming) {
      // Shift on a trim handle means ripple, not "add to selection".
    } else if (additive) editor.select(selection.includes(item.id) ? selection.filter(id => id !== item.id) : [...selection, item.id]);
    else if (!selection.includes(item.id)) editor.select([item.id]);
    else if (selection.length > 1 && !edge) collapse = item.id;
    if (track.locked) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, meta: e.metaKey || e.ctrlKey };
    const origin = editor.project;

    if (edge && e.altKey) {
      const sorted = [...track.items].sort((a, b) => a.start - b.start);
      const left = edge === "end" ? item : sorted.find(i => itemEnd(i) === item.start);
      const right = edge === "end" ? sorted.find(i => i.start === itemEnd(item)) : item;
      if (left && right) {
        start({ kind: "roll", leftId: left.id, rightId: right.id, origin, startX: e.clientX, preview: origin, moved: false });
        return;
      }
    }
    if (edge) {
      start({ kind: "trim", id: item.id, edge, ripple: rippleTrimming, origin, startX: e.clientX, preview: origin, moved: false });
      return;
    }
    if (e.altKey && item.type === "media" && !item.freeze && origin.media[item.mediaId]?.kind !== "image") {
      start({ kind: "slip", id: item.id, origin, startX: e.clientX, preview: origin, moved: false });
      return;
    }
    const ids = !additive && selection.includes(item.id) && selection.length > 1 ? selection : [item.id];
    start({ kind: "move", ids, leadId: item.id, origin, grab: tAt(e.clientX) - item.start, preview: origin, floatT: item.start, floatY: yAt(e.clientY), moved: false, collapse });
  }

  function beginLane(e: React.PointerEvent) {
    if (e.button !== 0 || (e.ctrlKey && window.openroll.platform === "darwin")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, meta: e.metaKey || e.ctrlKey };
    const x = xContent(e.clientX);
    const y = yAt(e.clientY);
    start({ kind: "marquee", x0: x, y0: y, x1: x, y1: y, base: selection, additive: e.shiftKey || e.metaKey || e.ctrlKey, moved: false });
  }

  function beginScrub(e: React.PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, meta: false };
    if (!(e.shiftKey || e.metaKey)) editor.select([]);
    editor.player?.pause();
    editor.seek(tAt(e.clientX));
    start({ kind: "scrub" });
  }

  function beginMarker(e: React.PointerEvent, m: Marker) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, meta: false };
    start({ kind: "marker", id: m.id, origin: editor.project, startX: e.clientX, preview: editor.project, moved: false });
  }

  function beginRange(e: React.PointerEvent, which: "in" | "out") {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start({ kind: "range", which });
  }

  function beginResize(e: React.PointerEvent, box: LaneBox) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start({ kind: "resize", id: box.track.id, origin: editor.project, startY: e.clientY, startH: box.height, preview: editor.project });
  }

  function beginReorder(e: React.PointerEvent, track: Track) {
    if (e.button !== 0 || (e.ctrlKey && window.openroll.platform === "darwin")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, meta: false };
    const from = editor.project.tracks.findIndex(t => t.id === track.id);
    reorderStart.current = { y: e.clientY, from };
    start({ kind: "reorder", id: track.id, to: from, line: -1 });
  }
  const reorderStart = useRef({ y: 0, from: 0 });

  function start(g: Gesture) {
    setGesture(g);
    startAuto();
  }

  function update() {
    const g = gref.current;
    if (!g) return;
    const { x: cx, y: cy, meta } = pointer.current;
    const per = ppsRef.current;
    switch (g.kind) {
      case "scrub":
        editor.scrub(tAt(cx));
        return;
      case "range": {
        let t = tAt(cx);
        const s = meta ? { shift: 0 } : snap([t], points([]), tol());
        t = Math.max(0, t + s.shift);
        const r = editor.range;
        if (g.which === "in") editor.setRange({ in: r.out !== null ? Math.min(t, r.out - 100_000) : t, out: r.out });
        else editor.setRange({ in: r.in, out: r.in !== null ? Math.max(t, r.in + 100_000) : t });
        return;
      }
      case "marquee": {
        const x1 = xContent(cx);
        const y1 = yAt(cy);
        const moved = g.moved || Math.hypot(x1 - g.x0, y1 - g.y0) > DRAG_PX;
        const next = { ...g, x1, y1, moved };
        setGesture(next);
        if (moved) {
          const t0 = Math.max(0, ((g.x0 - HEAD_W) / per) * 1e6);
          const t1 = Math.max(0, ((x1 - HEAD_W) / per) * 1e6);
          const hit = itemsInRect(lanes(editor.project), t0, t1, g.y0, y1);
          editor.select(g.additive ? [...new Set([...g.base, ...hit])] : hit);
        }
        return;
      }
      case "trim": {
        if (!g.moved && Math.abs(cx - g.startX) < 2) return;
        const item = findItem(g.origin, g.id)!.item;
        let delta = ((cx - g.startX) / per) * 1e6;
        const edgeT = g.edge === "start" ? item.start + delta : itemEnd(item) + delta;
        const s = meta ? { shift: 0, at: null } : snap([edgeT], points([g.id]), tol());
        delta += s.shift;
        setSnapAt(s.at);
        const preview = g.ripple ? rippleTrim(g.origin, g.id, g.edge, Math.round(delta)) : trim(g.origin, g.id, g.edge, Math.round(delta));
        setGesture({ ...g, preview, moved: true });
        return;
      }
      case "roll": {
        if (!g.moved && Math.abs(cx - g.startX) < 2) return;
        const left = findItem(g.origin, g.leftId)!.item;
        let delta = ((cx - g.startX) / per) * 1e6;
        const s = meta ? { shift: 0, at: null } : snap([itemEnd(left) + delta], points([g.leftId, g.rightId]), tol());
        delta += s.shift;
        setSnapAt(s.at);
        setGesture({ ...g, preview: rollTrim(g.origin, g.leftId, g.rightId, Math.round(delta)), moved: true });
        return;
      }
      case "slip": {
        if (!g.moved && Math.abs(cx - g.startX) < 2) return;
        // Dragging right pulls the footage right, which shows earlier source.
        const delta = (-(cx - g.startX) / per) * 1e6;
        setGesture({ ...g, preview: slip(g.origin, g.id, Math.round(delta)), moved: true });
        return;
      }
      case "marker": {
        if (!g.moved && Math.abs(cx - g.startX) < 3) return;
        const m = g.origin.markers.find(x => x.id === g.id)!;
        let t = m.t + ((cx - g.startX) / per) * 1e6;
        const s = meta ? { shift: 0 } : snap([t], snapPoints(g.origin, editor.time, new Set()).filter(p => p !== m.t), tol());
        t = Math.max(0, t + s.shift);
        setGesture({ ...g, preview: updateMarker(g.origin, g.id, { t }), moved: true });
        return;
      }
      case "resize": {
        setGesture({ ...g, preview: setTrackHeight(g.origin, g.id, g.startH + (cy - g.startY)) });
        return;
      }
      case "reorder": {
        const y = yAt(cy);
        const all = lanes(editor.project);
        let to = all.findIndex(b => y < b.top + b.height / 2);
        if (to < 0) to = all.length;
        const line = to < all.length ? all[to].top - 1 : (all.at(-1)?.top ?? 0) + (all.at(-1)?.height ?? 0) + 1;
        const from = all.findIndex(b => b.track.id === g.id);
        setGesture({ ...g, to: to > from ? to - 1 : to, line: Math.abs(cy - reorderStart.current.y) > DRAG_PX ? line : -1 });
        return;
      }
      case "move": {
        const lead = findItem(g.origin, g.leadId)!.item;
        const group = g.ids.map(id => findItem(g.origin, id)?.item).filter((i): i is Item => !!i);
        const pointerT = tAt(cx);
        let dt = Math.max(0, pointerT - g.grab) - lead.start;
        const first = Math.min(...group.map(i => i.start));
        const last = Math.max(...group.map(i => itemEnd(i)));
        const s = meta ? { shift: 0, at: null } : snap([first + dt, last + dt], points(g.ids), tol());
        dt += s.shift;
        if (!g.moved && Math.abs(dt) < (3 / per) * 1e6 && Math.abs(yAt(cy) - g.floatY) < DRAG_PX) return;
        setSnapAt(s.at);
        const leadTrack = findItem(g.origin, g.leadId)!.track;
        if (g.ids.length > 1) {
          const preview = moveGroup(g.origin, g.ids, { dt, slotTime: leadTrack.main ? pointerT : undefined });
          setGesture({ ...g, preview, floatT: lead.start + dt, floatY: yAt(cy), moved: true });
        } else {
          const lane = laneAt(lanes(g.origin), yAt(cy));
          const trackId = lane?.track.id ?? leadTrack.id;
          const startT = Math.max(0, lead.start + dt);
          // On the main track the pointer picks the slot; elsewhere the clip lands where it is.
          const preview = moveItem(g.origin, g.leadId, { trackId, start: lane?.track.main ? pointerT : startT });
          setGesture({ ...g, preview, floatT: startT, floatY: yAt(cy), moved: true });
        }
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!gref.current) return;
    pointer.current = { x: e.clientX, y: e.clientY, meta: e.metaKey || e.ctrlKey };
    update();
  }

  function finish(e?: React.PointerEvent) {
    const g = gref.current;
    setGesture(null);
    setSnapAt(null);
    stopAuto();
    if (!g) return;
    if (e) pointer.current = { x: e.clientX, y: e.clientY, meta: e.metaKey || e.ctrlKey };
    switch (g.kind) {
      case "move":
        if (g.moved) editor.apply(g.ids.length > 1 ? "Move clips" : "Move clip", () => g.preview);
        else if (g.collapse) editor.select([g.collapse]);
        break;
      case "trim":
        if (g.moved) editor.apply("Trim clip", () => g.preview);
        break;
      case "roll":
        if (g.moved) editor.apply("Roll edit", () => g.preview);
        break;
      case "slip":
        if (g.moved) editor.apply("Slip clip", () => g.preview);
        break;
      case "marker":
        if (g.moved) editor.apply("Move marker", () => g.preview);
        else editor.seek(g.origin.markers.find(m => m.id === g.id)?.t ?? editor.time);
        break;
      case "resize":
        editor.apply("Resize track", () => g.preview);
        break;
      case "reorder":
        if (g.line >= 0) editor.apply("Move track", p => moveTrack(p, g.id, g.to));
        break;
      case "marquee":
        if (!g.moved) {
          if (!g.additive) editor.select([]);
          editor.player?.pause();
          editor.seek(Math.max(0, ((g.x0 - HEAD_W) / ppsRef.current) * 1e6));
        }
        break;
    }
  }

  // Escape abandons a drag and leaves the project as it was.
  useEffect(() => {
    if (!gesture || gesture.kind === "scrub") return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setGesture(null);
      setSnapAt(null);
      stopAuto();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [gesture?.kind]);

  // Scroll sideways while a drag sits near either edge, faster the nearer it is.
  const autoRaf = useRef(0);
  function startAuto() {
    cancelAnimationFrame(autoRaf.current);
    const tick = () => {
      const el = scrollRef.current;
      const g = gref.current;
      if (!el || !g) return;
      const r = el.getBoundingClientRect();
      const { x, y } = pointer.current;
      const left = r.left + HEAD_W;
      const right = r.right - 12;
      const zone = (d: number) => Math.min(1, Math.max(0, (EDGE_ZONE - d) / EDGE_ZONE));
      let dx = 0;
      if (g.kind !== "reorder" && g.kind !== "resize") dx = zone(right - x) * 22 - zone(x - left) * 22;
      let dy = 0;
      if (g.kind === "marquee") dy = zone(r.bottom - 12 - y) * 16 - zone(y - (r.top + RULER_H)) * 16;
      if (dx || dy) {
        const before = el.scrollLeft + el.scrollTop;
        el.scrollLeft += dx;
        el.scrollTop += dy;
        if (el.scrollLeft + el.scrollTop !== before) update();
      }
      autoRaf.current = requestAnimationFrame(tick);
    };
    autoRaf.current = requestAnimationFrame(tick);
  }
  function stopAuto() {
    cancelAnimationFrame(autoRaf.current);
  }
  useEffect(() => () => stopAuto(), []);

  function onClipMenu(e: React.MouseEvent, item: Item) {
    if (!editor.selection.includes(item.id)) editor.select([item.id]);
    menu.open(e, clipMenu(editor, item, { rename: setRenamingClip }));
  }

  function onLaneMenu(e: React.MouseEvent, track: Track) {
    menu.open(e, laneMenu(editor, track, tAt(e.clientX)));
  }

  function onHeadMenu(e: React.MouseEvent, track: Track) {
    menu.open(e, trackHeadMenu(editor, track, () => startHeadRename(track.id)));
  }

  function startHeadRename(id: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-track="${id}"] .tl-head-name`);
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  function commitMarkerName(m: Marker, label: string | null) {
    if (label === null) {
      setRenamingMarker(m.id);
      return;
    }
    setRenamingMarker(null);
    if (label !== (m.label ?? "")) editor.apply("Rename marker", p => updateMarker(p, m.id, { label }));
  }

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

  const floating = gesture?.kind === "move" && gesture.moved && gesture.ids.length === 1 ? gesture : null;
  const groupIds = gesture?.kind === "move" ? gesture.ids : null;
  const firstVisible = view.left / pps;
  const lastVisible = (view.left + view.width) / pps;

  useLayoutEffect(() => {
    if (!dropHint) return;
    const clear = () => setDropHint(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [dropHint]);

  const marquee = gesture?.kind === "marquee" && gesture.moved ? gesture : null;
  const rate = shuttle !== 0 ? `${shuttle < 0 ? "◀ " : ""}${Math.abs(shuttle)}×` : looping ? "Loop" : null;
  const renameBox = renamingClip ? boxes.find(b => b.track.items.some(i => i.id === renamingClip)) : null;
  const renameItemData = renameBox?.track.items.find(i => i.id === renamingClip);

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
        <button className="textbtn" title="Keep the playhead in view while playing (Option F)" aria-pressed={follow} onClick={() => setFollow(f => !f)}>
          Follow
        </button>
        <span className="spacer" />
        {rate && <span className="tl-rate num" aria-live="polite">{rate}</span>}
        <button className="iconbtn" title="Zoom out (⌘−)" onClick={() => zoomBy(1 / 1.5)}>
          <Icon name="zoomOut" />
        </button>
        <input
          className="zoom"
          type="range"
          min={0}
          max={1000}
          value={Math.round((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000)}
          onChange={e => zoomNow(MIN_PPS * (MAX_PPS / MIN_PPS) ** (Number(e.target.value) / 1000))}
          aria-label="Timeline zoom"
        />
        <button className="iconbtn" title="Zoom in (⌘=)" onClick={() => zoomBy(1.5)}>
          <Icon name="zoomIn" />
        </button>
        <button className="textbtn" title="Fit (Shift Z)" onClick={fit}>
          Fit
        </button>
      </div>

      <div
        className={"tl-scroll" + (gesture?.kind === "move" && gesture.moved ? " tl-dragging" : "") + (altDown ? " tl-alt" : "") + (gesture?.kind === "roll" ? " tl-rolling" : "")}
        ref={scrollRef}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDragOver={onDragOver}
        onDragLeave={e => e.currentTarget === e.target && setDropHint(null)}
        onDrop={onDrop}
        onContextMenu={e => menu.open(e, addTrackMenu(editor))}
      >
        <div className="tl-content" style={{ width: contentW + HEAD_W, height: contentH }}>
          <div className="tl-ruler-row">
            <div className="tl-corner">
              <button
                className="iconbtn sm tl-add"
                title="Add track"
                aria-haspopup="menu"
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  menu.openAt(r.left, r.bottom + 4, addTrackMenu(editor));
                }}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
            <Ruler
              pps={pps}
              left={view.left}
              width={view.width}
              markers={shown.markers}
              range={range}
              renaming={renamingMarker}
              onPointerDown={beginScrub}
              onContextMenu={e => menu.open(e, rulerMenu(editor, tAt(e.clientX), fit))}
              onMarkerDown={beginMarker}
              onMarkerContext={(e, m) => menu.open(e, markerMenu(editor, m, () => setRenamingMarker(m.id)))}
              onMarkerRename={commitMarkerName}
              onRangeDown={beginRange}
            />
          </div>

          {boxes.map(box => (
            <div key={box.track.id} data-track={box.track.id} className={"tl-row" + (box.track.main ? " tl-row-main" : "") + (box.track.locked ? " tl-row-locked" : "")} style={{ top: box.top, height: box.height }}>
              <TrackHead editor={editor} track={box.track} dragging={gesture?.kind === "reorder" && gesture.id === box.track.id && gesture.line >= 0} onReorderStart={beginReorder} onContextMenu={onHeadMenu} />
              <div className="tl-lane" onPointerDown={beginLane} onContextMenu={e => onLaneMenu(e, box.track)}>
                {box.track.items.map(item => {
                  if (floating && item.id === floating.leadId) return null;
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
                      animate={!!gesture && gesture.kind === "move" && !groupIds?.includes(item.id)}
                      onPointerDown={beginClip}
                      onContextMenu={onClipMenu}
                    />
                  );
                })}
              </div>
              <div className="tl-resize" onPointerDown={e => beginResize(e, box)} title="Drag to resize the track" />
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
            const found = findItem(floating.origin, floating.leadId)!;
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

          {renameBox && renameItemData && (
            <input
              className="tl-rename"
              autoFocus
              aria-label="Clip name"
              defaultValue={renameItemData.name ?? ""}
              placeholder="Clip name"
              style={{ left: HEAD_W + (renameItemData.start / 1e6) * pps + 4, top: renameBox.top + 4, width: Math.max(140, (renameItemData.duration / 1e6) * pps - 8) }}
              onFocus={e => e.currentTarget.select()}
              onPointerDown={e => e.stopPropagation()}
              onBlur={e => {
                renameItem(editor, renameItemData.id, e.currentTarget.value);
                setRenamingClip(null);
              }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") setRenamingClip(null);
              }}
            />
          )}

          {marquee && (
            <div
              className="tl-marquee"
              style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
            />
          )}
          {gesture?.kind === "reorder" && gesture.line >= 0 && <div className="tl-reorder" style={{ top: gesture.line }} />}
          {snapAt !== null && <div className="tl-snap" style={{ transform: `translateX(${HEAD_W + (snapAt / 1e6) * pps}px)` }} />}
          {dropHint && dropHint.lane && (
            <div className="tl-drop" style={{ top: dropHint.lane.top, height: dropHint.lane.height, transform: `translateX(${HEAD_W + (dropHint.t / 1e6) * pps}px)` }} />
          )}
          <div className="tl-playhead" ref={playheadRef} />
        </div>
      </div>
      {menu.element}
    </section>
  );
}
