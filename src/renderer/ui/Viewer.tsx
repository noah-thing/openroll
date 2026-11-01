import { useEffect, useRef, useState } from "react";
import { Player } from "../../engine/player";
import { useEditor, useFrame } from "../lib/hooks";
import { timecode } from "../lib/format";
import type { Editor } from "../state/editor";
import { useSettings } from "../state/settings";
import { QUALITY_SCALE } from "../../shared/settings";
import { Icon } from "./kit/Icon";
import { ToolBoxes } from "./ToolBoxes";
import { TransformBox } from "./TransformBox";

export function Viewer({ editor }: { editor: Editor }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nowRef = useRef<HTMLSpanElement>(null);
  const durRef = useRef<HTMLSpanElement>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(false);
  const settings = useEditor(editor, e => e.project.settings);
  const prefs = useSettings();
  const empty = useEditor(editor, e => !e.project.tracks.some(t => t.items.length));

  useEffect(() => {
    const p = new Player(canvasRef.current!);
    p.onError = message => editor.toast(message, { tone: "error" });
    editor.attachPlayer(p);
    setPlayer(p);
    const off = p.subscribe(() => setPlaying(p.playing));
    return () => {
      off();
      p.dispose();
    };
  }, [editor]);

  useEffect(() => {
    const el = stageRef.current!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const aspect = settings.width / settings.height;
      let w = r.width, h = r.width / aspect;
      if (h > r.height) {
        h = r.height;
        w = h * aspect;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.width, settings.height]);

  useEffect(() => {
    if (!player || !box.w) return;
    // Auto never renders more pixels than the project has or the screen can show; the other
    // levels are fractions of the project size.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const screen = Math.round(box.w * dpr);
    const w = prefs.previewQuality === "auto" ? Math.min(settings.width, screen) : Math.max(64, Math.round(settings.width * QUALITY_SCALE[prefs.previewQuality]));
    player.setSize(w, Math.round((w * settings.height) / settings.width));
  }, [player, box, settings.width, settings.height, prefs.previewQuality]);

  useEffect(() => {
    player?.setHardwareDecoding(prefs.hardwareDecoding);
  }, [player, prefs.hardwareDecoding]);

  const fps = settings.fps.num / settings.fps.den;
  useFrame(() => {
    if (!player) return;
    if (nowRef.current) nowRef.current.textContent = timecode(player.time, fps);
    if (durRef.current) durRef.current.textContent = timecode(player.duration, fps);
  });

  return (
    <section className="viewer">
      <div className="viewer-stage" ref={stageRef}>
        <div className="viewer-frame" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} className="viewer-canvas" />
          {empty && (
            <div className="viewer-empty">
              <p>Drop clips here or on the timeline</p>
            </div>
          )}
          <TransformBox editor={editor} width={box.w} height={box.h} />
          <ToolBoxes editor={editor} width={box.w} height={box.h} />
        </div>
      </div>
      <div className="viewer-controls">
        <div className="tc num">
          <span className="tc-now" ref={nowRef} />
          <span className="tc-dur"> / <span ref={durRef} /></span>
        </div>
        <div className="transport">
          <button className="iconbtn" title="Previous edit (Up)" onClick={() => editor.jumpEdit(-1)}>
            <Icon name="prev" size={16} />
          </button>
          <button className="play" title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => player?.toggle()}>
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          <button className="iconbtn" title="Next edit (Down)" onClick={() => editor.jumpEdit(1)}>
            <Icon name="next" size={16} />
          </button>
        </div>
        <div className="viewer-right">
          <button className="iconbtn" title="Full screen preview" onClick={() => void stageRef.current?.requestFullscreen()}>
            <Icon name="fullscreen" />
          </button>
        </div>
      </div>
    </section>
  );
}
