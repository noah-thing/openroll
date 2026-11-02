import { describe, expect, it } from "vitest";
import { MIN_ITEM, insertItems, mediaItem, setSpeed, setSpeedRamp, split, trim } from "../../src/core/edit";
import { audible } from "../../src/core/audio-plan";
import { buildScene } from "../../src/core/scene";
import { readProject } from "../../src/core/load";
import { findItem, itemEnd, sourceSpan, sourceTime, type Ease, type MediaItem, type Project, type SpeedKey } from "../../src/core/project";
import {
  AUDIO_SPEED_RANGE, averageSpeed, localAtPlayed, normalizeKeys, playedOffset, rampDuration, rampKeepsAudio, rampLocal, rampOffset, rateSteps, reshapeRamp, sliceKeys, speedAt, speedRange,
} from "../../src/core/speed";
import { SPEED_PRESETS } from "../../src/core/speed-presets";
import { S, begin, check, rng, type Rng } from "./model-gen";

function randomKeys(r: Rng): SpeedKey[] {
  const n = r.int(2, 6);
  const xs = [0, ...Array.from({ length: n - 2 }, () => 0.05 + r.f() * 0.9).sort((a, b) => a - b), 1];
  const eases: Ease[] = ["linear", "ease", "easeIn", "easeOut", "hold", [0.3, 0.8, 0.5, 1.2]];
  return xs.map((x, i) => ({ x, v: 0.3 + r.f() * 6, ...(i < n - 1 && r.f() < 0.5 ? { ease: r.pick(eases) } : {}) }));
}

const CURVES: { name: string; keys: SpeedKey[] }[] = [
  ...SPEED_PRESETS.map(p => ({ name: p.id, keys: normalizeKeys(p.keys)! })),
  ...Array.from({ length: 12 }, (_, i) => ({ name: `random ${i}`, keys: normalizeKeys(randomKeys(rng(i + 1)))! })),
];

/** Independent check of the area under 1 / speed, with a plain midpoint sum. */
function referenceTau(keys: SpeedKey[]): number {
  const n = 400_000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 1 / speedAt(keys, (i + 0.5) / n);
  return sum / n;
}

const clip = (keys: SpeedKey[] | null, opts: Partial<MediaItem> = {}): { p: Project; id: string } => {
  const base = begin();
  const it = { ...mediaItem(base.media.a, 0), ...opts };
  let p = insertItems(base, [it]);
  if (keys) p = setSpeedRamp(p, it.id, keys);
  return { p, id: it.id };
};
const get = (p: Project, id: string) => findItem(p, id)!.item as MediaItem;

describe("speed curve time mapping", () => {
  for (const { name, keys } of CURVES) {
    describe(name, () => {
      const span = 8 * S;
      const duration = rampDuration(keys, span);
      const r = { keys, span };

      it("takes the length the area under 1 / speed says", () => {
        expect(duration / span).toBeCloseTo(referenceTau(keys), 3);
        expect(1 / averageSpeed(keys)).toBeCloseTo(referenceTau(keys), 3);
      });

      it("is exact at both ends and never goes backwards", () => {
        expect(rampOffset(r, duration, 0)).toBe(0);
        expect(rampOffset(r, duration, duration)).toBe(span);
        let last = -1;
        for (let i = 0; i <= 2000; i++) {
          const v = rampOffset(r, duration, (duration * i) / 2000);
          expect(v).toBeGreaterThan(last);
          last = v;
        }
      });

      it("has an inverse", () => {
        expect(rampLocal(r, duration, 0)).toBe(0);
        expect(rampLocal(r, duration, span)).toBe(duration);
        for (let i = 1; i < 400; i++) {
          const local = (duration * i) / 400;
          expect(rampLocal(r, duration, rampOffset(r, duration, local))).toBeCloseTo(local, 3);
        }
      });

      it("advances at the speed of the curve", () => {
        // Over a short stretch the source covered divided by the time taken is the speed there.
        for (const f of [0.1, 0.35, 0.6, 0.85]) {
          const local = duration * (1 - 1e-9) * f;
          const x = rampOffset(r, duration, local) / span;
          const h = 20_000;
          const rate = (rampOffset(r, duration, local + h) - rampOffset(r, duration, local - h)) / (2 * h);
          const expected = speedAt(keys, x);
          const [lo, hi] = [speedAt(keys, Math.max(0, x - 0.01)), speedAt(keys, Math.min(1, x + 0.01))].sort((a, b) => a - b);
          expect(rate).toBeGreaterThan(Math.min(expected, lo) * 0.9);
          expect(rate).toBeLessThan(Math.max(expected, hi) * 1.1);
        }
      });

      it("carries on at the edge speed past the ends", () => {
        const tail = rampOffset(r, duration, duration + 1000) - span;
        expect(tail).toBeGreaterThan(0);
        expect(rampOffset(r, duration, -1000)).toBeLessThan(0);
        expect(rampLocal(r, duration, span + tail)).toBeCloseTo(duration + 1000, 3);
      });
    });
  }

  it("a curve with one speed everywhere is plain constant speed", () => {
    const keys: SpeedKey[] = [{ x: 0, v: 2 }, { x: 1, v: 2 }];
    const span = 6 * S;
    const d = rampDuration(keys, span);
    expect(d).toBe(3 * S);
    for (const f of [0.1, 0.5, 0.9]) expect(rampOffset({ keys, span }, d, d * f)).toBeCloseTo(d * f * 2, 3);
  });
});

