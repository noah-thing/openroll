// Writes the starter templates and the community index into templates/.
// The files are what ships; this script is how they are drawn, so a change to a starter is
// made here and the output committed. Run: node scripts/build-starter-templates.mjs
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../templates/", import.meta.url));
const S = 1_000_000;
const s = seconds => Math.round(seconds * S);

const SHORT = { width: 1080, height: 1920 };
const WIDE = { width: 1920, height: 1080 };
const SQUARE = { width: 1080, height: 1080 };

const FONT = "Familjen Grotesk";
const INK = "#14130e";
const PAPER = "#efe8d8";
const GOLD = "#f2c23a";
const RED = "#e2674f";

const style = (text, o = {}) => ({ text, font: FONT, size: 96, weight: 700, color: "#ffffff", align: "center", lineHeight: 1.1, letterSpacing: 0, ...o });

const text = (str, start, dur, st = {}, at = {}, anim = {}) => ({
  type: "text",
  start: s(start),
  duration: s(dur),
  ...(Object.keys(at).length ? { transform: at } : {}),
  style: style(str, st),
  ...(anim.in ? { animationIn: { kind: anim.in, duration: s(anim.inFor ?? 0.4) } } : {}),
  ...(anim.out ? { animationOut: { kind: anim.out, duration: s(anim.outFor ?? 0.3) } } : {}),
  ...(anim.keys ? { keyframes: anim.keys } : {}),
});

const box = (kind, w, h, color, start, dur, at = {}, extra = {}, anim = {}) => ({
  type: "shape",
  start: s(start),
  duration: s(dur),
  ...(Object.keys(at).length ? { transform: at } : {}),
  shape: { kind, color, ...extra },
  width: w,
  height: h,
  ...(anim.in ? { animationIn: { kind: anim.in, duration: s(anim.inFor ?? 0.4) } } : {}),
  ...(anim.out ? { animationOut: { kind: anim.out, duration: s(anim.outFor ?? 0.3) } } : {}),
  ...(anim.keys ? { keyframes: anim.keys } : {}),
});

const sticker = (id, size, color, start, dur, at = {}, anim = {}, extra = {}) => box("sticker", size, size, color, start, dur, at, { sticker: id, ...extra }, anim);
const color = (c, start, dur) => ({ type: "color", start: s(start), duration: s(dur), color: c });
const slot = (id, start, dur, extra = {}) => ({ type: "slot", slot: id, start: s(start), duration: s(dur), ...extra });
const key = (t, v, ease = "ease") => ({ t: s(t), v, ease });
const clip = n => ({ id: `clip${n}`, label: `Clip ${n}`, kind: "visual" });
const lane = (kind, name, items, main = false) => ({ kind, name, ...(main ? { main: true } : {}), items });

const templates = [];
const add = t => {
  const ends = (t.tracks ?? []).flatMap(tr => tr.items.map(i => i.start + i.duration));
  templates.push({ format: "openroll-template", version: 1, author: "OpenRoll", ...t, duration: Math.max(0, ...ends) });
};

add({
  id: "hook-title",
  name: "Hook title",
  kind: "timeline",
  description: "A loud opening line over your first clip, with a slow push in. Made for the first three seconds of a short.",
  tags: ["shorts", "title", "hook"],
  frame: SHORT,
  slots: [clip(1)],
  tracks: [
    lane("video", "Main", [slot("clip1", 0, 3, { keyframes: { "transform.scale": [key(0, 1, "easeOut"), key(3, 1.12)] } })], true),
    lane("video", "Underline", [sticker("wavy", 760, GOLD, 0.35, 2.65, { y: -430 }, { in: "slide-left", inFor: 0.35 })]),
    lane("text", "Title", [text("WAIT FOR IT", 0, 3, { size: 168, weight: 800, stroke: { color: "#000000", width: 14 }, lineHeight: 1 }, { y: -520 }, { in: "pop", inFor: 0.35 })]),
  ],
});

