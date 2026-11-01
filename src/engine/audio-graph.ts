// The one place that decides how an item sounds. The live player and the exporter both
// build their per item chains here, which is what keeps playback and export identical.

import { chainPlan, duckCurve, fadeCurve, itemGain, speechRanges, valueAt, type Point } from "../core/audio-plan";
import { dbToGain } from "../core/dsp";
import { itemEnd, type MediaItem, type MediaRef, type Micros, type Project, type VoiceFx } from "../core/project";
import workletUrl from "./worklets/dsp.worklet?worker&url";

/** RNNoise works on 10 ms frames, so cleaned audio trails its source by one frame. */
const DENOISE_LATENCY = 0.01;

/** How the chain converts timeline times into the context's time. */
export interface TimeMap {
  /** Timeline time that is audible first. */
  from: Micros;
  /** Context time for a timeline time. */
  toCtx(t: Micros): number;
  /** Earliest context time automation may be scheduled at. */
  now: number;
}

export interface ItemChain {
  input: AudioNode;
  output: AudioNode;
  /** Seconds the processing delays the signal; sources start this much early. */
  latency: number;
}

export function needsWorklet(item: MediaItem): boolean {
  const plan = chainPlan(item);
  return plan.denoise > 0 || plan.fx === "pitchUp" || plan.fx === "pitchDown";
}

export async function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  await Promise.all([ctx.audioWorklet.addModule(workletUrl), calibrate()]);
}

/** Final stage of every mix: leaves normal levels alone and rounds off overs instead of clipping. */
export function createBus(ctx: BaseAudioContext, destination: AudioNode): AudioNode {
  const shaper = ctx.createWaveShaper();
  const knee = 0.85;
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  shaper.connect(destination);
  return shaper;
}

export function buildChain(ctx: BaseAudioContext, p: Project, item: MediaItem, media: MediaRef, time: TimeMap): ItemChain {
  const plan = chainPlan(item);
  const input = ctx.createGain();
  let tail: AudioNode = input;
  let latency = 0;
  const then = (n: AudioNode) => {
    tail.connect(n);
    tail = n;
  };

  if (plan.denoise > 0) {
    const node = new AudioWorkletNode(ctx, "openroll-rnnoise", { channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2] });
    node.parameters.get("amount")!.value = plan.denoise;
    then(node);
    latency = DENOISE_LATENCY;
  }
  if (plan.voice) tail = enhanceVoice(ctx, tail);
  if (plan.fx) tail = voiceEffect(ctx, tail, plan.fx);

  const level = ctx.createGain();
  automate(level.gain, fadeCurve(item), itemGain(item, media), time);
  tail.connect(level);

  let output: AudioNode = level;
  if (item.audio?.duckUnder) {
    const duck = ctx.createGain();
    const ranges = speechRanges(p, item);
    automate(duck.gain, duckCurve(ranges, item.start, itemEnd(item)), 1, time);
    level.connect(duck);
    output = duck;
  }
  return { input, output, latency };
}

/** Write a piecewise linear curve onto a param, starting from where playback begins. */
function automate(param: AudioParam, points: Point[], scale: number, time: TimeMap): void {
  param.setValueAtTime(valueAt(points, time.from) * scale, time.now);
  points.forEach((pt, i) => {
    if (pt.t <= time.from) return;
    const at = Math.max(time.now, time.toCtx(pt.t));
    // Before the first point the curve is flat, so hold instead of ramping from "now".
    if (i === 0) param.setValueAtTime(pt.g * scale, at);
    else param.linearRampToValueAtTime(pt.g * scale, at);
  });
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, gain = 0, q = 0.7071): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.gain.value = gain;
  f.Q.value = q;
  return f;
}

interface CompressorSpec {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

const LEVELLER: CompressorSpec = { threshold: -26, ratio: 3, attack: 0.012, release: 0.25, knee: 18 };
const SIBILANCE: CompressorSpec = { threshold: -38, ratio: 6, attack: 0.002, release: 0.06, knee: 6 };

/** Makeup gain Chromium adds on its own for each spec, found by measuring a quiet tone. */
const makeup = new Map<CompressorSpec, number>();

function makeCompressor(ctx: BaseAudioContext, spec: CompressorSpec): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = spec.threshold;
  c.ratio.value = spec.ratio;
  c.attack.value = spec.attack;
  c.release.value = spec.release;
  c.knee.value = spec.knee;
  return c;
}

/**
 * Web Audio compressors lift their output to make up for what they take away, and the
 * amount is baked in. Measure it once so the voice toggle changes the sound, not the level.
 */
