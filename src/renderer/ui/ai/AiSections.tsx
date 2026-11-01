import { useMemo, useState } from "react";
import { updateItem } from "../../../core/edit";
import type { MediaItem, Project } from "../../../core/project";
import { MODELS } from "../../../engine/ai/models";
import { aiFor, useAiStatus } from "../../state/ai";
import type { Editor } from "../../state/editor";
import { Section, Segmented, Slider, Toggle } from "../kit/Field";
import { useItemEdit } from "../inspector/anim";
import { AiStatusRow } from "./AiStatusRow";
import { EnhanceCompare } from "./EnhanceCompare";

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

/** The AI sections of the Video tab. */
export function AiVideoSections({ editor, item, project }: { editor: Editor; item: MediaItem; project: Project }) {
  const media = project.media[item.mediaId];
  const isVideo = media?.kind === "video";
  return (
    <>
      <CutoutSection editor={editor} item={item} />
      {isVideo && <StabiliseSection editor={editor} item={item} />}
      <ReframeSection editor={editor} item={item} project={project} />
      {media && <EnhanceSection editor={editor} item={item} project={project} />}
    </>
  );
}

/** The AI sections of the Speed tab. */
export function AiSpeedSections({ editor, item }: { editor: Editor; item: MediaItem }) {
  return (
    <>
      <SlowMotionSection editor={editor} item={item} />
      <MotionBlurSection editor={editor} item={item} />
    </>
  );
}

function CutoutSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const ai = aiFor(editor);
  const status = useAiStatus(editor, item.mediaId, "cutout");
  return (
    <Section title="Remove background" fold="ai-cutout">
      <Toggle label="Remove background" value={!!item.cutout} onChange={v => editor.apply(v ? "Remove background" : "Keep background", p => updateItem(p, item.id, { cutout: v || undefined }))} />
      {item.cutout && <AiStatusRow status={status} onStop={() => ai.cancel("cutout", item.mediaId)} onRetry={() => ai.retry("cutout", item.mediaId)} />}
      <p className="insp-note">
        People and objects stay, the rest becomes see through, so you can put another clip or a colour behind. Runs on this computer. The first time it downloads a {mb(MODELS.matting.bytes)} model.
      </p>
    </Section>
  );
}

function StabiliseSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const ai = aiFor(editor);
  const status = useAiStatus(editor, item.mediaId, "stabilize");
  const strength = item.stabilize?.strength ?? 0.6;
  const on = !!item.stabilize && item.stabilize.strength > 0;
  const crop = on && status.state === "ready" ? ai.stabilizeCrop(item.mediaId, strength) : null;
  const edit = useItemEdit(editor, item);
  return (
    <Section title="Stabilise" fold="ai-stabilise">
      <Toggle label="Steady the camera" value={on} onChange={v => editor.apply(v ? "Stabilise" : "Stop stabilising", p => updateItem(p, item.id, { stabilize: v ? { strength: 0.6 } : undefined }))} />
      {on && (
        <>
          <Slider
            label="Strength"
            value={strength * 100}
            min={5}
            max={100}
            unit="%"
            reset={60}
            onChange={v => edit("Stabilise strength", d => void (d.stabilize = { strength: v / 100 }), "stabilise")}
            onCommit={() => editor.endGroup()}
          />
          <AiStatusRow status={status} onStop={() => ai.cancel("stabilize", item.mediaId)} onRetry={() => ai.retry("stabilize", item.mediaId)} />
          {crop !== null && <p className="insp-note num">The picture is cropped in by {Math.round(crop * 100)}% to hide the edges.</p>}
        </>
      )}
      <p className="insp-note">Smooths out hand shake and keeps slow moves. Higher strength holds the frame stiller and crops in more.</p>
    </Section>
  );
}

const RATIOS = [
  { label: "9:16", w: 1080, h: 1920 },
  { label: "1:1", w: 1080, h: 1080 },
  { label: "4:5", w: 1080, h: 1350 },
];

