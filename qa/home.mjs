import { join } from "node:path";
import { homedir } from "node:os";
const STILLS = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));
export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  await shot("home-empty");
  for (const name of ["ferry", "forest", "night"]) {
    const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(STILLS, name + ".jpg"), join(STILLS, "coffee.jpg")]);
    await page.evaluate(i => window.__or.newProject(i), infos);
    await page.waitForSelector(".clip");
    await page.waitForTimeout(1500);
    await page.evaluate(n => window.__or.editor.apply("Rename", p => ({ ...p, name: n })), name === "ferry" ? "Ferry day" : name === "forest" ? "Morning run" : "Bus home");
    await page.waitForTimeout(900);
    await page.click(".top .mark");
    await page.waitForSelector(".home");
  }
  await page.waitForTimeout(600);
  await shot("home-projects");
}
