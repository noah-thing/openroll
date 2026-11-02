// Shared by the property tests: a seeded random editor, the project it starts from, a list of
// edit steps that each look like something a person (or the UI) can do, and the invariants a
// project must hold after every one of them.

import {
  MIN_ITEM, addMedia, deleteItems, duplicateItems, insertItems, isMagnetic, mediaItem, moveItem, rippleDeleteRange, setSpeed, setTransition, split, trim,
} from "../../src/core/edit";
import {
  closeAllGaps, closeGap, copyItems, freezeFrame, moveGroup, pasteItems, replaceMedia, reverseItems, rippleDeleteItems, rippleTrim, rollTrim, setMagnetic, slip, trimToTime,
} from "../../src/core/timeline-edit";
import { setKey } from "../../src/core/look/keyframes";
import { IDENTITY, createProject, findItem, itemEnd, newId, sourceSpan, type CaptionItem, type Item, type MediaRef, type Project } from "../../src/core/project";

export const S = 1_000_000;

export type Rng = ReturnType<typeof rng>;

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    f: next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
  };
}

const ref = (id: string, seconds: number, kind: MediaRef["kind"] = "video"): MediaRef => ({
  id, kind, path: `/m/${id}`, name: id, size: 1, mtime: 0, duration: seconds * S, hasAudio: kind !== "image", hasVideo: kind !== "audio", width: 1920, height: 1080,
});

function caption(start: number, duration: number): CaptionItem {
  const n = 5;
  const words = Array.from({ length: n }, (_, i) => ({ text: "w" + i, start: Math.floor((duration * i) / n), end: Math.floor((duration * (i + 1)) / n) }));
  return { id: newId("i"), type: "caption", start, duration, transform: { ...IDENTITY }, style: { text: "", font: "Familjen Grotesk", size: 10, weight: 400, color: "#fff", align: "center", lineHeight: 1, letterSpacing: 0 }, words };
}

export function begin(): Project {
  return addMedia(createProject("t"), [ref("a", 10), ref("b", 7), ref("c", 3.3), ref("img", 5, "image"), ref("song", 30, "audio")]);
}

export interface Step {
  name: string;
  run: (p: Project, r: Rng) => Project;
}

const allItems = (p: Project) => p.tracks.flatMap(t => t.items);
const pickItem = (p: Project, r: Rng): Item | undefined => (allItems(p).length ? r.pick(allItems(p)) : undefined);
const someIds = (p: Project, r: Rng, odds: number) => allItems(p).filter(() => r.f() < odds).map(i => i.id);
const timeNear = (p: Project, r: Rng): number => {
  const items = allItems(p);
  const base = items.length && r.f() < 0.7 ? r.pick(items) : undefined;
  const anchor = base ? (r.f() < 0.5 ? base.start : itemEnd(base)) : r.int(0, 20) * S;
  return Math.max(0, anchor + r.pick([0, 0, 1, -1, 49_999, 50_000, 50_001, -50_001, 100_000, -100_000, r.int(-3 * S, 3 * S)]));
};