function ReframeSection({ editor, item, project }: { editor: Editor; item: MediaItem; project: Project }) {
  const ai = aiFor(editor);
  const status = useAiStatus(editor, item.mediaId, "reframe");
  const [busy, setBusy] = useState(false);
  const s = project.settings;
  const tall = s.height > s.width;
  const media = project.media[item.mediaId];

  async function run(target?: { w: number; h: number; label: string }) {
    setBusy(true);
    try {
      if (target) {
        editor.apply(`Change frame to ${target.label}`, p => {
          if (p.settings.width === target.w && p.settings.height === target.h) return p;
          const k = Math.max(1, Math.max(p.settings.width, p.settings.height) / Math.max(target.w, target.h));
          return { ...p, settings: { ...p.settings, width: Math.round((target.w * k) / 2) * 2, height: Math.round((target.h * k) / 2) * 2 } };
        });
      }
      const r = await ai.reframe(item.id);
      editor.toast(r.found ? "Reframed to follow the person" : "No one found to follow, the clip is centred");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Auto reframe" fold="ai-reframe">
      <div className="ai-actions">
        <button className="ai-primary" disabled={busy || media?.kind === "audio"} onClick={() => void run(tall ? undefined : RATIOS[0])}>
          {tall ? "Reframe to follow" : "Make vertical"}
        </button>
        {RATIOS.slice(1).map(r => (
          <button key={r.label} className="ai-secondary" disabled={busy} onClick={() => void run(r)}>
            {r.label}
          </button>
        ))}
        {!tall && (
          <button className="ai-secondary" disabled={busy} onClick={() => void run()}>
            Current frame
          </button>
        )}
      </div>
      {(busy || status.state === "error") && <AiStatusRow status={status} onStop={() => ai.cancel("reframe", item.mediaId)} onRetry={() => void run()} />}
      {!busy && status.state === "ready" && <AiStatusRow status={status} />}
      <p className="insp-note">Finds the main person, then moves and scales the clip so they stay in the frame. The result is ordinary keyframes you can edit. Downloads a {mb(MODELS.detector.bytes)} model the first time.</p>
    </Section>
  );
}

/** Videos wider than this are left to the sharpen pass; the upscaler is meant for small sources. */
const UPSCALE_LIMIT = 960;
/** Measured on an M series Mac in the packaged app, seconds per 128 pixel tile. */
const SECONDS_PER_TILE = 0.95;

function EnhanceSection({ editor, item, project }: { editor: Editor; item: MediaItem; project: Project }) {
  const media = project.media[item.mediaId];
  const edit = useItemEdit(editor, item);
  const [comparing, setComparing] = useState(false);
  const amount = item.enhance?.amount ?? 0.5;
  const on = !!item.enhance;
  const small = !!media && Math.max(media.width ?? 0, media.height ?? 0) <= UPSCALE_LIMIT && media.kind !== "audio";
  const perFrame = useMemo(() => {
    const w = media?.width ?? 0, h = media?.height ?? 0;
    return Math.ceil(w / 112) * Math.ceil(h / 112) * SECONDS_PER_TILE;
  }, [media?.width, media?.height]);
  const seconds = (item.duration / 1e6) * (project.settings.fps.num / project.settings.fps.den);
  const minutes = Math.round((perFrame * seconds) / 60);
  return (
    <Section title="Enhance quality" fold="ai-enhance">
      <Toggle label="Clean up and sharpen" value={on} onChange={v => editor.apply(v ? "Enhance quality" : "Stop enhancing", p => updateItem(p, item.id, { enhance: v ? { amount: 0.5 } : undefined }))} />
      {on && (
        <>
          <Slider label="Amount" value={amount * 100} min={0} max={100} unit="%" reset={50} onChange={v => edit("Enhance amount", d => void (d.enhance = { ...d.enhance!, amount: v / 100 }), "enhance")} onCommit={() => editor.endGroup()} />
          {media?.kind === "video" && (
            <>
              <Toggle label="AI upscale on export" value={!!item.enhance?.upscale} onChange={v => edit("AI upscale", d => void (d.enhance = { ...d.enhance!, upscale: v || undefined }))} />
              {!small ? (
                <p className="insp-note">This clip is already large, so the upscaler would not help. Clean up and sharpen still apply.</p>
              ) : item.enhance?.upscale ? (
                <p className="insp-note num">
                  About {perFrame.toFixed(1)} s for every frame, so roughly {minutes < 1 ? "under a minute" : `${minutes} min`} added to the export of this clip.
                </p>
              ) : null}
            </>
          )}
          <button className="ai-secondary" onClick={() => setComparing(true)}>
            Compare at playhead
          </button>
        </>
      )}
      <p className="insp-note">
        Cleaning up and sharpening shows live. The AI upscale ({MODELS.superres.name}, {mb(MODELS.superres.bytes)}) makes the picture four times larger and is applied when you export.
      </p>
      {comparing && <EnhanceCompare editor={editor} itemId={item.id} onClose={() => setComparing(false)} />}
    </Section>
  );
}

function SlowMotionSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const slow = item.speed < 0.999;
  const mode = item.slowMotion ?? "off";
  return (
    <Section title="Smooth slow motion" fold="ai-slow">
      <Segmented
        options={[
          { value: "off", label: "Off" },
          { value: "blend", label: "Frame blend" },
          { value: "flow", label: "Optical flow" },
        ]}
        value={mode}
        onChange={v => editor.apply(v === "off" ? "Plain slow motion" : v === "flow" ? "Optical flow slow motion" : "Frame blend slow motion", p => updateItem(p, item.id, { slowMotion: v === "off" ? undefined : v }))}
      />
      <p className="insp-note">
        {slow
          ? "Makes the frames between the real ones. Frame blend fades neighbours together, optical flow follows the motion and looks smoother on steady moves."
          : "Takes effect when the speed is below 1×. Set a slower speed above."}
      </p>
    </Section>
  );
}

function MotionBlurSection({ editor, item }: { editor: Editor; item: MediaItem }) {
  const edit = useItemEdit(editor, item);
  const on = !!item.motionBlur;
  return (
    <Section title="Motion blur" fold="ai-blur">
      <Toggle label="Motion blur" value={on} onChange={v => editor.apply(v ? "Motion blur" : "Stop motion blur", p => updateItem(p, item.id, { motionBlur: v ? { amount: 0.5 } : undefined }))} />
      {on && (
        <Slider label="Amount" value={(item.motionBlur?.amount ?? 0.5) * 100} min={5} max={100} unit="%" reset={50} onChange={v => edit("Motion blur amount", d => void (d.motionBlur = { amount: v / 100 }), "blur")} onCommit={() => editor.endGroup()} />
      )}
      <p className="insp-note">Smears fast moves the way a camera shutter does. Works on position, scale and rotation changes, and on clips played faster than 1×. 50% is a natural look.</p>
    </Section>
  );
}
