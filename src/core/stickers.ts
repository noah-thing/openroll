// Our own sticker set, drawn as vector paths on a 100 by 100 grid with one stroke
// weight, round caps and round joins, so every piece looks like it came from one hand.
// The same data feeds the panel previews (SVG) and the compositor (Path2D on a canvas).

export type Paint = "stroke" | "fill" | "soft" | "ink" | "inkfill" | "red";

export interface StickerPath {
  d: string;
  paint: Paint;
}

export type StickerGroup = "Arrows" | "Marks" | "Emphasis" | "Bubbles" | "Faces";
export const STICKER_GROUPS: StickerGroup[] = ["Arrows", "Marks", "Emphasis", "Bubbles", "Faces"];

export interface StickerDef {
  id: string;
  name: string;
  group: StickerGroup;
  paths: StickerPath[];
  /** Colour it starts with; faces start yellow, marks may carry their own. */
  color: string;
}

/** Line weight on the 100 grid. */
export const LINE = 6;
export const INK = "#14130e";
export const RED = "#e2674f";

const r = (n: number) => Math.round(n * 10) / 10;

/** Two short strokes at `tip`, swept back along the direction the line arrives from. */
function head(tip: [number, number], from: [number, number], size = 22, spread = 36): string {
  const dx = from[0] - tip[0], dy = from[1] - tip[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const a = (spread * Math.PI) / 180;
  const arm = (s: number): [number, number] => [tip[0] + size * (ux * Math.cos(s) - uy * Math.sin(s)), tip[1] + size * (ux * Math.sin(s) + uy * Math.cos(s))];
  const [x1, y1] = arm(a), [x2, y2] = arm(-a);
  return `M${r(x1)} ${r(y1)}L${tip[0]} ${tip[1]}L${r(x2)} ${r(y2)}`;
}

function star(cx: number, cy: number, outer: number, inner: number, points: number, turn = -Math.PI / 2): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? inner : outer;
    const a = turn + (i * Math.PI) / points;
    out.push(`${i ? "L" : "M"}${r(cx + rad * Math.cos(a))} ${r(cy + rad * Math.sin(a))}`);
  }
  return out.join("") + "Z";
}

