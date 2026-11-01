import { compile, makeTexture, multiply, Program, rotate, scale, Target, translate, type GL, type Mat3 } from "./gl";
import { BLEND_FS, BLIT_FS, FULL_VS, LAYER_FS, QUAD_VS, TRANSITION_FS, TRANSITIONS } from "./shaders";
import type { BlendMode, Crop } from "../core/project";

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
  adjust?: Partial<Record<"exposure" | "contrast" | "saturation" | "temperature" | "tint" | "highlights" | "shadows" | "vignette", number>>;
  radius?: number;
  feather?: number;
}

export type Node =
  | { kind: "layer"; layer: Layer }
  | { kind: "transition"; a: Layer[]; b: Layer[]; transition: string; progress: number; blend?: BlendMode };

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

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    this.resize(canvas.width, canvas.height, 1920, 1080);
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
    for (const t of this.scratch) t.dispose();
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
      const top = this.borrow(0);
      if (node.kind === "layer") {
        this.drawLayer(node.layer, top);
        this.blendOnto(top, node.layer.blend ?? "normal");
      } else {
        const a = this.borrow(1);
        const b = this.borrow(2);
        a.clear();
        for (const l of node.a) this.drawLayer(l, a, false);
        b.clear();
        for (const l of node.b) this.drawLayer(l, b, false);
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
    for (const k of ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "vignette"] as const) p.f("u_" + k, (a[k] ?? 0) / 100);
    p.f("u_tintColor", ...(layer.color ?? [0, 0, 0]), layer.color ? 1 : 0);
    const minSide = Math.min(layer.width, layer.height) || 1;
    p.f("u_radius", (layer.radius ?? 0) / minSide).f("u_feather", (layer.feather ?? 0) / minSide);
    p.i("u_tex", 0);
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
    for (const [key, t] of this.textures) {
      if (this.frame - t.used > 240) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(key);
      }
    }
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
    for (const t of this.scratch) t.dispose();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

