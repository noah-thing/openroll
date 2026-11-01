// Renders a few looks onto real pictures and records preview frame rates.
// usage: node qa/launch.mjs qa/look-fx.mjs   (after npm run build)
import { join } from "node:path";
import { homedir } from "node:os";

const STILLS = "/Users/noahmalekani/openroll/design/directions/footage";
const VIDEO = join(homedir(), "openroll-research/testmedia/h264_1080p30_60s.mp4");

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const files = [join(STILLS, "coffee.jpg"), join(STILLS, "forest.jpg"), VIDEO];
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), files);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(2500);

  const patch = (index, fields) =>
    page.evaluate(
      ([index, fields]) => {
        const e = window.__or.editor;
        const id = e.project.tracks[0].items[index].id;
        e.apply("qa", p => {
          const n = structuredClone(p);
          Object.assign(n.tracks[0].items.find(i => i.id === id), fields);
          return n;
        });
        e.select([id]);
        e.seek(n0(e, index));
        function n0(ed, i) {
          return ed.project.tracks[0].items[i].start + 400_000;
        }
      },
      [index, fields],
    );
  const canvas = () => page.locator(".viewer-canvas");
  const snap = async name => {
    await page.waitForTimeout(500);
    await canvas().screenshot({ path: `qa/shots/${name}.png` });
  };

  const looks = {
    base: {},
    filter: { filter: { id: "cutting-room", amount: 1 } },
    mono: { filter: { id: "ink", amount: 1 }, adjust: { grain: 40, fade: 20 } },
    hsl: { hsl: { green: { hue: 30, sat: 60, light: 0 } }, curves: { master: [{ x: 0, y: 0.08 }, { x: 0.33, y: 0.25 }, { x: 0.66, y: 0.75 }, { x: 1, y: 0.95 }] } },
    mask: { mask: { shape: "ellipse", x: 0, y: 0, width: 0.6, height: 0.6, rotation: 0, feather: 0.2, invert: false }, filter: { id: "neon-rain", amount: 1 } },
    fill: { transform: { x: 0, y: 0, scale: 0.55, rotation: 0, opacity: 1 }, fill: { mode: "blur", blur: 0.7 } },
  };
  for (const [name, fields] of Object.entries(looks)) {
    await patch(0, { filter: undefined, adjust: undefined, hsl: undefined, curves: undefined, mask: undefined, fill: undefined, effects: undefined, chroma: undefined, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, ...fields });
    await snap("fx-" + name);
  }

  const kinds = ["defocus", "rush", "handheld", "tear", "prism", "emulsion", "tape", "sun-leak", "strobe", "thump", "mosaic", "mirror", "kaleido", "heartbeat", "neon-edge", "mono-strobe", "slow-shutter", "fisheye", "raster", "duotone", "bloom", "ripple"];
  for (const kind of kinds) {
    await patch(0, { filter: undefined, adjust: undefined, hsl: undefined, curves: undefined, mask: undefined, fill: undefined, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, effects: [{ id: "fxqa", kind, amount: 0.7, params: { speed: 1, style: 0 } }] });
    await page.evaluate(() => window.__or.editor.seek(window.__or.editor.project.tracks[0].items[0].start + 330_000));
    await snap("fxk-" + kind);
  }

  // Frame rate at a full 1080p preview: three stacked video layers, each with a filter and effects.
  const stack = effects =>
    page.evaluate(effects => {
      const e = window.__or.editor;
      e.apply("qa stack", p => {
        const n = structuredClone(p);
        const base = n.tracks[0].items.find(i => i.mediaId === Object.keys(n.media).pop());
        base.start = 0;
        base.transform.scale = 1;
        n.tracks = [n.tracks[0], n.tracks[1]];
        n.tracks[0].items = [base];
        base.filter = effects.length ? { id: "halide", amount: 1 } : undefined;
        base.effects = effects.map((kind, i) => ({ id: "a" + i, kind, amount: 0.6, params: { speed: 1 } }));
        for (const name of ["o1", "o2"]) {
          const c = structuredClone(base);
          c.id = "i" + name;
          c.transform.scale = 0.7;
          c.effects = c.effects?.map(x => ({ ...x, id: x.id + name }));
          n.tracks.push({ id: "tr" + name, kind: "video", name, items: [c] });
        }
        return n;
      });
      e.player.setSize(1920, 1080);
      e.seek(0);
    }, effects);
  const configs = { "plain": [], "2 effects each": ["bloom", "prism"], "heavy, 4 effects each": ["defocus", "bloom", "neon-edge", "tape"] };
  for (const [name, effects] of Object.entries(configs)) {
    await stack(effects);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__or.editor.player.play());
    await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => window.__or.editor.player.stats);
    await page.evaluate(() => window.__or.editor.player.pause());
    console.log(`1080p, 3 layers, ${name}: ${stats.fps} fps, worst frame ${stats.worstMs} ms, late ${stats.late}`);
  }
  await shot("fx-stack");
}
