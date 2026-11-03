// Under the sea: everything below the hero. Drawn once, on the same pixel grid as the sky, and never animated.
import { C, P, bayer, bevel, BIG, buffer, hash, rng } from "./pixel.js";

const wrap = document.querySelector(".deep");
const canvas = document.getElementById("deep");

// Water in stages, from the lit layer just under the surface down to the seabed. Each stage is one flat blue,
// and the change between two stages is a short dithered seam, the way old games drew depth.
const STAGES = ["#0b52a0", "#0a4a8e", "#083d7c", "#06316a", "#052757", "#041e46", "#031636", "#021028", "#020a1c"];
const AT = [0, .045, .1, .18, .3, .44, .58, .72, .86];
const pack = h => { const n = parseInt(h.slice(1), 16); return 0xff000000 | (n & 0xff) << 16 | (n & 0xff00) | (n >> 16 & 0xff); };
const STEPS = STAGES.map((h, i) => [AT[i], pack(h)]);
const lighter = c => {
  const i = STEPS.findIndex(s => s[1] === c);
  return i > 0 ? STEPS[i - 1][1] : pack("#1063b8");
};

function waterAt(x, y, H) {
  const t = y / H;
  let i = STEPS.length - 1;
  while (i > 0 && STEPS[i][0] > t) i--;
  const cur = STEPS[i][1], next = STEPS[i + 1];
  if (!next) return cur;
  const into = y - (next[0] * H - 7);
  return into > 0 && bayer(x, y) < into / 8 ? next[1] : cur;
}

function solids() {
  const base = wrap.getBoundingClientRect();
  return [...wrap.querySelectorAll("[data-solid]")].map(el => {
    const r = el.getBoundingClientRect();
    return { x0: (r.left - base.left) / P - 4, y0: (r.top - base.top) / P - 3, x1: (r.right - base.left) / P + 4, y1: (r.bottom - base.top) / P + 3 };
  });
}
const hits = (box, list) => list.some(r => box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0);

// Everything that lives down here is drawn by hand, facing right. Each species shows up once, at its own depth:
// bright reef fish near the surface, stranger things further down. Letters: a lit back, b body, c belly,
// w stripes or spots, e eye, t tail or tentacles, s stalk, l light, m teeth.
const Y = { hi: 0xff7ae2ff, body: 0xff44c7f6, lo: 0xff1a96c9 };
const PINK = { hi: 0xffe6c7ff, body: 0xffc58ff4, lo: 0xff9a5ac4 };
const SPRITES_FISH = {
  tang: { rows: ["....aaa.....", "...aabbb....", "t.abbbbbba..", "ttbbbbbbbbb.", "ttbbbbbbbebb", "t.cbbbbbbbb.", "...ccbbbcc..", "......cc...."],
    ink: { a: Y.hi, b: Y.body, c: Y.lo, e: C.navy, t: Y.lo } },
  cyan: { rows: ["....aaa.....", "t..abbbba...", "tt.bbbbbbbb.", "ttbbbbbbbebb", "tt.cbbbbbbb.", "t...cccccc..", "......c....."],
    ink: { a: C.ice, b: C.cyan, c: C.blue, e: C.navy, t: C.blue2 } },
  angel: { rows: ["..aa.........", "..aaa........", "...abb.......", "....bbbba....", "t...bwbbbbb..", "tt.bbwbbbbbb.", "ttbbbwbbbbbeb", "tt.bbwbbbbbb.", "t...bwbbbbc..", "....cccbc....", "...ccc.......", "..cc.........", "..c.........."],
    ink: { a: C.ice, b: C.blue2, w: C.white, c: C.deep, e: C.navy, t: C.mid } },
  clown: { rows: ["......aaa......", "....aaabba.....", "t..abbbbbbbb...", "tt.bbbwbbbbbbb.", "ttbbbbwbbbbbebb", "tt.bbbwbbbbbbb.", "t..cbbbbbbbbb..", "....cccbbcc....", "........c......"],
    ink: { a: C.coralHi, b: C.coral, c: C.coralLo, w: C.ice, e: C.white, t: C.coralLo } },
  jelly: { still: true, rows: ["..aaaaa..", ".abbbbba.", "abbwbbbba", "abbbbbbba", "ccccccccc", ".t.t.t.t.", ".t..t..t.", "t..t..t..", ".t..t.t..", "..t...t..", ".t.....t."],
    ink: { a: PINK.hi, b: PINK.body, w: C.white, c: PINK.lo, t: PINK.body } },
  puffer: { rows: ["....a.a.a...", "...aaaaaaa..", "..abwbbbwba.", "t.bbbbbbbbbb", "ttbbwbbbbeeb", "ttbbbbbwbbbb", "t.bbbbbbbbm.", "..cwbbbbbc..", "...ccccccc..", "....c.c.c..."],
    ink: { a: C.white, b: C.ice, w: C.blue, c: C.cyan, e: C.navy, m: C.blue2, t: C.cyan } },
  grouper: { rows: [".........aaaa.......", ".......aaabbba......", "t....abbbbbbbbbb....", "tt..abbbbbbbbbbbbb..", "ttt.bbbbbbbbbbbbbbb.", "tttbbbbbbbbbbbbbbebb", "ttt.bbbbbbbbbbbbbbb.", "tt..cbbbbbbbbbbbbb..", "t....ccbbbbbbbbcc...", ".......cccccccc.....", "..........cc........"],
    ink: { a: C.blue, b: C.mid, c: C.deep, e: C.cyan, t: C.mid2 } },
  angler: { rows: ["...........l.....", "..........lLl....", "...........s.....", "..........s......", "....aaaaas.......", "t..abbbbbbba.....", "ttabbbbbbbbbbb...", "ttbbbbbbbbbbebb..", "ttbbbbbbbbbbbmmm.", "t.cbbbbbbbbbm.m..", "...ccccccccmmm...", ".....cc..........",],
    ink: { a: 0xff7a4a2b, b: 0xff57331d, c: 0xff3f2213, e: C.cyan, m: C.ice, s: C.dimBlue, l: C.cyan, L: C.white, t: 0xff3f2213 } },
};

