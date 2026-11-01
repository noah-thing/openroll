export type GL = WebGL2RenderingContext;

export function compile(gl: GL, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader: ${log}`);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export class Program {
  private locations = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: GL, readonly handle: WebGLProgram) {}

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, l);
    }
    return l;
  }

  f(name: string, ...v: number[]): this {
    const l = this.loc(name);
    if (v.length === 1) this.gl.uniform1f(l, v[0]);
    else if (v.length === 2) this.gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) this.gl.uniform3f(l, v[0], v[1], v[2]);
    else this.gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }

  v3(name: string, values: Float32Array): this {
    this.gl.uniform3fv(this.loc(name), values);
    return this;
  }

  m3(name: string, m: Float32Array): this {
    this.gl.uniformMatrix3fv(this.loc(name), false, m);
    return this;
  }
}

export class Target {
  readonly fbo: WebGLFramebuffer;
  readonly tex: WebGLTexture;

  constructor(private gl: GL, public width: number, public height: number) {
    this.tex = makeTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  clear(r = 0, g = 0, b = 0, a = 0): void {
    this.bind();
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.tex);
  }
}

export function makeTexture(gl: GL): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Column major 3x3, enough for 2D affine transforms. */
export type Mat3 = Float32Array;

export function mat3(): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const o = new Float32Array(9);
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}

export function translate(x: number, y: number): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);
}

export function scale(x: number, y: number): Mat3 {
  return new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);
}

export function rotate(rad: number): Mat3 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
}
