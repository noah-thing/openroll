// Drag an effect onto a clip, keyframe by hand through the inspector, curves and colour mix.
import { join } from "node:path";

const STILLS = "/Users/noahmalekani/openroll/design/directions/footage";

export default async function ({ page, shot }) {
  page.setDefaultTimeout(8000);
  await page.setViewportSize?.({ width: 1440, height: 900 });
  await page.waitForSelector(".home");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(STILLS, "forest.jpg"), join(STILLS, "coffee.jpg")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);

  await page.click('.rail button:has-text("Effects")');
  await page.waitForTimeout(800);
  const card = page.locator(".fx-card", { hasText: "Duotone" });
  await card.dragTo(page.locator(".clip").nth(1));
  await page.waitForTimeout(500);
  console.log("effects after drag:", await page.evaluate(() => JSON.stringify(window.__or.editor.project.tracks[0].items.map(i => i.effects?.map(e => e.kind)))));

  // Keyframes through the real controls: scale 100% at 0.5 s, 150% at 2 s
  await page.locator(".clip").first().click();
  await page.evaluate(() => window.__or.editor.seek(500_000));
  await page.waitForTimeout(300);
  await page.locator(".field", { hasText: "Scale" }).locator(".kf").click();
  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  await page.waitForTimeout(300);
  await page.locator(".field", { hasText: "Scale" }).locator(".field-value").dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("150");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const keys = await page.evaluate(() => JSON.stringify(window.__or.editor.project.tracks[0].items[0].keyframes));
  console.log("keys:", keys);
  await page.evaluate(() => window.__or.editor.seek(1_250_000));
  await page.waitForTimeout(500);
  await shot("ui2-keyframed");
  await page.screenshot({ path: "qa/shots/ui2-ticks.png", clip: { x: 190, y: 615, width: 420, height: 90 } });
  const scaleMid = await page.evaluate(() => {
    const it = window.__or.editor.project.tracks[0].items[0];
    return it.keyframes["transform.scale"].length;
  });
  console.log("scale keys:", scaleMid);

  // Curves and colour mix
  await page.click('.tabs button:has-text("Look")');
  await page.waitForTimeout(300);

  await page.evaluate(() => (document.querySelector(".insp-body").scrollTop = 480));
  await page.waitForTimeout(300);
  const pts = page.locator(".curve-pt");
  const b1 = await pts.nth(1).boundingBox();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2 - 40, { steps: 6 });
  await page.mouse.up();
  await page.locator(".band").nth(3).click();
  await page.waitForTimeout(300);
  await page.locator(".field", { hasText: "Saturation" }).last().locator(".slider").click({ position: { x: 100, y: 9 } });
  await page.waitForTimeout(500);
  await shot("ui2-curves");
  console.log("curves:", await page.evaluate(() => JSON.stringify(window.__or.editor.project.tracks[0].items[0].curves)));
  // one undo step per drag
  const before = await page.evaluate(() => window.__or.editor.history.undoLabels?.length ?? -1);
  console.log("history labels available:", before);
}
