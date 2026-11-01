// Remove background through the inspector: toggle, wait for the matte, look at the result.
// usage: node qa/launch.mjs qa/ai-cutout.mjs   (after npm run build)
import { check, openProject, project } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page, ["people_pan_1280x720.mp4"]);
  // a loud backdrop makes see through pixels obvious
  await page.evaluate(() => window.__or.editor.apply("qa", p => ({ ...p, settings: { ...p.settings, background: "#1fae5b" } })));
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  await page.waitForTimeout(800);
  await shot("ai-cutout-0-before");

  const panel = page.locator(".insp");
  await panel.locator(".toggle:has-text('Remove background') .switch").click();
  const t0 = Date.now();
  await page.waitForTimeout(500);
  await shot("ai-cutout-1-preparing");
  const preparing = await page.locator(".clip-prep").count();
  check("clip shows a preparing badge while the matte is made", preparing > 0);

  await panel.locator(".ai-ok").waitFor({ timeout: 240000 });
  const seconds = (Date.now() - t0) / 1000;
  console.log("matte ready after", seconds.toFixed(1), "s;", await panel.locator(".ai-ok .ai-detail").textContent());
  const p = await project(page);
  check("cutout flag saved in the project", p.tracks[0].items[0].cutout === true);

  await page.evaluate(() => window.__or.editor.seek(2_500_000));
  await page.waitForTimeout(900);
  await shot("ai-cutout-2-ready");
  await page.evaluate(() => window.__or.editor.seek(5_000_000));
  await page.waitForTimeout(900);
  await shot("ai-cutout-3-later");

  // undo is one step
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(400);
  const after = await project(page);
  check("undo removes the cutout", !after.tracks[0].items[0].cutout);
}
