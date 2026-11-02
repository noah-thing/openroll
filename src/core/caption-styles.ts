import type { CaptionTemplate } from "./captions";
import { snapWeight } from "./fonts";
import type { Project, TextStyle } from "./project";

export interface CaptionPreset {
  id: string;
  name: string;
  /** Words shown in the picker, with the one at `lit` highlighted. */
  sample: string;
  /** Highlight colour this look is meant to be seen with. */
  highlight?: string;
  animationIn?: string;
  /** Written for a 1080 pixel short side. */
  style: TextStyle;
}

const base: TextStyle = {
  text: "",
  font: "Familjen Grotesk",
  size: 64,
  weight: 600,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.15,
  letterSpacing: 0,
};

export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: "clean", name: "Clean", sample: "Never been here", style: { ...base, shadow: { color: "rgba(0,0,0,0.6)", blur: 18, x: 0, y: 4 } } },
  { id: "outline", name: "Outline", sample: "Never been here", highlight: "#f2c23a", style: { ...base, weight: 700, size: 70, stroke: { color: "#000000", width: 7 } } },
  { id: "block", name: "Block", sample: "Never been here", highlight: "#f2c23a", style: { ...base, size: 58, background: { color: "rgba(10,12,11,0.78)", padding: 22, radius: 8 } } },
  { id: "marker", name: "Marker", sample: "Never been here", highlight: "#e2674f", style: { ...base, weight: 700, size: 60, color: "#14130e", background: { color: "#f2c23a", padding: 20, radius: 6 } } },
  { id: "loud", name: "Loud", sample: "Never been here", highlight: "#8fbf8a", animationIn: "pop", style: { ...base, font: "Anton", weight: 400, size: 88, letterSpacing: 1, stroke: { color: "#000000", width: 10 } } },
  { id: "blue", name: "Ice", sample: "Never been here", highlight: "#7fb4e8", style: { ...base, weight: 700, size: 66, shadow: { color: "rgba(0,0,0,0.7)", blur: 12, x: 0, y: 3 }, stroke: { color: "#0d1b2a", width: 5 } } },
  { id: "serif", name: "Serif", sample: "Never been here", style: { ...base, font: "Playfair Display", weight: 600, size: 62, shadow: { color: "rgba(0,0,0,0.55)", blur: 14, x: 0, y: 3 } } },
  { id: "lower", name: "Lower third", sample: "Never been here", highlight: "#f2c23a", style: { ...base, weight: 500, size: 46, align: "left", background: { color: "rgba(10,12,11,0.72)", padding: 20, radius: 4 } } },
];

export const HIGHLIGHT_COLORS = ["#f2c23a", "#e2674f", "#8fbf8a", "#7fb4e8", "#c9a7e8", "#ff8fb1"];

export type CaptionPosition = "top" | "middle" | "lower";

/** Fraction of the frame height the caption sits from the centre. */
const POSITION_Y: Record<CaptionPosition, number> = { top: -0.3, middle: 0, lower: 0.27 };

export interface CaptionChoice {
  preset: string;
  /** null keeps the highlight off. */
  highlight: string | null;
  position: CaptionPosition;
  /** Replaces the preset's font. Unset keeps the one the look was designed with. */
  font?: string;
}

export const DEFAULT_CHOICE: CaptionChoice = { preset: "outline", highlight: "#f2c23a", position: "lower" };

export function presetById(id: string): CaptionPreset {
  return CAPTION_PRESETS.find(p => p.id === id) ?? CAPTION_PRESETS[0];
}

/** Resolve a choice into the values captions carry, scaled to this project's frame. */
export function templateFor(choice: CaptionChoice, project: Project): CaptionTemplate {
  const preset = presetById(choice.preset);
  const k = Math.min(project.settings.width, project.settings.height) / 1080;
  const s = preset.style;
  const font = choice.font ?? s.font;
  const style: TextStyle = {
    ...s,
    font,
    weight: snapWeight(font, s.weight),
    size: Math.round(s.size * k),
    letterSpacing: s.letterSpacing * k,
    stroke: s.stroke && { ...s.stroke, width: s.stroke.width * k },
    shadow: s.shadow && { ...s.shadow, blur: s.shadow.blur * k, y: s.shadow.y * k },
    background: s.background && { ...s.background, padding: s.background.padding * k, radius: s.background.radius * k },
  };
  return {
    style,
    highlight: choice.highlight ?? undefined,
    y: Math.round(POSITION_Y[choice.position] * project.settings.height),
    animationIn: preset.animationIn ? { kind: preset.animationIn, duration: 250_000 } : undefined,
  };
}
