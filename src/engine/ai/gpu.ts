// The GPU side of the AI visual features that work on pixels every frame: making in between
// frames for slow motion, streaking fast motion, and the denoise and sharpen pass. The
// compositor owns the context and calls in here with source textures; results come back as
// textures it can draw like any other source.

import { compile, makeTexture, Program, Target, type GL } from "../gl";
import { FULL_VS } from "../shaders";
import { ENHANCE_FS, FLOW_FS, FLOW_SMOOTH_FS, GREY_FS, INTERPOLATE_FS } from "./shaders";

export interface SourceTexture {
  tex: WebGLTexture;
  width: number;
  height: number;
  /** Identity of the picture, to know when cached work still applies. */
  id: string;
}

export type TemporalMode = "blend" | "flow" | "streak";

/** A half float render target; the flow field needs sub pixel values the 8 bit targets cannot hold. */
class FloatTarget {
  readonly fbo: WebGLFramebuffer;
  readonly tex: WebGLTexture;
  constructor(private gl: GL, readonly width: number, readonly height: number) {
    this.tex = makeTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.width, this.height);
  }
  dispose(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.tex);
  }
}

interface FlowSet {
  pair: string;
  size: string;
  field: FloatTarget;
  scratch: FloatTarget;
}

export class AiPasses {
  private grey: Program;
  private flow: Program;
  private smooth: Program;
  private interpolateProgram: Program;
  private enhanceProgram: Program;
  private floatOk: boolean;
  private targets = new Map<string, Target>();
  private floats = new Map<string, FloatTarget>();
  private flowCache: FlowSet | null = null;
  /** For the stats overlay and tests: how many flow fields were computed. */
  flowsComputed = 0;

  constructor(private gl: GL) {
    this.floatOk = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
    this.grey = new Program(gl, compile(gl, FULL_VS, GREY_FS));
    this.flow = new Program(gl, compile(gl, FULL_VS, FLOW_FS));
    this.smooth = new Program(gl, compile(gl, FULL_VS, FLOW_SMOOTH_FS));
    this.interpolateProgram = new Program(gl, compile(gl, FULL_VS, INTERPOLATE_FS));
    this.enhanceProgram = new Program(gl, compile(gl, FULL_VS, ENHANCE_FS));
  }

  private target(name: string, w: number, h: number): Target {
    const key = `${name}:${w}x${h}`;
    let t = this.targets.get(key);
    if (!t) {
      // sizes change rarely; keep the pool from growing if a project mixes many clip sizes
      if (this.targets.size > 24) this.clear();
      t = new Target(this.gl, w, h);
      this.targets.set(key, t);
    }
    return t;
  }

  private floatTarget(name: string, w: number, h: number): FloatTarget {
    const key = `${name}:${w}x${h}`;
    let t = this.floats.get(key);
    if (!t) {
      t = new FloatTarget(this.gl, w, h);
      this.floats.set(key, t);
    }
    return t;
  }

  private clear(): void {
    for (const t of this.targets.values()) t.dispose();
    for (const t of this.floats.values()) t.dispose();
    this.targets.clear();
    this.floats.clear();
    this.flowCache = null;
  }