add({
  id: "lower-third",
  name: "Lower third",
  kind: "timeline",
  description: "A name and a line of context in the bottom corner, on a dark plate with a gold edge.",
  tags: ["title", "name", "interview"],
  frame: WIDE,
  slots: [],
  tracks: [
    lane("video", "Plate", [box("rect", 900, 190, "rgba(10,12,11,0.85)", 0, 4.5, { x: -470, y: 330 }, { radius: 6 }, { in: "slide-right", inFor: 0.45, out: "fade", outFor: 0.3 })]),
    lane("video", "Edge", [box("rect", 10, 190, GOLD, 0, 4.5, { x: -915, y: 330 }, { radius: 0 }, { in: "slide-right", inFor: 0.45, out: "fade", outFor: 0.3 })]),
    lane("text", "Name", [text("Ella Lind", 0.1, 4.4, { size: 76, weight: 700, align: "left" }, { x: -655, y: 300 }, { in: "slide-right", inFor: 0.5, out: "fade", outFor: 0.3 })]),
    lane("text", "Role", [text("Skipper, Sjöbris", 0.2, 4.3, { size: 44, weight: 500, align: "left", color: "#c9cdc7" }, { x: -655, y: 370 }, { in: "slide-right", inFor: 0.5, out: "fade", outFor: 0.3 })]),
  ],
});

add({
  id: "chapter-card",
  name: "Chapter card",
  kind: "timeline",
  description: "A full screen divider with a chapter number and title. Drop it between two parts of a longer video.",
  tags: ["title", "chapter", "divider"],
  frame: WIDE,
  slots: [],
  tracks: [
    lane("video", "Main", [color("#13201a", 0, 3)], true),
    lane("video", "Rule", [box("rect", 220, 6, GOLD, 0.2, 2.6, { y: 40 }, { radius: 3 }, { in: "zoom-in", inFor: 0.5, out: "fade" })]),
    lane("text", "Chapter", [
      text("CHAPTER 2", 0.1, 2.8, { size: 36, weight: 600, letterSpacing: 10, color: GOLD }, { y: -60 }, { in: "fade", inFor: 0.5, out: "fade" }),
    ]),
    lane("text", "Title", [text("The long way round", 0.3, 2.6, { size: 120, weight: 700, letterSpacing: -2 }, { y: 150 }, { in: "slide-up", inFor: 0.6, out: "fade" })]),
  ],
});

add({
  id: "end-card",
  name: "End card",
  kind: "timeline",
  description: "Thanks for watching over a softened clip, with a subscribe button and an arrow pointing at it.",
  tags: ["end", "subscribe", "outro"],
  frame: WIDE,
  slots: [clip(1)],
  tracks: [
    lane("video", "Main", [slot("clip1", 0, 7, { adjust: { exposure: -28, saturation: -20 }, effects: [{ kind: "defocus", amount: 0.55 }] })], true),
    lane("video", "Arrow", [sticker("arrow-curve", 260, "#ffffff", 1.4, 5.6, { x: 330, y: 150 }, { in: "slide-left", inFor: 0.5 }, { weight: 1.3 })]),
    lane("text", "Thanks", [text("Thanks for watching", 0, 7, { size: 132, weight: 700, letterSpacing: -2 }, { y: -140 }, { in: "slide-up", inFor: 0.6 })]),
    lane("text", "Button", [
      text("Subscribe", 1, 6, { size: 64, weight: 700, background: { color: RED, padding: 26, radius: 50 } }, { y: 120 }, { in: "pop", inFor: 0.4 }),
    ]),
    lane("text", "Note", [text("New videos every week", 1.4, 5.6, { size: 38, weight: 500, color: "#d8dbd5" }, { y: 260 }, { in: "fade", inFor: 0.5 })]),
  ],
});

add({
  id: "quote-card",
  name: "Quote card",
  kind: "timeline",
  description: "A square card with a large quote on paper colour, for sharing a line from the video.",
  tags: ["quote", "square", "card"],
  frame: SQUARE,
  slots: [],
  tracks: [
    lane("video", "Main", [color(PAPER, 0, 5)], true),
    lane("video", "Rule", [box("rect", 120, 6, RED, 0.3, 4.7, { y: 255 }, { radius: 3 }, { in: "zoom-in", inFor: 0.5 })]),
    lane("text", "Mark", [text("“", 0, 5, { font: "Georgia, serif", size: 340, weight: 700, color: "#cfc3a4", lineHeight: 0.8 }, { y: -330 }, { in: "fade", inFor: 0.6 })]),
    lane("text", "Quote", [text("The best edit is the one nobody notices", 0.2, 4.8, { font: "Georgia, serif", size: 82, weight: 400, color: INK, lineHeight: 1.18 }, { y: -40 }, { in: "slide-up", inFor: 0.7 })]),
    lane("text", "Author", [text("A. EDITOR", 0.7, 4.3, { size: 34, weight: 600, letterSpacing: 8, color: "#7a705c" }, { y: 340 }, { in: "fade", inFor: 0.6 })]),
  ],
});

