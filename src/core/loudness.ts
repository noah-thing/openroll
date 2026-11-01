// Integrated loudness after ITU-R BS.1770 / EBU R128: K weighting, 400 ms blocks with
// 75% overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below the mean.

import { Biquad, dbToGain } from "./dsp";

export const TARGET_LUFS = -16;

function kWeighting(rate: number): [Biquad, Biquad] {
  // Shelf that models the head, then a high pass that drops rumble.
  const q1 = 0.7071752369554196, f1 = 1681.9744509555319, g = 3.999843853973347;
  const k1 = Math.tan((Math.PI * f1) / rate);
  const vh = dbToGain(g);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k1 / q1 + k1 * k1;
  const shelf = new Biquad(
    (vh + (vb * k1) / q1 + k1 * k1) / a0,
    (2 * (k1 * k1 - vh)) / a0,
    (vh - (vb * k1) / q1 + k1 * k1) / a0,
    (2 * (k1 * k1 - 1)) / a0,
    (1 - k1 / q1 + k1 * k1) / a0,
  );
  const q2 = 0.5003270373238773, f2 = 38.13547087602444;
  const k2 = Math.tan((Math.PI * f2) / rate);
  const d = 1 + k2 / q2 + k2 * k2;
  const high = new Biquad(1, -2, 1, (2 * (k2 * k2 - 1)) / d, (1 - k2 / q2 + k2 * k2) / d);
  return [shelf, high];
}

export class LoudnessMeter {
  private filters: [Biquad, Biquad][];
  private sub: number[] = [];
  private acc = 0;
  private inSub = 0;
  private readonly subLen: number;
  private blocks: number[] = [];
  private readonly doubled: boolean;

  constructor(rate: number, channels: number) {
    this.filters = Array.from({ length: Math.min(channels, 2) }, () => kWeighting(rate));
    this.subLen = Math.round(rate * 0.1);
    // A mono file plays through both speakers, so it is as loud as the same signal in stereo.
    this.doubled = channels === 1;
  }

  /** Feed planar samples; chunks can be any length. */
  push(planes: Float32Array[], frames: number): void {
    const n = this.filters.length;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < n; c++) {
        const [a, b] = this.filters[c];
        const y = b.process(a.process(planes[c][i]));
        this.acc += y * y;
      }
      if (++this.inSub === this.subLen) this.closeSub();
    }
  }

  private closeSub(): void {
    this.sub.push((this.acc * (this.doubled ? 2 : 1)) / this.subLen);
    this.acc = 0;
    this.inSub = 0;
    if (this.sub.length >= 4) {
      const last = this.sub.slice(-4);
      this.blocks.push((last[0] + last[1] + last[2] + last[3]) / 4);
      if (this.sub.length > 8) this.sub.splice(0, this.sub.length - 4);
    }
  }

  /** Integrated loudness in LUFS, or null when the signal is silent or too short. */
  integrated(): number | null {
    return integratedLoudness(this.blocks);
  }
}

const toLufs = (energy: number) => -0.691 + 10 * Math.log10(energy);

export function integratedLoudness(blocks: number[]): number | null {
  const loud = blocks.filter(e => e > 0 && toLufs(e) > -70);
  if (!loud.length) return null;
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length;
  const gate = toLufs(mean) - 10;
  const kept = loud.filter(e => toLufs(e) > gate);
  if (!kept.length) return null;
  return toLufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** Gain in dB that brings a clip at `lufs` to the target, kept within a sane range. */
export function normalizeGainDb(lufs: number, target = TARGET_LUFS): number {
  return Math.max(-24, Math.min(18, target - lufs));
}
