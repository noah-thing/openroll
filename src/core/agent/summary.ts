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
    notes: notes(p),
  };
}

/**
 * Things an editor would notice at a glance and a model reading JSON would not: sound running
 * on after the picture, stretches of black, text pushed out of frame, titles on top of captions.
 */
export function notes(p: Project): string[] {
  const out: string[] = [];
  const visual = p.tracks.filter(t => t.kind !== "audio" && !t.hidden).flatMap(t => t.items);
  const pictureEnd = Math.max(0, ...visual.filter(i => i.type !== "text" && i.type !== "caption").map(itemEnd));
  const end = projectDuration(p);
  if (pictureEnd > 0 && end - pictureEnd > 1_000_000) {
    out.push(`Sound runs ${sec(end - pictureEnd)} s past the last picture (which ends at ${sec(pictureEnd)} s); the video would show black. Trim the audio to ${sec(pictureEnd)} s and fade it out.`);
  }
  const covered = visual.filter(i => i.type === "media" || i.type === "color").map(i => [i.start, itemEnd(i)] as const).sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (const [a, b] of covered) {
    if (a - at > 200_000 && at < pictureEnd) out.push(`Nothing on screen from ${sec(at)} s to ${sec(a)} s.`);
    at = Math.max(at, b);
  }
  const W = p.settings.width / 2, H = p.settings.height / 2;
  for (const i of visual) {
    if ((i.type === "text" || i.type === "caption") && (Math.abs(i.transform.x) > W * 0.9 || Math.abs(i.transform.y) > H * 0.9)) {
      out.push(`Text ${i.id} sits at the frame edge or outside it (x ${Math.round(i.transform.x)}, y ${Math.round(i.transform.y)}).`);
    }
  }
  const texts = visual.filter(i => i.type === "text");
  const caps = visual.filter(i => i.type === "caption");
  for (const t of texts) {
    const clash = caps.find(c => c.start < itemEnd(t) && itemEnd(c) > t.start && Math.abs(c.transform.y - t.transform.y) < p.settings.height * 0.12);
    if (clash) out.push(`Title ${t.id} and caption ${clash.id} overlap in time and sit at nearly the same height.`);
  }
  return out;
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
  } else if (i.type === "shape") {
    base.shape = i.shape.kind === "sticker" ? `sticker:${i.shape.sticker}` : i.shape.kind;
    base.color = i.shape.color;
  } else {
    base.color = i.color;
  }
  return base;
}
