// The night sky at the top of the page: stars, the moon, the sea, and the title.
import { C, P, bayer, bevel, BIG, buffer, drawSmall, hash, measureSmall, rng, still, vnoise } from "./pixel.js";

const sky = document.getElementById("sky");
const titleCanvas = document.getElementById("title");
const subCanvas = document.getElementById("sub");
const hero = document.querySelector(".hero");

const DROP = 4;
let start = 0, SW = 0, SH = 0, B, stars = [], moon;

export const horizonRow = () => SH - Math.round(Math.max(30, SH * (SH > SW ? .16 : .22)));

function drawTitle(t) {
  const word = "OPENROLL", gap = 2;
  const widths = [...word].map(ch => BIG[ch][0].length);
  const W = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1) + 1, H = 14 + 3 + DROP;
  const b = buffer(titleCanvas, W, H);
  titleCanvas.style.width = W * P + "px"; titleCanvas.style.height = H * P + "px";
  const on = new Uint8Array(W * H);
  let ox = 0;
  [...word].forEach((ch, i) => {
    // letters land one after another, in whole pixel steps like a sprite would
    const k = still ? 99 : (t - start - 260 - i * 85) / 55;
    if (k >= 0) {
      const lift = Math.max(0, DROP - Math.floor(k));
      BIG[ch].forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") on[(y + DROP - lift) * W + ox + x] = 1; }));
    }
    ox += widths[i] + gap;
  });
  const sweep = still || t - start < 1800 ? -99 : ((t - start - 1800) / 28) % (W + 110) - 20;
  bevel(on, W, H, b.px, { sweep, top: DROP });
  b.flush();
}

function drawSub() {
  const s = Math.max(2, Math.round(P / 2));
  const one = "FREE, OPEN SOURCE ALTERNATIVE TO CAPCUT";
  const lines = measureSmall(one) * s <= innerWidth - 32 ? [one] : ["FREE, OPEN SOURCE", "ALTERNATIVE TO CAPCUT"];
  drawSmall(subCanvas, lines, s);
}

function build() {
  const r = hero.getBoundingClientRect();
  SW = Math.ceil(r.width / P); SH = Math.ceil(r.height / P);
  B = buffer(sky, SW, SH);
  const rand = rng(7);
  stars = [];
  const n = Math.round(SW * SH / 120);
  for (let i = 0; i < n; i++) {
    const sx = rand() * SW, sy = rand() * SH * .78, fx = sx / SW;
    const roll = rand(), hue = rand(), depth = .25 + rand() * .75, phase = rand() * 6.28, speed = .6 + rand() * 1.6;
    if (fx > .2 && fx < .8 && sy > SH * .1 && sy < SH * .66 && roll < .82) continue;
    if (SH > SW && sy > SH * .2 && sy < SH * .74 && roll < .9) continue;
    if (sy < SH * .09 && (fx < .2 || fx > .6)) continue;
    const kind = roll < .93 ? "dot" : roll < .985 ? "spark" : "big";
    const color = hue < .55 ? C.dimBlue : hue < .78 ? C.blue : hue < .9 ? C.cyan : hue < .96 ? C.coral : C.white;
    stars.push({ x: sx, y: sy, kind, color, depth, phase, speed });
  }
  const tall = SH > SW;
  // on a phone the moon hangs above the title instead of beside it
  const R = tall ? Math.round(SW * .085) : Math.round(Math.min(SW, SH * 1.6) * .058) + 5;
  moon = { R, cx: tall ? Math.round(SW * .8) : SW - R - Math.round(SW * .07), cy: tall ? Math.round(SH * .14) : R + Math.round(SH * .1) };
  // if the title is wide enough to reach the moon, the moon moves up into the corner and shrinks until it clears
  const hr = hero.getBoundingClientRect(), tr = titleCanvas.getBoundingClientRect();
  const tx1 = (tr.right - hr.left) / P + 2, ty0 = (tr.top - hr.top) / P - 2;
  while (moon.R > 5 && moon.cx - moon.R < tx1 && moon.cy + moon.R > ty0) {
    moon.cx = SW - moon.R - 3; moon.cy = moon.R + 2;
    if (moon.cx - moon.R < tx1 && moon.cy + moon.R > ty0) moon.R--;
  }
  drawSub();
}

