// The project as an AI tool reads it: seconds instead of microseconds, short keys, and only
// the fields that differ from their defaults, so a long timeline still fits in a prompt.

import { itemEnd, projectDuration, type Item, type Project } from "../project";

const sec = (us: number) => Math.round(us / 1000) / 1000;

export interface SummaryOptions {
  /** Include word timing for captions (large). */
  words?: boolean;
}

export function summarize(p: Project, opts: SummaryOptions = {}) {
  const fps = p.settings.fps.num / p.settings.fps.den;
  return {
    name: p.name,
    frame: { width: p.settings.width, height: p.settings.height, fps: Math.round(fps * 1000) / 1000, background: p.settings.background },
    duration: sec(projectDuration(p)),
    media: Object.values(p.media).map(m => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      duration: sec(m.duration),
      ...(m.width ? { size: `${m.width}x${m.height}` } : {}),
      ...(m.fps ? { fps: m.fps } : {}),
      ...(m.hasAudio && m.kind !== "audio" ? { audio: true } : {}),
      ...(m.beats?.length ? { beats: m.beats.length } : {}),
      path: m.path,
    })),
    tracks: p.tracks.map(t => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      ...(t.main ? { main: true } : {}),
      ...(t.muted ? { muted: true } : {}),
      ...(t.hidden ? { hidden: true } : {}),
      ...(t.locked ? { locked: true } : {}),
      items: t.items.map(i => item(i, opts)),
    })),
    markers: p.markers.map(m => ({ at: sec(m.t), ...(m.label ? { label: m.label } : {}) })),
  };
}

function item(i: Item, opts: SummaryOptions) {
  const base: Record<string, unknown> = { id: i.id, type: i.type, start: sec(i.start), end: sec(itemEnd(i)) };
  const t = i.transform;
  if (t.x || t.y) Object.assign(base, { x: Math.round(t.x), y: Math.round(t.y) });
  if (t.scale !== 1) base.scale = t.scale;
  if (t.rotation) base.rotation = t.rotation;
  if (t.opacity !== 1) base.opacity = t.opacity;
  if (i.transitionIn) base.transitionIn = { kind: i.transitionIn.kind, duration: sec(i.transitionIn.duration) };
  if (i.animationIn) base.animationIn = { kind: i.animationIn.kind, duration: sec(i.animationIn.duration) };
  if (i.animationOut) base.animationOut = { kind: i.animationOut.kind, duration: sec(i.animationOut.duration) };
  if (i.keyframes && Object.keys(i.keyframes).length) base.keyframes = Object.fromEntries(Object.entries(i.keyframes).map(([k, keys]) => [k, keys.map(x => [sec(x.t + i.start), x.v])]));
  if (i.type === "media") {
    Object.assign(base, { media: i.mediaId, in: sec(i.in) });
    if (i.speed !== 1) base.speed = i.speed;
    if (i.volume !== 1) base.volume = i.volume;
    if (i.fadeIn) base.fadeIn = sec(i.fadeIn);
    if (i.fadeOut) base.fadeOut = sec(i.fadeOut);
    for (const k of ["reversed", "freeze", "blend", "filter", "cutout", "stabilize", "enhance", "slowMotion", "motionBlur", "audio", "voiceFx", "muteAudio", "mask", "chroma", "crop"] as const) {
      if (i[k] !== undefined && i[k] !== false) base[k] = i[k];
    }
    if (i.adjust && Object.values(i.adjust).some(v => v)) base.adjust = i.adjust;
    if (i.effects?.length) base.effects = i.effects.map(e => ({ id: e.id, kind: e.kind, amount: e.amount, ...e.params }));
  } else if (i.type === "text") {
    base.text = i.style.text;
    base.style = { size: i.style.size, weight: i.style.weight, color: i.style.color, font: i.style.font };
  } else if (i.type === "caption") {
    base.text = i.words.map(w => w.text).join(" ");
    if (opts.words) base.words = i.words.map(w => [w.text, sec(w.start + i.start), sec(w.end + i.start)]);
  } else {
    base.color = i.color;
  }
  return base;
}
