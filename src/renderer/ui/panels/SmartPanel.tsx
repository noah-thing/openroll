import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { beatsOnTimeline, cutTimes, cutToBeat, type Density } from "../../../core/beat-edit";
import type { Highlight } from "../../../core/highlights";
import { findItem, itemEnd, type MediaItem, type Project } from "../../../core/project";
import { shortTime, span } from "../../lib/format";
import { useEditor } from "../../lib/hooks";
import { captionService } from "../../state/captions";
import type { Editor } from "../../state/editor";
import { framePlace, type MediaCache } from "../../state/media-cache";
import { findShorts, makeShort, pickSource, type FoundShorts, type ShortsSource } from "../../state/shorts";
import { Icon } from "../kit/Icon";
import { Segmented, Toggle } from "../kit/Field";
import "../../styles/smart.css";

type View = "shorts" | "beat";

export function SmartPanel({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const [view, setView] = useState<View>("shorts");
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Smart edits</h2>
      </div>
      <div className="smart-switch">
        <Segmented
          options={[
            { value: "shorts", label: "Shorts" },
            { value: "beat", label: "Cut to the beat" },
          ]}
          value={view}
          onChange={v => setView(v as View)}
        />
      </div>
      <div className="panel-scroll">{view === "shorts" ? <Shorts editor={editor} cache={cache} /> : <BeatCut editor={editor} />}</div>
    </div>
  );
}

// Shorts

/** Kept for the session, so switching panels does not throw the cards away. */
const found = new WeakMap<Editor, FoundShorts>();

