// One pass over a file's audio that yields everything the editor wants to know about it
// without decoding twice: integrated loudness, where speech is, and where the beats are.

import { Biquad, percentile } from "./dsp";
import { LoudnessMeter } from "./loudness";
import { onsetFromDb, trackBeats } from "./beats";

export interface AudioAnalysis {
  /** Integrated loudness in LUFS, null for silence. */
  lufs: number | null;
  /** Flat start, end pairs in microseconds where someone is talking. */
  speech: number[];
  beats: number[];
  bpm: number | null;
}

const HOP_SECONDS = 0.01;
/** A pulse this regular is music, so its loud parts are not treated as speech. */
const MUSIC_CONFIDENCE = 0.5;

export class AudioAnalyzer {
  private meter: LoudnessMeter;
  private hp: Biquad;
  private lp: Biquad;
  private hop: number;
  private inHop = 0;
  private accFull = 0;
  private accHigh = 0;
  private accBand = 0;
  private last = 0;
  private fullDb: number[] = [];
  private highDb: number[] = [];
  private bandDb: number[] = [];

  constructor(rate: number, private channels: number) {
    this.meter = new LoudnessMeter(rate, channels);
    this.hop = Math.round(rate * HOP_SECONDS);
    this.hp = Biquad.pass("high", 300, rate);
    this.lp = Biquad.pass("low", 3400, rate);
  }

  push(planes: Float32Array[], frames: number): void {
    this.meter.push(planes, frames);
    const c = this.channels;
    for (let i = 0; i < frames; i++) {
      let m = 0;
      for (let k = 0; k < c; k++) m += planes[k][i];
      m /= c;
      // Pre emphasis lifts clicks and hats above the bass; the plain signal keeps the kick loud.
      const emph = m - 0.97 * this.last;
      this.last = m;
      this.accHigh += emph * emph;
      this.accFull += m * m;
      const b = this.lp.process(this.hp.process(m));
      this.accBand += b * b;
      if (++this.inHop === this.hop) {
        this.fullDb.push(Math.max(-90, 10 * Math.log10(this.accFull / this.hop + 1e-10)));
        this.bandDb.push(Math.max(-90, 10 * Math.log10(this.accBand / this.hop + 1e-10)));
        this.highDb.push(Math.max(-90, 10 * Math.log10(this.accHigh / this.hop + 1e-10)));
        this.accFull = 0;
        this.accHigh = 0;
        this.accBand = 0;
        this.inHop = 0;
      }
    }
  }

  finish(): AudioAnalysis {
    const lufs = this.meter.integrated();
    // Weighting the full band above the highs makes the pulse lock to kicks, not hats.
    const full = onsetFromDb(this.fullDb), high = onsetFromDb(this.highDb);
    const onset = full.map((v, i) => v + 0.5 * high[i]);
    const tempo = trackBeats(onset, HOP_SECONDS);
    const musical = !!tempo && tempo.confidence >= MUSIC_CONFIDENCE;
    const speech = musical ? [] : speechRanges(this.bandDb, HOP_SECONDS);
    return {
      lufs,
      speech: speech.map(s => Math.round(s * 1e6)),
      beats: tempo && tempo.confidence >= 0.3 ? tempo.beats.map(b => Math.round(b * 1e6)) : [],
      bpm: tempo && tempo.confidence >= 0.3 ? tempo.bpm : null,
    };
  }
}

/** Flat start, end pairs in seconds where the voice band stands clear of the noise floor. */
export function speechRanges(db: ArrayLike<number>, hop: number): number[] {
  const n = db.length;
  if (n < 10) return [];
  const floor = percentile(db, 0.1);
  const peak = percentile(db, 0.95);
  if (peak - floor < 15 || peak < -55) return [];
  const threshold = Math.max(floor + 8, floor + 0.4 * (peak - floor));
  const active: boolean[] = Array.from({ length: n }, (_, i) => db[i] > threshold);

  // Words have gaps; bridge pauses shorter than a breath, then drop blips.
  const bridge = Math.round(0.35 / hop);
  const minLength = Math.round(0.2 / hop);
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && active[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const prev = runs[runs.length - 1];
      if (prev && start - prev[1] <= bridge) prev[1] = i;
      else runs.push([start, i]);
      start = -1;
    }
  }
  const out: number[] = [];
  for (const [a, b] of runs) if (b - a >= minLength) out.push(a * hop, b * hop);
  return out;
}
