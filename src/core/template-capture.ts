// Turning part of a project into a template. Clips become empty slots, so no file, path or
// media id leaves the project; what stays is how the piece is built and what it looks like.

import { captionText } from "./captions";
import { sanitizeTemplate, slugify, TEMPLATE_FORMAT, TEMPLATE_LIMITS, TEMPLATE_VERSION, type TemplateResult } from "./template";
import { itemEnd, newId, type Item, type MediaItem, type Micros, type Project, type Track } from "./project";

interface Picked {
  item: Item;
  track: Track;
  order: number;
}

const SAMPLE_CAPTION = "Your captions appear here";

export function captureTemplate(p: Project, ids: readonly string[] | null, name: string): TemplateResult {
  const wanted = ids ? new Set(ids) : null;
  const picked: Picked[] = p.tracks.flatMap((track, order) => track.items.filter(i => !wanted || wanted.has(i.id)).map(item => ({ item, track, order })));
  if (!picked.length) return { ok: false, error: wanted ? "Select something on the timeline first." : "The timeline is empty." };
  if (picked.length > TEMPLATE_LIMITS.items) return { ok: false, error: `That is too much for one template. Select fewer than ${TEMPLATE_LIMITS.items} items.` };

  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false, error: "Give the template a name." };
  const id = `${slugify(clean)}-${newId().slice(-5)}`;
  const frame = { width: p.settings.width, height: p.settings.height };

  if (picked.every(x => x.item.type === "caption")) {
    const first = picked.sort((a, b) => a.item.start - b.item.start)[0].item;
    if (first.type !== "caption") return { ok: false, error: "Select something on the timeline first." };
    return sanitizeTemplate({
      format: TEMPLATE_FORMAT,
      version: TEMPLATE_VERSION,
      id,
      name: clean,
      kind: "captions",
      frame,
      captions: { style: first.style, highlight: first.highlight, y: first.transform.y / p.settings.height, animationIn: first.animationIn },
    });
  }

  const main = picked.filter(x => x.track.main).sort((a, b) => a.item.start - b.item.start);
  const origin = main.length ? main[0].item.start : Math.min(...picked.map(x => x.item.start));

  // Gaps between the picked main clips close up, since the main track is packed; things above move with them.
  const gaps: { from: Micros; to: Micros }[] = [];
  for (let i = 1; i < main.length; i++) {
    const from = itemEnd(main[i - 1].item);
    if (main[i].item.start > from) gaps.push({ from, to: main[i].item.start });
  }
  const squeeze = (t: Micros) => Math.max(0, t - origin - gaps.reduce((sum, g) => sum + Math.max(0, Math.min(t, g.to) - g.from), 0));

  const media = picked
    .filter((x): x is Picked & { item: MediaItem } => x.item.type === "media")
    .sort((a, b) => a.item.start - b.item.start || a.order - b.order);
  const slotOf = new Map<string, { id: string; label: string; kind: "visual" | "audio" }>();
  let clips = 0, sounds = 0;
  for (const m of media) {
    const audio = p.media[m.item.mediaId]?.kind === "audio";
    const n = audio ? ++sounds : ++clips;
    slotOf.set(m.item.id, { id: audio ? `audio${n}` : `clip${n}`, label: audio ? `Audio ${n}` : `Clip ${n}`, kind: audio ? "audio" : "visual" });
  }
  if (slotOf.size > TEMPLATE_LIMITS.slots) return { ok: false, error: `Templates hold up to ${TEMPLATE_LIMITS.slots} clips. Select fewer.` };

  const tracks = p.tracks.flatMap(track => {
    const here = picked.filter(x => x.track === track).sort((a, b) => a.item.start - b.item.start);
    if (!here.length) return [];
    return [
      {
        kind: track.kind,
        name: track.name,
        ...(track.main ? { main: true } : {}),
        items: here.map((x, i) => {
          const prev = here[i - 1]?.item;
          const joined = !!prev && itemEnd(prev) === x.item.start;
          return templateItem(x.item, slotOf.get(x.item.id)?.id, joined, squeeze(x.item.start));
        }),
      },
    ];
  });

  const end = Math.max(...picked.map(x => itemEnd(x.item)));
  const markers = p.markers.filter(m => m.t >= origin && m.t <= end).map(m => ({ t: squeeze(m.t), label: m.label }));

  return sanitizeTemplate({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id,
    name: clean,
    kind: "timeline",
    frame,
    slots: [...slotOf.values()],
    tracks,
    markers,
  });
}

function templateItem(item: Item, slot: string | undefined, joined: boolean, start: Micros): Record<string, unknown> {
  const base = {
    start,
    duration: item.duration,
    transform: item.transform,
    keyframes: item.keyframes,
    transitionIn: joined ? item.transitionIn : undefined,
    animationIn: item.animationIn,
    animationOut: item.animationOut,
  };
  switch (item.type) {
    case "media":
      return {
        ...base,
        type: "slot",
        slot,
        speed: item.speed,
        volume: item.volume,
        fadeIn: item.fadeIn,
        fadeOut: item.fadeOut,
        reversed: item.reversed,
        muteAudio: item.muteAudio,
        crop: item.crop,
        blend: item.blend,
        adjust: item.adjust,
        filter: item.filter,
        effects: item.effects?.map(e => ({ kind: e.kind, amount: e.amount, speed: e.params?.speed, style: e.params?.style, off: e.off })),
        mask: item.mask,
        fill: item.fill,
      };
    case "text":
      return { ...base, type: "text", style: item.style };
    case "caption":
      return { ...base, type: "caption", style: { ...item.style, text: item.words.length ? SAMPLE_CAPTION : captionText(item) || SAMPLE_CAPTION }, highlight: item.highlight };
    case "color":
      return { ...base, type: "color", color: item.color };
    case "shape":
      return { ...base, type: "shape", shape: item.shape, width: item.width, height: item.height };
  }
}