function fishBox(x, y, kind) {
  const r = SPRITES_FISH[kind].rows;
  return { x0: x - 1, y0: y - 1, x1: x + r[0].length + 1, y1: y + r.length + 1 };
}

function drawFish(b, x, y, dir, kind) {
  const { rows, ink } = SPRITES_FISH[kind], w = rows[0].length;
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
    if (ink[ch]) b.put(dir > 0 ? x + dx : x + w - 1 - dx, y + dy, ink[ch]);
  }));
}

function bubble(b, x, y, r) {
  if (r === 0) { b.put(x, y, C.dimBlue); return; }
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) b.put(x + dx, y + dy, C.dimBlue);
  b.put(x, y - 1, C.blue);
}

function seabed(b, H, W, rand, blocked, base) {
  const sandTop = x => Math.round(base - Math.sin(x * .045) * 2.4 - Math.sin(x * .13 + 1) * 1.1);
  for (let x = 0; x < W; x++) {
    const top = sandTop(x);
    for (let y = top; y < H; y++) {
      const d = y - top;
      b.put(x, y, d === 0 ? C.sandHi : d < 3 ? (bayer(x, y) < .5 ? C.sandHi : C.sand) : d < 9 ? C.sand : bayer(x, y) < .5 ? C.sand : C.sandLo);
    }
  }
  // rocks and kelp only where nothing is written over them
  for (let i = 0; i < Math.round(W / 28); i++) {
    const x = Math.floor(rand() * W), r = 3 + Math.floor(rand() * 5), top = sandTop(x);
    const box = { x0: x - r, y0: top - r, x1: x + r, y1: top + 1 };
    if (hits(box, blocked)) continue;
    for (let dy = -r; dy <= 0; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) {
      if ((dx / (r + 2)) ** 2 + (dy / r) ** 2 > 1) continue;
      b.put(x + dx, top + dy + 1, dy === -r || (dy < -r + 2 && dx < 0) ? C.rockHi : C.rock);
    }
  }
  for (let i = 0; i < Math.round(W / 15); i++) {
    const x0 = Math.floor(rand() * W), tall = 14 + Math.floor(rand() * 34), ph = rand() * 6.28, top = sandTop(x0);
    const box = { x0: x0 - 4, y0: top - tall, x1: x0 + 5, y1: top };
    if (hits(box, blocked)) continue;
    for (let k = 0; k < tall; k++) {
      const y = top - k, x = x0 + Math.round(Math.sin(k * .22 + ph) * 1.6 * Math.min(1, k / 8));
      b.put(x, y, C.kelp); b.put(x + 1, y, k > tall - 3 ? C.kelp : C.kelpLo);
      if (k % 6 === 3 && k < tall - 2) { const s = (k / 6 | 0) % 2 ? 1 : -1; b.put(x + (s > 0 ? 2 : -1), y, C.kelpHi); b.put(x + (s > 0 ? 3 : -2), y - 1, C.kelpHi); }
    }
    b.put(x0, top - tall, C.kelpHi);
  }
  const crab = ["a.......a", "aa.e.e.aa", ".abbbbba.", "..bbbbb..", ".c.c.c.c."];
  const crabInk = { a: C.coralHi, b: C.coral, c: C.coralLo, e: C.white };
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.floor(rand() * (W - 12)) + 2, y = sandTop(x + 4) - 4;
    if (hits({ x0: x - 3, y0: y - 3, x1: x + 12, y1: y + 6 }, blocked)) continue;
    crab.forEach((row, dy) => [...row].forEach((ch, dx) => crabInk[ch] && b.put(x + dx, y + dy, crabInk[ch])));
    break;
  }
}