export async function calibrate(): Promise<void> {
  for (const spec of [LEVELLER, SIBILANCE]) {
    if (makeup.has(spec)) continue;
    const ctx = new OfflineAudioContext(1, 9600, 48_000);
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const quiet = ctx.createGain();
    quiet.gain.value = dbToGain(-80);
    osc.connect(quiet).connect(makeCompressor(ctx, spec)).connect(ctx.destination);
    osc.start();
    const out = (await ctx.startRendering()).getChannelData(0);
    // skip the compressor's lookahead, then compare against the known input level
    let sum = 0;
    for (let i = 4800; i < out.length; i++) sum += out[i] * out[i];
    const rms = Math.sqrt(sum / (out.length - 4800));
    makeup.set(spec, rms / (dbToGain(-80) / Math.SQRT2));
  }
}

/** A compressor followed by the gain that cancels its automatic makeup. */
function compress(ctx: BaseAudioContext, from: AudioNode, spec: CompressorSpec): AudioNode {
  const c = makeCompressor(ctx, spec);
  const trim = ctx.createGain();
  trim.gain.value = 1 / (makeup.get(spec) ?? 1);
  from.connect(c);
  c.connect(trim);
  return trim;
}

/** Rumble filter, presence lift, a gentle leveller and a de-esser. Returns the new tail. */
function enhanceVoice(ctx: BaseAudioContext, from: AudioNode): AudioNode {
  let tail = from;
  for (const n of [biquad(ctx, "highpass", 80), biquad(ctx, "peaking", 250, -2, 1), biquad(ctx, "peaking", 3200, 3.5, 0.9)]) {
    tail.connect(n);
    tail = n;
  }
  tail = compress(ctx, tail, LEVELLER);

  // De-esser: split at 6.5 kHz, squash only the top band, add the halves back. The top
  // band is inverted because a second order low and high pass pair differ by 180 degrees
  // at the crossover, and this makes them sum flat when nothing is being squashed.
  const low = biquad(ctx, "lowpass", 6500);
  const high = biquad(ctx, "highpass", 6500);
  const flip = ctx.createGain();
  flip.gain.value = -1;
  const sum = ctx.createGain();
  // The high pass and leveller take about this much off typical speech; put it back so
  // the toggle changes tone and consistency rather than loudness.
  sum.gain.value = dbToGain(1.3);
  tail.connect(low);
  tail.connect(high);
  low.connect(sum);
  compress(ctx, high, SIBILANCE).connect(flip);
  flip.connect(sum);
  return sum;
}

function voiceEffect(ctx: BaseAudioContext, from: AudioNode, fx: VoiceFx): AudioNode {
  switch (fx) {
    case "pitchUp":
    case "pitchDown": {
      const node = new AudioWorkletNode(ctx, "openroll-pitch", { channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2] });
      node.parameters.get("ratio")!.value = fx === "pitchUp" ? 1.35 : 0.75;
      from.connect(node);
      return node;
    }
    case "robot": {
      // Ring modulation: multiply the voice by a low sine.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 55;
      osc.connect(ring.gain);
      osc.start();
      from.connect(ring);
      const out = ctx.createGain();
      out.gain.value = 1.6;
      ring.connect(out);
      return out;
    }
    case "radio": {
      const chain = [biquad(ctx, "highpass", 600, 0, 0.8), biquad(ctx, "lowpass", 3200, 0, 0.8), biquad(ctx, "peaking", 1800, 6, 1.2)];
      let tail = from;
      for (const n of chain) {
        tail.connect(n);
        tail = n;
      }
      const grit = ctx.createWaveShaper();
      const curve = new Float32Array(1025);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 512) - 1) * 3.2) * 0.8;
      grit.curve = curve;
      tail.connect(grit);
      return grit;
    }
    case "echo": {
      const dry = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.28;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.38;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      const out = ctx.createGain();
      from.connect(dry);
      dry.connect(out);
      from.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(out);
      return out;
    }
    case "bigRoom": {
      const verb = ctx.createConvolver();
      verb.buffer = roomImpulse(ctx);
      const dry = ctx.createGain();
      dry.gain.value = 0.8;
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      const out = ctx.createGain();
      from.connect(dry);
      dry.connect(out);
      from.connect(verb);
      verb.connect(wet);
      wet.connect(out);
      return out;
    }
  }
}

const roomCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A synthetic hall: decaying noise, with a deterministic seed so every render matches. */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const hit = roomCache.get(ctx);
  if (hit) return hit;
  const seconds = 1.8;
  const buf = ctx.createBuffer(2, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 1234 + c * 77;
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 2 ** 32 - 0.5;
      lp += (noise - lp) * 0.55;
      d[i] = lp * Math.exp((-6.9 * i) / d.length) * 2.2;
    }
  }
  roomCache.set(ctx, buf);
  return buf;
}