{
  const ringAt = n =>
    box("ellipse", 560, 560, "#ffffff", n, 1, {}, { noFill: true, stroke: { color: "#ffffff", width: 10 } }, {
      keys: { "transform.scale": [key(0, 0.7, "easeOut"), key(1, 1.25)], "transform.opacity": [key(0, 0.9, "easeIn"), key(1, 0)] },
    });
  add({
    id: "countdown",
    name: "Countdown",
    kind: "timeline",
    description: "Three, two, one on a dark field with a ring that pulses on each number. Ends on the cut into your first clip.",
    tags: ["countdown", "intro", "shorts"],
    frame: SHORT,
    slots: [],
    tracks: [
      lane("video", "Main", [color("#101113", 0, 3)], true),
      lane("video", "Ring", [ringAt(0), ringAt(1), ringAt(2)]),
      lane("text", "Numbers", [
        text("3", 0, 1, { size: 560, weight: 800 }, { y: -20 }, { in: "pop", inFor: 0.25 }),
        text("2", 1, 1, { size: 560, weight: 800 }, { y: -20 }, { in: "pop", inFor: 0.25 }),
        text("1", 2, 1, { size: 560, weight: 800, color: GOLD }, { y: -20 }, { in: "pop", inFor: 0.25 }),
      ]),
    ],
  });
}

{
  const punch = (from, to) => ({ "transform.scale": [key(0, from, "easeOut"), key(1.2, to)] });
  add({
    id: "fast-cuts",
    name: "Three fast cuts",
    kind: "timeline",
    description: "Three clips, a little over a second each, with a punch zoom on every cut. A marker sits on each cut.",
    tags: ["shorts", "cuts", "zoom", "montage"],
    frame: SHORT,
    slots: [clip(1), clip(2), clip(3)],
    markers: [{ t: 0, label: "Cut" }, { t: s(1.2), label: "Cut" }, { t: s(2.4), label: "Cut" }],
    tracks: [
      lane("video", "Main", [
        slot("clip1", 0, 1.2, { keyframes: punch(1.3, 1) }),
        slot("clip2", 1.2, 1.2, { keyframes: punch(1, 1.18) }),
        slot("clip3", 2.4, 1.2, { keyframes: punch(1.3, 1) }),
      ], true),
    ],
  });
}

add({
  id: "split-screen-intro",
  name: "Split screen intro",
  kind: "timeline",
  description: "Two clips side by side with a title across the join. Good for a before and after, or two people in one frame.",
  tags: ["split", "intro", "comparison"],
  frame: WIDE,
  slots: [clip(1), clip(2)],
  tracks: [
    lane("video", "Overlay", [slot("clip2", 0, 4, { layout: "right", animationIn: { kind: "slide-left", duration: s(0.5) } })]),
    lane("video", "Main", [slot("clip1", 0, 4, { layout: "left", animationIn: { kind: "slide-right", duration: s(0.5) } })], true),
    lane("video", "Divider", [box("rect", 8, 1080, "#ffffff", 0, 4, {}, { radius: 0 })]),
    lane("text", "Title", [text("Side by side", 0.4, 3.6, { size: 92, weight: 700, background: { color: "rgba(10,12,11,0.8)", padding: 28, radius: 8 } }, {}, { in: "pop", inFor: 0.4 })]),
  ],
});

