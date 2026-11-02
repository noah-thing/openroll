import { describe, expect, it } from "vitest";
import { MIN_ITEM, insertItems, mediaItem, setSpeedRamp, split, trim } from "../../src/core/edit";
import { valueAt } from "../../src/core/animate";
import { History } from "../../src/core/history";
import { setKey } from "../../src/core/look/keyframes";
import { buildScene } from "../../src/core/scene";
import { findItem, itemEnd, sourceTime, type Ease, type Item, type MediaItem, type Project, type SpeedKey } from "../../src/core/project";
import { S, STEPS, begin, check, grow, rng } from "./model-gen";

const SEEDS = Number(process.env.SEEDS ?? 60);
const STEPS_EACH = Number(process.env.STEPS ?? 14);

// Hundreds of full projects per test. A slow CI runner needs more than the 5 s default.
const SLOW = 60_000;

describe("random edit sequences", { timeout: SLOW }, () => {
  it("keep the project valid, never touch their input, and survive a JSON round trip", () => {
    const failures = new Map<string, string>();
    for (const step of STEPS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = rng(seed * 7919 + step.name.length);
        let p = begin();
        for (let n = 0; n < 5; n++) p = STEPS[r.int(0, 1)].run(p, r);
        for (let n = 0; n < STEPS_EACH; n++) {
          const s = r.f() < 0.5 ? step : r.pick(STEPS);
          const before = p;
          const snapshot = JSON.stringify(before);
          p = s.run(p, r);
          if (JSON.stringify(before) !== snapshot) failures.set(`${s.name} mutated its input`, `seed ${seed}`);
          const known = check(before);
          const bad = check(p);
          for (const b of bad) if (!known.includes(b)) failures.set(`${s.name}: ${b.replace(/[-\d.]+/g, "#")}`, `seed ${seed} step ${n} in ${step.name}`);
          if (bad.length) break;
          expect(JSON.parse(JSON.stringify(p))).toEqual(p);
        }
      }
    }
    expect([...failures].map(([k, v]) => `${k} (${v})`)).toEqual([]);
  });
});

describe("history", { timeout: SLOW }, () => {
  it("undo and redo restore each project exactly, through a storm", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const history = new History();
      let p = begin();
      const seen: Project[] = [structuredClone(p)];
      for (let n = 0; n < 25; n++) {
        const next = r.pick(STEPS).run(p, r);
        if (next === p) continue;
        history.push(p, "edit");
        p = next;
        seen.push(structuredClone(p));
      }
      let at = seen.length - 1;
      while (at > 0) {
        p = history.undo(p)!.project;
        at--;
        expect(p).toEqual(seen[at]);
        if (r.f() < 0.2) {
          p = history.redo(p)!.project;
          at++;
          expect(p).toEqual(seen[at]);
          p = history.undo(p)!.project;
          at--;
        }
      }
      expect(history.undo(p)).toBeNull();
    }
  });
});

describe("scene", { timeout: SLOW }, () => {
  const FRAME = Math.round(S / 30);
  const half = (it: Item) => (it.transitionIn ? it.transitionIn.duration / 2 : 0);

  it("shows the item under the playhead on every visible track, with sane transitions", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const p = grow(seed * 31, 30);
      const times = new Set<number>();
      for (const t of p.tracks) for (const it of t.items) for (const base of [it.start, itemEnd(it)]) for (const k of [-2, -1, 0, 1, 2]) times.add(Math.max(0, base + k * FRAME));
      const visualTracks = p.tracks.filter(x => x.kind !== "audio" && !x.hidden);
      for (const t of [...times].sort((a, b) => a - b)) {
        const nodes = buildScene(p, t);
        expect(nodes.length).toBeLessThanOrEqual(visualTracks.length);
        const involved = nodes.flatMap(n => (n.kind === "visual" ? [n.visual.item.id] : [n.a.item.id, n.b.item.id]));
        for (const track of visualTracks) {
          for (const it of track.items.filter(i => t >= i.start && t < itemEnd(i))) {
            if (it.type === "media" && p.media[it.mediaId].kind === "audio") continue;
            expect(involved).toContain(it.id);
          }
        }
        for (const n of nodes) {
          if (n.kind !== "transition") continue;
          expect(n.progress).toBeGreaterThanOrEqual(0);
          expect(n.progress).toBeLessThan(1);
          const next = n.b.item;
          expect(t).toBeGreaterThanOrEqual(next.start - half(next));
          expect(t).toBeLessThan(next.start + half(next));
        }
      }
    }
  });

  it("plays forward clips forward and reversed clips backward", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const p = grow(seed * 17, 30);
      for (const track of p.tracks) {
        for (const it of track.items) {
          if (it.type !== "media" || it.freeze || p.media[it.mediaId].kind !== "video") continue;
          let last: number | null = null;
          for (let t = it.start; t < itemEnd(it); t += FRAME) {
            const node = buildScene(p, t).find(n => (n.kind === "visual" ? n.visual.item.id === it.id : n.a.item.id === it.id || n.b.item.id === it.id));
            if (!node) continue;
            const v = node.kind === "visual" ? node.visual : node.b.item.id === it.id ? node.b : node.a;
            if (v.kind !== "media") continue;
            if (last !== null) expect(it.reversed ? v.sourceTime <= last : v.sourceTime >= last).toBe(true);
            last = v.sourceTime;
          }
        }
      }
    }
  });
});

