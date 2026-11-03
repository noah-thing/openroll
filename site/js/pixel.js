// Shared pixel tools: the palette, deterministic noise and the two bitmap faces drawn for this site.

const hex = h => {
  const n = parseInt(h.slice(1), 16);
  return 0xff000000 | (n & 0xff) << 16 | (n & 0xff00) | (n >> 16 & 0xff);
};

export const C = {
  space: hex("#000207"), cyan: hex("#50ecfc"), ice: hex("#a6f1ff"), white: hex("#f3fcff"),
  blue: hex("#1ea9e7"), blue2: hex("#1590d6"), mid: hex("#0d78c6"), mid2: hex("#0b67b0"),
  deep: hex("#0a4a8e"), ocean: hex("#0b52a0"), deep2: hex("#073873"), navy: hex("#0b2544"), abyss: hex("#061a36"),
  trench: hex("#04122a"), floor: hex("#020a18"),
  coral: hex("#f23e42"), coralHi: hex("#ff7469"), coralLo: hex("#7c1322"),
  dimBlue: hex("#1c4f9a"), faint: hex("#0b2a5a"),
  sand: hex("#13284a"), sandHi: hex("#1f3d68"), sandLo: hex("#0d1d38"), rock: hex("#091529"), rockHi: hex("#16294b"),
  kelp: hex("#0f5a66"), kelpHi: hex("#17808a"), kelpLo: hex("#0a3d48"),
};
export const css = c => "#" + [c & 0xff, c >> 8 & 0xff, c >> 16 & 0xff].map(v => v.toString(16).padStart(2, "0")).join("");

export const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
export function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = t => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

// One art pixel is this many CSS pixels everywhere on the page.
export let P = 6;
export function pixelSize() {
  P = Math.max(3, Math.min(8, Math.round(innerWidth / 240)));
  document.documentElement.style.setProperty("--p", P + "px");
  return P;
}

// A pixel buffer that draws into a canvas at one art pixel per canvas pixel.
export function buffer(canvas, w, h) {
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d"), img = g.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  const put = (x, y, c) => {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c;
  };
  return { w, h, px, put, flush: () => g.putImageData(img, 0, 0) };
}

// The title face, 12 by 14 with four pixel strokes.
export const BIG = {
  O: ["..########..", ".##########.", "############", "####....####", "####....####", "####....####", "####....####", "####....####", "####....####", "####....####", "####....####", "############", ".##########.", "..########.."],
  P: ["##########..", "###########.", "############", "####....####", "####....####", "####....####", "############", "###########.", "##########..", "####........", "####........", "####........", "####........", "####........"],
  E: ["###########", "###########", "###########", "####.......", "####.......", "##########.", "##########.", "##########.", "####.......", "####.......", "####.......", "###########", "###########", "###########"],
  R: ["##########..", "###########.", "############", "####....####", "####....####", "####....####", "############", "###########.", "##########..", "####..####..", "####...####.", "####....####", "####....####", "####....####"],
  L: ["####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "####.......", "###########", "###########", "###########"],
  "0": [".########.", "##########", "##########", "####..####", "####..####", "####..####", "####..####", "####..####", "####..####", "####..####", "####..####", "##########", "##########", ".########."],
};
BIG.N = Array.from({ length: 14 }, (_, r) => {
  const row = Array(12).fill(".");
  for (let c = 0; c < 4; c++) row[c] = row[c + 8] = "#";
  const d = 4 + Math.floor(r * 4 / 14);
  for (let c = d; c < d + 3 && c < 8; c++) row[c] = "#";
  if (r < 2) row[4] = "#";
  return row.join("");
});

// Bevel a mask the way the title is shaded: light on top, shade underneath, a two row drop.
export function bevel(on, W, H, px, { sweep = -99, top = 0 } = {}) {
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && on[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y)) continue;
    if (at(x, y - 1) || at(x - 1, y - 1)) px[y * W + x] = C.deep2;
    else if (at(x, y - 2) || at(x - 1, y - 2)) px[y * W + x] = C.navy;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    let c;
    if (!at(x, y - 1)) c = C.cyan;
    else if (!at(x - 1, y)) c = C.blue2;
    else if (!at(x, y + 1)) c = C.mid2;
    else if (!at(x + 1, y)) c = C.mid;
    else c = y - top > 8 ? C.blue2 : C.blue;
    const s = x + (y - top) * 0.6 - sweep;
    if (s > 0 && s < 3 && c !== C.mid2) c = s < 1.5 ? C.white : C.ice;
    px[y * W + x] = c;
  }
}

// The small face, 5 by 7, for the red lines.
export const SMALL = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"], F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"], O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."], R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."], T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"], W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."], X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  ",": ["..", "..", "..", "..", "..", ".#", "#."], " ": ["..", "..", "..", "..", "..", "..", ".."],
};
// pairs that sit too far apart on a fixed grid get pulled in by one pixel
const KERN = { LT: -1, TA: -1, AT: -1, "T,": -1 };
const advance = (ch, next) => SMALL[ch][0].length + 1 + (KERN[ch + next] || 0);
export const measureSmall = text => [...text].reduce((w, ch, i) => w + advance(ch, text[i + 1]), -1);

export function drawSmall(canvas, lines, scale, { color = C.coral, hi = C.coralHi, lo = C.coralLo } = {}) {
  const W = Math.max(...lines.map(measureSmall)), H = lines.length * 10 - 2;
  const b = buffer(canvas, W, H);
  canvas.style.width = W * scale + "px"; canvas.style.height = H * scale + "px";
  const cells = [];
  lines.forEach((text, li) => {
    let x = Math.floor((W - measureSmall(text)) / 2);
    [...text].forEach((ch, k) => {
      SMALL[ch].forEach((r, y) => [...r].forEach((c, i) => c === "#" && cells.push([x + i, y + li * 10])));
      x += advance(ch, text[k + 1]);
    });
  });
  if (lo) for (const [x, y] of cells) b.put(x, y + 1, lo);
  for (const [x, y] of cells) b.put(x, y, y % 10 === 0 ? hi : color);
  b.flush();
}