add({
  id: "reaction-split",
  name: "Reaction split",
  kind: "timeline",
  description: "One clip over another in a vertical frame: the thing you are reacting to on top, you underneath.",
  tags: ["split", "reaction", "shorts"],
  frame: SHORT,
  slots: [clip(1), clip(2)],
  tracks: [
    lane("video", "Overlay", [slot("clip2", 0, 6, { layout: "bottom" })]),
    lane("video", "Main", [slot("clip1", 0, 6, { layout: "top" })], true),
    lane("video", "Divider", [box("rect", 1080, 8, GOLD, 0, 6, {}, { radius: 0 })]),
  ],
});

{
  const beat = 0.5;
  const clips = Array.from({ length: 8 }, (_, i) => clip(i + 1));
  add({
    id: "beat-montage",
    name: "Beat montage",
    kind: "timeline",
    description: "Eight clips on a 120 beats per minute grid with a marker on every beat and a slot for the music. A skeleton to cut to.",
    tags: ["montage", "beat", "music", "shorts"],
    frame: SHORT,
    slots: [...clips, { id: "music", label: "Music", kind: "audio" }],
    markers: Array.from({ length: 16 }, (_, i) => ({ t: s(i * beat), label: i % 4 === 0 ? "Bar" : "Beat" })),
    tracks: [
      lane("video", "Main", clips.map((c, i) => slot(c.id, i * 2 * beat, 2 * beat, { muteAudio: true, effects: [{ kind: "thump", amount: 0.3, speed: 2 }] })), true),
      lane("audio", "Music", [slot("music", 0, 8)]),
    ],
  });
}

add({
  id: "memory-recap",
  name: "Memory recap",
  kind: "timeline",
  description: "Four clips that dissolve into each other under a warm film look, with a title over the first.",
  tags: ["recap", "travel", "film"],
  frame: WIDE,
  slots: [clip(1), clip(2), clip(3), clip(4)],
  tracks: [
    lane("video", "Main", [1, 2, 3, 4].map((n, i) => slot(`clip${n}`, i * 3, 3, { filter: { id: "halide", amount: 0.9 }, adjust: { grain: 18, vignette: 20 }, ...(i ? { transitionIn: { kind: "dissolve", duration: s(0.8) } } : {}) })), true),
    lane("text", "Title", [text("The summer", 0.3, 3.2, { size: 132, weight: 600, letterSpacing: -2, shadow: { color: "rgba(0,0,0,0.5)", blur: 24, x: 0, y: 6 } }, { y: -20 }, { in: "fade", inFor: 0.5, out: "fade", outFor: 0.5 })]),
  ],
});

add({
  id: "facecam-bubble",
  name: "Facecam bubble",
  kind: "timeline",
  description: "A round picture of you in the corner while the main clip plays full screen. For tutorials and commentary.",
  tags: ["picture in picture", "tutorial", "commentary"],
  frame: WIDE,
  slots: [clip(1), clip(2)],
  tracks: [
    lane("video", "Facecam", [slot("clip2", 0, 8, { layout: "pip-br", mask: { shape: "ellipse", x: 0, y: 0, width: 0.5625, height: 1, rotation: 0, feather: 0, invert: false }, animationIn: { kind: "pop", duration: s(0.4) } })]),
    lane("video", "Main", [slot("clip1", 0, 8)], true),
  ],
});

add({
  id: "callout-arrow",
  name: "Callout arrow",
  kind: "timeline",
  description: "A hand drawn circle, an arrow and a short label to point at something on screen.",
  tags: ["callout", "sticker", "explain"],
  frame: WIDE,
  slots: [],
  tracks: [
    lane("video", "Marks", [
      sticker("ring", 360, RED, 0, 3.5, { x: -120, y: -60 }, { in: "zoom-in", inFor: 0.35 }, { weight: 1.6 }),
    ]),
    lane("video", "Arrow", [sticker("arrow-swoop", 300, "#ffffff", 0.35, 3.15, { x: 140, y: 120 }, { in: "slide-left", inFor: 0.4 }, { weight: 1.5 })]),
    lane("text", "Label", [text("Look here", 0.6, 2.9, { size: 64, weight: 700, color: INK, background: { color: GOLD, padding: 20, radius: 8 } }, { x: 380, y: 230 }, { in: "pop", inFor: 0.35 })]),
  ],
});

