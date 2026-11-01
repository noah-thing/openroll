import { describe, expect, it } from "vitest";
import { AudioAnalyzer } from "../../src/core/analyze";
import { LoudnessMeter } from "../../src/core/loudness";
import { trackBeats, onsetFromDb } from "../../src/core/beats";
import { chainPlan, duckCurve, fadeCurve, itemGain, speechRanges, valueAt } from "../../src/core/audio-plan";
import { createProject, type MediaItem, type MediaRef } from "../../src/core/project";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";

const RATE = 48_000;

function clicks(bpm: number, offset: number, seconds: number): Float32Array {
  const out = new Float32Array(RATE * seconds);
  const period = (60 / bpm) * RATE;
  for (let t = offset * RATE; t < out.length - 200; t += period) {
    const i = Math.round(t);
    for (let k = 0; k < 120; k++) out[i + k] = Math.sin((k / 120) * Math.PI * 12) * (1 - k / 120);
  }
  return out;
}

function feed(a: AudioAnalyzer, planes: Float32Array[]) {
  // odd chunk sizes on purpose: the analyzer must not care where chunks end
  for (let i = 0; i < planes[0].length; i += 3333) a.push(planes.map(p => p.subarray(i, i + 3333)), Math.min(3333, planes[0].length - i));
}