export function drawDeep() {
  const r = wrap.getBoundingClientRect();
  const W = Math.ceil(r.width / P), H = Math.ceil(r.height / P);
  canvas.style.width = W * P + "px"; canvas.style.height = H * P + "px";
  const b = buffer(canvas, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.px[y * W + x] = waterAt(x, y, H);

  // light from the surface, slanting down and fading out before the first section ends
  // the beams fade out above the first heading, so no text ever sits on them
  const intro = wrap.querySelector(".app .intro").getBoundingClientRect();
  const len = Math.max(30, Math.round((intro.top - r.top) / P) - 4);
  for (let beam = 0; beam < 7; beam++) {
    const x0 = W * (beam / 6) - 18 + (beam % 2) * 11, wid = 10 + (beam * 7) % 12;
    for (let y = 0; y < len; y++) {
      const fade = .5 * (1 - y / len) ** 1.4;
      for (let dx = 0; dx < wid; dx++) {
        const edge = Math.min(dx, wid - 1 - dx) < 2 ? .5 : 1;
        const x = Math.round(x0 + y * .42 + dx);
        if (x < 0 || x >= W || bayer(x, y) > fade * edge) continue;
        const i = y * W + x;
        b.px[i] = lighter(b.px[i]);
      }
    }
  }

  const blocked = solids();
  // a couple of bubble columns rising from the deep toward the surface
  for (const fx of [.07, .93, .62]) {
    const x0 = Math.round(W * fx);
    for (let y = 8, k = 0; y < 150; y += 7 + (k % 3) * 3, k++) {
      const x = x0 + Math.round(Math.sin(y * .21) * 2);
      if (!hits({ x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 }, blocked)) bubble(b, x, y, k % 4 === 0 ? 0 : 1);
    }
  }
  const foot = wrap.querySelector(".foot").getBoundingClientRect();
  const floorTop = Math.round((foot.top - r.top) / P) + 4;
  const rand = rng(23);
  // drifting specks, the snow you see in deep water
  for (let i = 0; i < W * H / 260; i++) {
    const x = rand() * W, y = rand() * H, c = rand() < .7 ? C.faint : C.dimBlue;
    if (!hits({ x0: x, y0: y, x1: x + 1, y1: y + 1 }, blocked)) b.put(x, y, c);
  }

  // one group of each species, each at its own depth, never behind text
  const CAST = [
    ["tang", .05, .2, 3], ["cyan", .16, .32, 4], ["angel", .3, .46, 2], ["clown", .42, .56, 1],
    ["jelly", .52, .66, 3], ["puffer", .62, .74, 1], ["grouper", .7, .82, 1], ["angler", .8, .9, 1],
  ];
  const placed = [];
  for (const [kind, t0, t1, n] of CAST) {
    const sp = SPRITES_FISH[kind], w = sp.rows[0].length, h = sp.rows.length;
    for (let tries = 0; tries < 400; tries++) {
      const spread = tries > 250 ? .08 : 0;
      const y = floorTop * (t0 - spread + rand() * (t1 - t0 + spread * 2)), x = 8 + rand() * (W - w - 16);
      const dir = sp.still ? 1 : rand() < .5 ? 1 : -1;
      const group = [[x, y]];
      for (let k = 1; k < n; k++) {
        const gap = w + 4 + Math.floor(rand() * 4);
        group.push(sp.still ? [x + k * gap, y + (k % 2 ? 6 : -4)] : [x - dir * k * gap * .85, y + (k % 2 ? -h * .6 : h * .55)]);
      }
      const boxes = group.map(([gx, gy]) => fishBox(gx, gy, kind));
      if (boxes.some(bx => bx.x0 < 0 || bx.x1 > W || bx.y0 < 24 || bx.y1 > floorTop - 14 || hits(bx, blocked) || hits(bx, placed))) continue;
      group.forEach(([gx, gy]) => drawFish(b, Math.round(gx), Math.round(gy), dir, kind));
      if (!sp.still && kind !== "angler") {
        const [lx, ly] = group[0];
        const bx = Math.round(dir > 0 ? lx + w + 1 : lx - 2), by = Math.round(ly - 1);
        const trail = [[bx, by, 0], [bx + dir, by - 3, 1], [bx, by - 7, 1]];
        if (!trail.some(([tx, ty]) => hits({ x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 }, blocked))) trail.forEach(([tx, ty, tr]) => bubble(b, tx, ty, tr));
      }
      if (kind === "angler") {
        // the lure lights a small patch of water around it
        const [lx, ly] = group[0], cx = Math.round(dir > 0 ? lx + 11 : lx + w - 12), cy = Math.round(ly + 1);
        for (let dy = -4; dy <= 4; dy++) for (let dx = -5; dx <= 5; dx++) {
          const d = Math.hypot(dx, dy * 1.2);
          const i = (cy + dy) * W + cx + dx;
          if (d < 5 && d > 1.5 && bayer(cx + dx, cy + dy) < (1 - d / 5) * .6 && b.px[i] !== undefined && STEPS.some(s => s[1] === b.px[i])) b.px[i] = C.dimBlue;
        }
      }
      placed.push(...boxes.map(bx => ({ x0: bx.x0 - 10, y0: bx.y0 - 8, x1: bx.x1 + 10, y1: bx.y1 + 8 })));
      break;
    }
  }

  seabed(b, H, W, rand, blocked, floorTop);
  b.flush();
}

// The tiles under "What you don't get" each carry a zero in the title's own lettering.
export function drawZeros() {
  for (const cv of document.querySelectorAll("canvas.zero")) {
    const W = 11, H = 17, g = BIG["0"];
    const b = buffer(cv, W, H);
    cv.style.width = W * P + "px"; cv.style.height = H * P + "px";
    const on = new Uint8Array(W * H);
    g.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") on[y * W + x] = 1; }));
    bevel(on, W, H, b.px);
    b.flush();
  }
}

// Small icons, drawn by hand on a 12 by 12 grid.
const SPRITES = {
  timeline: ["....r.......", "bbbbr.cccc..", "bbbbr.cccc..", "....r.......", "ccccrccc....", "ccccrccc....", "....r.......", "..bbrbbbbbb.", "..bbrbbbbbb.", "....r.......", "...rrr......", "............"],
  captions: ["............", ".wwwwwwwwww.", "w..........w", "w.cccccc...w", "w..........w", "w.cccc.ccc.w", "w..........w", ".wwwwwwwwww.", "..ww........", ".w..........", "............", "............"],
  sound: ["............", "......c.....", "..c...c.....", "..c..cc..c..", ".cc..cc..c..", ".cc.ccc.cc.c", ".cc.ccc.cc.c", ".cc..cc..c..", "..c..cc..c..", "..c...c.....", "......c.....", "............"],
  look: ["....wwww....", "..wwccbbww..", ".wcccccbbbw.", ".wcccccbbbw.", "wccccccbbbbw", "wccccccbbbbw", "wccccccbbbbw", "wccccccbbbbw", ".wcccccbbbw.", ".wcccccbbbw.", "..wwccbbww..", "....wwww...."],
  smart: ["....c.......", "....c.......", "..ccwcc.....", "....c.....b.", "....c....bwb", "..........b.", "......c.....", ".....cwc....", "......c.....", "............", "............", "............"],
  formats: ["...wwwwww...", "...w....w...", "...w.cc.w...", "...w.cc.w...", "...w.cc.w...", "...w....w...", "...w.bb.w...", "...w....w...", "...w....w...", "...w..r.w...", "...wwwwww...", "............"],
  export: ["......c.....", ".....ccc....", "....c.c.c...", "......c.....", "......c.....", "......c.....", ".w....c...w.", ".w........w.", ".w........w.", ".wwwwwwwwww.", "............", "............"],
  templates: ["............", ".cccc.bbbbb.", ".cccc.bbbbb.", ".cccc.bbbbb.", "............", ".bbbbb.rrrr.", ".bbbbb.rrrr.", ".bbbbb.rrrr.", "............", ".wwwwwwwwww.", "............", "............"],
  ai: ["c...........", "cc..........", "cwc.........", "cwwc........", "cwwwc.......", "cwwwwc......", "cwwcc.......", "cc.cc...r...", "....cc.rwr..", "....cc..r...", "............", "............"],
};
const INK = { c: C.cyan, b: C.blue, w: C.white, r: C.coral, d: C.deep, m: C.mid };

export function drawSprites() {
  const s = Math.max(2, Math.round(P / 2));
  for (const cv of document.querySelectorAll("canvas.spr")) {
    const rows = SPRITES[cv.dataset.s];
    if (!rows) continue;
    const b = buffer(cv, 12, 12);
    cv.style.width = 12 * s + "px"; cv.style.height = 12 * s + "px";
    rows.forEach((row, y) => [...row].forEach((ch, x) => INK[ch] && b.put(x, y, INK[ch])));
    b.flush();
  }
}

