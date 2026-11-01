// Fragment programs for the AI visual passes. All of them draw one full target quad, so
// they share the compositor's vertex shader and vertex array.

const HEAD = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
`;

/** Grey, shrunk four times: four linear taps one texel off centre cover a 4x4 block. */
export const GREY_FS = HEAD + /* glsl */ `
uniform sampler2D u_tex;
uniform vec2 u_texel; // one texel of the source
float L(vec2 uv) { return dot(texture(u_tex, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 o = u_texel;
  float g = (L(v_uv + vec2(-o.x, -o.y)) + L(v_uv + vec2(o.x, -o.y)) + L(v_uv + vec2(-o.x, o.y)) + L(v_uv + vec2(o.x, o.y))) * 0.25;
  outColor = vec4(g, g, g, 1.0);
}`;

// Flow is the shift of the picture from frame A to frame B in uv units, kept in a half float
// target. Block matching on grey, coarse to fine; each pass refines the guess before it.
export const FLOW_FS = HEAD + /* glsl */ `
uniform sampler2D u_a, u_b, u_guess;
uniform vec2 u_texel;   // one texel of u_a and u_b
uniform int u_radius;   // candidates run -radius..radius on each axis
uniform float u_step;   // candidate spacing, in texels
uniform float u_tap;    // patch tap spacing, in texels
uniform int u_hasGuess;
float G(sampler2D t, vec2 uv) { return texture(t, uv).r; }
void main() {
  vec2 guess = u_hasGuess == 1 ? texture(u_guess, v_uv).rg : vec2(0.0);
  float best = 1e9;
  vec2 bestD = vec2(0.0);
  float ref[9];
  int n = 0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) ref[n++] = G(u_a, v_uv + vec2(float(i), float(j)) * u_tap * u_texel);
  for (int cy = -u_radius; cy <= u_radius; cy++) {
    for (int cx = -u_radius; cx <= u_radius; cx++) {
      vec2 d = guess + vec2(float(cx), float(cy)) * u_step * u_texel;
      float cost = 0.0;
      int k = 0;
      for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) cost += abs(ref[k++] - G(u_b, v_uv + d + vec2(float(i), float(j)) * u_tap * u_texel));
      // prefer staying near the guess when two candidates look alike
      cost += 0.004 * length(vec2(float(cx), float(cy)));
      if (cost < best) { best = cost; bestD = d; }
    }
  }
  outColor = vec4(bestD, 0.0, 1.0);
}`;

/** Soften the field a little so neighbouring blocks agree; moving edges stay readable. */
export const FLOW_SMOOTH_FS = HEAD + /* glsl */ `
uniform sampler2D u_flow;
uniform vec2 u_texel;
void main() {
  vec2 acc = vec2(0.0);
  float w = 0.0;
  vec2 c = texture(u_flow, v_uv).rg;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 f = texture(u_flow, v_uv + vec2(float(i), float(j)) * u_texel).rg;
      float k = exp(-dot(f - c, f - c) * 20000.0) * (i == 0 && j == 0 ? 2.0 : 1.0);
      acc += f * k;
      w += k;
    }
  outColor = vec4(acc / w, 0.0, 1.0);
}`;

/** The in between picture: plain cross fade, flow warped fade, or a streak along the motion. */
export const INTERPOLATE_FS = HEAD + /* glsl */ `
uniform sampler2D u_a, u_b, u_flow;
uniform float u_mix;
uniform int u_mode;     // 0 blend, 1 flow, 2 streak
uniform float u_length; // streak: fraction of the frame to frame motion the shutter stays open
void main() {
  vec4 a0 = texture(u_a, v_uv);
  if (u_mode == 0) { outColor = mix(a0, texture(u_b, v_uv), u_mix); return; }
  vec2 f = texture(u_flow, v_uv).rg;
  if (u_mode == 2) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float k = (float(i) + 0.5) / 12.0 - 0.5;
      acc += texture(u_a, v_uv + f * u_length * k);
    }
    outColor = acc / 12.0;
    return;
  }
  vec4 a = texture(u_a, v_uv - f * u_mix);
  vec4 b = texture(u_b, v_uv + f * (1.0 - u_mix));
  vec4 b0 = texture(u_b, v_uv);
  // where the two warps disagree the flow is wrong (an edge uncovered, a block that failed): fall back toward a plain fade
  float err = distance(a.rgb, b.rgb);
  float bad = smoothstep(0.10, 0.32, err);
  outColor = mix(mix(a, b, u_mix), mix(a0, b0, u_mix), bad * 0.7);
}`;

/** Edge keeping denoise and a gentle unsharp mask in one pass. */
export const ENHANCE_FS = HEAD + /* glsl */ `
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_denoise; // 0..1
uniform float u_sharpen; // 0..1
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 centre = c.rgb;
  float sr = 0.015 + 0.14 * u_denoise;
  vec3 acc = vec3(0.0);
  vec3 blur = vec3(0.0);
  float wsum = 0.0, bsum = 0.0;
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      vec3 p = texture(u_tex, v_uv + vec2(float(i), float(j)) * u_texel).rgb;
      float sp = exp(-float(i * i + j * j) / 4.5);
      float d = dot(p - centre, p - centre);
      float w = sp * exp(-d / (2.0 * sr * sr));
      acc += p * w;
      wsum += w;
      blur += p * sp;
      bsum += sp;
    }
  vec3 den = mix(centre, acc / wsum, min(1.0, u_denoise * 1.4));
  vec3 soft = mix(centre, blur / bsum, 1.0);
  vec3 outc = den + (den - mix(den, soft, 0.9)) * u_sharpen * 1.6;
  outColor = vec4(clamp(outc, 0.0, 1.0), c.a);
}`;