describe("normalizing keys", () => {
  it("sorts, pins the ends to 0 and 1 and keeps speeds legal", () => {
    const out = normalizeKeys([{ x: 0.7, v: 500 }, { x: 0.2, v: 0.001 }])!;
    expect(out[0].x).toBe(0);
    expect(out.at(-1)!.x).toBe(1);
    expect(out.every(k => k.v >= 0.1 && k.v <= 100)).toBe(true);
    expect(out.map(k => k.x)).toEqual([...out.map(k => k.x)].sort((a, b) => a - b));
  });

  it("merges keys that sit on top of each other and drops garbage", () => {
    expect(normalizeKeys([{ x: 0, v: 1 }, { x: 0.0001, v: 3 }, { x: 1, v: 1 }])).toHaveLength(2);
    expect(normalizeKeys([{ x: NaN, v: 1 }])).toBeNull();
    expect(normalizeKeys([])).toBeNull();
    expect(normalizeKeys([{ x: 0.5, v: 2 }])).toEqual([{ x: 0, v: 2, ease: "linear" }, { x: 0.5, v: 2 }, { x: 1, v: 2 }]);
  });
});

describe("slicing a curve", () => {
  it("evaluates the same inside the cut as the whole did", () => {
    const r = rng(3);
    for (const { keys } of CURVES) {
      for (let n = 0; n < 20; n++) {
        const x0 = r.f() * 0.7, x1 = x0 + 0.1 + r.f() * (0.95 - x0);
        const part = sliceKeys(keys, x0, Math.min(1, x1));
        for (let i = 0; i <= 25; i++) {
          const f = i / 25;
          const x = x0 + f * (Math.min(1, x1) - x0);
          const want = speedAt(keys, x);
          // At the exact key of a held step the two sides disagree by design; stay off the edges.
          if (keys.some(k => Math.abs(k.x - x) < 1e-6)) continue;
          expect(speedAt(part, f)).toBeCloseTo(want, 4);
        }
      }
    }
  });
});