add({
  id: "follow-bug",
  name: "Follow reminder",
  kind: "timeline",
  description: "A small pill near the bottom asking for a follow, with a heart that pops in beside it.",
  tags: ["shorts", "follow", "call to action"],
  frame: SHORT,
  slots: [],
  tracks: [
    lane("video", "Heart", [sticker("heart", 120, RED, 0.3, 3.7, { x: -300, y: 590 }, { in: "pop", inFor: 0.4 })]),
    lane("text", "Pill", [text("Follow for part two", 0, 4, { size: 52, weight: 700, color: INK, background: { color: "#ffffff", padding: 24, radius: 60 } }, { x: 30, y: 590 }, { in: "slide-up", inFor: 0.45, out: "fade", outFor: 0.3 })]),
  ],
});

add({
  id: "glitch-intro",
  name: "Glitch intro",
  kind: "timeline",
  description: "A short title sting: your clip tears and splits colour while the name slams in, then flashes into the next shot.",
  tags: ["intro", "glitch", "title"],
  frame: WIDE,
  slots: [clip(1)],
  tracks: [
    lane("video", "Main", [slot("clip1", 0, 2.5, { effects: [{ kind: "tear", amount: 0.7, speed: 1.5 }, { kind: "prism", amount: 0.6, speed: 1 }], adjust: { contrast: 20 } })], true),
    lane("text", "Title", [text("NEW EPISODE", 0.3, 2.2, { size: 170, weight: 800, letterSpacing: 4, stroke: { color: "#000000", width: 10 } }, {}, { in: "pop", inFor: 0.2, out: "fade", outFor: 0.2 })]),
  ],
});

const captionTemplate = (id, name, description, tags, frame, look) => add({ id, name, description, tags, kind: "captions", frame, slots: [], tracks: [], captions: look });

captionTemplate("captions-yellow-highlight", "Bold yellow highlight", "Heavy white letters with a black outline. The word being spoken turns yellow and each caption pops in.", ["captions", "shorts", "bold"], SHORT, {
  style: style("", { size: 84, weight: 800, stroke: { color: "#000000", width: 12 }, lineHeight: 1.12 }),
  highlight: GOLD,
  y: 0.2,
  animationIn: { kind: "pop", duration: s(0.22) },
});

captionTemplate("captions-white-box", "Clean white box", "Dark text on a soft white plate. Calm and easy to read on any footage.", ["captions", "clean", "box"], SHORT, {
  style: style("", { size: 54, weight: 600, color: INK, lineHeight: 1.2, background: { color: "rgba(255,255,255,0.94)", padding: 22, radius: 16 } }),
  highlight: RED,
  y: 0.27,
  animationIn: { kind: "fade", duration: s(0.15) },
});

captionTemplate("captions-karaoke-pop", "Karaoke word pop", "Large centred words, dimmed until spoken. The current word lights up green as the line pops in.", ["captions", "karaoke", "music"], SHORT, {
  style: style("", { size: 100, weight: 800, color: "#ffffffb3", lineHeight: 1.1, shadow: { color: "rgba(0,0,0,0.65)", blur: 22, x: 0, y: 6 } }),
  highlight: "#7fe36b",
  y: 0.02,
  animationIn: { kind: "pop", duration: s(0.2) },
});

captionTemplate("captions-soft-serif", "Soft serif", "Quiet serif subtitles with a gentle shadow, for travel films and anything slow.", ["captions", "serif", "film"], WIDE, {
  style: style("", { font: "Georgia, serif", size: 52, weight: 400, shadow: { color: "rgba(0,0,0,0.6)", blur: 16, x: 0, y: 4 } }),
  y: 0.36,
  animationIn: { kind: "fade", duration: s(0.3) },
});

// Rewrite the folder: stale files from a renamed starter must not linger.
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".openrolltemplate")) rmSync(join(OUT, f));
for (const t of templates) writeFileSync(join(OUT, `${t.id}.openrolltemplate`), JSON.stringify(t, null, 2) + "\n");
const index = {
  format: "openroll-template-index",
  version: 1,
  templates: templates.map(t => ({ id: t.id, name: t.name, file: `${t.id}.openrolltemplate`, kind: t.kind, description: t.description, author: t.author, tags: t.tags })),
};
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`wrote ${templates.length} templates to ${OUT}`);