const circle = (cx: number, cy: number, rad: number) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0Z`;
const S = (d: string): StickerPath => ({ d, paint: "stroke" });
const F = (d: string): StickerPath => ({ d, paint: "fill" });
const SOFT = (d: string): StickerPath => ({ d, paint: "soft" });
const INKS = (d: string): StickerPath => ({ d, paint: "ink" });
const INKF = (d: string): StickerPath => ({ d, paint: "inkfill" });
const REDF = (d: string): StickerPath => ({ d, paint: "red" });

const FACE = "#f2c23a";
const face = (...features: StickerPath[]): StickerPath[] => [F(circle(50, 50, 42)), ...features];
const eyes = (): StickerPath[] => [INKF(circle(36, 41, 5)), INKF(circle(64, 41, 5))];
const bubble = (d: string): StickerPath[] => [SOFT(d), S(d)];

const def = (id: string, name: string, group: StickerGroup, paths: StickerPath[], color = group === "Faces" ? FACE : "#ffffff"): StickerDef => ({ id, name, group, paths, color });

export const STICKERS: StickerDef[] = [
  def("arrow-right", "Arrow", "Arrows", [S(`M12 50H86${head([88, 50], [60, 50])}`)]),
  def("arrow-up", "Arrow up", "Arrows", [S(`M50 88V14${head([50, 12], [50, 40])}`)]),
  def("arrow-curve", "Curved arrow", "Arrows", [S(`M14 78C20 34 50 18 80 34${head([82, 35], [52, 18])}`)]),
  def("arrow-swoop", "Swoop arrow", "Arrows", [S(`M82 16C40 18 18 44 28 80${head([28, 84], [24, 56])}`)]),
  def("arrow-elbow", "Elbow arrow", "Arrows", [S(`M16 18V62Q16 76 30 76H82${head([86, 76], [58, 76])}`)]),
  def("arrow-double", "Double arrow", "Arrows", [S(`M16 50H84${head([12, 50], [40, 50])}${head([88, 50], [60, 50])}`)]),

  def("ring", "Circle", "Marks", [S("M56 11C78 14 92 32 89 54C86 76 66 90 44 88C22 86 9 66 12 44C15 24 32 11 58 13")]),
  def("underline", "Underline", "Marks", [S("M8 60C30 56 62 62 92 54")]),
  def("wavy", "Wavy underline", "Marks", [S("M8 56q10.5-14 21 0t21 0t21 0t21 0")]),
  def("highlight", "Highlight", "Marks", [SOFT("M14 34H86Q94 34 94 42V58Q94 66 86 66H14Q6 66 6 58V42Q6 34 14 34Z")], "#f2c23a"),
  def("check", "Check", "Marks", [S("M18 52L40 74L84 26")], "#8fd7a8"),
  def("cross", "Cross", "Marks", [S("M24 24L76 76M76 24L24 76")], "#ef7b6c"),
  def("brackets", "Brackets", "Marks", [S("M32 14H16V86H32M68 14H84V86H68")]),

  def("burst", "Burst", "Emphasis", [S(star(50, 50, 42, 30, 12))]),
  def("pow", "Pow", "Emphasis", [F(star(50, 50, 44, 28, 9, -Math.PI / 2 + 0.2))], "#f2c23a"),
  def("sparkle", "Sparkle", "Emphasis", [F("M50 8C54 34 66 46 92 50C66 54 54 66 50 92C46 66 34 54 8 50C34 46 46 34 50 8Z")]),
  def("star", "Star", "Emphasis", [F(star(50, 53, 42, 18, 5))], "#f2c23a"),
  def("heart", "Heart", "Emphasis", [F("M50 86C20 62 10 46 10 32C10 20 19 12 30 12C39 12 46 17 50 25C54 17 61 12 70 12C81 12 90 20 90 32C90 46 80 62 50 86Z")], "#e2674f"),
  def("bolt", "Bolt", "Emphasis", [F("M58 8L22 54H46L40 92L78 44H54Z")], "#f2c23a"),
  def("shock", "Shock lines", "Emphasis", [S("M50 10V32M17 24L31 41M83 24L69 41")]),
  def("pin", "Pin", "Emphasis", [F("M50 92C30 68 22 56 22 40A28 28 0 0 1 78 40C78 56 70 68 50 92Z"), INKS(circle(50, 40, 9))], "#e2674f"),

  def("speech", "Speech bubble", "Bubbles", bubble("M22 14H78Q90 14 90 26V54Q90 66 78 66H46L26 86V66H22Q10 66 10 54V26Q10 14 22 14Z")),
  def("thought", "Thought bubble", "Bubbles", [...bubble("M50 12C74 12 90 24 90 42C90 60 74 72 50 72C26 72 10 60 10 42C10 24 26 12 50 12Z"), S(circle(32, 84, 5)), S(circle(20, 94, 2.5))]),
  def("shout", "Shout", "Bubbles", bubble(star(50, 50, 44, 33, 11))),
  def("callout", "Callout", "Bubbles", bubble("M12 16H88V62H40L22 84V62H12Z")),

  def("smile", "Smile", "Faces", face(...eyes(), INKS("M30 58Q50 80 70 58"))),
  def("grin", "Grin", "Faces", face(...eyes(), INKF("M28 56H72Q70 80 50 80Q30 80 28 56Z"))),
  def("wink", "Wink", "Faces", face(INKF(circle(36, 41, 5)), INKS("M57 42Q64 34 72 42"), INKS("M30 58Q50 80 70 58"))),
  def("wow", "Surprised", "Faces", face(...eyes(), INKF("M50 58a7 10 0 1 0 0.01 0Z"))),
  def("sad", "Sad", "Faces", face(...eyes(), INKS("M32 74Q50 56 68 74"))),
  def("cool", "Cool", "Faces", face(INKF("M18 34H46V48Q46 58 38 58H28Q18 58 18 48ZM54 34H82V48Q82 58 74 58H64Q54 58 54 48Z"), INKS("M46 38H54"), INKS("M32 70Q50 84 68 70"))),
  def("love", "Love", "Faces", face(REDF("M36 52C26 45 24 38 29 34C32 32 35 33 36 36C37 33 40 32 43 34C48 38 46 45 36 52Z"), REDF("M64 52C54 45 52 38 57 34C60 32 63 33 64 36C65 33 68 32 71 34C76 38 74 45 64 52Z"), INKS("M30 62Q50 84 70 62"))),
];

export function stickerById(id: string | undefined): StickerDef | undefined {
  return STICKERS.find(s => s.id === id);
}

/** SVG markup for previews. Same geometry and paint rules as the canvas drawing. */
export function stickerSvg(sticker: StickerDef, color: string, weight = 1): string {
  return sticker.paths
    .map(p => {
      const d = `d="${p.d}"`;
      const line = `stroke-width="${LINE * weight}" stroke-linecap="round" stroke-linejoin="round"`;
      switch (p.paint) {
        case "stroke":
          return `<path ${d} fill="none" stroke="${color}" ${line}/>`;
        case "fill":
          return `<path ${d} fill="${color}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        case "soft":
          return `<path ${d} fill="${color}" fill-opacity="0.32"/>`;
        case "ink":
          return `<path ${d} fill="none" stroke="${INK}" ${line}/>`;
        case "inkfill":
          return `<path ${d} fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
        case "red":
          return `<path ${d} fill="${RED}"/>`;
      }
    })
    .join("");
}
