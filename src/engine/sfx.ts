// Sound effects made from nothing: oscillators and noise rendered once through an
// OfflineAudioContext, so there is something to cut to before anyone has a library.

import { encodeWav } from "./wav";

const RATE = 48_000;

export interface SfxDef {
  id: string;
  name: string;
  seconds: number;
  build(ctx: OfflineAudioContext, seconds: number): void;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 99991;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    d[i] = (seed / 2 ** 32) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function bell(ctx: BaseAudioContext, seconds: number, peakAt: number, peak = 1): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(peak, seconds * peakAt);
  g.gain.exponentialRampToValueAtTime(0.0001, seconds);
  return g;
}

export const SFX: SfxDef[] = [
  {
    id: "whoosh",
    name: "Whoosh",
    seconds: 0.9,
    build(ctx, s) {
      const n = noise(ctx, s);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(260, 0);
      f.frequency.exponentialRampToValueAtTime(3600, s * 0.45);
      f.frequency.exponentialRampToValueAtTime(420, s);
      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(-0.7, 0);
      pan.pan.linearRampToValueAtTime(0.7, s);
      n.connect(f).connect(bell(ctx, s, 0.45, 1.4)).connect(pan).connect(ctx.destination);
      n.start();
    },
  },
  {
    id: "click",
    name: "Click",
    seconds: 0.12,
    build(ctx, s) {
      const n = noise(ctx, s);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2400;
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, 0);
      env.gain.exponentialRampToValueAtTime(0.0001, 0.018);
      n.connect(hp).connect(env).connect(ctx.destination);
      n.start();
      const osc = ctx.createOscillator();
      osc.frequency.value = 1900;
      const oe = ctx.createGain();
      oe.gain.setValueAtTime(0.5, 0);
      oe.gain.exponentialRampToValueAtTime(0.0001, 0.03);
      osc.connect(oe).connect(ctx.destination);
      osc.start();
    },
  },
  {
    id: "pop",
    name: "Pop",
    seconds: 0.25,
    build(ctx) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(720, 0);
      osc.frequency.exponentialRampToValueAtTime(110, 0.09);
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, 0);
      env.gain.exponentialRampToValueAtTime(0.0001, 0.2);
      osc.connect(env).connect(ctx.destination);
      osc.start();
    },
  },
  {
    id: "riser",
    name: "Riser",
    seconds: 3,
    build(ctx, s) {
      const n = noise(ctx, s);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(180, 0);
      lp.frequency.exponentialRampToValueAtTime(9000, s * 0.97);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, 0);
      env.gain.exponentialRampToValueAtTime(1, s * 0.96);
      env.gain.linearRampToValueAtTime(0, s);
      n.connect(lp).connect(env).connect(ctx.destination);
      n.start();
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(140, 0);
        osc.frequency.exponentialRampToValueAtTime(1100, s * 0.97);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0);
        g.gain.exponentialRampToValueAtTime(0.18, s * 0.96);
        g.gain.linearRampToValueAtTime(0, s);
        osc.connect(g).connect(ctx.destination);
        osc.start();
      }
    },
  },
  {
    id: "hit",
    name: "Hit",
    seconds: 1.4,
    build(ctx, s) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, 0);
      osc.frequency.exponentialRampToValueAtTime(38, 0.35);
      const body = ctx.createGain();
      body.gain.setValueAtTime(1.2, 0);
      body.gain.exponentialRampToValueAtTime(0.0001, s * 0.8);
      osc.connect(body).connect(ctx.destination);
      osc.start();
      const n = noise(ctx, s);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(5000, 0);
      lp.frequency.exponentialRampToValueAtTime(200, 0.5);
      const crack = ctx.createGain();
      crack.gain.setValueAtTime(0.9, 0);
      crack.gain.exponentialRampToValueAtTime(0.0001, 0.6);
      n.connect(lp).connect(crack).connect(ctx.destination);
      n.start();
    },
  },
];

export async function renderSfx(def: SfxDef): Promise<Uint8Array> {
  const ctx = new OfflineAudioContext(2, Math.ceil(def.seconds * RATE), RATE);
  def.build(ctx, def.seconds);
  const out = await ctx.startRendering();
  const planes = [out.getChannelData(0), out.getChannelData(1)];
  let peak = 0;
  for (const p of planes) for (const v of p) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.85 / peak : 1;
  for (const p of planes) for (let i = 0; i < p.length; i++) p[i] *= gain;
  // a few ms of fade so no effect ends on a click
  const tail = Math.min(planes[0].length, Math.round(0.004 * RATE));
  for (const p of planes) for (let i = 0; i < tail; i++) p[p.length - 1 - i] *= i / tail;
  return encodeWav(planes, RATE);
}
