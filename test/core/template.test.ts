import { describe, expect, it } from "vitest";
import { parseTemplate, sanitizeTemplate, serializeTemplate, TEMPLATE_LIMITS, type Template } from "../../src/core/template";
import { parseIndex } from "../../src/core/template-index";

const S = 1_000_000;

function good(): Record<string, unknown> {
  return {
    format: "openroll-template",
    version: 1,
    id: "hook",
    name: "Hook",
    kind: "timeline",
    frame: { width: 1080, height: 1920 },
    slots: [{ id: "clip1", label: "Clip 1", kind: "visual" }],
    tracks: [
      { kind: "video", name: "Main", main: true, items: [{ type: "slot", slot: "clip1", start: 0, duration: 3 * S, keyframes: { "transform.scale": [{ t: 0, v: 1, ease: "ease" }, { t: 3 * S, v: 1.2, ease: "linear" }] } }] },
      { kind: "text", name: "Title", items: [{ type: "text", start: 0, duration: 2 * S, style: { text: "Wait", size: 120 }, animationIn: { kind: "pop", duration: 300_000 } }] },
    ],
  };
}

const read = (raw: unknown): Template => {
  const r = sanitizeTemplate(raw);
  if (!r.ok) throw new Error(r.error);
  return r.template;
};

describe("template format", () => {
  it("reads a well formed template and works out its length", () => {
    const t = read(good());
    expect(t.duration).toBe(3 * S);
    expect(t.slots).toHaveLength(1);
    expect(t.tracks[1].items[0]).toMatchObject({ type: "text", style: { text: "Wait", size: 120, font: "Familjen Grotesk", align: "center" } });
  });

  it("round trips through its own text unchanged", () => {
    const t = read(good());
    const again = parseTemplate(serializeTemplate(t));
    expect(again.ok && again.template).toEqual(t);
  });

  it("refuses what is not a template, or is from the future", () => {
    expect(parseTemplate("").ok).toBe(false);
    expect(parseTemplate("{nope").ok).toBe(false);
    expect(parseTemplate(JSON.stringify({ format: "openroll", version: 1 })).ok).toBe(false);
    const future = sanitizeTemplate({ ...good(), version: 2 });
    expect(future.ok).toBe(false);
    expect(!future.ok && future.error).toMatch(/newer version/);
    expect(sanitizeTemplate({ ...good(), tracks: [] }).ok).toBe(false);
    expect(sanitizeTemplate({ ...good(), name: "  " }).ok).toBe(false);
  });

  it("makes an id from the name when the given one is unsafe", () => {
    const t = read({ ...good(), id: "../../etc/passwd" });
    expect(t.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(t.id.startsWith("hook-")).toBe(true);
  });

  it("packs the main track and drops what would overlap on another lane", () => {
    const raw = good();
    (raw.tracks as { items: unknown[] }[])[0].items.push({ type: "slot", slot: "clip1", start: 10 * S, duration: S });
    (raw.tracks as unknown[]).push({ kind: "video", name: "Over", items: [{ type: "color", color: "#112233", start: 0, duration: 2 * S }, { type: "color", color: "#445566", start: S, duration: 2 * S }] });
    const t = read(raw);
    expect(t.tracks[0].items.map(i => i.start)).toEqual([0, 3 * S]);
    expect(t.tracks[2].items).toHaveLength(1);
  });

  it("keeps items in lanes that suit them and drops the rest", () => {
    const raw = good();
    (raw.tracks as { items: unknown[] }[])[1].items.push({ type: "color", color: "#000000", start: 3 * S, duration: S });
    (raw.tracks as { items: unknown[] }[])[0].items.push({ type: "text", start: 0, duration: S, style: { text: "x" } }, { type: "slot", slot: "ghost", start: 0, duration: S });
    const t = read(raw);
    expect(t.tracks[0].items).toHaveLength(1);
    expect(t.tracks[1].items).toHaveLength(1);
  });
});

describe("hostile templates", () => {
  it("never lets prototype keys through", () => {
    const text = JSON.stringify(good()).replace('"keyframes":{', '"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"keyframes":{"__proto__":[{"t":0,"v":1}],"constructor":[],');
    const r = parseTemplate(text);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const dump = JSON.stringify(r.ok ? r.template : null);
    expect(dump).not.toContain("polluted");
    expect(dump).not.toContain("__proto__");
    if (r.ok) expect(Object.keys((r.template.tracks[0].items[0] as { keyframes: object }).keyframes)).toEqual(["transform.scale"]);
  });

  it("drops fields it does not know, including anything that looks like a file", () => {
    const raw = good();
    const item = (raw.tracks as { items: Record<string, unknown>[] }[])[0].items[0];
    Object.assign(item, { mediaId: "m1", path: "/Users/me/secret.mp4", src: "file:///etc/passwd", mediaFile: "C:\\x.mov", extra: { deep: true } });
    Object.assign(raw, { media: { m1: { path: "/Users/me/secret.mp4" } }, luts: {}, notes: "x" });
    const dump = JSON.stringify(read(raw));
    for (const bad of ["mediaId", "secret", "passwd", "C:", "extra", "luts", "notes"]) expect(dump).not.toContain(bad);
  });

  it("clamps numbers and drops values that are not numbers", () => {
    const raw = good();
    const text = (raw.tracks as { items: Record<string, unknown>[] }[])[1].items[0];
    Object.assign(text, { start: -5, duration: 1e18, transform: { x: 1e12, scale: -4, opacity: 9, rotation: "spin", y: null } });
    (text.style as Record<string, unknown>).size = 1e9;
    const item = read(raw).tracks[1].items[0];
    expect(item.start).toBe(0);
    expect(item.duration).toBe(TEMPLATE_LIMITS.time);
    expect(item.transform).toEqual({ x: 20000, scale: 0.01, opacity: 1 });
    expect(item.type === "text" && item.style.size).toBe(1000);
  });

  it("only accepts plain colours and font names", () => {
    const raw = good();
    const text = (raw.tracks as { items: Record<string, unknown>[] }[])[1].items[0];
    text.style = { text: "x", color: "red; background:url(http://evil)", font: 'x"; src: url(//evil)', background: { color: "javascript:1", padding: 5, radius: 2 }, shadow: { color: "rgba(0,0,0,0.5)", blur: 4, x: 0, y: 0 } };
    const item = read(raw).tracks[1].items[0];
    if (item.type !== "text") throw new Error("text expected");
    expect(item.style.color).toBe("#ffffff");
    expect(item.style.font).toBe("Familjen Grotesk");
    expect(item.style.background?.color).toBe("#000000");
    expect(item.style.shadow?.color).toBe("rgba(0,0,0,0.5)");
  });

  it("allows only known transitions, effects, filters, stickers and animation kinds", () => {
    const raw = good();
    const slot = (raw.tracks as { items: Record<string, unknown>[] }[])[0].items[0];
    Object.assign(slot, {
      transitionIn: { kind: "../../x", duration: S },
      animationIn: { kind: "explode", duration: S },
      filter: { id: "lut:abc", amount: 1 },
      effects: [{ kind: "thump", amount: 0.4 }, { kind: "rm -rf", amount: 1 }, { kind: "sharpen", amount: 1 }],
      layout: "diagonal",
    });
    const out = read(raw).tracks[0].items[0];
    if (out.type !== "slot") throw new Error("slot expected");
    expect(out.transitionIn).toBeUndefined();
    expect(out.animationIn).toBeUndefined();
    expect(out.filter).toBeUndefined();
    expect(out.layout).toBeUndefined();
    expect(out.effects?.map(e => e.kind)).toEqual(["thump"]);
    const shape = { type: "shape", start: 0, duration: S, width: 10, height: 10, shape: { kind: "sticker", sticker: "nope", color: "#ffffff" } };
    (raw.tracks as unknown[]).push({ kind: "video", name: "S", items: [shape] });
    expect(read(raw).tracks).toHaveLength(2);
  });

  it("limits keyframe paths so a key cannot name an effect by id or reach into the model", () => {
    const raw = good();
    const slot = (raw.tracks as { items: Record<string, unknown>[] }[])[0].items[0];
    slot.keyframes = { "fx:abc:amount": [{ t: 0, v: 1 }], "media.path": [{ t: 0, v: 1 }], "adjust.exposure": [{ t: 0, v: 5, ease: "boom" }], "transform.x": [{ t: 5 * S, v: Infinity }, { t: S, v: 4 }] };
    const out = read(raw).tracks[0].items[0];
    expect(Object.keys((out as { keyframes: object }).keyframes)).toEqual(["adjust.exposure", "transform.x"]);
    expect((out as { keyframes: Record<string, unknown[]> }).keyframes["adjust.exposure"]).toEqual([{ t: 0, v: 5, ease: "ease" }]);
  });

  it("caps counts, sizes and lengths", () => {
    const raw = good();
    const many = Array.from({ length: 500 }, (_, i) => ({ type: "text", start: i * 100_000, duration: 100_000, style: { text: "t".repeat(5000) } }));
    (raw.tracks as unknown[]).push(...Array.from({ length: 40 }, (_, n) => ({ kind: "text", name: "n".repeat(500), items: many.map(m => ({ ...m, start: m.start + n * 1e9 })) })));
    raw.slots = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, label: "x".repeat(100), kind: "visual" }));
    raw.tags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    raw.description = "d".repeat(10_000);
    const t = read(raw);
    expect(t.tracks.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.tracks);
    expect(t.tracks.reduce((n, tr) => n + tr.items.length, 0)).toBeLessThanOrEqual(TEMPLATE_LIMITS.items);
    expect(t.tags!.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.tags);
    expect(t.description!.length).toBe(300);
    for (const tr of t.tracks) for (const i of tr.items) if (i.type === "text") expect(i.style.text.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.text);
    expect(parseTemplate("x".repeat(TEMPLATE_LIMITS.bytes + 1)).ok).toBe(false);
  });

  it("drops slots nothing uses and slots with unsafe ids", () => {
    const raw = good();
    raw.slots = [{ id: "clip1", label: "Clip 1" }, { id: "../x", label: "Bad" }, { id: "clip1", label: "Twin" }, { id: "spare", label: "Spare" }];
    expect(read(raw).slots.map(s => s.id)).toEqual(["clip1"]);
  });

  it("reads a caption style and refuses an empty one", () => {
    const style = { id: "cap", name: "Cap", kind: "captions", format: "openroll-template", version: 1, frame: { width: 1080, height: 1920 }, captions: { style: { size: 80, weight: 800, text: "ignored" }, highlight: "#f2c23a", y: 9 } };
    const t = read(style);
    expect(t.captions).toMatchObject({ highlight: "#f2c23a", y: 0.5, style: { size: 80, text: "" } });
    expect(sanitizeTemplate({ ...style, captions: "x" }).ok).toBe(false);
  });
});

describe("community index", () => {
  const entry = { id: "a-b", name: "A", file: "a-b.openrolltemplate", kind: "timeline", tags: ["x"] };
  it("keeps good entries and skips the rest", () => {
    const list = parseIndex({
      format: "openroll-template-index",
      templates: [
        entry,
        { ...entry, id: "a-b" },
        { ...entry, id: "c", file: "../c.openrolltemplate" },
        { ...entry, id: "d", file: "https://evil.example/d.openrolltemplate" },
        { ...entry, id: "E F", file: "e.openrolltemplate" },
        { ...entry, id: "g", file: "g.openrolltemplate", kind: "movie" },
        { ...entry, id: "h", file: "h.openrolltemplate", name: "" },
        null,
        "x",
      ],
    });
    expect(list.map(e => e.id)).toEqual(["a-b"]);
  });

  it("returns nothing for the wrong document", () => {
    expect(parseIndex(null)).toEqual([]);
    expect(parseIndex({ templates: [entry] })).toEqual([]);
    expect(parseIndex({ format: "openroll-template-index", templates: "x" })).toEqual([]);
  });
});