function Shorts({ editor, cache }: { editor: Editor; cache: MediaCache }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const service = captionService(editor);
  const job = useSyncExternalStore(service.subscribe, () => service.state);
  const [step, setStep] = useState<"listen" | "picture" | null>(null);
  const [, bump] = useState(0);
  const [making, setMaking] = useState<number | null>(null);

  const source = pickSource(project, selection);
  const result = source && found.get(editor)?.itemId === source.item.id ? found.get(editor)! : null;
  const busy = step !== null;

  async function run(src: ShortsSource) {
    setStep("listen");
    const r = await findShorts(editor, cache, src, setStep);
    setStep(null);
    if (r) {
      found.set(editor, r);
      if (!r.highlights.length) editor.toast("No strong stretches found. A talking clip with clear speech works best.");
      bump(n => n + 1);
    }
  }

  async function make(i: number, h: Highlight) {
    setMaking(i);
    await makeShort(editor, result!.itemId, h, result!.words);
    setMaking(null);
  }

  if (!source) {
    return (
      <div className="smart-body">
        <p className="smart-lead">Turn a long talk or vlog into short vertical clips.</p>
        <p className="insp-note">Add a video with speech that runs at least 20 seconds. OpenRoll listens, looks for the best stretches and lets you make each one into a 9:16 project with captions.</p>
      </div>
    );
  }

  return (
    <div className="smart-body">
      <p className="smart-lead">Turn a long talk or vlog into short vertical clips.</p>
      <div className="smart-source">
        <Icon name="video" size={16} />
        <span title={source.media.name}>{source.item.name ?? source.media.name}</span>
        <small className="num">{span(source.item.duration)}</small>
      </div>
      {busy ? (
        <div className="smart-progress" role="status">
          <div className="progress-bar">
            <i style={{ width: step === "listen" ? `${Math.max(4, job.fraction * 100)}%` : "100%" }} className={step === "picture" ? "pulse" : ""} />
          </div>
          <span>{step === "listen" ? (job.downloading ? "Downloading the speech model, once" : `Listening, ${Math.round(job.fraction * 100)}%`) : "Looking at the picture and the sound"}</span>
          {step === "listen" && (
            <button className="textbtn sm" onClick={() => service.cancel()}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <button className="export cap-go" onClick={() => void run(source)}>
          {result ? "Look again" : "Find highlights"}
        </button>
      )}
      {job.phase === "error" && !busy && <p className="modal-warn">{job.message}</p>}
      {result && !busy && (
        <>
          {result.highlights.length > 0 && (
            <p className="insp-note">
              {result.highlights.length} {result.highlights.length === 1 ? "stretch" : "stretches"}, picked from {result.basis || "the clip"}. Hover a card to watch it.
            </p>
          )}
          <div className="short-list">
            {result.highlights.map((h, i) => (
              <ShortCard key={h.from} h={h} source={source} cache={cache} busy={making === i} disabled={making !== null} onMake={() => void make(i, h)} onShow={() => (editor.seek(h.from), editor.select([source.item.id]))} />
            ))}
          </div>
          <p className="insp-note">Each short is a new 9:16 project with the stretch trimmed, the picture filled from the centre and captions added. Your long video stays as it is.</p>
        </>
      )}
    </div>
  );
}

function ShortCard({ h, source, cache, busy, disabled, onMake, onShow }: { h: Highlight; source: ShortsSource; cache: MediaCache; busy: boolean; disabled: boolean; onMake(): void; onShow(): void }) {
  const [hover, setHover] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { item, media } = source;
  const srcFrom = (item.in + (h.from - item.start) * item.speed) / 1e6;
  const srcTo = (item.in + (h.to - item.start) * item.speed) / 1e6;
  const strip = cache.filmstrip(media);

  // The still: the strip frame nearest the start.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !strip) return;
    const f = framePlace(strip, Math.min(strip.count - 1, Math.max(0, Math.round(srcFrom / strip.step))));
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(strip.sheet, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  }, [strip, srcFrom]);

  useEffect(() => {
    const v = video.current;
    if (!hover || !v) return;
    v.currentTime = srcFrom;
    void v.play().catch(() => {});
  }, [hover, srcFrom]);

  return (
    <article className="short-card" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div className="short-media">
        <canvas ref={canvas} width={320} height={180} />
        {hover && <video ref={video} src={window.openroll.mediaUrl(media.path)} muted playsInline preload="auto" onTimeUpdate={e => e.currentTarget.currentTime >= srcTo && (e.currentTarget.currentTime = srcFrom)} />}
        <span className="short-len num">{span(h.to - h.from)}</span>
        {h.laughter && <span className="short-tag">Laughter</span>}
      </div>
      <div className="short-info">
        <p className="short-title">{h.title}</p>
        <p className="short-reason">{h.reason}</p>
        <div className="short-actions">
          <button className="textbtn sm" onClick={onShow} title="Move the playhead to where this starts">
            {shortTime(h.from)} to {shortTime(h.to)}
          </button>
          <button className="export" disabled={disabled} onClick={onMake}>
            {busy ? "Making…" : "Make short"}
          </button>
        </div>
      </div>
    </article>
  );
}

// Cut to the beat

interface Pick {
  music: MediaItem | null;
  clips: MediaItem[];
}

function pickBeatInputs(p: Project, selection: string[]): Pick {
  const items = p.tracks.flatMap(t => t.items.map(i => ({ i, track: t }))).filter((x): x is { i: MediaItem; track: Project["tracks"][number] } => x.i.type === "media");
  const isAudio = (i: MediaItem) => p.media[i.mediaId]?.kind === "audio";
  const withBeats = (i: MediaItem) => !!p.media[i.mediaId]?.beats?.length;
  const sel = selection.map(id => findItem(p, id)?.item).filter((i): i is MediaItem => i?.type === "media");
  const music = sel.find(i => isAudio(i) && withBeats(i)) ?? items.map(x => x.i).find(i => isAudio(i) && withBeats(i)) ?? null;
  const picked = sel.filter(i => !isAudio(i));
  const main = items.filter(x => x.track.main && !isAudio(x.i)).map(x => x.i);
  return { music, clips: picked.length >= 1 && (picked.length > 1 || main.length <= 1) ? picked : main };
}

function BeatCut({ editor }: { editor: Editor }) {
  const project = useEditor(editor, e => e.project);
  const selection = useEditor(editor, e => e.selection);
  const [density, setDensity] = useState<Density>(2);
  const [mute, setMute] = useState(true);
  const { music, clips } = useMemo(() => pickBeatInputs(project, selection), [project, selection]);
  const media = music ? project.media[music.mediaId] : undefined;

  const cuts = useMemo(() => {
    if (!music || !media?.beats || !clips.length) return 0;
    const from = Math.min(...clips.map(c => c.start));
    return cutTimes(beatsOnTimeline(music, media.beats), density, from, itemEnd(music)).length;
  }, [music, media, clips, density]);

  function go() {
    if (!music) return;
    const ids = clips.map(c => c.id);
    const r = cutToBeat(project, ids, music.id, density, mute);
    if (!r.pieces) {
      editor.toast("Nothing to cut. The music needs to start after the clips begin.");
      return;
    }
    editor.apply("Cut to the beat", p => cutToBeat(p, ids, music.id, density, mute).project);
    editor.toast(`Placed ${r.pieces} cuts on the beat`, { undo: true });
  }

  return (
    <div className="smart-body">
      <p className="smart-lead">Place clips so every cut lands on a beat of the music.</p>
      <div className="smart-source">
        <Icon name="audio" size={16} />
        {music && media ? (
          <>
            <span title={media.name}>{music.name ?? media.name}</span>
            <small className="num">{media.bpm ? `${Math.round(media.bpm)} bpm` : `${media.beats?.length} beats`}</small>
          </>
        ) : (
          <span className="smart-dim">No music with a beat yet</span>
        )}
      </div>
      <div className="smart-source">
        <Icon name="video" size={16} />
        <span className={clips.length ? "" : "smart-dim"}>{clips.length ? `${clips.length} ${clips.length === 1 ? "clip" : "clips"}` : "No clips on the main track"}</span>
        <small>{selection.length > 1 ? "selected" : "main track"}</small>
      </div>
      <div className="smart-field">
        <label>Cut on</label>
        <Segmented
          options={[
            { value: "1", label: "Every beat" },
            { value: "2", label: "Every 2" },
            { value: "4", label: "Every 4" },
          ]}
          value={String(density)}
          onChange={v => setDensity(Number(v) as Density)}
        />
      </div>
      <Toggle label="Mute the clips' own sound" value={mute} onChange={setMute} />
      <button className="export cap-go" disabled={!music || !clips.length || !cuts} onClick={go}>
        Cut to the beat
      </button>
      <p className="insp-note">
        {!music
          ? "Add a song to the timeline. Its beats are found automatically."
          : !clips.length
            ? "Add clips to the main track, or select the ones you want to use."
            : `About ${cuts} cuts across ${shortTime(itemEnd(music) - Math.min(...clips.map(c => c.start)))} of music. Clips take turns and keep moving through their footage. Undo puts them back.`}
      </p>
    </div>
  );
}
