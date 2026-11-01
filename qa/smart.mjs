// Command bar, undo history, saved versions, safe zones, stickers, layouts and cut to the beat.
// Run: node qa/launch.mjs qa/smart.mjs
import { check, clipBox, openProject, project } from "./lib.mjs";

const mod = process.platform === "darwin" ? "Meta" : "Control";

export default async function ({ page, shot }) {
  await openProject(page, ["h264_1080p30_60s.mp4", "longgop_1080p60_20s.mp4", "tone_90s.mp3"]);
  const items = async () => (await project(page)).tracks.flatMap(t => t.items);

  // ---- command bar
  const opened = await page.evaluate(
    () =>
      new Promise(resolve => {
        const t = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
        requestAnimationFrame(() => resolve({ ms: performance.now() - t, shown: !!document.querySelector(".cmdbar") }));
      }),
  );
  check("command bar paints within one frame of the key", opened.shown && opened.ms < 50, `${opened.ms.toFixed(1)} ms`);
  await page.waitForTimeout(260);
  await shot("smart-01-bar-empty");
  await page.keyboard.type("spe");
  await page.waitForTimeout(220);
  await shot("smart-02-bar-search");
  const first = await page.locator(".cmdbar-row").first().innerText();
  check("searching puts the best label match first", /speech|speed/i.test(first), first.replace(/\n/g, " "));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("escape closes the bar", (await page.locator(".cmdbar").count()) === 0);

  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".cmdbar");
  await page.keyboard.press(`${mod}+k`);
  await page.waitForTimeout(200);
  check("the shortcut toggles it closed", (await page.locator(".cmdbar").count()) === 0);

  const b = await clipBox(page, 0);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const before = (await items())[0];
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".cmdbar");
  await page.keyboard.type("speed 2x");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const after = (await items()).find(i => i.id === before.id);
  check("speed 2x from the bar halves the clip", after.speed === 2 && Math.abs(after.duration * 2 - before.duration) < 2000, `speed ${after.speed}`);

  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".cmdbar");
  await page.waitForTimeout(250);
  const recent = await page.locator(".cmdbar-row").first().innerText();
  check("the command just used comes first when the bar opens", /speed/i.test(recent), recent.replace(/\n/g, " "));
  await shot("smart-03-bar-recent");
  await page.keyboard.type("make vertical");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const s = (await project(page)).settings;
  check("make vertical changes the frame", s.width < s.height, `${s.width}x${s.height}`);

  // ---- undo history
  await page.click('[aria-label="Undo history"]');
  await page.waitForSelector(".histpanel");
  await page.waitForTimeout(260);
  await shot("smart-04-history");
  const names = await page.locator(".histname").allInnerTexts();
  check("history lists the steps newest first, then the start", names.length >= 3 && /vertical|frame/i.test(names[0]) && /start/i.test(names.at(-1)), names.join(" | "));
  await page.locator(".histlist button", { hasText: "Import and place clips" }).click();
  await page.waitForTimeout(250);
  const back = await project(page);
  check("clicking an earlier step jumps back two edits at once", back.settings.width > back.settings.height && (await items()).find(i => i.id === before.id).speed === 1);
  await page.locator(".histlist button", { hasText: "Start of this session" }).click();
  await page.waitForTimeout(200);
  check("the start of the session is the empty project", (await items()).length === 0);
  await page.locator(".histlist button", { hasText: "Change frame to 9:16" }).click();
  await page.waitForTimeout(250);
  check("clicking a later step jumps forward again", (await project(page)).settings.width < (await project(page)).settings.height);
  await shot("smart-05-history-forward");
  await page.keyboard.press("Escape");
  check("undo still works after jumping", await page.evaluate(() => window.__or.editor.history.timeline.applied > 0));

  // ---- saved versions
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".cmdbar");
  await page.keyboard.type("save a version");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[aria-label="Saved versions"]');
  await page.fill('[aria-label="Version name"]', "Vertical cut");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".versions-list li");
  await shot("smart-06-versions");
  check("a named version is listed", (await page.locator(".versions-name").first().innerText()) === "Vertical cut");
  await page.keyboard.press("Escape").catch(() => {});
  await page.click('[aria-label="Saved versions"] [aria-label="Close"]');
  await page.evaluate(() => window.__or.editor.apply("Test change", p => ({ ...p, name: "Changed" })));
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".cmdbar");
  await page.keyboard.type("saved versions");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".versions-list li");
  await page.locator(".versions-list .textbtn", { hasText: "Restore" }).first().click();
  await page.waitForTimeout(300);
  check("restoring a version brings the project back as an undoable step", (await project(page)).name !== "Changed" && (await page.evaluate(() => window.__or.editor.history.undoLabel)).startsWith("Restore"));

  // ---- safe zones
  await page.click(".guides-btn button");
  await page.waitForSelector(".guides-menu");
  await page.waitForTimeout(220);
  await shot("smart-07-guides-menu");
  await page.locator(".guides-row", { hasText: "TikTok" }).click();
  await page.locator(".guides-row", { hasText: "Title safe" }).click();
  await page.waitForTimeout(150);
  check("safe zones draw over the viewer", (await page.locator(".guides .guide-cover").count()) === 3 && (await page.locator(".guides .guide-line").count()) === 1);
  await page.mouse.click(10, 10);
  await shot("smart-08-guides");
  await page.click(".guides-btn button");
  await page.locator(".guides-row", { hasText: "Hide all" }).click();
  check("hide all clears them", (await page.locator(".guides").count()) === 0);

  // ---- stickers and shapes
  await page.click('.rail button:has-text("Stickers")');
  await page.waitForSelector(".sticker");
  await page.waitForTimeout(300);
  await shot("smart-09-stickers");
  check("about thirty stickers", (await page.locator(".sticker").count()) >= 28, String(await page.locator(".sticker").count()));
  await page.locator(".sticker", { hasText: "Heart" }).click();
  await page.locator(".sticker", { hasText: "Curved arrow" }).click();
  await page.locator(".shape-row button", { hasText: "Rectangle" }).click();
  await page.waitForTimeout(600);
  const shapes = (await items()).filter(i => i.type === "shape");
  check("stickers and shapes are timeline items on overlay lanes", shapes.length === 3 && !(await project(page)).tracks.find(t => t.main).items.some(i => i.type === "shape"));
  await shot("smart-10-viewer-shapes");
  await page.waitForSelector(".insp .tabs button:has-text('Shape')");
  await shot("smart-11-shape-inspector");

  // ---- layouts
  const vid = (await items()).find(i => i.type === "media" && i.mediaId && i.name !== undefined && !/tone/.test(i.name));
  await page.evaluate(id => window.__or.editor.select([id]), vid.id);
  await page.waitForSelector(".layout-btn");
  await shot("smart-12-layout-section");
  await page.click('.layout-btn[aria-label="Picture in picture, bottom right"]');
  await page.waitForTimeout(300);
  const pip = (await items()).find(i => i.id === vid.id);
  check("picture in picture shrinks and moves the clip", pip.transform.scale < 0.5 && pip.transform.x > 0 && pip.transform.y > 0, JSON.stringify(pip.transform));
  await shot("smart-13-pip");
  await page.click('.layout-btn[aria-label="Split, top half"]');
  await page.waitForTimeout(300);
  const top = (await items()).find(i => i.id === vid.id);
  check("a split trims the clip to its half", !!top.crop && top.transform.y < 0);
  await shot("smart-14-split");
  await page.click('.insp button:has-text("Full frame")');
  check("full frame resets it", !(await items()).find(i => i.id === vid.id).crop);
}
