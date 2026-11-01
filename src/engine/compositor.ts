import { compile, makeTexture, multiply, Program, rotate, scale, Target, translate, type GL, type Mat3 } from "./gl";
import { BLEND_FS, BLIT_FS, FULL_VS, LAYER_FS, QUAD_VS, TRANSITION_FS, TRANSITIONS } from "./shaders";
import { BLUR_FS, COPY_FS, EFFECT_FS } from "./effect-shaders";
import { bakeCurves, curvesAreFlat } from "../core/look/curves";
import { effectIndex } from "../core/look/effects";
import { filterPreset } from "../core/look/filters";
import type { BlendMode, ChromaKey, Crop, Curves, Fill, Hsl, Mask } from "../core/project";
import { HSL_BANDS } from "../core/project";

export type Pixels = VideoFrame | ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement;

export interface LayerSource {
  /** Stable identity for texture reuse, e.g. the item id. */
  key: string;
  pixels: Pixels | null;
  /** Bumps whenever `pixels` holds a new picture, so unchanged frames skip the upload. */
  version: number | string;
  /** Size as stored, before any rotation metadata is applied. */
  width: number;
  height: number;
  rotation?: number;
  premultiplied?: boolean;
}

export interface Layer {
  source?: LayerSource;
  color?: [number, number, number];
  /** Centre offset from frame centre and box size, in project pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  crop?: Crop;
  blend?: BlendMode;
  adjust?: Partial<Record<string, number>>;
  filter?: { id: string; amount: number };
  curves?: Curves;
  hsl?: Hsl;
  effects?: LayerEffect[];
  mask?: Mask;
  chroma?: ChromaKey;
  fill?: Fill;
  /** Seconds into the item; moves grain and the time based effects. */
  time?: number;
  radius?: number;
  feather?: number;
}

export interface LayerEffect {
  id: string;
  kind: string;
  amount: number;
  speed: number;
  style: number;
}

export type Node =
  | { kind: "layer"; layer: Layer }
  | { kind: "transition"; a: Layer[]; b: Layer[]; transition: string; progress: number; blend?: BlendMode };

const MASK_SHAPE = { rect: 1, ellipse: 2, linear: 3, mirror: 4 } as const;

interface Feedback {
  prev: Target;
  cur: Target;
  lastT: number;
  dt: number;
  used: number;
}

const BLEND_INDEX: Record<BlendMode, number> = { normal: 0, screen: 1, multiply: 2, overlay: 3, add: 4, lighten: 5, darken: 6 };

interface CachedTexture {
  tex: WebGLTexture;
  version: number | string;
  used: number;
}

export class Compositor {
  readonly gl: GL;
  private layerProgram: Program;
  private blendProgram: Program;
  private transitionProgram: Program;
  private blitProgram: Program;
  private effectProgram: Program;
  private blurProgram: Program;
  private copyProgram: Program;
  private luts = new Map<string, WebGLTexture>();
  private curveTextures = new Map<string, { tex: WebGLTexture; used: number }>();
  private feedback = new Map<string, Feedback>();
  private tiny: Target[] = [];
  private dummyLut!: WebGLTexture;
  private flatCurves!: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private textures = new Map<string, CachedTexture>();
  private acc!: Target;
  private accSwap!: Target;
  private scratch: Target[] = [];
  private frame = 0;
  private projW = 1920;
  private projH = 1080;
  private lost = false;

