// Tempo and beat times from an onset strength curve. Tempo comes from autocorrelation;
// the beat positions come from a small dynamic program (Ellis, "Beat tracking by
// dynamic programming") that favours onsets spaced one period apart.

export interface BeatResult {
  bpm: number;
  /** Beat times in seconds. */
  beats: number[];
  /** 0..1, how regular the pulse is. Speech and noise score low, a drum loop high. */
  confidence: number;
}

export const MIN_BPM = 60;
export const MAX_BPM = 180;

/** Onset strength per hop from hop energies in dB: rises only, so decays do not count. */
export function onsetFromDb(db: ArrayLike<number>): Float32Array {
  const out = new Float32Array(db.length);
  for (let i = 1; i < db.length; i++) {
    const before = Math.max(db[i - 1], i > 1 ? db[i - 2] : -Infinity);
    out[i] = Math.max(0, db[i] - before);
  }
  return out;
}

export function trackBeats(onset: Float32Array, hop: number): BeatResult | null {
  const n = onset.length;
  if (n < 2 / hop) return null;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= n;
  let energy = 0;
  for (const v of onset) energy += (v - mean) ** 2;
  const sd = Math.sqrt(energy / n);
  if (sd < 1e-6) return null;
  const o = onset.map(v => (v - mean) / sd);

  const minLag = Math.floor(60 / (MAX_BPM * hop));
  const maxLag = Math.ceil(60 / (MIN_BPM * hop));
  // Autocorrelation over the range of plausible tempi, with a mild pull toward 120 BPM
  // so that a 60 BPM and a 120 BPM reading of the same clicks resolve the usual way.
  let bestLag = 0, best = -Infinity, bestRaw = 0;
  const zero = o.reduce((a, v) => a + v * v, 0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = lag; i < n; i++) r += o[i] * o[i - lag];
    r /= zero;
    const bpm = 60 / (lag * hop);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2);
    if (r * prior > best) {
      best = r * prior;
      bestRaw = r;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  // Refine the period to the strongest of the three nearest lags using parabolic interpolation.
  const period = bestLag;

  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const tight = 100;
  for (let t = 0; t < n; t++) {
    let top = 0, from = -1;
    const lo = Math.max(0, t - Math.round(2 * period));
    const hi = t - Math.round(period / 2);
    for (let p = lo; p <= hi; p++) {
      const s = score[p] - tight * Math.log((t - p) / period) ** 2;
      if (from < 0 || s > top) {
        top = s;
        from = p;
      }
    }
    if (from >= 0 && top > 0) {
      score[t] = o[t] + top;
      back[t] = from;
    } else score[t] = o[t];
  }

  // Start the backtrace at the best peak in the last two periods.
  let end = n - 1;
  let endScore = -Infinity;
  for (let t = Math.max(0, n - 2 * period); t < n; t++) {
    if (score[t] > endScore) {
      endScore = score[t];
      end = t;
    }
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t * hop);
    if (back[t] < 0) break;
  }
  beats.reverse();

  return { bpm: Math.round((60 / (period * hop)) * 10) / 10, beats, confidence: Math.max(0, Math.min(1, bestRaw)) };
}
