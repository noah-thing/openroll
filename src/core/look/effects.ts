// The effect catalogue. The position in EFFECTS is the `u_kind` the shader switches on,
// so new kinds go at the end and existing ones never move.

import { newId, type Effect } from "../project";

export type EffectGroup = "Blur and zoom" | "Distort" | "Glitch and retro" | "Light and colour";

export interface EffectDef {
  kind: string;
  name: string;
  group: EffectGroup;
  amount: number;
  /** Cycles or pulses per second where the effect moves; absent when it holds still. */
  speed?: number;
  styles?: string[];
  /** A moment, in seconds, where the card preview shows the effect clearly. */
  poster: number;
  /** Not offered in the panel; added by the Adjust sharpen slider. */
  internal?: boolean;
}

export const EFFECTS: EffectDef[] = [
  { kind: "defocus", name: "Defocus", group: "Blur and zoom", amount: 0.5, poster: 0 },
  { kind: "rush", name: "Rush", group: "Blur and zoom", amount: 0.6, poster: 0 },
  { kind: "handheld", name: "Handheld", group: "Distort", amount: 0.5, speed: 1, poster: 0.37 },
  { kind: "tear", name: "Tear", group: "Glitch and retro", amount: 0.6, speed: 1, poster: 0.32 },
  { kind: "prism", name: "Prism", group: "Glitch and retro", amount: 0.5, speed: 0.5, poster: 0.2 },
  { kind: "emulsion", name: "Emulsion", group: "Glitch and retro", amount: 0.5, poster: 0.1 },
  { kind: "tape", name: "Tape", group: "Glitch and retro", amount: 0.6, speed: 1, poster: 0.45 },
  { kind: "sun-leak", name: "Sun leak", group: "Light and colour", amount: 0.6, speed: 0.4, poster: 1.1 },
  { kind: "strobe", name: "Strobe", group: "Light and colour", amount: 0.6, speed: 2, poster: 0.02 },
  { kind: "thump", name: "Thump", group: "Blur and zoom", amount: 0.5, speed: 2, poster: 0.06 },
  { kind: "mosaic", name: "Mosaic", group: "Distort", amount: 0.4, poster: 0 },
  { kind: "mirror", name: "Mirror", group: "Distort", amount: 1, styles: ["Left", "Right", "Top", "Bottom", "Four way"], poster: 0 },
  { kind: "kaleido", name: "Kaleido", group: "Distort", amount: 0.9, speed: 0.3, styles: ["Four", "Six", "Eight"], poster: 0.6 },
  { kind: "heartbeat", name: "Heartbeat", group: "Light and colour", amount: 0.7, speed: 1, poster: 0.05 },
  { kind: "neon-edge", name: "Neon edge", group: "Light and colour", amount: 0.7, speed: 0.4, poster: 0.5 },
  { kind: "mono-strobe", name: "Mono strobe", group: "Light and colour", amount: 0.8, speed: 2, styles: ["Black and white", "Inverted"], poster: 0.3 },
  { kind: "slow-shutter", name: "Slow shutter", group: "Blur and zoom", amount: 0.6, poster: 0 },
  { kind: "fisheye", name: "Fisheye", group: "Distort", amount: 0.6, styles: ["Barrel", "Pinch"], poster: 0 },
  { kind: "raster", name: "Raster", group: "Glitch and retro", amount: 0.6, speed: 0.5, poster: 0.2 },
  { kind: "duotone", name: "Duotone", group: "Light and colour", amount: 1, styles: ["Midnight", "Plum", "Ink", "Navy", "Forest", "Ocean"], poster: 0 },
  { kind: "bloom", name: "Bloom", group: "Light and colour", amount: 0.6, poster: 0 },
  { kind: "ripple", name: "Ripple", group: "Distort", amount: 0.5, speed: 0.6, poster: 0.5 },
  { kind: "sharpen", name: "Sharpen", group: "Blur and zoom", amount: 0.5, poster: 0, internal: true },
];

const BY_KIND = new Map(EFFECTS.map((e, i) => [e.kind, { def: e, index: i }]));

export function effectDef(kind: string): EffectDef | undefined {
  return BY_KIND.get(kind)?.def;
}

export function effectIndex(kind: string): number {
  return BY_KIND.get(kind)?.index ?? -1;
}

export const EFFECT_GROUPS: EffectGroup[] = ["Blur and zoom", "Distort", "Glitch and retro", "Light and colour"];

export function newEffect(kind: string): Effect {
  const def = effectDef(kind);
  const params: Record<string, number> = {};
  if (def?.speed !== undefined) params.speed = def.speed;
  if (def?.styles) params.style = 0;
  return { id: newId("fx"), kind, amount: def?.amount ?? 0.5, ...(Object.keys(params).length ? { params } : {}) };
}
