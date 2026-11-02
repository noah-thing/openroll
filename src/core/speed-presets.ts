// Ready made speed curves. Keys sit along the source span in playing order and the speeds
// are absolute, so a preset also decides how long the clip ends up.

import type { SpeedKey } from "./project";

export interface SpeedPreset {
  id: string;
  label: string;
  keys: SpeedKey[];
}

export const SPEED_PRESETS: SpeedPreset[] = [
  {
    id: "montage",
    label: "Montage",
    keys: [{ x: 0, v: 0.4 }, { x: 0.5, v: 3 }, { x: 1, v: 0.4 }],
  },
  {
    id: "hero",
    label: "Hero",
    keys: [{ x: 0, v: 2 }, { x: 0.3, v: 0.4 }, { x: 0.7, v: 0.4 }, { x: 1, v: 2 }],
  },
  {
    id: "bullet",
    label: "Bullet",
    keys: [{ x: 0, v: 4 }, { x: 0.4, v: 0.15 }, { x: 0.6, v: 0.15 }, { x: 1, v: 4 }],
  },
  {
    id: "jump-cut",
    label: "Jump cut",
    keys: [
      { x: 0, v: 1, ease: "hold" },
      { x: 0.25, v: 6, ease: "hold" },
      { x: 0.35, v: 1, ease: "hold" },
      { x: 0.6, v: 6, ease: "hold" },
      { x: 0.7, v: 1, ease: "hold" },
      { x: 1, v: 1 },
    ],
  },
  {
    id: "flash-in",
    label: "Flash in",
    keys: [{ x: 0, v: 8, ease: "easeOut" }, { x: 0.3, v: 1 }, { x: 1, v: 1 }],
  },
  {
    id: "flash-out",
    label: "Flash out",
    keys: [{ x: 0, v: 1 }, { x: 0.7, v: 1, ease: "easeIn" }, { x: 1, v: 8 }],
  },
];

export function presetById(id: string): SpeedPreset | undefined {
  return SPEED_PRESETS.find(p => p.id === id);
}
