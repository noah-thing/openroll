import { memo, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { Edge } from "../../../core/edit";
import type { Item, MediaRef, Project, Track } from "../../../core/project";
import { keyTimes } from "../../../core/look/keyframes";
import { PEAKS_PER_SECOND } from "../../../engine/media-protocol";
import { span } from "../../lib/format";
import type { MediaCache } from "../../state/media-cache";

interface Props {
  item: Item;
  project: Project;
  track: Track;
  pps: number;
  view: { left: number; width: number };
  selected: boolean;
  lifted?: boolean;
  animate?: boolean;
  cache: MediaCache;
  onPointerDown(e: React.PointerEvent, item: Item, edge: Edge | null): void;
}

/** Extra pixels drawn either side of the viewport so short scrolls never show a blank edge. */
const OVERDRAW = 300;

export const ClipView = memo(function ClipView({ item, project, track, pps, view, selected, lifted, animate, cache, onPointerDown }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const media = item.type === "media" ? project.media[item.mediaId] : undefined;
  const version = useSyncExternalStore(cache.subscribe, () => cache.version);
  const [imageTick, imageLoaded] = useReducer((n: number) => n + 1, 0);

  const left = (item.start / 1e6) * pps;
  const width = Math.max(2, (item.duration / 1e6) * pps);
  const x0 = Math.max(0, view.left - left - OVERDRAW);
  const x1 = Math.min(width, view.left + view.width - left + OVERDRAW);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !media || x1 <= x0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = canvas.parentElement!.clientHeight;
    const w = Math.ceil(x1 - x0);
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    if (item.type !== "media") return;
    const speed = item.speed;
    const srcAt = (x: number) => (item.reversed ? item.in + (item.duration - (x / pps) * 1e6) * speed : item.in + (x / pps) * 1e6 * speed);

    const audioOnly = media.kind === "audio";
    const waveH = audioOnly ? h - 16 : track.main && media.hasAudio ? 14 : 0;
    const filmH = audioOnly ? 0 : h - waveH;

    if (media.kind === "video") drawFilm(g, cache, media, x0, w, filmH, srcAt, item.freeze);
    else if (media.kind === "image") drawImageTile(g, media, w, filmH, imageLoaded);
    if (waveH > 0) {
      const peaks = cache.waveform(media);
      if (peaks) drawWave(g, peaks, x0, w, audioOnly ? 2 : filmH, waveH, srcAt, audioOnly, item.volume);
    }
  }, [media, item, pps, x0, x1, version, imageTick, cache, track.main]);

  const kindClass = item.type === "media" ? (media?.kind === "audio" ? "clip-audio" : track.main ? "clip-video" : media?.kind === "image" ? "clip-image" : "clip-overlay") : "clip-" + item.type;
  const label = item.type === "text" ? item.style.text : item.type === "caption" ? item.words.map(w => w.text).join(" ") || item.style.text : item.name ?? media?.name ?? "";

  return (
    <div
      className={["clip", kindClass, selected && "sel", lifted && "lift", animate && "clip-anim"].filter(Boolean).join(" ")}
      style={{ transform: `translate3d(${left}px,0,0)`, width }}
      onPointerDown={e => onPointerDown(e, item, null)}
      data-id={item.id}
    >
      {media && <canvas ref={canvasRef} className="clip-canvas" style={{ left: x0, width: Math.max(0, x1 - x0) }} />}
      <div className="clip-label" style={{ left: Math.max(6, view.left - left + 6) }}>
        {item.type === "media" && item.speed !== 1 && <span className="clip-badge">{fmtSpeed(item.speed)}</span>}
        {item.transitionIn && <span className="clip-badge">⇄</span>}
        <span className="clip-name">{label}</span>
        {width > 90 && <span className="clip-dur num">{span(item.duration)}</span>}
      </div>
      {selected && item.keyframes && keyTimes(item.keyframes).map(t => <span key={t} className="clip-key" style={{ left: (t / 1e6) * pps }} />)}
      {width > 14 && (
        <>
          <span className="clip-h clip-h-l" onPointerDown={e => onPointerDown(e, item, "start")} />
          <span className="clip-h clip-h-r" onPointerDown={e => onPointerDown(e, item, "end")} />
        </>
      )}
    </div>
  );
});

function fmtSpeed(s: number): string {
  return `${Math.round(s * 100) / 100}×`;
}

function drawFilm(g: CanvasRenderingContext2D, cache: MediaCache, media: MediaRef, x0: number, w: number, h: number, srcAt: (x: number) => number, freeze?: boolean) {
  const strip = cache.filmstrip(media);
  if (!strip || h <= 0) return;
  const tileW = Math.max(12, (strip.frameWidth / strip.frameHeight) * h);
  // align tiles to clip x = 0 so they do not swim while scrolling
  const first = Math.floor(x0 / tileW) * tileW;
  for (let x = first; x < x0 + w; x += tileW) {
    const src = freeze ? srcAt(0) : srcAt(x + tileW / 2);
    const idx = Math.min(strip.count - 1, Math.max(0, Math.round(src / 1e6 / strip.step)));
    g.drawImage(strip.sheet, idx * strip.frameWidth * 2, 0, strip.frameWidth * 2, strip.frameHeight * 2, x - x0, 0, tileW, h);
  }
}

const imageCache = new Map<string, HTMLImageElement>();
function drawImageTile(g: CanvasRenderingContext2D, media: MediaRef, w: number, h: number, onLoad: () => void) {
  let img = imageCache.get(media.id);
  if (!img) {
    img = new Image();
    img.src = window.openroll.mediaUrl(media.path);
    imageCache.set(media.id, img);
  }
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener("load", onLoad, { once: true });
    return;
  }
  const tileW = (img.naturalWidth / img.naturalHeight) * h;
  for (let x = 0; x < w; x += tileW) g.drawImage(img, x, 0, tileW, h);
}

function drawWave(g: CanvasRenderingContext2D, peaks: Uint8Array, x0: number, w: number, top: number, h: number, srcAt: (x: number) => number, centered: boolean, volume: number) {
  g.fillStyle = getComputedStyle(g.canvas).getPropertyValue("--wave") || "rgba(255,255,255,.3)";
  const gain = Math.min(1.6, Math.max(0.15, volume));
  for (let x = 0; x < w; x += 2) {
    const a = srcAt(x0 + x) / 1e6, b = srcAt(x0 + x + 2) / 1e6;
    let i0 = Math.floor(Math.min(a, b) * PEAKS_PER_SECOND);
    const i1 = Math.max(i0 + 1, Math.ceil(Math.max(a, b) * PEAKS_PER_SECOND));
    let v = 0;
    for (; i0 < i1 && i0 < peaks.length; i0++) if (peaks[i0] > v) v = peaks[i0];
    const amp = Math.min(1, (v / 255) * gain);
    if (centered) {
      const bar = Math.max(1, amp * h);
      g.fillRect(x, top + (h - bar) / 2, 1.5, bar);
    } else {
      const bar = Math.max(0.5, amp * h);
      g.fillRect(x, top + h - bar, 1.5, bar);
    }
  }
}
