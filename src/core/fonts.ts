// The fonts that ship with OpenRoll. A text item stores a family name from this list, and
// the preview and every export draw it from the same files, so a title looks identical
// wherever it is rendered.

export type FontCategory = "sans" | "display" | "serif" | "handwriting" | "mono";

export interface FontInfo {
  /** The family name stored in projects. */
  family: string;
  /** Start of the bundled file names, e.g. `inter` for `inter-latin.woff2`. */
  file: string;
  category: FontCategory;
  /** Lightest and heaviest weight the file draws. Equal for fonts with a single weight. */
  minWeight: number;
  maxWeight: number;
  /** Fallback for characters the font lacks. */
  generic: "sans-serif" | "serif" | "monospace" | "cursive";
  /** Only the Latin subset is bundled, so the file list is shorter. */
  latinOnly?: boolean;
}

export const DEFAULT_FONT = "Familjen Grotesk";

export const FONTS: readonly FontInfo[] = [
  { family: "Familjen Grotesk", file: "familjen-grotesk", category: "sans", minWeight: 400, maxWeight: 700, generic: "sans-serif" },
  { family: "Inter", file: "inter", category: "sans", minWeight: 300, maxWeight: 800, generic: "sans-serif" },
  { family: "Montserrat", file: "montserrat", category: "sans", minWeight: 300, maxWeight: 800, generic: "sans-serif" },
  { family: "Nunito", file: "nunito", category: "sans", minWeight: 300, maxWeight: 800, generic: "sans-serif" },
  { family: "Oswald", file: "oswald", category: "display", minWeight: 300, maxWeight: 700, generic: "sans-serif" },
  { family: "Anton", file: "anton", category: "display", minWeight: 400, maxWeight: 400, generic: "sans-serif" },
  { family: "Bebas Neue", file: "bebas-neue", category: "display", minWeight: 400, maxWeight: 400, generic: "sans-serif" },
  { family: "Archivo Black", file: "archivo-black", category: "display", minWeight: 400, maxWeight: 400, generic: "sans-serif" },
  { family: "Bangers", file: "bangers", category: "display", minWeight: 400, maxWeight: 400, generic: "sans-serif" },
  { family: "Playfair Display", file: "playfair-display", category: "serif", minWeight: 400, maxWeight: 800, generic: "serif" },
  { family: "DM Serif Display", file: "dm-serif-display", category: "serif", minWeight: 400, maxWeight: 400, generic: "serif" },
  { family: "Caveat", file: "caveat", category: "handwriting", minWeight: 400, maxWeight: 700, generic: "cursive" },
  { family: "Permanent Marker", file: "permanent-marker", category: "handwriting", minWeight: 400, maxWeight: 400, generic: "cursive", latinOnly: true },
  { family: "JetBrains Mono", file: "jetbrains-mono", category: "mono", minWeight: 300, maxWeight: 800, generic: "monospace" },
];

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: "sans", label: "Sans serif" },
  { id: "display", label: "Display" },
  { id: "serif", label: "Serif" },
  { id: "handwriting", label: "Handwriting" },
  { id: "mono", label: "Monospace" },
];

/**
 * Projects made before there was a font picker store a CSS stack for the serif looks.
 * It keeps drawing with the system face it always did, so those projects open unchanged.
 */
const LEGACY_STACKS = ["Georgia, serif"];

export function fontInfo(family: string): FontInfo | undefined {
  return FONTS.find(f => f.family === family);
}

export function isKnownFont(family: unknown): family is string {
  return typeof family === "string" && (!!fontInfo(family) || LEGACY_STACKS.includes(family));
}

/** The family to store for whatever a file or an AI tool sent. */
export function safeFont(family: unknown): string {
  return isKnownFont(family) ? family : DEFAULT_FONT;
}

/** Weights this font has, lightest first, in steps of one hundred. */
export function fontWeights(family: string): number[] {
  const f = fontInfo(family);
  const [lo, hi] = f ? [f.minWeight, f.maxWeight] : [300, 700];
  const out: number[] = [];
  for (let w = lo; w <= hi; w += 100) out.push(w);
  return out;
}

/** The nearest weight the font really has. Canvas and CSS would otherwise fake a bold. */
export function snapWeight(family: string, weight: number): number {
  const f = fontInfo(family);
  if (!f) return weight;
  return Math.min(f.maxWeight, Math.max(f.minWeight, weight));
}

/** CSS font-family value for a stored family, with fallbacks for characters it does not cover. */
export function fontStack(family: string): string {
  const f = fontInfo(family);
  if (!f) return family;
  return `"${f.family}", ${f.generic}`;
}
