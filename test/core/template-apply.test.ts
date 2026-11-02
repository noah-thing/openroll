import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/core/agent/ops";
import { addMedia, insertItems, mediaItem } from "../../src/core/edit";
import { History } from "../../src/core/history";
import { allCaptions } from "../../src/core/captions";
import { createProject, mainTrack, type CaptionItem, type MediaRef, type Project } from "../../src/core/project";
import { sanitizeTemplate, type Template } from "../../src/core/template";
import { applyCaptionStyle, applyTemplate, chooseFills, previewProject } from "../../src/core/template-apply";
import { captureTemplate } from "../../src/core/template-capture";

const S = 1_000_000;
const ref = (id: string, seconds: number, kind: MediaRef["kind"] = "video"): MediaRef => ({
  id, kind, path: `/m/${id}.mp4`, name: `${id}.mp4`, size: 1, mtime: 0, duration: seconds * S, hasAudio: kind !== "image", hasVideo: kind !== "audio", width: 1920, height: 1080,
});

function make(raw: Record<string, unknown>): Template {
  const r = sanitizeTemplate({ format: "openroll-template", version: 1, id: "t", name: "T", kind: "timeline", frame: { width: 1920, height: 1080 }, ...raw });
  if (!r.ok) throw new Error(r.error);
  return r.template;
}

const cuts = make({
  slots: [{ id: "a", label: "Clip 1" }, { id: "b", label: "Clip 2" }, { id: "m", label: "Music", kind: "audio" }],
  markers: [{ t: 0 }, { t: S }],
  tracks: [
    { kind: "video", name: "Main", main: true, items: [
      { type: "slot", slot: "a", start: 0, duration: 2 * S, keyframes: { "transform.scale": [{ t: 0, v: 1.2 }, { t: 2 * S, v: 1 }] } },
      { type: "slot", slot: "b", start: 2 * S, duration: 2 * S, transitionIn: { kind: "dissolve", duration: 400_000 } },
    ] },
    { kind: "audio", name: "Music", items: [{ type: "slot", slot: "m", start: 0, duration: 4 * S }] },
    { kind: "text", name: "Title", items: [{ type: "text", start: S, duration: 2 * S, transform: { y: -300 }, style: { text: "Hello", size: 100 } }] },
  ],
});

function withMedia(): Project {
  return addMedia(createProject("p"), [ref("one", 10), ref("two", 1), ref("song", 30, "audio")]);
}

describe("a new frame shape", () => {
  const shapes = make({
    frame: { width: 1920, height: 1080 },
    tracks: [
      { kind: "video", name: "Shapes", items: [
        { type: "shape", start: 0, duration: S, shape: { kind: "ellipse", color: "#ffffff" }, width: 200, height: 200 },
        { type: "shape", start: S, duration: S, shape: { kind: "rect", color: "#ffffff" }, width: 1920, height: 100 },
      ] },
    ],
  });

  it("keeps a circle round and lets a full width bar span the new width", () => {
    const portrait = { ...createProject("p"), settings: { ...createProject("p").settings, width: 1080, height: 1920 } };
    const items = applyTemplate(portrait, shapes, { at: 0 }).project.tracks.flatMap(t => t.items);
    const circle = items.find(i => i.type === "shape" && i.shape.kind === "ellipse");
    const bar = items.find(i => i.type === "shape" && i.shape.kind === "rect");
    expect(circle?.type === "shape" && circle.width).toBe(circle?.type === "shape" ? circle.height : -1);
    expect(bar?.type === "shape" && bar.width).toBe(1080);
  });
});

describe("chooseFills", () => {
  it("does not take clips from a locked track, which the template could not replace", () => {
    const p = withMedia();
    const placed = insertItems(p, [mediaItem(p.media.one, 0)], { trackId: mainTrack(p).id });
    const clip = mainTrack(placed).items[0];
    expect(chooseFills(placed, cuts, [clip.id]).consume).toEqual([clip.id]);
    mainTrack(placed).locked = true;
    expect(chooseFills(placed, cuts, [clip.id]).consume).toEqual([]);
  });
});

