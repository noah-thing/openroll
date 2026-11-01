export const QUAD_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
uniform mat3 u_matrix;
uniform vec4 u_uv; // x0, y0, x1, y1 in source texture space
out vec2 v_uv;
out vec2 v_local;
void main() {
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_uv = mix(u_uv.xy, u_uv.zw, a_pos);
  v_local = a_pos;
}`;

export const FULL_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
  v_uv = a_pos;
}`;

// Sliders are -1..1 here; the UI's -100..100 is divided down before upload.
// Order: key, filter, adjust, curves, colour bands, vignette, grain, mask.
export const LAYER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
in vec2 v_local;
uniform sampler2D u_tex;
uniform sampler3D u_lut;
uniform sampler2D u_curves;
uniform float u_opacity;
uniform bool u_premultiplied;
uniform vec4 u_g0; // exposure, contrast, saturation, temperature
uniform vec4 u_g1; // tint, highlights, shadows, fade
uniform float u_vignette, u_grain, u_time;
uniform vec2 u_boxPx;
uniform vec4 u_tintColor; // solid colour layers: rgb, and a = 1 to use it instead of the texture
uniform float u_feather;  // soft edge in local units, for picture in picture
uniform float u_radius;   // rounded corners in local units

uniform int u_fMode;      // 0 none, 1 recipe, 2 LUT
uniform float u_fAmount;
uniform vec4 u_f0, u_f1;  // same layout as u_g0, u_g1
uniform vec4 u_f2;        // vignette, grain, mono, unused
uniform vec3 u_fLow, u_fHigh;

uniform bool u_curvesOn;
uniform bool u_hslOn;
uniform vec3 u_hsl[8];

uniform bool u_keyOn;
uniform vec3 u_keyColor;
uniform vec3 u_keyParams; // similarity, smoothness, spill

uniform vec4 u_uv;          // the vertex shader's crop rectangle, to zoom about its centre
uniform vec4 u_stab;        // steadying: shift and roll in frame widths and radians, zoom (0 = off)
uniform float u_stabAspect;
uniform bool u_matteOn;
uniform sampler2D u_matte;
uniform float u_matteEdge;

uniform int u_maskShape;  // 0 off, 1 rect, 2 ellipse, 3 linear, 4 mirror
uniform vec4 u_maskRect;  // centre x, y, width, height as box fractions
uniform vec3 u_maskParams; // rotation (radians), feather, invert
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 grade(vec3 rgb, vec4 a, vec4 b) {
  rgb *= exp2(a.x * 2.0);
  rgb.r *= 1.0 + a.w * 0.18;
  rgb.b *= 1.0 - a.w * 0.18;
  rgb.g *= 1.0 + b.x * 0.12;
  float l = luma(rgb);
  rgb += b.z * 0.35 * (1.0 - smoothstep(0.0, 0.5, l)) * (1.0 - l);
  rgb += b.y * 0.35 * smoothstep(0.5, 1.0, l) * l;
  rgb = (rgb - 0.5) * (1.0 + a.y) + 0.5;
  rgb = mix(vec3(luma(rgb)), rgb, 1.0 + a.z);
  rgb = mix(rgb, rgb * 0.82 + 0.14, b.w);
  return rgb;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Hue centres of the eight bands, in turns.
const float BAND[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.7778, 0.8889);

vec3 bands(vec3 rgb) {
  vec3 hsv = rgb2hsv(rgb);
  float dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = abs(hsv.x - BAND[i]);
    d = min(d, 1.0 - d);
    float w = 1.0 - smoothstep(0.0, 0.1, d);
    w *= smoothstep(0.02, 0.2, hsv.y);
    dh += w * u_hsl[i].x;
    ds += w * u_hsl[i].y;
    dl += w * u_hsl[i].z;
  }
  hsv.x = fract(hsv.x + dh * 0.1);
  hsv.y = clamp(hsv.y * (1.0 + ds), 0.0, 1.0);
  hsv.z = clamp(hsv.z * (1.0 + dl * 0.6), 0.0, 1.0);
  return hsv2rgb(hsv);
}

vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}

float maskCoverage() {
  vec2 p = (v_local - 0.5 - u_maskRect.xy) * u_boxPx;
  float c = cos(-u_maskParams.x), s = sin(-u_maskParams.x);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 h = u_maskRect.zw * u_boxPx * 0.5;
  float d;
  if (u_maskShape == 1) {
    vec2 a = abs(q) - h;
    d = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0);
  } else if (u_maskShape == 2) {
    d = (length(q / max(h, vec2(1e-4))) - 1.0) * min(h.x, h.y);
  } else if (u_maskShape == 3) {
    d = -q.y;
  } else {
    d = abs(q.y) - h.y;
  }
  float f = max(u_maskParams.y * min(u_boxPx.x, u_boxPx.y) * 0.5, 1.0);
  float inside = 1.0 - smoothstep(-f, f, d);
  return u_maskParams.z > 0.5 ? 1.0 - inside : inside;
}

