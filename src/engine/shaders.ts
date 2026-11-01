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
export const LAYER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_local;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform bool u_premultiplied;
uniform float u_exposure, u_contrast, u_saturation, u_temperature, u_tint, u_highlights, u_shadows, u_vignette;
uniform vec4 u_tintColor; // solid colour layers: rgb, and a = 1 to use it instead of the texture
uniform float u_feather;  // soft edge in local units, for picture in picture
uniform float u_radius;   // rounded corners in local units
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 c = u_tintColor.a > 0.5 ? vec4(u_tintColor.rgb, 1.0) : texture(u_tex, v_uv);
  if (u_premultiplied && c.a > 0.0) c.rgb /= c.a;

  vec3 rgb = c.rgb;
  rgb *= exp2(u_exposure * 2.0);
  rgb.r *= 1.0 + u_temperature * 0.18;
  rgb.b *= 1.0 - u_temperature * 0.18;
  rgb.g *= 1.0 + u_tint * 0.12;
  float l = luma(rgb);
  rgb += u_shadows * 0.35 * (1.0 - smoothstep(0.0, 0.5, l)) * (1.0 - l);
  rgb += u_highlights * 0.35 * smoothstep(0.5, 1.0, l) * l;
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  rgb = mix(vec3(luma(rgb)), rgb, 1.0 + u_saturation);
  if (u_vignette != 0.0) {
    float d = distance(v_local, vec2(0.5));
    rgb *= 1.0 - u_vignette * smoothstep(0.35, 0.85, d);
  }
  rgb = clamp(rgb, 0.0, 1.0);

  float a = c.a * u_opacity;
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
