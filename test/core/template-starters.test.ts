import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIndex } from "../../src/core/template-index";
import { applyTemplate, chooseFills, previewProject } from "../../src/core/template-apply";
import { parseTemplate, type Template } from "../../src/core/template";
import { createProject } from "../../src/core/project";

const DIR = join(__dirname, "../../templates");
const files = readdirSync(DIR).filter(f => f.endsWith(".openrolltemplate"));
const load = (f: string): Template => {
  const r = parseTemplate(readFileSync(join(DIR, f), "utf8"));
  if (!r.ok) throw new Error(`${f}: ${r.error}`);
  return r.template;
};

describe("starter templates", () => {
  it("there are between 15 and 20", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.length).toBeLessThanOrEqual(20);
  });

  it.each(files)("%s reads without repairs or anything dropped", f => {
    const text = readFileSync(join(DIR, f), "utf8");
    const r = parseTemplate(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairs).toEqual([]);
    expect(r.template).toEqual(JSON.parse(text));
    expect(f).toBe(`${r.template.id}.openrolltemplate`);
  });

  it.each(files)("%s applies to an empty project and builds a preview", f => {
    const t = load(f);
    const preview = previewProject(t);
    expect(preview.settings.width).toBe(t.frame.width);
    if (t.kind === "timeline") {
      const r = applyTemplate(createProject("x"), t, { at: 0 });
      expect(r.ids.length).toBeGreaterThan(0);
      expect(r.empty.length).toBe(t.slots.length);
      expect(chooseFills(createProject("x"), t, []).fills.size).toBe(0);
    }
  });

  it("the index lists exactly the files in the folder", () => {
    const entries = parseIndex(JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")));
    expect(entries.map(e => e.file).sort()).toEqual([...files].sort());
    for (const e of entries) {
      const t = load(e.file);
      expect([e.id, e.name, e.kind]).toEqual([t.id, t.name, t.kind]);
    }
  });
});
