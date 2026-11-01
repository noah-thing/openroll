// Small DSP building blocks shared by analysis code. Pure TypeScript so they run in
// workers and in tests.

export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private b0: number, private b1: number, private b2: number, private a1: number, private a2: number) {}

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  /** Second order low or high pass (RBJ cookbook). */
  static pass(kind: "low" | "high", freq: number, rate: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * freq) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const sign = kind === "low" ? 1 : -1;
    const b0 = (1 - sign * cos) / 2 / a0;
    return new Biquad(b0, (sign * (1 - sign * cos)) / a0, b0, (-2 * cos) / a0, (1 - alpha) / a0);
  }
}

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));

export function percentile(values: ArrayLike<number>, p: number): number {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}
