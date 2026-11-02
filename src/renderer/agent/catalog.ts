import { CAPTION_PRESETS, HIGHLIGHT_COLORS } from "../../core/caption-styles";
import { LAYOUTS } from "../../core/layouts";
import { EFFECTS } from "../../core/look/effects";
import { FILTERS, type FilterLook } from "../../core/look/filters";
import { STICKERS } from "../../core/stickers";
import { TRANSITIONS } from "../../engine/shaders";
import { VOICES } from "../../engine/tts-protocol";
import { TEXT_PRESETS } from "../ui/panels/text-presets";

const EFFECT_USE: Record<string, string> = {
  defocus: "Soft lens blur. Backgrounds behind text, dreamy moments, hiding detail.",
  rush: "Radial zoom blur from the centre. Speed, impact, the start of a fast section.",
  handheld: "Gentle camera shake. Makes locked off shots feel filmed by hand; raise amount for action.",
  tear: "Horizontal glitch tearing. Digital, edgy, transitions in tech or music edits.",
  prism: "RGB channels split apart. Energy, glitch accents on beats.",
  emulsion: "Film grain and texture. Nostalgia, warmth, cinematic feel at low amounts.",
  tape: "VHS: wobble, colour bleed, noise. Home video and retro looks.",
  "sun-leak": "Moving warm light leak. Summer, memories, soft transitions.",
  strobe: "Brightness flicker. Parties and drops; use briefly.",
  thump: "A zoom punch that pulses. Put it on clips that start on strong beats.",
  mosaic: "Pixelation. Hiding faces or plates, or a retro look.",
  mirror: "Mirrors the picture (style picks the side). Symmetry, surreal looks.",
  kaleido: "Kaleidoscope. Abstract music visuals.",
  heartbeat: "Pulsing scale and brightness like a heartbeat. Tension, romance, emphasis.",
  "neon-edge": "Glowing outlines. Night, club, sci fi looks.",
  "mono-strobe": "Flashes between black and white (or inverted). Hard rhythmic accents.",
  "slow-shutter": "Long exposure trails. Dance, motion, dreamy movement.",
  fisheye: "Barrel or pinch lens distortion. Skate and action style.",
  raster: "Scan lines like an old screen. Retro, screens within the video.",
  duotone: "Maps the picture to two colours. Bold graphic looks, posters, music videos.",
  bloom: "Bright parts glow softly. Dreamy, golden hour, night lights.",
  ripple: "Wavy water like distortion. Dreams, flashbacks, heat.",
};

const TRANSITION_USE: Record<string, string> = {
  dissolve: "Soft crossfade. Time passing, calm edits. The safe default.",
  "dip-black": "Fade through black. End of a section, a bigger jump in time.",
  "dip-white": "Fade through white. Memories, flash cuts, bright moods.",
  "wipe-left": "Hard edge wipes left. Playful, direction of travel.",
  "wipe-right": "Hard edge wipes right.",
  "wipe-up": "Wipes up.",
  "wipe-down": "Wipes down.",
  "slide-left": "Next shot slides in from the right. Social, upbeat.",
  "slide-right": "Next shot slides in from the left.",
  "push-up": "Pushes the old shot up and out. Feeds, lists.",
  "zoom-in": "Zooms into the next shot. Energy, moving forward.",
  "zoom-out": "Zooms out into the next shot.",
  blur: "Blurs out and in. Smooth and modern.",
  circle: "Circle opens on the next shot. Reveals, playful.",
  flash: "White flash on the cut. Impact, beat drops.",
  split: "Opens from the middle. Reveals.",
};

const ANIMATIONS = {
  fade: "Fades in or out.",
  "slide-up": "Rises into place while fading.",
  "slide-down": "Drops into place.",
  "slide-left": "Comes in from the right.",
  "slide-right": "Comes in from the left.",
  "zoom-in": "Grows into place.",
  "zoom-out": "Shrinks into place.",
  pop: "Springs in with a small overshoot. Labels, stickers, emphasis.",
  spin: "Spins in.",
};

const OPS = {
  add_clip: "{media (id, path or name), at? (timeline s; omit to append on main), track? (\"main\", \"auto\" or a track id), in? (source s), duration? (s), as?}",
  add_text: "{text, at, duration? (3), style? (font, size, weight, color, align, letterSpacing, lineHeight, stroke {color,width}, shadow {color,blur,x,y}, background {color,padding,radius}), x?, y? (pixels from frame centre, y down), as?}",
  add_color: "{color #rrggbb, at, duration, track?, as?} solid colour clip, e.g. black for a beat of silence",
  add_shape: "{kind rect|ellipse|line|sticker, sticker? (id), at, duration?, color?, x?, y?, scale?, as?}",
  move: "{id, at, track?} on the main track this picks a slot; elsewhere it lands exactly there",
  trim: "{id, in? (source s), duration? (s)}",
  split: "{at, ids?} splits every clip under the time, or only ids",
  delete: "{ids} main track gaps close; other tracks keep their gaps",
  remove_range: "{from, to} cuts a stretch out of every unlocked track and closes it",
  set: "{id, props} see props",
  keyframe: "{id, prop (e.g. transform.scale, transform.x, transform.opacity, adjust.exposure), at (timeline s), value, ease? linear|ease|easeIn|easeOut|hold}",
  transition: "{id (the clip after the cut), kind, duration? (0.5)} kind null removes",
  filter: "{id, filter (id) or null, amount? 0..1}",
  effect: "{id, kind, amount? 0..1, speed?, style? (index into styles)}",
  layout: "{id, layout} picture in picture or split screen placement",
  cut_to_beat: "{clips (ids), music (clip id with beats), every? 1|2|4, muteClips? (true)} rebuilds the main track as beat length pieces",
  apply_template: "{template (id or name, see list_templates), at? (s; default end of the timeline), media? (media ids, filled into slots in order; omit to use the library), ids? (captions to restyle), as?} adds a ready made title, lower third, cut pattern or other piece with open slots for clips; a caption style template restyles existing captions instead. Slots without media show as marked empty boxes.",
  marker: "{at, label?}",
  track: "{id, muted?, hidden?, locked?, name?}",
  add_track: "{kind video|audio|text, name?, as?}",
  project: "{ratio? 16:9|9:16|1:1|4:5|4:3|21:9, width?, height?, fps?, background? #rrggbb, name?}",
};