function drawStars(t) {
  const { put } = B;
  for (const s of stars) {
    let x = (s.x - t * 0.0016 * s.depth) % SW;
    if (x < 0) x += SW;
    const y = s.y, tw = Math.sin(t * 0.001 * s.speed + s.phase), fx = x / SW;
    // stars drift, so the quiet area around the words is checked every frame
    if (fx > .24 && fx < .76 && y > SH * .14 && y < SH * .66) continue;
    if (s.kind === "dot") { if (tw > -0.85) put(x, y, s.color); continue; }
    const arm = s.kind === "big" ? (tw > .3 ? 3 : tw > -.4 ? 2 : 1) : (tw > 0 ? 2 : 1);
    put(x, y, s.color === C.coral ? C.coralHi : C.white);
    for (let k = 1; k <= arm; k++) {
      const c = k === 1 ? (s.color === C.dimBlue ? C.blue : s.color) : k === arm ? C.dimBlue : s.color;
      put(x + k, y, c); put(x - k, y, c); put(x, y + k, c); put(x, y - k, c);
    }
    if (s.kind === "big" && arm > 1) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) put(x + dx, y + dy, C.faint);
  }
}

function drawMoon(t) {
  const { R, cx, cy } = moon;
  const pal = [C.deep2, C.deep, C.mid, C.blue, C.cyan, C.ice, C.white];
  const rot = t * 0.00004;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d2 = x * x + y * y;
    if (d2 > R * R) continue;
    const nx = x / R, ny = y / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const light = Math.max(0, nx * -0.55 + ny * -0.6 + nz * 0.58);
    const lon = Math.atan2(nx, nz) + rot * 6.28, lat = Math.asin(ny);
    const tex = vnoise(lon * 3.2 + 40, lat * 3.2) * .65 + vnoise(lon * 9 + 9, lat * 9) * .35;
    let v = light * 1.15 + (tex - .5) * .9;
    if (d2 > (R - 1.2) * (R - 1.2)) v -= .25;
    const idx = Math.max(0, Math.min(pal.length - 1, Math.floor(v * (pal.length - 1) + bayer(x + cx, y + cy) - .25)));
    B.put(cx + x, cy + y, pal[idx]);
  }
}

// Four rows of swell, darker toward the horizon. Each is a smooth sum of two waves so the shapes never look like noise.
const SEA = [
  { off: 0, speed: .0022, amp: 1.3, len: 38, bob: .0007, body: "far" },
  { off: 6, speed: .0038, amp: 1.9, len: 50, bob: .0008, body: "back" },
  { off: 13, speed: .0058, amp: 2.7, len: 62, bob: .0009, body: "mid" },
  { off: 22, speed: .0088, amp: 3.8, len: 78, bob: .0011, body: "near" },
];
function swell(L, x, t) {
  const a = (x * 6.283) / L.len + t * L.bob;
  const b = (x * 6.283) / (L.len * 2.37) - t * L.bob * .6 + L.off;
  return L.amp * (Math.sin(a) - .28 * Math.cos(2 * a)) * .8 + Math.sin(b) * L.amp * .45;
}

