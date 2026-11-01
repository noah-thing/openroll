import { homedir } from "node:os";
// Layers with effects and a fill, inside a transition window.
import { join } from "node:path";

const STILLS = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));

export default async function ({ page }) {
  page.setDefaultTimeout(8000);
  await page.waitForSelector(".home");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(STILLS, "forest.jpg"), join(STILLS, "coffee.jpg")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.apply("qa", p => {
      const n = structuredClone(p);
      const [a, b] = n.tracks[0].items;
      a.effects = [{ id: "x", kind: "prism", amount: 0.6, params: { speed: 1 } }];
      a.fill = { mode: "blur", blur: 0.5 };
      a.transform.scale = 0.7;
      b.filter = { id: "ink", amount: 1 };
      b.transitionIn = { kind: "dissolve", duration: 1_000_000 };
      return n;
    });
    e.seek(e.project.tracks[0].items[1].start);
  });
  await page.waitForTimeout(800);
  await page.locator(".viewer-canvas").screenshot({ path: "qa/shots/transition-look.png" });
}
