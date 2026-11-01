// Filter presets. A preset is a small colour recipe, not a baked image, so it renders
// the same at any resolution and the amount slider is an honest blend between the
// untouched picture and the full look. Values use the shader's -1..1 scale.

export interface FilterLook {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
  /** 0..1, lifts the blacks. */
  fade?: number;
  /** 0..1 */
  vignette?: number;
  /** 0..1 */
  grain?: number;
  /** 0..1, how far to drain colour into a grey ramp. */
  mono?: number;
  /** Signed rgb offsets pushed into the darks and the lights. */
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
}

export type FilterGroup = "Natural" | "Film" | "Mood" | "Black and white";

export interface FilterPreset {
  id: string;
  name: string;
  group: FilterGroup;
  look: FilterLook;
}

export const FILTER_GROUPS: FilterGroup[] = ["Natural", "Film", "Mood", "Black and white"];

export const FILTERS: FilterPreset[] = [
  { id: "plain-air", name: "Plain air", group: "Natural", look: { contrast: 0.08, saturation: 0.1, highlights: -0.06, shadows: 0.1 } },
  { id: "linen", name: "Linen", group: "Natural", look: { exposure: 0.06, contrast: -0.06, saturation: -0.12, temperature: 0.08, fade: 0.1, shadows: 0.15 } },
  { id: "meadow", name: "Meadow", group: "Natural", look: { contrast: 0.1, saturation: 0.28, temperature: 0.04, tint: -0.1, shadowTint: [-0.01, 0.015, -0.01] } },
  { id: "harbour", name: "Harbour", group: "Natural", look: { contrast: 0.1, saturation: 0.14, temperature: -0.14, highlights: -0.08, shadowTint: [-0.01, 0.005, 0.02] } },
  { id: "clay", name: "Clay", group: "Natural", look: { contrast: 0.06, saturation: -0.08, temperature: 0.16, tint: 0.04, fade: 0.06, highlightTint: [0.02, 0.005, -0.015] } },
  { id: "noon", name: "Noon", group: "Natural", look: { exposure: 0.1, contrast: 0.16, saturation: 0.2, temperature: 0.06, highlights: -0.12 } },

  { id: "night-reel", name: "Night reel", group: "Film", look: { exposure: -0.06, contrast: 0.22, saturation: -0.06, temperature: -0.06, fade: 0.1, grain: 0.35, vignette: 0.3, shadowTint: [-0.015, 0.012, 0.03], highlightTint: [0.02, 0.005, -0.01] } },
  { id: "halide", name: "Halide", group: "Film", look: { contrast: 0.14, saturation: 0.06, temperature: 0.04, fade: 0.12, grain: 0.22, shadowTint: [-0.02, 0.02, 0.025], highlightTint: [0.035, 0.012, -0.02] } },
  { id: "matinee", name: "Matinee", group: "Film", look: { contrast: -0.08, saturation: -0.16, temperature: 0.1, fade: 0.28, grain: 0.18, vignette: 0.2, highlightTint: [0.02, 0.01, -0.015] } },
  { id: "cutting-room", name: "Cutting room", group: "Film", look: { contrast: 0.2, saturation: 0.1, fade: 0.06, shadowTint: [-0.04, 0.0, 0.05], highlightTint: [0.05, 0.015, -0.04] } },
  { id: "dust", name: "Dust", group: "Film", look: { exposure: 0.04, contrast: -0.1, saturation: -0.22, temperature: 0.12, fade: 0.34, grain: 0.3, vignette: 0.25 } },
  { id: "tungsten", name: "Tungsten", group: "Film", look: { contrast: 0.14, saturation: 0.08, temperature: 0.3, tint: 0.06, shadows: 0.08, grain: 0.15, vignette: 0.15 } },

  { id: "dusk", name: "Dusk", group: "Mood", look: { exposure: -0.04, contrast: 0.12, saturation: 0.06, temperature: -0.02, fade: 0.08, shadowTint: [0.035, -0.015, 0.05], highlightTint: [0.04, 0.0, -0.015] } },
  { id: "neon-rain", name: "Neon rain", group: "Mood", look: { exposure: -0.1, contrast: 0.26, saturation: 0.28, fade: 0.04, vignette: 0.25, shadowTint: [0.02, -0.02, 0.06], highlightTint: [0.0, 0.04, 0.04] } },
  { id: "ember", name: "Ember", group: "Mood", look: { exposure: -0.04, contrast: 0.18, saturation: 0.14, temperature: 0.28, vignette: 0.3, shadowTint: [0.045, -0.015, -0.02], highlightTint: [0.04, 0.01, -0.03] } },
  { id: "fjord", name: "Fjord", group: "Mood", look: { contrast: 0.12, saturation: -0.28, temperature: -0.24, fade: 0.1, highlights: -0.08, shadowTint: [-0.01, 0.01, 0.03] } },
  { id: "honey", name: "Honey", group: "Mood", look: { exposure: 0.08, contrast: 0.04, saturation: 0.1, temperature: 0.32, tint: 0.05, fade: 0.1, highlights: -0.1 } },
  { id: "overcast", name: "Overcast", group: "Mood", look: { contrast: -0.04, saturation: -0.3, temperature: -0.06, fade: 0.16, highlights: -0.12, shadows: 0.12 } },
  { id: "velvet", name: "Velvet", group: "Mood", look: { exposure: -0.1, contrast: 0.3, saturation: 0.1, temperature: 0.04, vignette: 0.4, shadows: -0.1, shadowTint: [0.02, -0.01, 0.02] } },
  { id: "lagoon", name: "Lagoon", group: "Mood", look: { exposure: 0.04, contrast: 0.1, saturation: 0.3, temperature: -0.18, tint: -0.12, shadowTint: [-0.025, 0.02, 0.02], highlightTint: [0.0, 0.02, 0.0] } },

  { id: "silver", name: "Silver", group: "Black and white", look: { contrast: 0.14, mono: 1 } },
  { id: "ink", name: "Ink", group: "Black and white", look: { contrast: 0.46, exposure: -0.04, mono: 1, vignette: 0.35, shadows: -0.1 } },
  { id: "chalk", name: "Chalk", group: "Black and white", look: { exposure: 0.08, contrast: -0.16, mono: 1, fade: 0.3, highlights: -0.1 } },
  { id: "newsprint", name: "Newsprint", group: "Black and white", look: { contrast: 0.26, mono: 1, fade: 0.14, grain: 0.6, vignette: 0.2, highlightTint: [0.012, 0.006, -0.008] } },
];

const BY_ID = new Map(FILTERS.map(f => [f.id, f]));

export function filterPreset(id: string): FilterPreset | undefined {
  return BY_ID.get(id);
}

export const LUT_PREFIX = "lut:";

export function isLutId(id: string): boolean {
  return id.startsWith(LUT_PREFIX);
}