const PROPS = {
  x: "number, pixels from frame centre", y: "number, pixels from frame centre (down is positive)", scale: "number, 1 = fitted", rotation: "degrees", opacity: "0..1",
  volume: "0..2, 1 is original", fadeIn: "seconds", fadeOut: "seconds", speed: "0.1..100; the clip length changes to match", reversed: "boolean", freeze: "boolean, holds the first frame",
  blend: "normal|screen|multiply|overlay|add|lighten|darken",
  adjust: "{exposure, contrast, saturation, temperature, tint, highlights, shadows, vignette, fade, sharpen, grain} each -100..100 (fade, sharpen, grain 0..100)",
  crop: "{left, top, right, bottom} fractions 0..1 of the source",
  mask: "{shape rect|ellipse|linear|mirror, x, y, width, height (fractions of the clip box), rotation, feather 0..1, invert}",
  chroma: "{color #rrggbb, similarity 0..1, smoothness 0..1, spill 0..1} green screen",
  fill: "{kind blur|color, color?, amount?} what fills the frame around a clip that does not cover it",
  cutout: "boolean, remove the background around people (takes a moment to prepare)",
  stabilize: "{strength 0..1}", enhance: "{amount 0..1, upscale? boolean}", slowMotion: "blend|flow (flow is smoother below speed 1)", motionBlur: "{amount 0..1}",
  audio: "{denoise 0..1, voice boolean, normalize boolean, duckUnder boolean}", voiceFx: "pitchUp|pitchDown|robot|radio|echo|bigRoom", muteAudio: "boolean",
  animationIn: "{kind, duration s} or null", animationOut: "{kind, duration s} or null",
  text: "string, for text and caption clips", style: "partial text style, for text and caption clips", name: "string", color: "#rrggbb for colour clips",
};

export function buildCatalog() {
  return {
    units: "Times are seconds on the timeline. in is seconds inside the source media. Positions are pixels from the frame centre.",
    ops: OPS,
    props: PROPS,
    transitions: TRANSITIONS.map(kind => ({ kind, use: TRANSITION_USE[kind] ?? "" })),
    filters: FILTERS.map(f => ({ id: f.id, name: f.name, group: f.group, look: describeLook(f.look) })),
    effects: EFFECTS.filter(e => !e.internal).map(e => ({ kind: e.kind, name: e.name, group: e.group, defaultAmount: e.amount, ...(e.speed ? { speed: e.speed } : {}), ...(e.styles ? { styles: e.styles } : {}), use: EFFECT_USE[e.kind] ?? "" })),
    animations: ANIMATIONS,
    textPresets: TEXT_PRESETS.map(t => ({ id: t.id, name: t.name, style: t.style, y: Math.round(t.y * 100) / 100, animationIn: t.animationIn })),
    captionStyles: CAPTION_PRESETS.map(c => ({ id: c.id, name: c.name, sample: c.sample })),
    highlightColors: HIGHLIGHT_COLORS,
    layouts: LAYOUTS,
    stickers: STICKERS.map(s => ({ id: s.id, name: s.name, group: s.group })),
    voices: VOICES,
    blendModes: ["normal", "screen", "multiply", "overlay", "add", "lighten", "darken"],
    easings: ["linear", "ease", "easeIn", "easeOut", "hold"],
  };
}

function describeLook(look: FilterLook): string {
  const parts: string[] = [];
  const n = (k: keyof FilterLook) => (typeof look[k] === "number" ? (look[k] as number) : 0);
  if (n("mono") > 0.5) parts.push("black and white");
  if (n("temperature") > 0.05) parts.push("warm");
  if (n("temperature") < -0.05) parts.push("cool");
  if (n("saturation") > 0.1) parts.push("richer colour");
  if (n("saturation") < -0.1 && n("mono") <= 0.5) parts.push("muted colour");
  if (n("contrast") > 0.12) parts.push("punchy");
  if (n("contrast") < -0.04) parts.push("soft contrast");
  if (n("fade") > 0.05) parts.push("lifted blacks");
  if (n("grain") > 0.1) parts.push("grain");
  if (n("vignette") > 0.1) parts.push("vignette");
  return parts.join(", ") || "neutral";
}
