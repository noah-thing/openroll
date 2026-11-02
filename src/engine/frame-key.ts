import { effectDef } from "../core/look/effects";
import { filterPreset } from "../core/look/filters";
import type { Layer, Node } from "./compositor";

/** Effects that read the clock without declaring a speed. */
const CLOCKED = new Set(["emulsion", "slow-shutter"]);

/** Time only reaches the picture through grain, which steps 24 times a second, and the moving effects. */
function timeMatters(l: Layer): boolean {
  return !!l.effects?.some(e => e.amount > 0.001 && (CLOCKED.has(e.kind) || effectDef(e.kind)?.speed !== undefined));
}

/** Grain redraws on a 24 Hz grid, so frames inside one step look alike. */
function grainStep(l: Layer): number | undefined {
  const grain = (l.adjust?.grain ?? 0) !== 0 || (l.filter && l.filter.amount > 0.001 && (filterPreset(l.filter.id)?.look.grain ?? 0) !== 0);
  return grain ? Math.floor((l.time ?? 0) * 24) : undefined;
}

function layerKey(l: Layer): Layer {
  return timeMatters(l) ? l : { ...l, time: grainStep(l) };
}

/**
 * Identifies everything a render depends on, so a frame that would come out
 * the same as the last one can be skipped. Pixel data is stood in for by each
 * source's key and version, which change whenever the picture does.
 */
export function frameKey(nodes: Node[], background: [number, number, number], width: number, height: number): string {
  const slim = nodes.map(n =>
    n.kind === "layer" ? { ...n, layer: layerKey(n.layer) } : { ...n, a: n.a.map(layerKey), b: n.b.map(layerKey) },
  );
  return `${width}x${height}|${background.join(",")}|${JSON.stringify(slim, (k, v) => (k === "pixels" ? undefined : v))}`;
}
