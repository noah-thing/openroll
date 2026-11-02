import { useEffect, useState } from "react";
import type { CaptionPreset } from "../../../core/caption-styles";
import { fontStack, snapWeight } from "../../../core/fonts";

/** A caption style drawn as live type. Hovering steps the highlight through the words. */
export function Specimen({ preset, font, highlight, selected, onPick }: { preset: CaptionPreset; font?: string; highlight: string | null; selected: boolean; onPick(): void }) {
  const words = preset.sample.split(" ");
  const [lit, setLit] = useState(1);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!hover) {
      setLit(1);
      return;
    }
    const id = window.setInterval(() => setLit(l => (l + 1) % words.length), 420);
    return () => clearInterval(id);
  }, [hover, words.length]);

  const s = preset.style;
  const k = 0.22;
  const box: React.CSSProperties = {
    fontFamily: fontStack(font ?? s.font),
    fontWeight: snapWeight(font ?? s.font, s.weight),
    fontSize: s.size * k,
    letterSpacing: s.letterSpacing * k,
    color: s.color,
    background: s.background?.color,
    padding: s.background ? `${s.background.padding * k * 0.5}px ${s.background.padding * k}px` : undefined,
    borderRadius: s.background ? s.background.radius * k : undefined,
    WebkitTextStroke: s.stroke ? `${s.stroke.width * k}px ${s.stroke.color}` : undefined,
    paintOrder: "stroke fill",
    textShadow: s.shadow ? `0 ${s.shadow.y * k}px ${s.shadow.blur * k}px ${s.shadow.color}` : undefined,
    textAlign: s.align,
    whiteSpace: "nowrap",
  };

  return (
    <button className={"cap-card" + (selected ? " on" : "")} aria-pressed={selected} onClick={onPick} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <span className="cap-stage">
        <span style={box}>
          {words.map((w, i) => (
            <span key={i} style={{ color: highlight && i === lit ? highlight : undefined, transition: "color 0.12s" }}>
              {i ? " " : ""}
              {w}
            </span>
          ))}
        </span>
      </span>
      <span className="text-card-name">{preset.name}</span>
    </button>
  );
}