  constructor(readonly canvas: OffscreenCanvas | HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      desynchronized: true,
    }) as GL | null;
    if (!gl) throw new Error("WebGL2 is not available on this device");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault();
      this.lost = true;
    });

    this.layerProgram = new Program(gl, compile(gl, QUAD_VS, LAYER_FS));
    this.blendProgram = new Program(gl, compile(gl, FULL_VS, BLEND_FS));
    this.transitionProgram = new Program(gl, compile(gl, FULL_VS, TRANSITION_FS));
    this.blitProgram = new Program(gl, compile(gl, FULL_VS, BLIT_FS));
    this.effectProgram = new Program(gl, compile(gl, FULL_VS, EFFECT_FS));
    this.blurProgram = new Program(gl, compile(gl, FULL_VS, BLUR_FS));
    this.copyProgram = new Program(gl, compile(gl, FULL_VS, COPY_FS));

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    this.dummyLut = this.uploadLut(2, new Uint8Array(2 ** 3 * 3));
    this.flatCurves = this.uploadCurves(bakeCurves({}));
    this.resize(canvas.width, canvas.height, 1920, 1080);
  }

  /** Forget trailing effect history, for a picture that did not follow the previous one. */
  resetTrails(): void {
    for (const fb of this.feedback.values()) fb.lastT = -1;
  }

  /** Register a 3D LUT (size^3 RGB bytes, red fastest) under the id filters refer to. */
  registerLut(id: string, size: number, rgb: Uint8Array): void {
    if (this.luts.has(id)) return;
    this.luts.set(id, this.uploadLut(size, rgb));
  }

  private uploadLut(size: number, rgb: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const rgba = new Uint8Array(size ** 3 * 4);
    for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
      rgba[o] = rgb[i];
      rgba[o + 1] = rgb[i + 1];
      rgba[o + 2] = rgb[i + 2];
      rgba[o + 3] = 255;
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return tex;
  }

  private uploadCurves(texels: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = makeTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
    return tex;
  }

  private curvesTexture(c: Curves): WebGLTexture {
    const key = JSON.stringify(c);
    let hit = this.curveTextures.get(key);
    if (!hit) {
      hit = { tex: this.uploadCurves(bakeCurves(c)), used: 0 };
      this.curveTextures.set(key, hit);
    }
    hit.used = this.frame;
    return hit.tex;
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /** Output size in device pixels, and the project's frame size the layers are laid out in. */
  resize(outW: number, outH: number, projW: number, projH: number): void {
    outW = Math.max(2, Math.round(outW));
    outH = Math.max(2, Math.round(outH));
    this.projW = projW;
    this.projH = projH;
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    if (this.acc && this.acc.width === outW && this.acc.height === outH) return;
    this.acc?.dispose();
    this.accSwap?.dispose();
    for (const t of this.scratch) t?.dispose();
    this.scratch = [];
    this.acc = new Target(this.gl, outW, outH);
    this.accSwap = new Target(this.gl, outW, outH);
  }

  render(nodes: Node[], background: [number, number, number]): void {
    if (this.isLost) return;
    const gl = this.gl;
    this.frame++;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    this.acc.clear();

    for (const node of nodes) {
      if (node.kind === "layer") {
        const done = this.needsPasses(node.layer) ? this.renderLayer(node.layer) : this.drawPlain(node.layer);
        this.blendOnto(done, node.layer.blend ?? "normal");
      } else {
        const top = this.borrow(0);
        const a = this.borrow(1);
        const b = this.borrow(2);
        a.clear();
        for (const l of node.a) this.drawInto(l, a);
        b.clear();
        for (const l of node.b) this.drawInto(l, b);
        top.bind();
        const kind = Math.max(0, TRANSITIONS.indexOf(node.transition as never));
        this.transitionProgram.use().i("u_a", 0).i("u_b", 1).f("u_p", clamp01(node.progress)).i("u_kind", kind).f("u_size", top.width, top.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.blendOnto(top, node.blend ?? "normal");
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.blitProgram.use().i("u_tex", 0).f("u_bg", ...background);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.acc.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.evictTextures();
  }

  private borrow(i: number): Target {
    let t = this.scratch[i];
    if (!t) t = this.scratch[i] = new Target(this.gl, this.acc.width, this.acc.height);
    return t;
  }

  private drawPlain(layer: Layer): Target {
    const top = this.borrow(0);
    this.drawLayer(layer, top);
    return top;
  }

  /** Stack a layer onto `into`, which may already hold others (a transition side). */
  private drawInto(layer: Layer, into: Target): void {
    if (!this.needsPasses(layer)) {
      this.drawLayer(layer, into, false);
      return;
    }
    this.copyOver(this.renderLayer(layer), into);
  }

  private needsPasses(layer: Layer): boolean {
    return !!layer.source && (!!layer.fill || !!layer.effects?.some(e => e.amount > 0.001) || (layer.adjust?.sharpen ?? 0) > 0.5);
  }

  /** The layer with its effect stack and fill applied, in one of the scratch targets. */
  private renderLayer(layer: Layer): Target {
    let cur = this.borrow(3), other = this.borrow(4);
    this.drawLayer(layer, cur);
    const t = layer.time ?? 0;
    const passes: LayerEffect[] = [];
    const sharpen = (layer.adjust?.sharpen ?? 0) / 100;
    if (sharpen > 0.005) passes.push({ id: "sharpen", kind: "sharpen", amount: sharpen, speed: 1, style: 0 });
    for (const e of layer.effects ?? []) if (e.amount > 0.001 && effectIndex(e.kind) >= 0) passes.push(e);
    for (const e of passes) {
      this.runEffect(e, layer, cur, other, t);
      [cur, other] = [other, cur];
    }
    return layer.fill ? this.composeFill(layer, cur) : cur;
  }

  private runEffect(e: LayerEffect, layer: Layer, src: Target, dst: Target, t: number): void {
    const gl = this.gl;
    const kind = effectIndex(e.kind);
    const fbKey = `${layer.source?.key ?? ""}:${e.id}`;
    let keep = 0;
    let prev = src;
    if (e.kind === "slow-shutter") {
      const fb = this.feedbackFor(fbKey, src, t);
      prev = fb.prev;
      // Trails fade by time, not by frame, so a 60 fps export matches a 30 fps preview.
      keep = Math.pow(Math.min(0.92, e.amount * 0.95), Math.max(fb.dt, 1 / 120) * 30);
    }
    dst.bind();
    gl.disable(gl.BLEND);
    this.effectProgram
      .use()
      .i("u_tex", 0)
      .i("u_prev", 1)
      .i("u_kind", kind)
      .i("u_style", Math.round(e.style))
      .f("u_amount", e.amount)
      .f("u_t", t * e.speed)
      .f("u_rawT", t)
      .f("u_keep", keep)
      .f("u_size", dst.width, dst.height)
      .f("u_centre", 0.5 + layer.x / this.projW, 0.5 + layer.y / this.projH);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (e.kind === "slow-shutter") this.copy(dst, this.feedback.get(fbKey)!.cur, 1);
  }

  /** Previous output for a trailing effect. Re-rendering the same moment must not add to the trail. */
  private feedbackFor(key: string, src: Target, t: number): Feedback {
    let fb = this.feedback.get(key);
    if (!fb || fb.prev.width !== src.width || fb.prev.height !== src.height) {
      fb?.prev.dispose();
      fb?.cur.dispose();
      fb = { prev: new Target(this.gl, src.width, src.height), cur: new Target(this.gl, src.width, src.height), lastT: -1, dt: 1 / 30, used: 0 };
      this.feedback.set(key, fb);
    }
    fb.used = this.frame;
    const step = t - fb.lastT;
    if (fb.lastT < 0 || step < -1e-4 || step > 0.25) {
      this.copy(src, fb.prev, 1);
      this.copy(src, fb.cur, 1);
      fb.dt = 1 / 30;
    } else if (step > 1e-4) {
      [fb.prev, fb.cur] = [fb.cur, fb.prev];
      fb.dt = step;
    }
    fb.lastT = t;
    return fb;
  }

  private copy(from: Target, to: Target, gain: number): void {
    const gl = this.gl;
    to.bind();
    gl.disable(gl.BLEND);
    this.copyProgram.use().i("u_tex", 0).f("u_gain", gain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private copyOver(from: Target, to: Target): void {
    const gl = this.gl;
    to.bind();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.copyProgram.use().i("u_tex", 0).f("u_gain", 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** Put the layer over a colour or a blurred, enlarged copy of itself. */
  private composeFill(layer: Layer, content: Target): Target {
    const gl = this.gl;
    const out = this.borrow(5);
    const fill = layer.fill!;
    if (fill.mode === "color") {
      const [r, g, b] = hexToRgb(fill.color ?? "#000000");
      out.clear(r * layer.opacity, g * layer.opacity, b * layer.opacity, layer.opacity);
    } else {
      const small = this.tinyTargets();
      const c = layer.crop;
      const boxW = layer.width * (1 - (c?.left ?? 0) - (c?.right ?? 0));
      const boxH = layer.height * (1 - (c?.top ?? 0) - (c?.bottom ?? 0));
      const k = Math.max(this.projW / (boxW || 1), this.projH / (boxH || 1)) * 1.04;
      const backdrop: Layer = { ...layer, x: 0, y: 0, width: layer.width * k, height: layer.height * k, rotation: 0, mask: undefined, chroma: undefined, effects: undefined, fill: undefined, radius: 0, feather: 0 };
      this.drawLayer(backdrop, small[0]);
      // Strength is how many times the soft blur repeats at a tiny size, which is cheap.
      const passes = 1 + Math.round((fill.blur ?? 0.6) * 4);
      for (let i = 0; i < passes; i++) {
        this.blurPass(small[0], small[1], 1 / small[0].width, 0);
        this.blurPass(small[1], small[0], 0, 1 / small[0].height);
      }
      out.bind();
      gl.disable(gl.BLEND);
      this.copyProgram.use().i("u_tex", 0).f("u_gain", 0.62);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, small[0].tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.copyOver(content, out);
    return out;
  }

  private tinyTargets(): Target[] {
    const w = Math.max(16, Math.round(this.acc.width / 8)), h = Math.max(16, Math.round(this.acc.height / 8));
    if (!this.tiny.length || this.tiny[0].width !== w || this.tiny[0].height !== h) {
      for (const t of this.tiny) t.dispose();
      this.tiny = [new Target(this.gl, w, h), new Target(this.gl, w, h)];
    }
    return this.tiny;
  }

  private blurPass(from: Target, to: Target, dx: number, dy: number): void {
    const gl = this.gl;
    to.bind();
    gl.disable(gl.BLEND);
    this.blurProgram.use().i("u_tex", 0).f("u_dir", dx, dy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Draw one layer into `into`. With `clear`, `into` holds only this layer afterwards. */
  private drawLayer(layer: Layer, into: Target, clear = true): void {
    const gl = this.gl;
    if (clear) into.clear();
    else into.bind();
    if (layer.opacity <= 0) return;

    const tex = layer.source ? this.textureFor(layer.source) : null;
    if (layer.source && !tex) return;

    const p = this.layerProgram.use();
    p.m3("u_matrix", this.matrixFor(layer));
    const crop = layer.crop;
    p.f("u_uv", crop?.left ?? 0, crop?.top ?? 0, 1 - (crop?.right ?? 0), 1 - (crop?.bottom ?? 0));
    p.f("u_opacity", layer.opacity).i("u_premultiplied", layer.source?.premultiplied ? 1 : 0);
    const a = layer.adjust ?? {};
    const n = (k: string) => (a[k] ?? 0) / 100;
    p.f("u_g0", n("exposure"), n("contrast"), n("saturation"), n("temperature"));
    p.f("u_g1", n("tint"), n("highlights"), n("shadows"), n("fade"));
    p.f("u_vignette", n("vignette")).f("u_grain", n("grain")).f("u_time", layer.time ?? 0);
    const visW = 1 - (crop?.left ?? 0) - (crop?.right ?? 0), visH = 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0);
    p.f("u_boxPx", layer.width * visW, layer.height * visH);
    p.f("u_tintColor", ...(layer.color ?? [0, 0, 0]), layer.color ? 1 : 0);
    const minSide = Math.min(layer.width, layer.height) || 1;
    p.f("u_radius", (layer.radius ?? 0) / minSide).f("u_feather", (layer.feather ?? 0) / minSide);

    this.setFilter(p, layer);
    const curved = !!layer.curves && !curvesAreFlat(layer.curves);
    p.i("u_curvesOn", curved ? 1 : 0);
    p.i("u_hslOn", this.setHsl(p, layer.hsl) ? 1 : 0);
    const ck = layer.chroma;
    p.i("u_keyOn", ck ? 1 : 0);
    if (ck) p.f("u_keyColor", ...hexToRgb(ck.color)).f("u_keyParams", ck.similarity, ck.smoothness, ck.spill);
    const m = layer.mask;
    p.i("u_maskShape", m ? MASK_SHAPE[m.shape] : 0);
    if (m) p.f("u_maskRect", m.x, m.y, m.width, m.height).f("u_maskParams", (m.rotation * Math.PI) / 180, m.feather, m.invert ? 1 : 0);

    p.i("u_tex", 0).i("u_lut", 1).i("u_curves", 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, curved ? this.curvesTexture(layer.curves!) : this.flatCurves);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Layers inside a transition stack on each other, so they need real alpha blending.
    if (!clear) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  private setFilter(p: Program, layer: Layer): void {
    const gl = this.gl;
    const f = layer.filter;
    let mode = 0;
    let lut = this.dummyLut;
    if (f && f.amount > 0.001) {
      const preset = filterPreset(f.id);
      if (preset) {
        mode = 1;
        const l = preset.look;
        p.f("u_f0", l.exposure ?? 0, l.contrast ?? 0, l.saturation ?? 0, l.temperature ?? 0);
        p.f("u_f1", l.tint ?? 0, l.highlights ?? 0, l.shadows ?? 0, l.fade ?? 0);
        p.f("u_f2", l.vignette ?? 0, l.grain ?? 0, l.mono ?? 0, 0);
        p.f("u_fLow", ...(l.shadowTint ?? [0, 0, 0])).f("u_fHigh", ...(l.highlightTint ?? [0, 0, 0]));
      } else if (this.luts.has(f.id)) {
        mode = 2;
        lut = this.luts.get(f.id)!;
      }
    }
    p.i("u_fMode", mode).f("u_fAmount", Math.min(1, Math.max(0, f?.amount ?? 0)));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lut);
  }

  private hslValues = new Float32Array(24);

  private setHsl(p: Program, hsl: Hsl | undefined): boolean {
    if (!hsl) return false;
    let any = false;
    HSL_BANDS.forEach((band, i) => {
      const v = hsl[band];
      this.hslValues[i * 3] = (v?.hue ?? 0) / 100;
      this.hslValues[i * 3 + 1] = (v?.sat ?? 0) / 100;
      this.hslValues[i * 3 + 2] = (v?.light ?? 0) / 100;
      if (v && (v.hue || v.sat || v.light)) any = true;
    });
    if (any) p.v3("u_hsl[0]", this.hslValues);
    return any;
  }

  private blendOnto(top: Target, mode: BlendMode): void {
    const gl = this.gl;
    this.accSwap.bind();
    this.blendProgram.use().i("u_base", 0).i("u_top", 1).i("u_mode", BLEND_INDEX[mode] ?? 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.acc.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, top.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.acc, this.accSwap] = [this.accSwap, this.acc];
  }

  /**
   * Unit quad to clip space. The box is centred at frame centre + (x, y), rotated, and
   * sized to the visible (cropped) part of the source. Rotation metadata from phones is
   * applied inside, so a portrait clip stored sideways shows upright.
   */
  private matrixFor(layer: Layer): Mat3 {
    const W = this.projW, H = this.projH;
    const projection = new Float32Array([2 / W, 0, 0, 0, -2 / H, 0, -1, 1, 1]);
    const c = layer.crop;
    const visW = 1 - (c?.left ?? 0) - (c?.right ?? 0);
    const visH = 1 - (c?.top ?? 0) - (c?.bottom ?? 0);
    const meta = ((layer.source?.rotation ?? 0) * Math.PI) / 180;
    const sideways = Math.abs(Math.sin(meta)) > 0.5;
    // width/height describe the box as displayed; the stored texture is the other way round when sideways
    const boxW = layer.width * visW, boxH = layer.height * visH;
    const texW = sideways ? boxH : boxW, texH = sideways ? boxW : boxH;
    let m = translate(W / 2 + layer.x, H / 2 + layer.y);
    m = multiply(m, rotate((layer.rotation * Math.PI) / 180));
    if (c) m = multiply(m, translate(((c.left - c.right) / 2) * layer.width, ((c.top - c.bottom) / 2) * layer.height));
    m = multiply(m, rotate(meta));
    m = multiply(m, scale(texW, texH));
    m = multiply(m, translate(-0.5, -0.5));
    return multiply(projection, m);
  }

  private textureFor(src: LayerSource): WebGLTexture | null {
    if (!src.pixels) return this.textures.get(src.key)?.tex ?? null;
    const gl = this.gl;
    let cached = this.textures.get(src.key);
    if (!cached) {
      cached = { tex: makeTexture(gl), version: -1, used: 0 };
      this.textures.set(src.key, cached);
    }
    cached.used = this.frame;
    if (cached.version !== src.version) {
      gl.bindTexture(gl.TEXTURE_2D, cached.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.pixels as TexImageSource);
        cached.version = src.version;
      } catch {
        // A frame closed underneath us (seek during upload). Keep the previous picture.
      }
    }
    return cached.tex;
  }

  private evictTextures(): void {
    if (this.frame % 120) return;
    for (const [key, fb] of this.feedback) {
      if (this.frame - fb.used > 240) {
        fb.prev.dispose();
        fb.cur.dispose();
        this.feedback.delete(key);
      }
    }
    for (const [key, c] of this.curveTextures) {
      if (this.frame - c.used > 600) {
        this.gl.deleteTexture(c.tex);
        this.curveTextures.delete(key);
      }
    }
    for (const [key, t] of this.textures) {
      if (this.frame - t.used > 240) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(key);
      }
    }
  }

  /**
   * Raw RGBA of the last render, rows bottom up, written into `into`. Opaque output is read
   * from the canvas (background already composited); transparent output from the premultiplied
   * accumulator, so the background never lands in it.
   */
  readRaw(transparent: boolean, into: Uint8Array): void {
    const gl = this.gl;
    if (transparent) this.acc.bind();
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, into);
  }

  /** Read the current output back, e.g. for a project thumbnail. */
  snapshot(): ImageData {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    this.acc.bind();
    const px = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // GL rows run bottom up
    const row = w * 4;
    const flipped = new Uint8ClampedArray(px.length);
    for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return new ImageData(flipped, w, h);
  }

  dispose(): void {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    this.textures.clear();
    this.acc?.dispose();
    this.accSwap?.dispose();
    for (const t of this.scratch) t?.dispose();
    for (const t of this.tiny) t.dispose();
    for (const fb of this.feedback.values()) {
      fb.prev.dispose();
      fb.cur.dispose();
    }
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  // "none" means a transparent project background; where it must be drawn, it is black.
  if (!/^#?[0-9a-f]{6}/i.test(hex)) return [0, 0, 0];
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