// Where in the source this pixel reads from once camera shake is taken out.
vec2 steadyUv(vec2 uv) {
  if (u_stab.w <= 0.0) return uv;
  vec2 mid = 0.5 * (u_uv.xy + u_uv.zw);
  vec2 span = u_uv.zw - u_uv.xy;
  vec2 p = (uv - mid) / span;
  p.y /= u_stabAspect;
  p -= u_stab.xy;
  float c = cos(u_stab.z), s = sin(u_stab.z);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / u_stab.w;
  q.y *= u_stabAspect;
  return mid + q * span;
}

void main() {
  vec2 suv = steadyUv(v_uv);
  vec4 c = u_tintColor.a > 0.5 ? vec4(u_tintColor.rgb, 1.0) : texture(u_tex, suv);
  if (u_premultiplied && c.a > 0.0) c.rgb /= c.a;
  vec3 rgb = c.rgb;
  float alpha = c.a;
  if (u_matteOn) {
    float m = texture(u_matte, suv).r;
    float lo = 0.5 * u_matteEdge * 0.9, hi = 1.0 - lo;
    alpha *= smoothstep(lo, max(hi, lo + 0.01), m);
  }

  if (u_keyOn) {
    float thr = u_keyParams.x * 0.4;
    float soft = u_keyParams.y * 0.3 + 0.0001;
    float d = distance(cbcr(rgb), cbcr(u_keyColor));
    alpha *= smoothstep(thr, thr + soft, d);
    vec3 dir = u_keyColor - luma(u_keyColor);
    dir = dir / (length(dir) + 1e-5);
    float spill = max(0.0, dot(rgb - luma(rgb), dir));
    rgb -= dir * spill * u_keyParams.z;
  }

  float vig = u_vignette;
  float grain = u_grain;
  if (u_fMode == 1) {
    vec3 f = grade(rgb, u_f0, u_f1);
    float l = luma(f);
    f += u_fLow * (1.0 - smoothstep(0.0, 0.6, l)) + u_fHigh * smoothstep(0.4, 1.0, l);
    f = mix(f, vec3(luma(f)), u_f2.z);
    rgb = mix(rgb, f, u_fAmount);
    vig += u_f2.x * u_fAmount;
    grain += u_f2.y * u_fAmount;
  } else if (u_fMode == 2) {
    vec3 f = texture(u_lut, clamp(rgb, 0.0, 1.0) * (1.0 - 1.0 / float(textureSize(u_lut, 0).x)) + 0.5 / float(textureSize(u_lut, 0).x)).rgb;
    rgb = mix(rgb, f, u_fAmount);
  }

  rgb = grade(rgb, u_g0, u_g1);
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_curvesOn) {
    rgb = vec3(texture(u_curves, vec2(rgb.r * 0.99609 + 0.00195, 0.5)).r, texture(u_curves, vec2(rgb.g * 0.99609 + 0.00195, 0.5)).g, texture(u_curves, vec2(rgb.b * 0.99609 + 0.00195, 0.5)).b);
  }
  if (u_hslOn) rgb = bands(rgb);
  if (vig != 0.0) {
    float d = distance(v_local, vec2(0.5));
    rgb *= 1.0 - vig * smoothstep(0.35, 0.85, d);
  }
  if (grain > 0.0) {
    vec2 cell = floor(v_local * u_boxPx / 2.0) + floor(u_time * 24.0) * 17.0;
    float n = hash12(cell) - 0.5;
    rgb += n * grain * 0.3 * (1.0 - abs(luma(rgb) - 0.5));
  }
  rgb = clamp(rgb, 0.0, 1.0);

  float a = alpha * u_opacity;
  if (u_maskShape > 0) a *= maskCoverage();
  if (u_radius > 0.0 || u_feather > 0.0) {
    vec2 q = abs(v_local - 0.5) - (0.5 - u_radius - u_feather);
    float dist = length(max(q, 0.0)) - u_radius;
    a *= 1.0 - smoothstep(-u_feather, 0.0, dist);
  }
  outColor = vec4(rgb * a, a);
}`;

// Separable blend modes on premultiplied colour.
export const BLEND_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_top;
uniform int u_mode;
out vec4 outColor;

vec3 blend(vec3 b, vec3 s, int m) {
  if (m == 1) return b + s - b * s;                       // screen
  if (m == 2) return b * s;                               // multiply
  if (m == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); // overlay
  if (m == 4) return min(b + s, 1.0);                     // add
  if (m == 5) return max(b, s);                           // lighten
  if (m == 6) return min(b, s);                           // darken
  return s;
}

void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 s = texture(u_top, v_uv);
  if (u_mode == 0 || s.a == 0.0) { outColor = s + b * (1.0 - s.a); return; }
  vec3 bs = b.a > 0.0 ? b.rgb / b.a : vec3(0.0);
  vec3 ss = s.rgb / s.a;
  vec3 mixed = mix(ss, blend(bs, ss, u_mode), b.a);
  outColor = vec4(mixed * s.a + b.rgb * (1.0 - s.a), s.a + b.a * (1.0 - s.a));
}`;

