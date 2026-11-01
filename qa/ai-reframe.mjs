// Make vertical follows the person; enhance compare shows a before and after.
// usage: node qa/launch.mjs qa/ai-reframe.mjs   (after npm run build)
import { check, openProject, project } from "./lib.mjs";

export default async function ({ page, shot }) {
  await openProject(page, ["skate_pan_1080p.mp4"]);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  const panel = page.locator(".insp");
  const t0 = Date.now();
  await panel.locator("button:has-text('Make vertical')").click();
  await page.waitForFunction(() => window.__or.editor.project.tracks[0].items[0].keyframes?.["transform.x"], null, { timeout: 120000 });
  console.log("reframe took", ((Date.now() - t0) / 1000).toFixed(1), "s");
  const p = await project(page);
  const item = p.tracks[0].items[0];
  check("frame is vertical", p.settings.height > p.settings.width);
  check("position and scale are keyframed", !!item.keyframes["transform.x"] && !!item.keyframes["transform.scale"], `${item.keyframes["transform.x"].length} x keys`);
  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  await page.waitForTimeout(900);
  await shot("ai-reframe-vertical");
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(300);
  const undone = await project(page);
  check("undo restores plain placement", !undone.tracks[0].items[0].keyframes);

  // enhance compare
  await page.locator(".clip").first().click();
  await panel.locator(".toggle:has-text('Clean up and sharpen') .switch").click();
  await panel.locator("button:has-text('Compare at playhead')").click();
  const e0 = Date.now();
  await page.locator(".ai-compare").waitFor({ timeout: 240000 });
  console.log("compare ready after", ((Date.now() - e0) / 1000).toFixed(1), "s:", await page.locator(".ai-compare-modal .insp-note").textContent());
  await shot("ai-enhance-compare");
}
