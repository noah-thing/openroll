import { box, check, clipBox, openProject, project, selection } from "./lib.mjs";

const S = 1e6;
const mod = process.platform === "darwin" ? "Meta" : "Control";

export default async function ({ page, shot }) {
  await openProject(page);
  const main = p => p.tracks.find(t => t.main).items;
  const time = () => page.evaluate(() => window.__or.editor.time);

  // click on an empty lane seeks
  const lane = await box(page, '[data-track] >> nth=1');
  const audioLane = page.locator(".tl-lane").nth(1);
  const ab = await audioLane.boundingBox();
  await page.mouse.click(ab.x + 200, ab.y + 20);
  await page.waitForTimeout(100);
  check("click on empty lane seeks", (await time()) > 1 * S, String(await time()));

  // marquee from the audio lane up over the first two clips
  const c0 = await clipBox(page, 0), c1 = await clipBox(page, 1), c2 = await clipBox(page, 2);
  await page.mouse.move(c1.x + 10, ab.y + 25);
  await page.mouse.down();
  await page.mouse.move(c1.x + 30, c1.y + 30, { steps: 6 });
  await page.mouse.move(c0.x + c0.width - 40, c1.y + 20, { steps: 6 });
  await shot("tl-01-marquee");
  await page.mouse.up();
  check("marquee selects two clips", (await selection(page)).length === 2, String((await selection(page)).length));

  // shift click adds the third
  await page.keyboard.down("Shift");
  await page.mouse.click(c2.x + 40, c2.y + 20);
  await page.keyboard.up("Shift");
  check("shift click adds", (await selection(page)).length === 3);

  // select all, copy, deselect, paste at playhead
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+c`);
  await page.mouse.click(c0.x + 50, c0.y + 20);
  await page.evaluate(() => window.__or.editor.seek(0));
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(150);
  let p = await project(page);
  check("paste adds three clips", main(p).length === 6, String(main(p).length));
  await page.keyboard.press(`${mod}+z`);
  p = await project(page);
  check("undo paste", main(p).length === 3);

  // context menu
  await page.mouse.click(c0.x + 5, c0.y + 5);
  await page.mouse.click(c1.x + 50, c1.y + 20, { button: "right" });
  await page.waitForSelector(".ctxmenu");
  await shot("tl-02-context");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await shot("tl-02b-context-keys");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  check("escape closes the menu", (await page.locator(".ctxmenu").count()) === 0);
  await page.mouse.click(c1.x + 50, c1.y + 20, { button: "right" });
  await page.getByRole("menuitem", { name: "Speed" }).hover();
  await page.waitForTimeout(150);
  await shot("tl-03-speed-sub");
  await page.locator(".ctx-item", { hasText: /^2x$/ }).click();
  p = await project(page);
  check("speed 2x via menu", main(p)[1].speed === 2 && main(p)[1].duration === 10 * S, JSON.stringify([main(p)[1].speed, main(p)[1].duration]));
  await page.keyboard.press(`${mod}+z`);

  // colour label
  await page.mouse.click(c1.x + 50, c1.y + 20, { button: "right" });
  await page.getByRole("menuitem", { name: "Colour label" }).hover();
  await page.getByRole("menuitem", { name: "Blue" }).click();
  p = await project(page);
  check("colour label", main(p)[1].color === "blue");

  // split, trim to playhead
  await page.evaluate(() => window.__or.editor.seek(10e6));
  await page.mouse.click(c0.x + 5, c0.y + 5);
  await page.keyboard.press("w");
  p = await project(page);
  check("W trims end to playhead", main(p)[0].duration === 10 * S, String(main(p)[0].duration));
  check("ripple on main", main(p)[1].start === 10 * S);
  await page.evaluate(() => window.__or.editor.seek(4e6));
  await page.keyboard.press("q");
  p = await project(page);
  check("Q trims start to playhead", main(p)[0].duration === 6 * S && main(p)[0].in === 4 * S);

  // freeze frame via shortcut
  await page.evaluate(() => window.__or.editor.seek(3e6));
  await page.keyboard.press("Shift+f");
  p = await project(page);
  check("freeze inserts a 2 s still", main(p).length === 5 && main(p)[1].freeze === true && main(p)[1].duration === 2 * S, String(main(p).length));
  await shot("tl-04-freeze");

  await page.evaluate(() => window.__or.editor.seek(5e6));
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  check("L twice runs at 2x", (await page.evaluate(() => window.__or.editor.shuttle)) === 2);
  const t1 = await time();
  await page.waitForTimeout(300);
  check("shuttle moves the playhead", (await time()) > t1);
  await page.keyboard.press("k");
  check("K stops", (await page.evaluate(() => window.__or.editor.shuttle)) === 0);
  await page.keyboard.press("j");
  const t2 = await time();
  await page.waitForTimeout(300);
  check("J goes backwards", (await time()) < t2);
  await page.keyboard.press("k");

  // in and out, loop
  await page.evaluate(() => window.__or.editor.seek(2e6));
  await page.keyboard.press("i");
  await page.evaluate(() => window.__or.editor.seek(3e6));
  await page.keyboard.press("o");
  const r = await page.evaluate(() => window.__or.editor.range);
  check("range set", r.in === 2e6 && r.out === 3e6);
  await shot("tl-05-range");
  await page.keyboard.press("Shift+Space");
  await page.waitForTimeout(2200);
  const tl = await time();
  check("range loops", tl >= 2e6 && tl <= 3.2e6, String(tl));
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("Alt+x");

  // markers
  await page.evaluate(() => window.__or.editor.seek(8e6));
  await page.keyboard.press("m");
  await page.evaluate(() => window.__or.editor.seek(20e6));
  await page.keyboard.press("m");
  p = await project(page);
  check("two markers", p.markers.length === 2);
  await page.keyboard.press("Shift+m");
  await page.evaluate(() => window.__or.editor.seek(0));
  await page.keyboard.press("Shift+m");
  check("jump to next marker", (await time()) === 8e6, String(await time()));
  const mk = await page.locator(".tl-marker").first().boundingBox();
  await page.mouse.move(mk.x + 6, mk.y + 6);
  await page.mouse.down();
  await page.mouse.move(mk.x + 66, mk.y + 6, { steps: 5 });
  await page.mouse.up();
  p = await project(page);
  check("marker dragged", p.markers[0].t > 8e6, String(p.markers[0].t));
  await page.mouse.dblclick(mk.x + 66, mk.y + 6);
  await page.keyboard.type("Intro");
  await page.keyboard.press("Enter");
  p = await project(page);
  check("marker renamed", p.markers.some(m => m.label === "Intro"));
  await shot("tl-06-markers");

  // add track from the plus menu
  await page.locator(".tl-add").click();
  await page.getByRole("menuitem", { name: "Text track" }).click();
  p = await project(page);
  check("text track added", p.tracks.some(t => t.kind === "text"));

  // shortcut sheet
  await page.keyboard.press(`${mod}+/`);
  await page.waitForSelector(".keysheet");
  await page.keyboard.type("marker");
  await shot("tl-07-sheet");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check("escape closes the sheet", (await page.locator(".keysheet").count()) === 0);
}
