import { useRef, useState } from "react";
import { insertItems, mediaItem, removeMedia } from "../../../core/edit";
import { mainTrack, projectDuration, type MediaRef } from "../../../core/project";
import { useEditor } from "../../lib/hooks";
import { shortTime } from "../../lib/format";
import type { Editor } from "../../state/editor";
import { importFiles } from "../../state/importer";
import type { MediaCache } from "../../state/media-cache";
import { Icon } from "../kit/Icon";
import { MEDIA_DRAG_TYPE } from "../timeline/Timeline";

export function MediaPanel({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const media = useEditor(editor, e => e.project.media);
  const tracks = useEditor(editor, e => e.project.tracks);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = Object.values(media);
  const used = new Set(tracks.flatMap(t => t.items.flatMap(i => (i.type === "media" ? [i.mediaId] : []))));

  async function pick() {
    const files = await window.openroll.pickMedia();
    if (!files.length) return;
    setBusy(true);
    await importFiles(editor, files);
    setBusy(false);
  }

  function add(m: MediaRef) {
    const item = mediaItem(m, m.kind === "audio" ? editor.time : projectDuration(editor.project));
    editor.apply("Add clip", p => insertItems(p, [item], m.kind === "audio" ? {} : { trackId: mainTrack(p).id }));
    editor.select([item.id]);
  }

  return (
    <div
      className={"panel" + (over ? " panel-drop" : "")}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={e => e.currentTarget === e.target && setOver(false)}
      onDrop={async e => {
        e.preventDefault();
        setOver(false);
        const files = await window.openroll.pathsForDropped([...e.dataTransfer.files]);
        setBusy(true);
        await importFiles(editor, files);
        setBusy(false);
      }}
    >
      <div className="panel-head">
        <h2>Media</h2>
        <button className="textbtn" onClick={pick} disabled={busy}>
          <Icon name="plus" size={16} />
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {!list.length ? (
        <button className="panel-empty" onClick={pick}>
          <Icon name="folder" size={22} />
          <b>Import clips, music and photos</b>
          <span>or drag them in from your desktop</span>
        </button>
      ) : (
        <div className="media-grid">
          {list.map(m => (
            <MediaTile
              key={m.id}
              media={m}
              used={used.has(m.id)}
              cache={cache}
              onAdd={() => add(m)}
              onRemove={() => editor.apply(`Remove ${m.name}`, p => removeMedia(p, m.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaTile({ media, used, cache, onAdd, onRemove }: { media: MediaRef; used: boolean; cache: MediaCache; onAdd(): void; onRemove(): void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const url = window.openroll.mediaUrl(media.path);
  const strip = media.kind === "video" ? cache.filmstrip(media) : null;

  // Skim: the pointer picks the moment and the clip plays from there, muted.
  function skim(e: React.PointerEvent) {
    const v = videoRef.current;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
    if (!v || !v.duration) return;
    const t = p * v.duration;
    if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
    if (v.paused) void v.play().catch(() => {});
  }

  return (
    <div
      className={"tile" + (used ? " tile-used" : "")}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={onAdd}
    >
      <div
        className={"tile-thumb" + (media.kind === "audio" ? " tile-audio" : "")}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => {
          setHover(false);
          videoRef.current?.pause();
          if (barRef.current) barRef.current.style.transform = "scaleX(0)";
        }}
        onPointerMove={media.kind === "video" ? skim : undefined}
      >
        {media.kind === "image" && <img src={url} alt="" draggable={false} />}
        {media.kind === "video" && strip && <StripPoster strip={strip} />}
        {media.kind === "video" && hover && <video ref={videoRef} src={url} muted playsInline preload="auto" className="tile-video" />}
        {media.kind === "audio" && <Icon name="audio" size={22} />}
        <span className="tile-bar" ref={barRef} />
        {media.kind !== "image" && <span className="tile-dur num">{shortTime(media.duration)}</span>}
        <button className="tile-add" title="Add to timeline" onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="tile-name" title={media.path}>
        {used && <i className="tile-dot" />}
        {media.name}
        <button className="tile-remove" title="Remove from project" onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

function StripPoster({ strip }: { strip: { sheet: ImageBitmap; frameWidth: number; frameHeight: number; count: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = (c: HTMLCanvasElement | null) => {
    ref.current = c;
    if (!c) return;
    const idx = Math.min(strip.count - 1, Math.floor(strip.count * 0.25));
    c.width = strip.frameWidth * 2;
    c.height = strip.frameHeight * 2;
    c.getContext("2d")!.drawImage(strip.sheet, idx * c.width, 0, c.width, c.height, 0, 0, c.width, c.height);
  };
  return <canvas ref={draw} className="tile-poster" />;
}
