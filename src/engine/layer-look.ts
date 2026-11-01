// Turns a Placement into compositor layer fields. The preview and export workers both
// go through here, so a look cannot render differently in one of them.

import type { Placement } from "../core/scene";
import type { Project } from "../core/project";
import { isLutId } from "../core/look/filters";
import { lutFromBase64 } from "../core/look/lut";
import type { Compositor, Layer } from "./compositor";

/** Geometry, opacity and every look field of a placement. `bare` drops the look entirely. */
export function layerFields(place: Placement, bare = false): Layer {
  const base: Layer = {
    x: place.x,
    y: place.y,
    width: place.width * place.animScale,
    height: place.height * place.animScale,
    rotation: place.rotation,
    opacity: place.opacity,
    crop: place.crop,
    blend: place.blend,
    time: place.time,
  };
  if (bare) return base;
  base.adjust = place.adjust;
  base.filter = place.filter;
  base.curves = place.curves;
  base.hsl = place.hsl;
  base.effects = place.effects;
  base.mask = place.mask;
  base.chroma = place.chroma;
  base.fill = place.fill;
  return base;
}

const seen = new WeakMap<Compositor, Set<string>>();

/** Upload any imported LUTs the project carries that the compositor has not seen yet. */
export function syncLuts(c: Compositor, p: Project): void {
  let done = seen.get(c);
  if (!done) seen.set(c, (done = new Set()));
  for (const [id, lut] of Object.entries(p.luts ?? {})) {
    if (!isLutId(id) || done.has(id)) continue;
    done.add(id);
    try {
      c.registerLut(id, lut.size, lutFromBase64(lut.size, lut.data));
    } catch {
      /* a damaged LUT renders as no filter */
    }
  }
}
