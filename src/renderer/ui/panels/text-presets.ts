import { IDENTITY, newId, type Micros, type Project, type TextItem, type TextStyle } from "../../../core/project";

export interface TextPreset {
  id: string;
  name: string;
  sample: string;
  style: TextStyle;
  /** Where it lands, as a fraction of frame height from the centre. */
  y: number;
  animationIn?: string;
}

const base: TextStyle = {
  text: "",
  font: "Familjen Grotesk",
  size: 96,
  weight: 700,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.1,
  letterSpacing: 0,
};

export const TEXT_PRESETS: TextPreset[] = [
  { id: "title", name: "Title", sample: "Sunday, mostly water", y: 0, animationIn: "slide-up", style: { ...base, size: 120, letterSpacing: -2 } },
  { id: "plain", name: "Plain", sample: "Just words", y: 0, style: { ...base, size: 72, weight: 500 } },
  { id: "punch", name: "Punch", sample: "WAIT FOR IT", y: 0.18, animationIn: "pop", style: { ...base, size: 92, weight: 700, stroke: { color: "#000000", width: 7 } } },
  { id: "label", name: "Label", sample: "day 3", y: -0.28, style: { ...base, size: 64, weight: 600, color: "#14130e", background: { color: "#f2c23a", padding: 18, radius: 6 } } },
  { id: "lower", name: "Lower third", sample: "Ella Lind, skipper", y: 0.32, animationIn: "slide-right", style: { ...base, size: 52, weight: 500, align: "left", background: { color: "rgba(10,12,11,0.72)", padding: 22, radius: 4 } } },
  { id: "soft", name: "Soft shadow", sample: "back home", y: 0, animationIn: "fade", style: { ...base, size: 88, weight: 600, shadow: { color: "rgba(0,0,0,0.55)", blur: 24, x: 0, y: 6 } } },
  { id: "tag", name: "Tag", sample: "NEW", y: -0.3, animationIn: "pop", style: { ...base, size: 56, weight: 700, letterSpacing: 4, background: { color: "#e2674f", padding: 16, radius: 40 } } },
  { id: "serif", name: "Serif", sample: "Chapter one", y: 0, animationIn: "fade", style: { ...base, font: "Georgia, serif", size: 96, weight: 400 } },
];

export const TEXT_DRAG_TYPE = "application/x-openroll-text";

export function textFromPreset(preset: TextPreset, start: Micros, p: Project): TextItem {
  return {
    id: newId("i"),
    type: "text",
    start,
    duration: 3_000_000,
    name: preset.name,
    transform: { ...IDENTITY, y: preset.y * p.settings.height },
    style: { ...preset.style, text: preset.sample },
    animationIn: preset.animationIn ? { kind: preset.animationIn, duration: 400_000 } : undefined,
  };
}