function drawSea(t) {
  const { px, put } = B;
  const horizon = horizonRow();
  for (let x = 0; x < SW; x++) if ((x + Math.floor(t * 0.0026)) % 3 === 0) put(x, horizon - 2, C.faint);

  for (const L of SEA) {
    const shift = t * L.speed, top = horizon + L.off;
    for (let x = 0; x < SW; x++) {
      const wx = x + shift, wi = Math.floor(wx);
      const here = swell(L, wx, t), left = swell(L, wx - 1, t), right = swell(L, wx + 1, t);
      const h = Math.round(top - here), slope = right - left;
      // a dark seam just above the crest, so each row of swell sits in front of the one behind it
      if (L.body !== "far") put(x, h - 1, L.body === "near" ? C.deep : C.deep2);
      for (let y = Math.max(0, h); y < SH; y++) {
        const d = y - h, b = bayer(wi, y);
        let c;
        if (L.body === "far") c = d === 0 ? C.deep : d === 1 && b < .4 ? C.deep : C.navy;
        else if (L.body === "back") c = d === 0 ? C.mid2 : d === 1 && b < .5 ? C.mid2 : d < 4 ? C.deep : d < 6 && b < .4 ? C.deep : C.deep2;
        else if (L.body === "mid") {
          if (d === 0) c = C.blue2;
          else if (d === 1) c = b < .5 ? C.blue2 : C.mid;
          else if (d < 5) c = b < .5 + slope * .9 ? C.mid : C.mid2;
          else c = d < 7 && b < .45 ? C.mid2 : C.deep;
        } else {
          // the near swell: crest, a lit face, a shaded back, then the water darkens toward the bottom of the screen
          if (d === 0) c = b < -slope * .8 ? C.ice : C.cyan;
          else if (d === 1) c = C.cyan;
          else if (d === 2) c = b < .5 ? C.cyan : C.blue;
          else if (d < 6) c = b < .5 + slope * .9 ? C.blue : C.blue2;
          else if (d < 8) c = b < .5 ? C.blue2 : C.mid;
          else if (d < 14) c = C.mid;
          else if (d < 16) c = b < .5 ? C.mid : C.mid2;
          else if (d < 22) c = C.mid2;
          else c = b < .5 - (d - 22) * .06 ? C.mid2 : C.deep;
          // the last rows sink into the colour the page continues with below
          const rem = SH - 1 - y;
          if (rem < 26 && d > 3) {
            const k = rem / 26;
            c = k < .25 ? C.ocean : k < .55 ? (b < (k - .25) / .3 ? C.mid2 : C.ocean) : (b < (k - .55) / .45 ? c : C.mid2);
          }
        }
        px[y * SW + x] = c;
      }
      if (L.body === "near" && here > left && here >= right && here > L.amp * .9) {
        put(x, h - 1, C.white); put(x - 1, h, C.ice); put(x + 1, h, C.ice);
      }
    }
    if (L.body === "mid" || L.body === "near") {
      const r = rng(L.off * 31 + 3);
      const count = Math.round(SW / (L.body === "near" ? 9 : 14));
      for (let i = 0; i < count; i++) {
        const base = r() * (SW + 40), depth = 3 + Math.floor(r() * (L.body === "near" ? 22 : 8)), len = 2 + Math.floor(r() * 4), ph = r() * 6.28;
        let x0 = (base - shift) % (SW + 40);
        if (x0 < -20) x0 += SW + 40;
        if (Math.sin(t * .0016 + ph) < -.2) continue;
        const y = Math.round(top - swell(L, x0 + shift, t)) + depth;
        const col = L.body === "near" ? (depth < 9 ? C.ice : C.blue) : C.blue2;
        for (let k = 0; k < len; k++) put(x0 + k, y, col);
      }
    }
  }

  // the moon's path on the water
  if (SH < SW) {
    for (let y = horizon + 2; y < SH - 8; y += 2) {
      const spread = 1 + Math.floor((y - horizon) / 9);
      const wob = Math.round(Math.sin(t * .003 + y * .9) * 1.5);
      if (hash(y, Math.floor(t / 220)) >= .4) continue;
      const len = 1 + Math.floor(hash(y, 7) * spread);
      for (let k = -len; k <= len; k++) {
        const i = (y * SW + moon.cx + k + wob) | 0;
        const c = px[i];
        if (c !== C.space && c !== C.deep && c !== C.deep2 && c !== C.navy) px[i] = Math.abs(k) < len * .4 ? C.cyan : C.blue;
      }
    }
  }
}

let visible = true, running = false;
function frame(t) {
  if (!start) start = t;
  B.px.fill(C.space);
  drawStars(t);
  drawMoon(t);
  drawSea(t);
  B.flush();
  drawTitle(t);
  running = !still && visible;
  if (running) requestAnimationFrame(frame);
}

export function startHero() {
  drawTitle(0);
  build();
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !running) requestAnimationFrame(frame);
  }).observe(hero);
  requestAnimationFrame(frame);
}

export function resizeHero() {
  build();
  if (!running) requestAnimationFrame(frame);
}
