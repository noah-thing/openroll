import { box, check, clipBox, openProject, project, selection } from "./lib.mjs";

const S = 1e6;
const mod = process.platform === "darwin" ? "Meta" : "Control";

export default async function ({ page, shot }) {
  await openProject(page);
  const main = p => p.tracks.find(t => t.main).items;
  // split the first clip so two clips touch inside one source
  await page.evaluate(() => window.__or.editor.seek(20e6));
  await page.keyboard.press("s");
  let p = await project(page);
  check("split", main(p).length === 4);

  // roll edit: alt drag on the cut between clip 0 and 1
  const c0 = await clipBox(page, 0);
  const cutX = c0.x + c0.width;
  const y = c0.y + c0.height / 2;
  await page.keyboard.down("Alt");
  await page.mouse.move(cutX - 3, y);
  await page.mouse.down();
  await page.mouse.move(cutX + 30, y, { steps: 6 });
  await shot("tl-10-roll");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  p = await project(page);
  check("roll moves the cut", main(p)[0].duration > 20 * S && main(p)[1].start === main(p)[0].duration && main(p)[0].duration + main(p)[1].duration === 60 * S, String(main(p)[0].duration));
  const total = main(p).reduce((a, i) => a + i.duration, 0);
  check("roll keeps total length", total === 100 * S, String(total));

  // slip: alt drag inside clip 3 (portrait, 20 s, trim first so there is room)
  await page.evaluate(() => window.__or.editor.seek(95e6));
  await page.keyboard.press("w");
  p = await project(page);
  const before = main(p).at(-1);
  const last = await clipBox(page, 3);
  await page.keyboard.down("Alt");
  await page.mouse.move(last.x + 20, last.y + 25);
  await page.mouse.down();
  await page.mouse.move(last.x + 5, last.y + 25, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  p = await project(page);
  const after = main(p).at(-1);
  check("slip changes the in point only", after.in !== before.in && after.duration === before.duration && after.start === before.start, `${before.in} -> ${after.in}`);

  // group drag: select clips 0 and 1, drag them behind the last one
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  p = await project(page);
  const ids = main(p).map(i => i.id);
  await page.evaluate(([a, b]) => window.__or.editor.select([a, b]), [ids[0], ids[1]]);
  const g0 = await clipBox(page, 0);
  const g3 = await clipBox(page, 3);
  await page.mouse.move(g0.x + 30, g0.y + 25);
  await page.mouse.down();
  await page.mouse.move(g3.x + g3.width - 10, g3.y + 25, { steps: 12 });
  await shot("tl-11-group-drag");
  await page.mouse.up();
  p = await project(page);
  const order = main(p).map(i => i.id);
  check("group moved as a block", order[2] === ids[0] && order[3] === ids[1], order.map(o => ids.indexOf(o)).join(","));
  check("selection kept", (await selection(page)).length === 2);
  await page.keyboard.press(`${mod}+z`);

  // ripple delete of the selection on the main track closes the gap
  await page.keyboard.press("Shift+Backspace");
  p = await project(page);
  check("ripple delete", main(p).length === 2 && main(p)[0].start === 0);
  await page.keyboard.press(`${mod}+z`);

  // track rename, resize
  await page.locator(".tl-head").first().dblclick({ position: { x: 12, y: 20 } });
  await page.keyboard.type("Video");
  await page.keyboard.press("Enter");
  p = await project(page);
  check("track renamed", p.tracks[0].name === "Video", p.tracks[0].name);
  const row = await page.locator(".tl-resize").first().boundingBox();
  await page.mouse.move(row.x + 400, row.y + 3);
  await page.mouse.down();
  await page.mouse.move(row.x + 400, row.y + 43, { steps: 4 });
  await page.mouse.up();
  p = await project(page);
  check("track resized", p.tracks[0].height > 90, String(p.tracks[0].height));

  // zoom animates and anchors
  const zb = page.locator('button[title^="Fit"]');
  await zb.click();
  await page.waitForTimeout(400);
  await page.keyboard.press(`${mod}+=`);
  await page.waitForTimeout(400);
  await shot("tl-12-zoomed");

  // magnet off lets a clip stay put
  await page.locator(".tl-head").first().hover();
  await page.locator('.tl-head button[title^="Magnetic"]').click();
  p = await project(page);
  check("magnet off", p.tracks[0].magnetic === false);
  await page.locator('.tl-head button[title^="Free"]').click();

  // reorder tracks by dragging a head
  await page.locator(".tl-add").click();
  await page.getByRole("menuitem", { name: "Video track" }).click();
  p = await project(page);
  check("video track added above main", p.tracks.length === 3 && p.tracks[0].pinned === true);
  const heads = page.locator(".tl-head");
  const h0 = await heads.nth(0).boundingBox();
  const h1 = await heads.nth(1).boundingBox();
  await page.mouse.move(h0.x + 40, h0.y + 10);
  await page.mouse.down();
  await page.mouse.move(h1.x + 40, h1.y + h1.height - 2, { steps: 6 });
  await shot("tl-13-reorder");
  await page.mouse.up();
  p = await project(page);
  check("track reordered", p.tracks[1].pinned === true, p.tracks.map(t => t.name).join(","));
}