export const TRANSITIONS = [
  "dissolve", "dip-black", "dip-white", "wipe-left", "wipe-right", "wipe-up", "wipe-down",
  "slide-left", "slide-right", "push-up", "zoom-in", "zoom-out", "blur", "circle", "flash", "split",
] as const;

export type TransitionKind = (typeof TRANSITIONS)[number];

export const TRANSITION_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_kind;
uniform vec2 u_size;
out vec4 outColor;

vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_a, uv); }
vec4 B(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_b, uv); }

vec4 blurred(sampler2D t, vec2 uv, float r) {
  vec4 acc = vec4(0.0);
  float n = 0.0;
  for (int x = -3; x <= 3; x++)
    for (int y = -3; y <= 3; y++) {
      acc += texture(t, uv + vec2(float(x), float(y)) * r / u_size);
      n += 1.0;
    }
  return acc / n;
}

void main() {
  float p = u_p;
  float e = p * p * (3.0 - 2.0 * p);
  vec2 uv = v_uv;
  float soft = 0.04;
  if (u_kind == 0) outColor = mix(A(uv), B(uv), e);
  else if (u_kind == 1 || u_kind == 2) {
    vec4 dip = u_kind == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    outColor = p < 0.5 ? mix(A(uv), dip, smoothstep(0.0, 0.5, p)) : mix(dip, B(uv), smoothstep(0.5, 1.0, p));
  }
  else if (u_kind == 3) outColor = mix(A(uv), B(uv), smoothstep(e - soft, e + soft, 1.0 - uv.x + soft * (1.0 - 2.0 * e)));
  else if (u_kind == 4) outColor = mix(A(uv), B(uv), smoothstep(e - soft, e + soft, uv.x + soft * (1.0 - 2.0 * e)));
  else if (u_kind == 5) outColor = mix(A(uv), B(uv), smoothstep(e - soft, e + soft, uv.y + soft * (1.0 - 2.0 * e)));
  else if (u_kind == 6) outColor = mix(A(uv), B(uv), smoothstep(e - soft, e + soft, 1.0 - uv.y + soft * (1.0 - 2.0 * e)));
  else if (u_kind == 7) { vec4 b = B(uv + vec2(1.0 - e, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (u_kind == 8) { vec4 b = B(uv - vec2(1.0 - e, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (u_kind == 9) { vec4 a = A(uv - vec2(0.0, e)); vec4 b = B(uv + vec2(0.0, 1.0 - e)); outColor = b + a * (1.0 - b.a); }
  else if (u_kind == 10) {
    vec2 c = vec2(0.5);
    vec4 a = A(c + (uv - c) / (1.0 + e * 0.6));
    vec4 b = B(c + (uv - c) * (1.6 - e * 0.6));
    outColor = mix(a, b, smoothstep(0.3, 0.8, p));
  }
  else if (u_kind == 11) {
    vec2 c = vec2(0.5);
    vec4 a = A(c + (uv - c) * (1.0 + e * 0.6));
    vec4 b = B(c + (uv - c) / (1.6 - e * 0.6));
    outColor = mix(a, b, smoothstep(0.3, 0.8, p));
  }
  else if (u_kind == 12) {
    float r = sin(p * 3.14159) * 12.0;
    outColor = mix(blurred(u_a, uv, r), blurred(u_b, uv, r), e);
  }
  else if (u_kind == 13) {
    vec2 d = (uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
    float radius = e * 1.2;
    outColor = mix(A(uv), B(uv), 1.0 - smoothstep(radius - 0.02, radius + 0.02, length(d)));
  }
  else if (u_kind == 14) {
    float f = 1.0 - abs(p * 2.0 - 1.0);
    outColor = mix(mix(A(uv), B(uv), step(0.5, p)), vec4(1.0), pow(f, 2.0));
  }
  else {
    float half_ = abs(uv.y - 0.5) * 2.0;
    outColor = mix(A(uv), B(uv), smoothstep(1.0 - e - soft, 1.0 - e + soft, 1.0 - half_));
  }
}`;

export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_bg;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  outColor = vec4(c.rgb + u_bg * (1.0 - c.a), 1.0);
}`;
