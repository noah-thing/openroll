// One fragment program for every effect. The kind numbers follow EFFECTS in
// core/look/effects.ts. The input is a layer rendered at output size with premultiplied
// alpha, so colour maths unpremultiplies first and blur style maths does not need to.

export const EFFECT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_prev; // slow shutter: the previous result
uniform int u_kind;
uniform int u_style;
uniform float u_amount;
uniform float u_t;       // seconds, already multiplied by speed
uniform float u_rawT;    // seconds
uniform float u_keep;    // slow shutter: how much of the previous frame survives
uniform vec2 u_size;     // target size in pixels
uniform vec2 u_centre;   // layer centre in uv
out vec4 outColor;

const float PI = 3.14159265;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wob(float x) { return sin(x * 1.7) + 0.6 * sin(x * 2.9 + 1.3) + 0.3 * sin(x * 5.3 + 4.1); }
float scaleK() { return u_size.y / 1080.0; }

vec4 S(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(u_tex, uv);
}
vec3 unp(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
vec4 pre(vec3 rgb, float a) { return vec4(rgb * a, a); }

vec4 spiralBlur(vec2 uv, float radiusPx, int n) {
  vec4 acc = vec4(0.0);
  float tot = 0.0;
  for (int i = 0; i < 40; i++) {
    if (i >= n) break;
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(n));
    float a = fi * 2.39996;
    acc += S(uv + vec2(cos(a), sin(a)) * r * radiusPx / u_size);
    tot += 1.0;
  }
  return acc / tot;
}

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
vec2 aspectFix() { return vec2(u_size.x / u_size.y, 1.0); }