describe("keyframes on split", { timeout: SLOW }, () => {
  it("both halves start and end on the value the whole had", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      let p = insertItems(begin(), [mediaItem(begin().media.a, 0)]);
      const id = p.tracks[0].items[0].id;
      p = structuredClone(p);
      const target = p.tracks[0].items[0];
      for (let k = 0; k < r.int(1, 4); k++) target.keyframes = setKey(target.keyframes, "transform.x", r.int(0, target.duration), r.int(-500, 500), r.pick<Ease>(["linear", "ease", "easeIn", "hold", [0.2, 0.9, 0.3, 1.2], [0.6, -0.2, 0.9, 1]]));
      const cut = r.int(MIN_ITEM, target.duration - MIN_ITEM);
      const whole = structuredClone(target);
      const q = split(p, cut);
      const left = findItem(q, id)!.item;
      const right = q.tracks[0].items[1];
      for (const [it, limit] of [[left, left.duration], [right, right.duration]] as const) {
        for (const k of it.keyframes?.["transform.x"] ?? []) {
          expect(k.t).toBeGreaterThanOrEqual(0);
          expect(k.t).toBeLessThanOrEqual(limit);
        }
      }
      expect(valueAt(left, "transform.x", left.duration)).toBeCloseTo(valueAt(whole, "transform.x", cut), 6);
      expect(valueAt(right, "transform.x", 0)).toBeCloseTo(valueAt(whole, "transform.x", cut), 6);
      expect(valueAt(left, "transform.x", 0)).toBeCloseTo(valueAt(whole, "transform.x", 0), 6);
      expect(valueAt(right, "transform.x", right.duration)).toBeCloseTo(valueAt(whole, "transform.x", whole.duration), 6);
      // and between the ends they trace the curve the whole had
      for (let i = 1; i < 12; i++) {
        const tl = Math.floor((cut * i) / 12), tr = Math.floor(((right.duration) * i) / 12);
        if (tl < cut) expect(valueAt(left, "transform.x", tl)).toBeCloseTo(valueAt(whole, "transform.x", tl), 4);
        expect(valueAt(right, "transform.x", tr)).toBeCloseTo(valueAt(whole, "transform.x", cut + tr), 4);
      }
    }
  });
});

describe("extreme speed curves", { timeout: SLOW }, () => {
  // Eases that stay inside 0..1, so the curve never leans on the speed limits and a cut can reproduce it exactly.
  let EASES: Ease[] = ["linear", "ease", "easeIn", "easeOut", "hold"];

  /** Timeline microseconds, in source terms at the speed the clip has there. Tables interpolate between cells, which on a steep curve is good to about a tenth of a millisecond. */
  function timelineSlack(item: MediaItem, t: number, micros: number): number {
    const media = 10 * S;
    const speed = Math.abs(sourceTime(item, t + 500, media) - sourceTime(item, t - 500, media)) / 1000;
    return micros * Math.max(1, speed) + 2;
  }

  function wild(seed: number): { p: Project; id: string; whole: MediaItem } {
    const r = rng(seed);
    const keys: SpeedKey[] = Array.from({ length: r.int(2, 24) }, () => ({ x: r.f(), v: r.pick([0.1, 0.25, 4, 100, 1, 2 + r.f() * 6]), ease: r.pick(EASES) }));
    let p = insertItems(begin(), [mediaItem(begin().media.a, 0)]);
    const id = p.tracks[0].items[0].id;
    p = setSpeedRamp(p, id, keys);
    return { p, id, whole: findItem(p, id)!.item as MediaItem };
  }

  it("keep every frame in place when split, wherever the cut falls", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { p, id, whole } = wild(seed);
      if (!whole.ramp) continue;
      const r = rng(seed * 13);
      const media = p.media.a.duration;
      const cut = whole.start + r.int(MIN_ITEM, Math.max(MIN_ITEM, whole.duration - MIN_ITEM));
      const q = split(p, cut);
      if (q === p) continue;
      expect(check(q), `seed ${seed}`).toEqual([]);
      const [a, b] = q.tracks[0].items as MediaItem[];
      for (let i = 0; i < 40; i++) {
        const t = r.f() < 0.3 ? cut + r.int(-60_000, 60_000) : whole.start + r.int(0, whole.duration - 1);
        if (t < whole.start || t >= itemEnd(whole)) continue;
        const item = t < b.start ? a : b;
        expect(Math.abs(sourceTime(item, t, media) - sourceTime(whole, t, media)), `seed ${seed} at ${t - cut} from the cut (${id})`).toBeLessThanOrEqual(timelineSlack(whole, t, 300));
      }
    }
  });

  it("keep the frames that remain when an edge is trimmed", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { p, id, whole } = wild(seed);
      if (!whole.ramp) continue;
      const r = rng(seed * 29);
      const media = p.media.a.duration;
      const edge = r.pick(["start", "end"] as const);
      const q = trim(p, id, edge, edge === "start" ? r.int(1, whole.duration - MIN_ITEM) : -r.int(1, whole.duration - MIN_ITEM));
      const it = findItem(q, id)!.item as MediaItem;
      expect(check(q), `seed ${seed} ${edge} ${JSON.stringify(whole.ramp)} ${whole.duration}`).toEqual([]);
      for (let i = 0; i < 20; i++) {
        const t = it.start + r.int(0, it.duration - 1);
        const was = whole.start + (edge === "start" ? t - it.start + (whole.duration - it.duration) : t - it.start);
        if (was < whole.start || was >= itemEnd(whole)) continue;
        expect(Math.abs(sourceTime(it, t, media) - sourceTime(whole, was, media)), `seed ${seed} ${edge} at ${t - it.start}`).toBeLessThanOrEqual(timelineSlack(whole, was, 300));
      }
    }
  });
});