describe("applyTemplate", () => {
  it("fills slots in order from the library, trims to the slot, and puts the song on audio", () => {
    const p = withMedia();
    const plan = chooseFills(p, cuts, []);
    const r = applyTemplate(p, cuts, { at: 0, fills: plan.fills });
    const main = mainTrack(r.project).items;
    expect(main.map(i => i.type === "media" && i.mediaId)).toEqual(["one", "two"]);
    // The second file is only one second long, so its slot shortens to fit.
    expect(main.map(i => [i.start, i.duration])).toEqual([[0, 2 * S], [2 * S, S]]);
    expect(r.filled).toBe(3);
    expect(r.empty).toEqual([]);
    expect(r.project.tracks.find(t => t.kind === "audio")!.items.some(i => i.type === "media" && i.mediaId === "song")).toBe(true);
    expect(r.project.markers).toHaveLength(2);
  });

  it("leaves marked empty slots when there is nothing to fill them with", () => {
    const r = applyTemplate(createProject("p"), cuts, { at: 0 });
    expect(r.filled).toBe(0);
    expect(r.empty).toEqual(["Clip 1", "Clip 2", "Music"]);
    const names = r.project.tracks.flatMap(t => t.items.map(i => i.name));
    expect(names).toContain("Empty slot: Clip 1");
    expect(names).toContain("Clip 2 label");
    expect(r.project.tracks.some(t => t.kind === "audio" && t.items.length)).toBe(false);
    expect(Object.keys(r.project.media)).toHaveLength(0);
  });

  it("puts text above pictures and times overlays from where the template begins", () => {
    let p = insertItems(withMedia(), [mediaItem(ref("one", 10), 0)]);
    p = { ...p, media: { ...p.media } };
    const r = applyTemplate(p, cuts, { at: 10 * S });
    expect(r.start).toBe(10 * S);
    const text = r.project.tracks.flatMap(t => t.items).find(i => i.type === "text" && i.style.text === "Hello")!;
    expect(text.start).toBe(11 * S);
    expect(r.project.tracks[0].kind).toBe("text");
  });

  it("is one history step and leaves the old project alone", () => {
    const p = withMedia();
    const before = JSON.stringify(p);
    const h = new History();
    const next = applyTemplate(p, cuts, { at: 0, fills: chooseFills(p, cuts, []).fills }).project;
    h.push(p, "Add T");
    expect(JSON.stringify(p)).toBe(before);
    expect(h.undo(next)!.project).toBe(p);
    expect(h.undo(p)).toBeNull();
  });

  it("uses selected clips, replaces them, and keeps their in point", () => {
    let p = withMedia();
    const a = mediaItem(p.media.one, 0);
    a.in = 3 * S;
    a.duration = 4 * S;
    const b = mediaItem(p.media.two, 4 * S);
    p = insertItems(p, [a, b]);
    const plan = chooseFills(p, cuts, [b.id, a.id]);
    expect(plan.consume.sort()).toEqual([a.id, b.id].sort());
    expect(plan.at).toBe(0);
    const r = applyTemplate(p, cuts, { at: plan.at!, fills: plan.fills, consume: plan.consume });
    const main = mainTrack(r.project).items;
    expect(main).toHaveLength(2);
    expect(main[0]).toMatchObject({ type: "media", mediaId: "one", in: 3 * S, duration: 2 * S });
    expect(r.project.tracks.flatMap(t => t.items.filter(i => i.id === a.id || i.id === b.id))).toEqual([]);
  });

  it("prefers footage that is not on the timeline yet", () => {
    let p = withMedia();
    p = insertItems(p, [mediaItem(p.media.one, 0)]);
    const plan = chooseFills(p, cuts, []);
    expect(plan.fills.get("a")!.media.id).toBe("two");
    expect(plan.fills.get("b")!.media.id).toBe("one");
  });

  it("scales geometry to the project's frame and lays out slots by the clip they hold", () => {
    const t = make({
      frame: { width: 1920, height: 1080 },
      slots: [{ id: "a", label: "Clip 1" }],
      tracks: [
        { kind: "video", name: "Main", main: true, items: [{ type: "slot", slot: "a", start: 0, duration: S, layout: "left", keyframes: { "transform.scale": [{ t: 0, v: 1 }, { t: S, v: 1.1 }] } }] },
        { kind: "text", name: "T", items: [{ type: "text", start: 0, duration: S, transform: { y: 400 }, style: { text: "Hi", size: 100, stroke: { color: "#000000", width: 10 } } }] },
      ],
    });
    const p = addMedia(createProject("v", { width: 1080, height: 1920 }), [ref("one", 10)]);
    const r = applyTemplate(p, t, { at: 0, fills: chooseFills(p, t, []).fills });
    const items = r.project.tracks.flatMap(x => x.items);
    const text = items.find(i => i.type === "text")!;
    expect(text.transform.y).toBeCloseTo(400 * (1920 / 1080));
    if (text.type !== "text") throw new Error();
    expect(text.style.size).toBe(100);
    const clip = items.find(i => i.type === "media")!;
    expect(clip.crop).toBeDefined();
    expect(clip.transform.x).toBe(-270);
    const keys = clip.keyframes!["transform.scale"];
    expect(keys[1].v / keys[0].v).toBeCloseTo(1.1);
    expect(keys[0].v).toBeCloseTo(clip.transform.scale);
  });

  it("builds a preview project in the template's own frame with no media of the user's", () => {
    const pv = previewProject(cuts);
    expect(pv.settings).toMatchObject({ width: 1920, height: 1080 });
    for (const m of Object.values(pv.media)) expect(m.path).toBe("");
  });
});