void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_tex, uv);
  vec4 o = src;
  float A = u_amount;

  if (u_kind == 0) { // defocus
    o = spiralBlur(uv, A * 0.05 * u_size.y, 36);
  } else if (u_kind == 1) { // rush
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 20; i++) {
      float k = float(i) / 19.0;
      acc += S(u_centre + (uv - u_centre) * (1.0 - A * 0.3 * k));
    }
    o = acc / 20.0;
  } else if (u_kind == 2) { // handheld
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 5; i++) {
      float tt = u_t * 7.0 + float(i) * 0.045;
      vec2 off = vec2(wob(tt), wob(tt + 17.0)) * 0.012 * A;
      float ang = wob(tt + 31.0) * 0.012 * A;
      vec2 p = (rot((uv - 0.5) * aspectFix(), ang) / aspectFix()) + 0.5 + off;
      acc += S(p / (1.0 + 0.06 * A) + 0.5 * (1.0 - 1.0 / (1.0 + 0.06 * A)));
    }
    o = acc / 5.0;
  } else if (u_kind == 3) { // tear
    float slot = floor(u_t * 9.0);
    float burst = step(0.55, hash11(slot * 1.7));
    float row = floor(uv.y * 28.0);
    float h = hash12(vec2(row, slot));
    float shift = (h > 0.78 ? (h - 0.78) * 4.5 : 0.0) * (hash12(vec2(row, slot + 9.0)) > 0.5 ? 1.0 : -1.0);
    shift *= 0.18 * A * burst;
    float split = 0.012 * A * (0.3 + burst);
    vec4 r = S(uv + vec2(shift + split, 0.0));
    vec4 g = S(uv + vec2(shift, 0.0));
    vec4 b = S(uv + vec2(shift - split, 0.0));
    o = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  } else if (u_kind == 4) { // prism
    float ang = u_t * 2.0;
    vec2 d = vec2(cos(ang), sin(ang)) * 0.022 * A / aspectFix();
    vec4 r = S(uv + d), g = S(uv), b = S(uv - d);
    o = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  } else if (u_kind == 5) { // emulsion
    vec3 c = unp(src);
    vec2 cell = floor(uv * u_size / max(1.0, 1.6 * scaleK()));
    float n = hash12(cell + floor(u_rawT * 24.0) * 13.0) + hash12(cell * 1.7 + 5.0 + floor(u_rawT * 24.0)) - 1.0;
    float l = luma(c);
    c += n * A * 0.35 * (0.4 + 0.6 * (1.0 - abs(l * 2.0 - 1.0)));
    o = pre(clamp(c, 0.0, 1.0), src.a);
  } else if (u_kind == 6) { // tape
    float slot = floor(u_t * 14.0);
    float rowBand = floor(uv.y * 90.0);
    float jit = (hash12(vec2(rowBand, slot)) - 0.5) * 0.004 * A;
    float track = smoothstep(0.0, 0.05, 0.05 - abs(uv.y - fract(1.0 - u_t * 0.18)));
    float wobble = sin(uv.y * 40.0 + u_t * 6.0) * 0.0016 * A + track * 0.02 * A * sin(uv.y * 300.0);
    vec2 p = vec2(uv.x + jit + wobble, uv.y);
    float bleed = 0.0045 * A;
    vec4 r = S(p + vec2(bleed, 0.0)), g = S(p), b = S(p - vec2(bleed, 0.0));
    vec3 c = vec3(r.r, g.g, b.b);
    float a = max(r.a, max(g.a, b.a));
    c = unp(vec4(c, 1.0)) * a;
    float line = 0.9 + 0.1 * sin(uv.y * u_size.y * PI / max(1.0, 2.0 * scaleK()));
    c *= mix(1.0, line, A);
    float n = hash12(floor(uv * u_size / 2.0) + slot * 7.0);
    c += (n - 0.5) * 0.08 * A * a;
    c += track * 0.18 * A * a;
    c = mix(c, vec3(luma(c)) * vec3(1.05, 1.0, 0.95), 0.18 * A);
    o = vec4(c, a);
  } else if (u_kind == 7) { // sun leak
    vec3 c = unp(src);
    float t = u_t;
    vec2 p1 = vec2(0.15 + 0.35 * sin(t * 0.9), 0.35 + 0.3 * cos(t * 0.7));
    vec2 p2 = vec2(0.9 - 0.3 * cos(t * 0.6 + 1.0), 0.1 + 0.4 * sin(t * 0.8 + 2.0));
    vec2 q = (uv - p1) * aspectFix();
    vec2 q2 = (uv - p2) * aspectFix();
    float g1 = exp(-dot(q, q) * 2.2);
    float g2 = exp(-dot(q2, q2) * 3.0);
    vec3 warm = vec3(1.0, 0.42, 0.12) * g1 + vec3(1.0, 0.12, 0.35) * g2 + vec3(1.0, 0.8, 0.4) * g1 * g1 * 0.8;
    float breathe = 0.65 + 0.35 * sin(t * 1.6);
    vec3 leak = warm * breathe * A * 1.15;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(leak, 0.0, 1.0));
    o = pre(c, src.a);
  } else if (u_kind == 8) { // strobe
    float f = exp(-fract(u_t) * 7.0);
    vec3 c = unp(src);
    c = mix(c, vec3(1.0), f * A);
    o = pre(c, src.a);
  } else if (u_kind == 9) { // thump
    float ph = fract(u_t);
    float punch = exp(-ph * 8.0) * (1.0 - exp(-ph * 90.0));
    float z = 1.0 + A * 0.2 * punch;
    vec2 p = u_centre + (uv - u_centre) / z;
    float split = 0.006 * A * punch;
    vec4 r = S(p + (p - u_centre) * split * 4.0), g = S(p), b = S(p - (p - u_centre) * split * 4.0);
    o = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  } else if (u_kind == 10) { // mosaic
    float block = 2.0 + A * 70.0;
    block *= scaleK();
    vec2 cell = floor(uv * u_size / block);
    o = S((cell + 0.5) * block / u_size);
  } else if (u_kind == 11) { // mirror
    vec2 p = uv;
    vec2 c = u_centre;
    if (u_style == 0) p.x = p.x > c.x ? 2.0 * c.x - p.x : p.x;
    else if (u_style == 1) p.x = p.x < c.x ? 2.0 * c.x - p.x : p.x;
    else if (u_style == 2) p.y = p.y > c.y ? 2.0 * c.y - p.y : p.y;
    else if (u_style == 3) p.y = p.y < c.y ? 2.0 * c.y - p.y : p.y;
    else p = c - abs(uv - c);
    o = mix(src, S(p), A);
  } else if (u_kind == 12) { // kaleido
    float n = u_style == 0 ? 4.0 : (u_style == 1 ? 6.0 : 8.0);
    vec2 d = (uv - u_centre) * aspectFix();
    float r = length(d);
    float a = atan(d.y, d.x) + u_t * 0.5;
    float seg = 2.0 * PI / n;
    a = abs(mod(a, seg) - seg * 0.5);
    vec2 k = vec2(cos(a), sin(a)) * r / aspectFix();
    k = rot(k * aspectFix(), -u_t * 0.5) / aspectFix();
    vec2 q = u_centre + k;
    q = 1.0 - abs(1.0 - mod(q, 2.0));
    o = mix(src, texture(u_tex, q), A);
  } else if (u_kind == 13) { // heartbeat
    float ph = fract(u_t);
    float beat = exp(-ph * 9.0) + 0.6 * exp(-abs(ph - 0.28) * 14.0);
    vec2 d = (uv - 0.5) * aspectFix();
    float v = smoothstep(0.25, 0.95, length(d));
    float k = A * v * (0.25 + 0.75 * clamp(beat, 0.0, 1.0));
    vec3 c = unp(src) * (1.0 - k);
    o = pre(c, src.a);
  } else if (u_kind == 14) { // neon edge
    vec2 px = 1.0 / u_size;
    float tl = luma(unp(S(uv + px * vec2(-1, -1)))), t = luma(unp(S(uv + px * vec2(0, -1)))), tr = luma(unp(S(uv + px * vec2(1, -1))));
    float l = luma(unp(S(uv + px * vec2(-1, 0)))), r = luma(unp(S(uv + px * vec2(1, 0))));
    float bl = luma(unp(S(uv + px * vec2(-1, 1)))), b = luma(unp(S(uv + px * vec2(0, 1)))), br = luma(unp(S(uv + px * vec2(1, 1))));
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float e = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0);
    vec3 hue = 0.55 + 0.45 * cos(2.0 * PI * (vec3(0.0, 0.33, 0.67) + u_t * 0.5 + uv.x * 0.4));
    vec3 c = unp(src);
    c = mix(c, c * 0.35, A * 0.7) + hue * e * A * 1.6;
    o = pre(clamp(c, 0.0, 1.0), src.a);
  } else if (u_kind == 15) { // mono strobe
    float on = step(0.5, fract(u_t));
    vec3 c = unp(src);
    float l = luma(c);
    vec3 bw = vec3(u_style == 1 ? 1.0 - l : l);
    bw = (bw - 0.5) * 1.5 + 0.5;
    c = mix(c, clamp(bw, 0.0, 1.0), on * A);
    o = pre(c, src.a);
  } else if (u_kind == 16) { // slow shutter
    vec4 prev = texture(u_prev, uv);
    o = mix(src, prev, u_keep);
  } else if (u_kind == 17) { // fisheye
    vec2 d = (uv - u_centre) * aspectFix();
    float r2 = dot(d, d);
    float k = (u_style == 0 ? 1.0 : -0.6) * A * 0.9;
    vec2 p = d * (1.0 + k * r2);
    // scale so the middle of each edge still lands on the picture; the corners smear
    p /= max(0.2, 1.0 + k * 0.79);
    o = texture(u_tex, clamp(u_centre + p / aspectFix(), 0.0, 1.0));
  } else if (u_kind == 18) { // raster
    float period = max(2.0, 4.0 * scaleK());
    float y = uv.y * u_size.y + u_t * 20.0 * scaleK();
    float line = 0.5 + 0.5 * sin(2.0 * PI * y / period);
    vec3 c = unp(src);
    c *= mix(1.0, 0.45 + 0.55 * line, A);
    float flick = 1.0 + 0.03 * A * sin(u_t * 60.0);
    c *= flick;
    vec3 mask = 0.85 + 0.15 * vec3(
      step(0.5, fract(uv.x * u_size.x / (3.0 * scaleK()))),
      step(0.5, fract(uv.x * u_size.x / (3.0 * scaleK()) + 0.33)),
      step(0.5, fract(uv.x * u_size.x / (3.0 * scaleK()) + 0.66)));
    c *= mix(vec3(1.0), mask, A * 0.5);
    o = pre(c, src.a);
  } else if (u_kind == 19) { // duotone
    vec3 lo, hi;
    if (u_style == 0) { lo = vec3(0.05, 0.04, 0.2); hi = vec3(1.0, 0.72, 0.3); }
    else if (u_style == 1) { lo = vec3(0.17, 0.04, 0.24); hi = vec3(1.0, 0.8, 0.7); }
    else if (u_style == 2) { lo = vec3(0.02, 0.02, 0.03); hi = vec3(0.7, 1.0, 0.85); }
    else if (u_style == 3) { lo = vec3(0.02, 0.07, 0.25); hi = vec3(1.0, 0.45, 0.4); }
    else if (u_style == 4) { lo = vec3(0.03, 0.12, 0.08); hi = vec3(1.0, 0.95, 0.78); }
    else { lo = vec3(0.0, 0.06, 0.16); hi = vec3(0.45, 0.95, 1.0); }
    vec3 c = unp(src);
    float l = smoothstep(0.02, 0.98, luma(c));
    c = mix(c, mix(lo, hi, l), A);
    o = pre(c, src.a);
  } else if (u_kind == 20) { // bloom
    vec4 acc = vec4(0.0);
    float n = 0.0;
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 32.0);
      float a = fi * 2.39996;
      vec4 s = S(uv + vec2(cos(a), sin(a)) * r * 0.045 * u_size.y / u_size);
      float bright = smoothstep(0.55, 1.0, luma(unp(s)));
      acc += s * bright;
      n += 1.0;
    }
    vec4 glow = acc / n * 2.2;
    vec3 c = 1.0 - (1.0 - clamp(src.rgb, 0.0, 1.0)) * (1.0 - clamp(glow.rgb * A * 1.2, 0.0, 1.0));
    o = vec4(min(c, vec3(max(src.a, glow.a))), max(src.a, glow.a * A));
  } else if (u_kind == 21) { // ripple
    vec2 d = (uv - u_centre) * aspectFix();
    float r = length(d);
    float w = sin(r * 38.0 - u_t * 7.0) * exp(-r * 2.4);
    vec2 p = uv + normalize(d + 1e-5) * w * 0.018 * A / aspectFix();
    o = S(p);
  } else if (u_kind == 22) { // sharpen
    vec2 px = 1.0 / u_size;
    vec4 blur = (S(uv + px * vec2(1, 0)) + S(uv - px * vec2(1, 0)) + S(uv + px * vec2(0, 1)) + S(uv - px * vec2(0, 1))) * 0.25;
    o = src + (src - blur) * A * 2.2;
    o.a = src.a;
    o.rgb = clamp(o.rgb, 0.0, o.a);
  }
  outColor = o;
}`;

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir; // one texel step along the blur axis
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv) * 0.2270270270;
  c += (texture(u_tex, v_uv + u_dir * 1.3846153846) + texture(u_tex, v_uv - u_dir * 1.3846153846)) * 0.3162162162;
  c += (texture(u_tex, v_uv + u_dir * 3.2307692308) + texture(u_tex, v_uv - u_dir * 3.2307692308)) * 0.0702702703;
  outColor = c;
}`;

/** Plain copy with a brightness factor, used for fills and for storing feedback frames. */
export const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_gain;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  outColor = vec4(c.rgb * u_gain, c.a);
}`;