  private quad(): void {
    this.gl.disable(this.gl.BLEND);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  private shrink(src: WebGLTexture, srcW: number, srcH: number, to: Target, reach = 1): void {
    to.bind();
    this.grey.use().i("u_tex", 0).f("u_texel", 1 / srcW, 1 / srcH).f("u_reach", reach);
    this.bindTex(0, src);
    this.quad();
  }

  /** Displacement from a to b, in uv units, kept per pair so playing slowly reuses it. */
  private flowFor(a: SourceTexture, b: SourceTexture): FloatTarget {
    const pair = `${a.id}>${b.id}`;
    const size = `${a.width}x${a.height}`;
    if (this.flowCache && this.flowCache.pair === pair && this.flowCache.size === size) return this.flowCache.field;
    this.flowsComputed++;
    const s1w = Math.max(8, Math.ceil(a.width / 4)), s1h = Math.max(8, Math.ceil(a.height / 4));
    const s2w = Math.max(8, Math.ceil(s1w / 4)), s2h = Math.max(8, Math.ceil(s1h / 4));
    const fw = Math.max(8, Math.ceil(a.width / 8)), fh = Math.max(8, Math.ceil(a.height / 8));
    const hw = Math.max(8, Math.ceil(a.width / 2)), hh = Math.max(8, Math.ceil(a.height / 2));
    const a0 = this.target("a0", hw, hh), b0 = this.target("b0", hw, hh);
    this.shrink(a.tex, a.width, a.height, a0, 0.5);
    this.shrink(b.tex, b.width, b.height, b0, 0.5);
    const a1 = this.target("a1", s1w, s1h), b1 = this.target("b1", s1w, s1h);
    const a2 = this.target("a2", s2w, s2h), b2 = this.target("b2", s2w, s2h);
    this.shrink(a0.tex, hw, hh, a1, 0.5);
    this.shrink(b0.tex, hw, hh, b1, 0.5);
    this.shrink(a1.tex, s1w, s1h, a2);
    this.shrink(b1.tex, s1w, s1h, b2);

    const coarse = this.floatTarget("f0", s2w, s2h);
    const mid = this.floatTarget("f1", fw, fh);
    const fine = this.floatTarget("f2", fw, fh);
    const final = this.floatTarget("f3", fw, fh);
    const run = (to: FloatTarget, ga: Target, gb: Target, guess: FloatTarget | null, radius: number, step: number, tap: number, bias: number) => {
      to.bind();
      this.flow.use().i("u_a", 0).i("u_b", 1).i("u_guess", 2).f("u_texel", 1 / ga.width, 1 / ga.height).i("u_radius", radius).f("u_step", step).f("u_tap", tap).i("u_hasGuess", guess ? 1 : 0).f("u_bias", bias);
      this.bindTex(0, ga.tex);
      this.bindTex(1, gb.tex);
      if (guess) this.bindTex(2, guess.tex);
      this.quad();
    };
    // roughly 80 pixels each way at 1080p, then two refinements around the answer so far
    run(coarse, a2, b2, null, 5, 1, 1, 0.004);
    run(mid, a1, b1, coarse, 3, 2, 2, 0.01);
    run(fine, a0, b0, mid, 2, 1, 2, 0.03);
    // a few soft passes: block matching on water or foliage is noisy, real motion is not
    for (const [from, to] of [[fine, final], [final, fine], [fine, final], [final, fine]] as const) {
      to.bind();
      this.smooth.use().i("u_flow", 0).f("u_texel", 1 / fw, 1 / fh);
      this.bindTex(0, from.tex);
      this.quad();
    }
    this.flowCache = { pair, size, field: fine, scratch: final };
    return fine;
  }

  /** The picture between a and b, `mix` of the way along. `length` only matters for the streak mode. */
  interpolate(a: SourceTexture, b: SourceTexture, mode: TemporalMode, mix: number, length = 0): WebGLTexture {
    const out = this.target("mix", a.width, a.height);
    const useFlow = mode !== "blend" && this.floatOk && a.width === b.width && a.height === b.height;
    const flow = useFlow ? this.flowFor(a, b) : null;
    out.bind();
    this.interpolateProgram
      .use()
      .i("u_a", 0)
      .i("u_b", 1)
      .i("u_flow", 2)
      .f("u_mix", mix)
      .i("u_mode", flow ? (mode === "streak" ? 2 : 1) : 0)
      .f("u_length", length);
    this.bindTex(0, a.tex);
    this.bindTex(1, b.tex);
    if (flow) this.bindTex(2, flow.tex);
    this.quad();
    return out.tex;
  }

  enhance(src: SourceTexture, denoise: number, sharpen: number): WebGLTexture {
    const out = this.target("enh", src.width, src.height);
    out.bind();
    this.enhanceProgram.use().i("u_tex", 0).f("u_texel", 1 / src.width, 1 / src.height).f("u_denoise", denoise).f("u_sharpen", sharpen);
    this.bindTex(0, src.tex);
    this.quad();
    return out.tex;
  }

  dispose(): void {
    this.clear();
  }
}