describe("loudness", () => {
  it("reads a stereo 1 kHz sine at -23 dBFS as -23 LUFS", () => {
    const n = RATE * 6;
    const sine = new Float32Array(n);
    const amp = 10 ** (-23 / 20);
    for (let i = 0; i < n; i++) sine[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    const m = new LoudnessMeter(RATE, 2);
    m.push([sine, sine], n);
    expect(m.integrated()!).toBeCloseTo(-23, 0);
  });

  it("counts mono as dual mono", () => {
    const n = RATE * 6;
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) sine[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    const mono = new LoudnessMeter(RATE, 1);
    mono.push([sine], n);
    const stereo = new LoudnessMeter(RATE, 2);
    stereo.push([sine, sine], n);
    expect(mono.integrated()!).toBeCloseTo(stereo.integrated()!, 1);
  });

  it("ignores silence between sections through the gate", () => {
    const n = RATE * 10;
    const x = new Float32Array(n);
    for (let i = 0; i < RATE * 3; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    const gated = new LoudnessMeter(RATE, 1);
    gated.push([x], n);
    const solid = new LoudnessMeter(RATE, 1);
    solid.push([x.subarray(0, RATE * 3)], RATE * 3);
    expect(Math.abs(gated.integrated()! - solid.integrated()!)).toBeLessThan(0.3);
  });

  it("returns null for silence", () => {
    const m = new LoudnessMeter(RATE, 1);
    m.push([new Float32Array(RATE * 2)], RATE * 2);
    expect(m.integrated()).toBeNull();
  });
});

describe("beats", () => {
  for (const [bpm, offset] of [[120, 0.13], [90, 0.4], [140, 0.05]] as const) {
    it(`finds ${bpm} BPM clicks`, () => {
      const a = new AudioAnalyzer(RATE, 1);
      feed(a, [clicks(bpm, offset, 16)]);
      const r = a.finish();
      expect(r.bpm).toBeGreaterThan(bpm - 1.5);
      expect(r.bpm).toBeLessThan(bpm + 1.5);
      const truth = Array.from({ length: 10 }, (_, i) => offset + (i * 60) / bpm);
      for (const t of truth) {
        const nearest = Math.min(...r.beats.map(b => Math.abs(b / 1e6 - t)));
        expect(nearest).toBeLessThan(0.03);
      }
    });
  }

  it("locks to the kick, not the off beat hats", () => {
    const bpm = 124, offset = 0.21, period = 60 / bpm;
    const x = new Float32Array(RATE * 20);
    let seed = 5;
    for (let t = offset; t < 19; t += period) {
      const i = Math.round(t * RATE);
      for (let j = 0; j < 0.18 * RATE; j++) x[i + j] += 0.8 * Math.sin((2 * Math.PI * (45 + 120 * Math.exp(-j / (0.04 * RATE))) * j) / RATE) * Math.exp(-j / (0.07 * RATE));
      const h = i + Math.round((period / 2) * RATE);
      for (let j = 0; j < 0.05 * RATE; j++) x[h + j] += 0.25 * ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1) * Math.exp(-j / (0.012 * RATE));
    }
    const a = new AudioAnalyzer(RATE, 1);
    feed(a, [x]);
    const r = a.finish();
    for (let k = 2; k < 12; k++) {
      const truth = offset + k * period;
      expect(Math.min(...r.beats.map(b => Math.abs(b / 1e6 - truth)))).toBeLessThan(0.03);
    }
    const onHat = r.beats.filter(b => Math.abs(((b / 1e6 - offset) / period) % 1 - 0.5) < 0.1).length;
    expect(onHat).toBe(0);
  });

  it("finds nothing in steady noise", () => {
    let seed = 1;
    const noise = Float32Array.from({ length: RATE * 8 }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.2);
    const a = new AudioAnalyzer(RATE, 1);
    feed(a, [noise]);
    expect(a.finish().beats.length).toBe(0);
  });

  it("onset curve only rises on rises", () => {
    expect(Array.from(onsetFromDb([-60, -60, -20, -30, -60]))).toEqual([0, 0, 40, 0, 0]);
  });

  it("rejects clips too short to judge", () => {
    expect(trackBeats(new Float32Array(50), 0.01)).toBeNull();
  });
});

describe("speech", () => {
  function burst(len: number, at: [number, number][]): Float32Array {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
    const x = new Float32Array(RATE * len);
    for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.002;
    for (const [a, b] of at) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) {
      // syllable wobble around 4 Hz over a mid band tone cluster
      const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * (i / RATE));
      x[i] += env * 0.2 * (Math.sin(2 * Math.PI * 500 * (i / RATE)) + Math.sin(2 * Math.PI * 1400 * (i / RATE)) * 0.5);
    }
    return x;
  }

  it("finds talking with pauses and bridges short gaps", () => {
    const a = new AudioAnalyzer(RATE, 1);
    feed(a, [burst(10, [[1, 2.2], [2.4, 3.4], [6, 8]])]);
    const r = a.finish().speech.map(v => v / 1e6);
    expect(r.length).toBe(4);
    expect(r[0]).toBeCloseTo(1, 1);
    expect(r[1]).toBeCloseTo(3.4, 1);
    expect(r[2]).toBeCloseTo(6, 1);
    expect(r[3]).toBeCloseTo(8, 1);
  });

  it("finds none in a flat tone", () => {
    const x = Float32Array.from({ length: RATE * 5 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    const a = new AudioAnalyzer(RATE, 1);
    feed(a, [x]);
    expect(a.finish().speech).toEqual([]);
  });
});

describe("ducking", () => {
  const low = 10 ** (-12 / 20);

  it("dips 12 dB under speech with an attack and a release", () => {
    const curve = duckCurve([[5_000_000, 8_000_000]], 0, 20_000_000);
    expect(valueAt(curve, 1_000_000)).toBe(1);
    expect(valueAt(curve, 6_000_000)).toBeCloseTo(low, 5);
    expect(valueAt(curve, 4_940_000)).toBeGreaterThan(low);
    expect(valueAt(curve, 4_940_000)).toBeLessThan(1);
    expect(valueAt(curve, 8_225_000)).toBeGreaterThan(low);
    expect(valueAt(curve, 9_000_000)).toBe(1);
  });

  it("stays down across short pauses", () => {
    const curve = duckCurve([[1_000_000, 2_000_000], [2_300_000, 3_000_000]], 0, 10_000_000);
    expect(valueAt(curve, 2_150_000)).toBeCloseTo(low, 5);
  });

  it("is flat without speech", () => {
    expect(valueAt(duckCurve([], 0, 5_000_000), 2_000_000)).toBe(1);
  });

  it("maps speech through trim and speed, ignores ducked and muted items", () => {
    const voice: MediaRef = { id: "v", kind: "audio", path: "/v.wav", name: "v", size: 1, mtime: 0, duration: 20_000_000, hasAudio: true, hasVideo: false, speech: [2_000_000, 6_000_000] };
    const music: MediaRef = { ...voice, id: "m", speech: [0, 20_000_000] };
    let p = addMedia(createProject("t"), [voice, music]);
    const v = mediaItem(voice, 10_000_000);
    v.in = 1_000_000;
    v.speed = 2;
    const m = mediaItem(music, 0);
    m.audio = { duckUnder: true };
    p = insertItems(p, [v, m]);
    const target = p.tracks.flatMap(t => t.items).find(i => i.id === m.id) as MediaItem;
    // source 2..6 s with in=1 s and speed 2 lands at 10.5..12.5 s on the timeline
    expect(speechRanges(p, target)).toEqual([[10_500_000, 12_500_000]]);
    const muted = { ...p, tracks: p.tracks.map(t => (t.items.some(i => i.id === v.id) ? { ...t, muted: true } : t)) };
    expect(speechRanges(muted, target)).toEqual([]);
  });
});

describe("item plan", () => {
  const media: MediaRef = { id: "m", kind: "audio", path: "/m.wav", name: "m", size: 1, mtime: 0, duration: 10_000_000, hasAudio: true, hasVideo: false, loudness: -26 };

  it("normalising moves a clip to -16 LUFS", () => {
    const item = mediaItem(media, 0);
    item.audio = { normalize: true };
    expect(20 * Math.log10(itemGain(item, media))).toBeCloseTo(10, 5);
  });

  it("builds a fade envelope", () => {
    const item = mediaItem(media, 2_000_000);
    item.fadeIn = 1_000_000;
    item.fadeOut = 2_000_000;
    const c = fadeCurve(item);
    expect(valueAt(c, 2_000_000)).toBe(0);
    expect(valueAt(c, 2_500_000)).toBeCloseTo(0.5, 5);
    expect(valueAt(c, 5_000_000)).toBe(1);
    expect(valueAt(c, 11_000_000)).toBeCloseTo(0.5, 5);
    expect(valueAt(c, 12_000_000)).toBe(0);
  });

  it("reports the processing an item asks for", () => {
    const item = mediaItem(media, 0);
    item.audio = { denoise: 0.7, voice: true };
    item.voiceFx = "robot";
    expect(chainPlan(item)).toEqual({ denoise: 0.7, voice: true, fx: "robot" });
  });
});