export const STEPS: Step[] = [
  {
    name: "insert",
    run: (p, r) => {
      const m = r.pick(["a", "b", "c", "img", "song"]);
      const it = mediaItem(p.media[m], timeNear(p, r));
      if (r.f() < 0.3 && p.media[m].kind !== "image") {
        it.in = Math.min(Math.floor(p.media[m].duration / 2), r.int(0, 4) * S);
        it.duration = Math.min(it.duration, p.media[m].duration - it.in);
      }
      return insertItems(p, [it], r.f() < 0.3 ? { index: r.int(0, 4) } : {});
    },
  },
  { name: "insert caption", run: (p, r) => insertItems(p, [caption(timeNear(p, r), r.int(1, 5) * S)]) },
  { name: "move", run: (p, r) => { const it = pickItem(p, r); return it ? moveItem(p, it.id, { trackId: r.pick(p.tracks).id, start: timeNear(p, r) }) : p; } },
  { name: "moveGroup", run: (p, r) => moveGroup(p, someIds(p, r, 0.4), { dt: r.int(-3 * S, 3 * S), slotTime: r.f() < 0.5 ? timeNear(p, r) : undefined }) },
  {
    name: "trim",
    run: (p, r) => {
      const it = pickItem(p, r);
      return it ? trim(p, it.id, r.pick(["start", "end"] as const), r.pick([r.int(-2 * S, 2 * S), r.int(-300_000, 300_000), 10 * S, -10 * S])) : p;
    },
  },
  { name: "rippleTrim", run: (p, r) => { const it = pickItem(p, r); return it ? rippleTrim(p, it.id, r.pick(["start", "end"] as const), r.int(-2 * S, 2 * S)) : p; } },
  {
    name: "rollTrim",
    run: (p, r) => {
      const t = r.pick(p.tracks);
      if (t.items.length < 2) return p;
      const i = r.int(0, t.items.length - 2);
      return rollTrim(p, t.items[i].id, t.items[i + 1].id, r.int(-2 * S, 2 * S));
    },
  },
  { name: "slip", run: (p, r) => { const it = pickItem(p, r); return it ? slip(p, it.id, r.int(-3 * S, 3 * S)) : p; } },
  { name: "split", run: (p, r) => split(p, timeNear(p, r), r.f() < 0.5 ? undefined : someIds(p, r, 0.5)) },
  { name: "delete", run: (p, r) => deleteItems(p, someIds(p, r, 0.25)) },
  { name: "rippleDeleteItems", run: (p, r) => rippleDeleteItems(p, someIds(p, r, 0.25)) },
  {
    name: "rippleDeleteRange",
    run: (p, r) => {
      const a = timeNear(p, r);
      return rippleDeleteRange(p, a, a + r.pick([1, 60_000, 100_000, r.int(0, 3 * S)]));
    },
  },
  { name: "setSpeed", run: (p, r) => { const it = pickItem(p, r); return it ? setSpeed(p, it.id, r.pick([0.25, 0.3, 0.5, 1, 1.5, 2, 3.7, 100])) : p; } },
  { name: "reverse", run: (p, r) => reverseItems(p, someIds(p, r, 0.4)) },
  { name: "freeze", run: (p, r) => { const it = pickItem(p, r); return it ? freezeFrame(p, it.id, timeNear(p, r), { duration: r.pick([S, 2 * S]) }) : p; } },
  { name: "duplicate", run: (p, r) => duplicateItems(p, someIds(p, r, 0.3)) },
  {
    name: "paste",
    run: (p, r) => {
      const clip = copyItems(p, someIds(p, r, 0.4));
      return clip ? pasteItems(p, clip, timeNear(p, r)).project : p;
    },
  },
  { name: "transition", run: (p, r) => { const it = pickItem(p, r); return it ? setTransition(p, it.id, r.f() < 0.8 ? "dissolve" : null, r.pick([50_000, 300_000, S, 5 * S])) : p; } },
  {
    name: "keyframe",
    run: (p, r) => {
      const it = pickItem(p, r);
      if (!it) return p;
      const q = structuredClone(p);
      const tgt = findItem(q, it.id)!.item;
      tgt.keyframes = setKey(tgt.keyframes, r.pick(["transform.scale", "transform.x"]), r.int(0, tgt.duration), r.f() * 3, r.pick(["linear", "ease", "hold"] as const));
      return q;
    },
  },
  { name: "closeGap", run: (p, r) => closeGap(p, r.pick(p.tracks).id, timeNear(p, r)) },
  { name: "closeAllGaps", run: (p, r) => closeAllGaps(p, r.pick(p.tracks).id) },
  { name: "trimToTime", run: (p, r) => trimToTime(p, timeNear(p, r), r.pick(["start", "end"] as const)) },
  { name: "replaceMedia", run: (p, r) => { const it = pickItem(p, r); return it ? replaceMedia(p, it.id, p.media[r.pick(["a", "b", "c"])]) : p; } },
  { name: "magnet", run: (p, r) => setMagnetic(p, p.tracks.find(t => t.main)!.id, r.f() < 0.5) },
];

export function grow(seed: number, steps: number): Project {
  const r = rng(seed);
  let p = begin();
  for (let n = 0; n < steps; n++) p = r.pick(STEPS).run(p, r);
  return p;
}

/** Every rule a valid project follows, as readable complaints. Empty means fine. */
export function check(p: Project): string[] {
  const bad: string[] = [];
  const ids = new Set<string>();
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number" && !Number.isFinite(v)) bad.push(`non finite at ${path}`);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k);
  };
  walk(p, "p");
  for (const t of p.tracks) {
    const sorted = [...t.items].sort((a, b) => a.start - b.start);
    if (t.items.some((it, i) => it !== sorted[i])) bad.push(`track ${t.name} unsorted`);
    let end = 0;
    sorted.forEach((it, i) => {
      if (ids.has(it.id)) bad.push(`duplicate id ${it.id}`);
      ids.add(it.id);
      if (it.start < 0) bad.push(`negative start ${it.start}`);
      if (!Number.isInteger(it.start) || !Number.isInteger(it.duration)) bad.push(`non integer time ${it.start} ${it.duration}`);
      if (it.duration < MIN_ITEM) bad.push(`short item ${it.duration}`);
      if (i > 0 && it.start < end) bad.push(`overlap on ${t.name} by ${end - it.start}`);
      end = Math.max(end, itemEnd(it));
      if (isMagnetic(t) && it.start !== (i ? itemEnd(sorted[i - 1]) : 0)) bad.push(`main not packed at ${i}`);
      if (it.type === "media") {
        const m = p.media[it.mediaId];
        if (!m) bad.push("missing media");
        else if (m.kind !== "image" && !it.freeze) {
          if (it.in < 0) bad.push(`negative in ${it.in}`);
          // the two halves of a split round their spans separately, so one microsecond of slack
          if (it.in + sourceSpan(it) > m.duration + 1) bad.push(`source span past media by ${it.in + sourceSpan(it) - m.duration} (speed ${it.speed}${it.reversed ? " rev" : ""})`);
        } else if (it.in < 0 || it.in > m.duration) bad.push(`freeze or image in out of range ${it.in}`);
      }
      if (it.transitionIn) {
        const prev = sorted[i - 1];
        if (!prev || itemEnd(prev) !== it.start) bad.push("transition on non touching");
        else if (it.transitionIn.duration > Math.min(prev.duration, it.duration) / 2) bad.push(`transition ${it.transitionIn.duration} longer than half of ${Math.min(prev.duration, it.duration)}`);
      }
      if (it.type === "caption") {
        let at = 0;
        for (const w of it.words) {
          if (w.start < at || w.end < w.start) bad.push("caption words out of order");
          if (w.start < 0 || w.end > it.duration) bad.push(`caption word outside item (${w.start} to ${w.end} of ${it.duration})`);
          at = w.start;
        }
      }
    });
  }
  return bad;
}