describe("caption style templates", () => {
  const look = make({ kind: "captions", captions: { style: { size: 80, weight: 800, color: "#ffffff" }, highlight: "#f2c23a", y: 0.2 }, tracks: [] });
  const caption = (id: string): CaptionItem => ({ id, type: "caption", start: 0, duration: S, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, style: { text: "", font: "x", size: 10, weight: 400, color: "#000000", align: "center", lineHeight: 1, letterSpacing: 0 }, words: [{ text: "hi", start: 0, end: S }] });

  it("restyles every caption, or only the ones named, keeping words and timing", () => {
    let p = createProject("c", { width: 1080, height: 1920 });
    p = insertItems(p, [caption("c1"), { ...caption("c2"), start: 2 * S }]);
    const all = applyCaptionStyle(p, look);
    expect(allCaptions(all).map(c => [c.style.size, c.highlight, c.transform.y, c.words.length])).toEqual([[80, "#f2c23a", 384, 1], [80, "#f2c23a", 384, 1]]);
    const one = applyCaptionStyle(p, look, ["c2"]);
    expect(allCaptions(one).map(c => c.style.size)).toEqual([10, 80]);
    expect(applyCaptionStyle(createProject("e"), look)).toEqual(expect.objectContaining({ name: "e" }));
  });
});

describe("captureTemplate", () => {
  it("turns clips into slots and keeps no file, path or media id", () => {
    const p = applyTemplate(withMedia(), cuts, { at: 0, fills: chooseFills(withMedia(), cuts, []).fills }).project;
    const made = captureTemplate(p, null, "My cuts");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const text = JSON.stringify(made.template);
    for (const leak of ["one.mp4", "/m/", "song", "mediaId", "path"]) expect(text).not.toContain(leak);
    expect(made.template.slots.map(s => [s.id, s.kind])).toEqual([["clip1", "visual"], ["audio1", "audio"], ["clip2", "visual"]]);
    expect(made.template.id).toMatch(/^my-cuts-[a-z0-9]{5}$/);
    expect(made.template.markers).toHaveLength(2);
    const again = applyTemplate(createProject("n"), made.template, { at: 0 });
    expect(again.empty).toHaveLength(3);
  });

  it("closes gaps between picked main clips and moves what sits above them", () => {
    let p = withMedia();
    const a = mediaItem(p.media.one, 0);
    a.duration = 2 * S;
    const b = mediaItem(p.media.one, 0);
    b.duration = 2 * S;
    p = insertItems(p, [a, b]);
    p = { ...p, tracks: p.tracks.map(t => (t.main ? { ...t, magnetic: false, items: [{ ...t.items[0] }, { ...t.items[1], start: 5 * S }] } : t)) };
    const made = captureTemplate(p, [a.id, b.id], "Gap");
    expect(made.ok && made.template.tracks[0].items.map(i => i.start)).toEqual([0, 2 * S]);
  });

  it("makes a caption style from selected captions and explains an empty pick", () => {
    const p = insertItems(createProject("c"), [{ id: "c1", type: "caption", start: 0, duration: S, transform: { x: 0, y: 300, scale: 1, rotation: 0, opacity: 1 }, style: { text: "", font: "Familjen Grotesk", size: 70, weight: 700, color: "#ffffff", align: "center", lineHeight: 1.1, letterSpacing: 0 }, words: [{ text: "secret words", start: 0, end: S }], highlight: "#f2c23a" } as CaptionItem]);
    const made = captureTemplate(p, ["c1"], "Look");
    expect(made.ok && made.template.kind).toBe("captions");
    expect(JSON.stringify(made)).not.toContain("secret");
    const none = captureTemplate(p, [], "Nothing");
    expect(none.ok).toBe(false);
    expect(captureTemplate(createProject("e"), null, "Empty").ok).toBe(false);
    expect(captureTemplate(p, ["c1"], "  ").ok).toBe(false);
  });
});

describe("apply_template operation", () => {
  const lookup = (key: string) => (key === "t" || key === "T" ? cuts : null);

  it("applies by id or name with named media, in one batch with other operations", () => {
    const { project, results } = applyOps(withMedia(), [{ op: "apply_template", template: "T", media: ["one", "/m/two.mp4", "song"], as: "first" }, { op: "set", id: "$first", props: { volume: 0.5 } }], { template: lookup });
    expect(results[0].ids!.length).toBeGreaterThan(3);
    expect(mainTrack(project).items.map(i => i.type === "media" && i.mediaId)).toEqual(["one", "two"]);
  });

  it("says what went wrong without changing anything", () => {
    expect(() => applyOps(withMedia(), [{ op: "apply_template", template: "nope" }], { template: lookup })).toThrow(/list_templates/);
    expect(() => applyOps(withMedia(), [{ op: "apply_template", template: "t", media: ["ghost"] }], { template: lookup })).toThrow(/no media ghost/);
    expect(() => applyOps(withMedia(), [{ op: "apply_template", template: "t" }])).toThrow(/no template/);
    expect(() => applyOps(withMedia(), [{ op: "apply_template", template: "t", media: "one" as unknown as string[] }], { template: lookup })).toThrow(/media must be a list/);
    expect(() => applyOps(withMedia(), [{ op: "apply_template", template: "t", ids: [1] as unknown as string[] }], { template: lookup })).toThrow(/ids must be a list/);
  });

  it("reports empty slots", () => {
    const { results } = applyOps(createProject("p"), [{ op: "apply_template", template: "t" }], { template: lookup });
    expect(results[0].empty).toEqual(["Clip 1", "Clip 2", "Music"]);
  });
});
