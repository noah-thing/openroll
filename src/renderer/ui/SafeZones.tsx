import { useEffect, useRef, useState } from "react";
import { GUIDES, guideById, type GuideId } from "../../core/safe-zones";
import { chooseApp, clearGuides, toggleGuide, useGuides } from "../state/guides";
import { Icon } from "./kit/Icon";
import "../styles/smart.css";

/** Shaded areas and outlines drawn over the viewer. Pointer events pass through to the clip below. */
export function SafeZones({ width, height }: { width: number; height: number }) {
  const on = useGuides();
  if (!on.length || !width) return null;
  return (
    <svg className="guides" width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="guide-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="rgba(255,255,255,0.22)" strokeWidth="0.5" />
        </pattern>
      </defs>
      {on.map(id => {
        const g = guideById(id);
        return (
          <g key={id}>
            {g.covered.map(z => (
              <g key={z.label}>
                <rect x={z.x * 100} y={z.y * 100} width={z.w * 100} height={z.h * 100} className="guide-cover" />
                <rect x={z.x * 100} y={z.y * 100} width={z.w * 100} height={z.h * 100} fill="url(#guide-hatch)" />
              </g>
            ))}
            {g.inset !== undefined && <rect x={g.inset * 100} y={g.inset * 100} width={100 - g.inset * 200} height={100 - g.inset * 200} className="guide-line" vectorEffect="non-scaling-stroke" />}
          </g>
        );
      })}
    </svg>
  );
}

/** Labels sit outside the stretched SVG so text is not distorted. */
export function GuideLabels({ width, height }: { width: number; height: number }) {
  const on = useGuides();
  if (!on.length || !width) return null;
  return (
    <div className="guide-labels" aria-hidden="true">
      {on.flatMap(id => {
        const g = guideById(id);
        const zones = g.covered.map(z => (
          <span key={id + z.label} className="guide-label" style={{ left: z.x * width + 6, top: z.y * height + 5 }}>
            {z.label}
          </span>
        ));
        return g.inset !== undefined
          ? [
              <span key={id} className="guide-label guide-label-line" style={{ left: g.inset * width + 6, top: g.inset * height + 4 }}>
                {g.label}
              </span>,
            ]
          : zones;
      })}
    </div>
  );
}

const APPS: GuideId[] = ["tiktok", "shorts", "reels"];

/** The button in the viewer controls and its small menu. */
export function GuidesButton() {
  const on = useGuides();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="guides-btn" ref={ref}>
      <button className={"iconbtn" + (on.length ? " lit" : "")} title="Safe zones" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="guides" />
      </button>
      {open && (
        <div className="guides-menu" role="group" aria-label="Safe zones">
          <p>Where the app covers the video</p>
          {GUIDES.filter(g => APPS.includes(g.id)).map(g => (
            <button key={g.id} className="guides-row" aria-pressed={on.includes(g.id)} onClick={() => chooseApp(g.id)}>
              <span className="guides-tick">{on.includes(g.id) && <Icon name="check" size={13} />}</span>
              {g.label}
            </button>
          ))}
          <hr />
          <p>Broadcast guides</p>
          {GUIDES.filter(g => !APPS.includes(g.id)).map(g => (
            <button key={g.id} className="guides-row" aria-pressed={on.includes(g.id)} onClick={() => toggleGuide(g.id)}>
              <span className="guides-tick">{on.includes(g.id) && <Icon name="check" size={13} />}</span>
              {g.label}
            </button>
          ))}
          {on.length > 0 && (
            <button className="guides-row guides-off" onClick={() => (clearGuides(), setOpen(false))}>
              Hide all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
