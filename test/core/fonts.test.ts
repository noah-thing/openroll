import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/core/agent/ops";
import { CAPTION_PRESETS, DEFAULT_CHOICE, templateFor } from "../../src/core/caption-styles";
import { addMedia } from "../../src/core/edit";
import { DEFAULT_FONT, FONTS, fontStack, fontWeights, isKnownFont, safeFont, snapWeight } from "../../src/core/fonts";
import { readProject } from "../../src/core/load";
import { createProject, type CaptionItem, type Project, type TextItem } from "../../src/core/project";

const FONT_DIR = join(import.meta.dirname, "../../src/renderer/fonts");

const style = { text: "Hello", font: DEFAULT_FONT, size: 64, weight: 600, color: "#fff", align: "center" as const, lineHeight: 1.1, letterSpacing: 0 };

function withText(font: unknown, type: "text" | "caption" = "text"): string {
  const p = createProject("t") as unknown as Project;
  const item = { id: "i1", type, start: 0, duration: 1_000_000, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, style: { ...style, font }, ...(type === "caption" ? { words: [] } : {}) };
  const text = p.tracks.find(t => t.kind === "text") ?? { id: "tt", kind: "text", name: "Text", items: [] };
  const doc = { ...p, tracks: [...p.tracks.filter(t => t !== text), { ...text, items: [item] }] };
  return JSON.stringify(doc);
}

const loadedStyle = (text: string) => {
  const r = readProject(text);
  if (!r.ok) throw new Error(r.error);
  const item = r.project.tracks.flatMap(t => t.items).find(i => i.type === "text" || i.type === "caption") as TextItem | CaptionItem;
  return { font: item.style.font, repairs: r.repairs };
};

describe("font catalog", () => {
  it("ships both Latin subsets for every family, and a sane weight range", () => {
    for (const f of FONTS) {
      const subsets = f.latinOnly ? ["latin"] : ["latin", "latin-ext"];
      for (const s of subsets) expect(existsSync(join(FONT_DIR, `${f.file}-${s}.woff2`)), `${f.file}-${s}`).toBe(true);
      expect(f.minWeight).toBeLessThanOrEqual(f.maxWeight);
      expect(f.minWeight % 100).toBe(0);
    }
    expect(new Set(FONTS.map(f => f.family)).size).toBe(FONTS.length);
  });

  it("stays small enough to ship", () => {
    let bytes = 0;
    for (const f of FONTS) for (const s of ["latin", "latin-ext"]) {
      const file = join(FONT_DIR, `${f.file}-${s}.woff2`);
      if (existsSync(file)) bytes += statSync(file).size;
    }
    expect(bytes).toBeLessThan(1_000_000);
  });

  it("lists the weights a font has and snaps to them", () => {
    expect(fontWeights("Anton")).toEqual([400]);
    expect(fontWeights("Inter")).toEqual([300, 400, 500, 600, 700, 800]);
    expect(snapWeight("Anton", 700)).toBe(400);
    expect(snapWeight("Familjen Grotesk", 300)).toBe(400);
    expect(snapWeight("Inter", 900)).toBe(800);
    expect(snapWeight("Georgia, serif", 700)).toBe(700);
  });

  it("builds a stack with a generic fallback", () => {
    expect(fontStack("Playfair Display")).toBe('"Playfair Display", serif');
    expect(fontStack("JetBrains Mono")).toBe('"JetBrains Mono", monospace');
    expect(fontStack("Georgia, serif")).toBe("Georgia, serif");
  });

  it("falls back to the default for anything it does not bundle", () => {
    expect(safeFont("Comic Sans MS")).toBe(DEFAULT_FONT);
    expect(safeFont(42)).toBe(DEFAULT_FONT);
    expect(safeFont("Bebas Neue")).toBe("Bebas Neue");
    expect(isKnownFont("Georgia, serif")).toBe(true);
  });
});

describe("fonts in saved projects", () => {
  it("opens a project made before the picker without touching it", () => {
    expect(loadedStyle(withText("Familjen Grotesk"))).toEqual({ font: "Familjen Grotesk", repairs: [] });
    expect(loadedStyle(withText("Georgia, serif"))).toEqual({ font: "Georgia, serif", repairs: [] });
  });

  it("keeps a chosen font on text and captions", () => {
    expect(loadedStyle(withText("Anton")).font).toBe("Anton");
    expect(loadedStyle(withText("Caveat", "caption")).font).toBe("Caveat");
  });

  it("replaces a font it does not know and says so", () => {
    expect(loadedStyle(withText("Papyrus"))).toEqual({ font: DEFAULT_FONT, repairs: ["font"] });
    expect(loadedStyle(withText(7, "caption"))).toEqual({ font: DEFAULT_FONT, repairs: ["font"] });
  });

  it("gives a style with no font the default quietly", () => {
    expect(loadedStyle(withText(undefined))).toEqual({ font: DEFAULT_FONT, repairs: [] });
  });
});

describe("fonts in captions", () => {
  const project = createProject("t");
  it("applies a chosen font over the look's own and snaps the weight", () => {
    const loud = templateFor({ ...DEFAULT_CHOICE, preset: "outline", font: "Anton" }, project);
    expect(loud.style.font).toBe("Anton");
    expect(loud.style.weight).toBe(400);
    expect(templateFor(DEFAULT_CHOICE, project).style.font).toBe(CAPTION_PRESETS.find(p => p.id === DEFAULT_CHOICE.preset)!.style.font);
  });

  it("only uses bundled fonts in the built in looks", () => {
    for (const p of CAPTION_PRESETS) expect(isKnownFont(p.style.font), p.id).toBe(true);
  });
});

describe("fonts in AI edits", () => {
  const base = () => addMedia(createProject("t"), []);
  const textOf = (p: Project) => p.tracks.flatMap(t => t.items).find((i): i is TextItem => i.type === "text")!;

  it("sets a font on new text and snaps the weight to what it has", () => {
    const { project } = applyOps(base(), [{ op: "add_text", text: "Go", at: 0, style: { font: "Bebas Neue", weight: 700 } }]);
    expect(textOf(project).style).toMatchObject({ font: "Bebas Neue", weight: 400 });
  });

  it("changes the font of existing text with set", () => {
    const first = applyOps(base(), [{ op: "add_text", text: "Go", at: 0 }]);
    const { project } = applyOps(first.project, [{ op: "set", id: textOf(first.project).id, props: { style: { font: "Playfair Display" } } }]);
    expect(textOf(project).style.font).toBe("Playfair Display");
  });

  it("refuses a font that is not bundled and lists the ones that are", () => {
    expect(() => applyOps(base(), [{ op: "add_text", text: "Go", at: 0, style: { font: "Helvetica" } }])).toThrow(/Available: .*Inter/);
  });
});