describe("splitting a ramped clip", () => {
  it("leaves two clips that show exactly what the whole showed", () => {
    const r = rng(21);
    for (const { name, keys } of CURVES) {
      for (const reversed of [false, true]) {
        const { p, id } = clip(keys, reversed ? { in: 1 * S, duration: 6 * S, reversed: true } : { in: 1 * S, duration: 6 * S });
        const whole = get(p, id);
        const cut = whole.start + MIN_ITEM + Math.floor(r.f() * (whole.duration - 2 * MIN_ITEM));
        const q = split(p, cut);
        expect(q).not.toBe(p);
        expect(check(q)).toEqual([]);
        const [a, b] = q.tracks[0].items as MediaItem[];
        expect(a.duration + b.duration).toBe(whole.duration);
        expect(sourceSpan(a) + sourceSpan(b)).toBe(sourceSpan(whole));
        if (reversed) expect(a.in).toBe(b.in + sourceSpan(b));
        else expect(b.in).toBe(a.in + sourceSpan(a));
        const media = q.media.a.duration;
        for (let i = 0; i <= 60; i++) {
          const t = Math.min(itemEnd(whole) - 1, whole.start + Math.floor((whole.duration * i) / 60));
          const item = t < b.start ? a : b;
          const got = sourceTime(item, t, media);
          const want = sourceTime(whole, t, media);
          expect(Math.abs(got - want), `${name} ${reversed ? "reversed " : ""}at ${t}`).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it("keeps working when split again and again", () => {
    const { p, id } = clip(SPEED_PRESETS[1].keys, { duration: 8 * S });
    let q = p;
    const whole = get(p, id);
    for (const f of [0.5, 0.25, 0.8, 0.4, 0.62]) q = split(q, Math.floor(whole.duration * f * 0.98));
    expect(check(q)).toEqual([]);
    const pieces = q.tracks[0].items as MediaItem[];
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.reduce((n, it) => n + sourceSpan(it), 0)).toBe(sourceSpan(whole));
  });
});

describe("trimming a ramped clip", () => {
  it("cutting the end or start keeps every remaining frame where it was", () => {
    for (const { name, keys } of CURVES) {
      for (const edge of ["start", "end"] as const) {
        const { p, id } = clip(keys, { in: 0, duration: 8 * S });
        const whole = get(p, id);
        const cutBy = Math.floor(whole.duration * 0.3);
        const q = trim(p, id, edge, edge === "start" ? cutBy : -cutBy);
        const it = get(q, id);
        expect(check(q)).toEqual([]);
        expect(it.duration).toBe(whole.duration - cutBy);
        for (let i = 0; i < 40; i++) {
          // Times in the whole's frame; the start trim also moves the clip left on the main track.
          const local = Math.floor((it.duration * (i + 0.5)) / 40);
          const was = whole.start + (edge === "start" ? cutBy : 0) + local;
          const got = sourceTime(it, it.start + local, q.media.a.duration);
          const want = sourceTime(whole, was, p.media.a.duration);
          expect(Math.abs(got - want), `${name} ${edge}`).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it("growing the end plays on at the speed the end had", () => {
    const keys: SpeedKey[] = [{ x: 0, v: 1 }, { x: 0.5, v: 2 }, { x: 1, v: 2 }];
    const { p, id } = clip(keys, { in: 0, duration: 4 * S });
    const before = get(p, id);
    const q = trim(p, id, "end", 1 * S);
    const it = get(q, id);
    expect(it.duration).toBe(before.duration + 1 * S);
    expect(sourceSpan(it) - sourceSpan(before)).toBeGreaterThan(1.8 * S);
    expect(sourceSpan(it) - sourceSpan(before)).toBeLessThan(2.2 * S);
    expect(check(q)).toEqual([]);
  });

  it("will not grow past the footage there is", () => {
    const { p, id } = clip(SPEED_PRESETS[0].keys, { in: 0, duration: 8 * S });
    const q = trim(p, id, "end", 60 * S);
    expect(check(q)).toEqual([]);
    const it = get(q, id);
    expect(it.in + sourceSpan(it)).toBeLessThanOrEqual(q.media.a.duration + 1);
  });

  it("a reshape that removes nothing leaves the curve as it was", () => {
    const r = { keys: normalizeKeys(SPEED_PRESETS[1].keys)!, span: 5 * S };
    const d = rampDuration(r.keys, r.span);
    const same = reshapeRamp(r, d, 0, 0);
    expect(same.ramp).toEqual(r);
    expect(same.headSpan).toBe(0);
    expect(same.tailSpan).toBe(0);
  });
});

describe("setting a curve", () => {
  it("makes the length follow the curve and keeps the footage", () => {
    for (const { keys } of CURVES) {
      const { p, id } = clip(null, { in: 2 * S, duration: 6 * S });
      const span = sourceSpan(get(p, id));
      const q = setSpeedRamp(p, id, keys);
      const it = get(q, id);
      expect(sourceSpan(it)).toBe(span);
      expect(it.in).toBe(2 * S);
      expect(it.duration).toBe(Math.max(MIN_ITEM, rampDuration(keys, span)));
      expect(it.speed).toBeCloseTo(span / it.duration, 9);
      expect(check(q)).toEqual([]);
    }
  });

  it("stores a curve that is the same everywhere as a plain speed, and clearing keeps the average", () => {
    const { p, id } = clip(null, { duration: 6 * S });
    const flat = setSpeedRamp(p, id, [{ x: 0, v: 2 }, { x: 1, v: 2 }]);
    expect(get(flat, id).ramp).toBeUndefined();
    expect(get(flat, id).speed).toBe(2);
    expect(get(flat, id).duration).toBe(3 * S);
    const ramped = setSpeedRamp(p, id, SPEED_PRESETS[0].keys, "montage");
    expect(get(ramped, id).ramp?.preset).toBe("montage");
    const cleared = setSpeedRamp(ramped, id, null);
    expect(get(cleared, id).ramp).toBeUndefined();
    expect(Math.abs(get(cleared, id).duration - get(ramped, id).duration)).toBeLessThanOrEqual(1);
  });

  it("a steady speed replaces the curve and keeps the footage", () => {
    const { p, id } = clip(SPEED_PRESETS[2].keys, { duration: 8 * S });
    const span = sourceSpan(get(p, id));
    const q = setSpeed(p, id, 2);
    expect(get(q, id).ramp).toBeUndefined();
    expect(sourceSpan(get(q, id))).toBe(span);
    expect(get(q, id).duration).toBe(Math.round(span / 2));
  });

  it("refuses stills, images and unknown clips", () => {
    const { p, id } = clip(null, { freeze: true });
    expect(setSpeedRamp(p, id, SPEED_PRESETS[0].keys)).toBe(p);
    const img = insertItems(begin(), [mediaItem(begin().media.img, 0)]);
    expect(setSpeedRamp(img, img.tracks[0].items[0].id, SPEED_PRESETS[0].keys)).toBe(img);
    expect(setSpeedRamp(p, "nope", SPEED_PRESETS[0].keys)).toBe(p);
  });

  it("reversed clips play the curve in playing order, backwards through the footage", () => {
    const keys: SpeedKey[] = [{ x: 0, v: 4 }, { x: 1, v: 0.5 }];
    const { p, id } = clip(keys, { in: 1 * S, duration: 6 * S, reversed: true });
    const it = get(p, id);
    const m = p.media.a.duration;
    expect(sourceTime(it, it.start, m)).toBe(it.in + sourceSpan(it));
    expect(sourceTime(it, itemEnd(it), m)).toBe(it.in);
    const early = sourceTime(it, it.start + 0.1 * S, m);
    const late = sourceTime(it, itemEnd(it) - 0.1 * S, m);
    // Fast at first, slow at the end: the first tenth of a second covers more footage than the last.
    expect(it.in + sourceSpan(it) - early).toBeGreaterThan(late - it.in);
  });
});

describe("what the scene shows", () => {
  it("asks for the source time the curve gives, to the microsecond", () => {
    const { p, id } = clip(SPEED_PRESETS[0].keys, { in: 1 * S, duration: 8 * S });
    const it = get(p, id);
    for (let i = 0; i < it.duration; i += 37_000) {
      const node = buildScene(p, it.start + i)[0];
      if (node.kind !== "visual" || node.visual.kind !== "media") throw new Error("expected media");
      const expected = Math.round(it.in + Math.round(rampOffset(it.ramp!, it.duration, i)));
      expect(node.visual.sourceTime).toBe(Math.min(expected, p.media.a.duration - 1));
    }
  });

  it("is untouched for a clip with a steady speed", () => {
    const { p, id } = clip(null, { in: 1 * S, duration: 4 * S, speed: 1.5 });
    const it = get(p, id);
    for (let i = 0; i < it.duration; i += 41_000) {
      const node = buildScene(p, it.start + i)[0];
      if (node.kind !== "visual" || node.visual.kind !== "media") throw new Error("expected media");
      expect(node.visual.sourceTime).toBe(it.in + Math.round(i * 1.5));
    }
    expect(playedOffset(it, 12345)).toBe(12345 * 1.5);
    expect(localAtPlayed(it, 12345)).toBe(12345 / 1.5);
  });
});

describe("sound on a ramped clip", () => {
  it("steps follow the curve and add up to the footage they cover", () => {
    const { p, id } = clip(SPEED_PRESETS[0].keys, { in: 1 * S, duration: 8 * S });
    const it = get(p, id);
    const from = 1.5, to = 2.5;
    const steps = rateSteps(it, from, to);
    expect(steps.length).toBeGreaterThan(5);
    const timelineLength = (localAtPlayed(it, to * 1e6 - it.in) - localAtPlayed(it, from * 1e6 - it.in)) / 1e6;
    let covered = 0;
    steps.forEach((s, i) => covered += s.rate * ((i + 1 < steps.length ? steps[i + 1].at : timelineLength) - s.at));
    expect(covered).toBeCloseTo(to - from, 4);
  });

  it("is kept while the curve stays in range and silenced outside it", () => {
    expect(speedRange(normalizeKeys(SPEED_PRESETS[0].keys)!)).toEqual([0.4, 3]);
    const mild = clip(SPEED_PRESETS[0].keys);
    const wild = clip(SPEED_PRESETS[2].keys);
    expect(rampKeepsAudio(get(mild.p, mild.id).ramp!)).toBe(true);
    expect(rampKeepsAudio(get(wild.p, wild.id).ramp!)).toBe(false);
    expect(audible(get(mild.p, mild.id), mild.p.media.a)).toBe(true);
    expect(audible(get(wild.p, wild.id), wild.p.media.a)).toBe(false);
    expect(AUDIO_SPEED_RANGE).toEqual([0.25, 4]);
  });
});

describe("curves with a steep stretch or a jump close to a cut", () => {
  it("measures a 0.1 to 100 ramp over a narrow stretch to within a hair", () => {
    const keys: SpeedKey[] = [{ x: 0, v: 100 }, { x: 0.45, v: 100, ease: "linear" }, { x: 0.5, v: 0.1, ease: "linear" }, { x: 0.55, v: 100 }, { x: 1, v: 100 }];
    expect(1 / averageSpeed(keys) / referenceTau(keys)).toBeCloseTo(1, 3);
  });

  it("splitting just after a hold jump keeps the last frames on the new speed", () => {
    const keys: SpeedKey[] = [{ x: 0, v: 3, ease: "hold" }, { x: 0.5, v: 1, ease: "hold" }, { x: 1, v: 1 }];
    const { p, id } = clip(keys, { in: 0, duration: 10 * S });
    const whole = get(p, id);
    const jump = whole.start + rampLocal(whole.ramp!, whole.duration, whole.ramp!.span / 2);
    // 10 ms past the jump is inside the merge distance keys used to have on a ten second span.
    const q = split(p, Math.round(jump) + 10_000);
    expect(q).not.toBe(p);
    const a = q.tracks[0].items[0] as MediaItem;
    const media = q.media.a.duration;
    for (const t of [a.start + a.duration - 8_000, a.start + a.duration - 1]) {
      expect(Math.abs(sourceTime(a, t, media) - sourceTime(whole, t, media))).toBeLessThanOrEqual(12);
    }
  });
});

describe("curves with a lot of points", () => {
  const busy = (): SpeedKey[] => Array.from({ length: 24 }, (_, i) => ({ x: 0.02 + i * 0.04, v: i % 2 ? 3 : 0.5, ease: "linear" as const }));

  it("keep their shape when a clip is trimmed after the end points were added", () => {
    const { p, id } = clip(busy(), { duration: 9 * S });
    const whole = get(p, id);
    expect(whole.ramp!.keys.length).toBeGreaterThan(24);
    const q = trim(p, id, "end", -100_000);
    const cut = get(q, id);
    expect(check(q)).toEqual([]);
    for (let i = 0; i < 30; i++) {
      const t = Math.floor((cut.duration * i) / 30);
      expect(Math.abs(sourceTime(cut, t, q.media.a.duration) - sourceTime(whole, t, q.media.a.duration))).toBeLessThanOrEqual(300);
    }
  });

  it("are not changed by saving and opening the project", () => {
    const { p } = clip(busy(), { duration: 9 * S });
    const r = readProject(JSON.stringify(trim(p, p.tracks[0].items[0].id, "end", -2 * S)));
    expect(r.ok && r.repairs).toEqual([]);
    expect(r.ok && r.project.tracks[0].items[0]).toEqual(trim(p, p.tracks[0].items[0].id, "end", -2 * S).tracks[0].items[0]);
  });
});
