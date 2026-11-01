import { check, clipBox, openProject, project, selection } from "./lib.mjs";

const S = 1e6;
const MIN = 100_000;
const mod = process.platform === "darwin" ? "Meta" : "Control";

/** The rules every project follows, as complaints. Empty means the model is sound. */
function problems(p) {
  const bad = [];
  const ids = new Set();
  for (const t of p.tracks) {
    const items = [...t.items].sort((a, b) => a.start - b.start);
    let end = 0;
    items.forEach((it, i) => {
      if (ids.has(it.id)) bad.push("duplicate id");
      ids.add(it.id);
      if (!Number.isFinite(it.start) || !Number.isFinite(it.duration)) bad.push("not a number");
      if (it.start < 0) bad.push("negative start");
      if (it.duration < MIN) bad.push(`short item ${it.duration}`);
      if (it.start < end) bad.push(`overlap ${end - it.start}`);
      if (t.main && t.magnetic !== false && it.start !== end) bad.push(`main not packed at ${i}`);
      if (it.type === "media" && p.media[it.mediaId].kind !== "image" && !it.freeze) {
        if (it.in < 0 || it.in + Math.round(it.duration * it.speed) > p.media[it.mediaId].duration + 1) bad.push("source out of range");
      }
      end = Math.max(end, it.start + it.duration);
    });
  }
  return bad;
}

const sound = async (page, name) => {
  const bad = problems(await project(page));
  check(name, bad.length === 0, bad.join("; "));
};

export default async function ({ page, shot }) {
  await openProject(page, ["h264_1080p30_60s.mp4", "hevc_4k30_30s.mp4", "portrait_1080x1920_20s.mp4"]);
  const main = p => p.tracks.find(t => t.main).items;
  const applied = () => page.evaluate(() => window.__or.editor.history.timeline.applied);
  const shape = p => JSON.stringify(main(p).map(i => [i.id, i.start, i.duration, i.in]));
  const zoomTo = async v => {
    await page.locator("input.zoom").evaluate((el, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    await page.waitForTimeout(250);
  };
  const fit = async () => {
    await page.getByRole("button", { name: "Fit" }).click();
    await page.waitForTimeout(400);
  };
  const first = await project(page);
  const base = await applied();
  await sound(page, "fresh project is sound");

  // drag at both zoom extremes
  for (const [label, v] of [["widest", 0], ["closest", 1000]]) {
    await zoomTo(v);
    await page.evaluate(() => window.__or.editor.seek(0));
    const c = await clipBox(page, 0);
    const before = main(await project(page)).map(i => i.id);
    const x = c.x + Math.min(c.width / 2, 40);
    await page.mouse.move(x, c.y + 25);
    await page.mouse.down();
    await page.mouse.move(x + 150, c.y + 25, { steps: 8 });
    await page.mouse.up();
    await sound(page, `${label} zoom drag leaves a sound project`);
    const after = main(await project(page)).map(i => i.id);
    check(`${label} zoom drag keeps every clip`, after.length === before.length && before.every(id => after.includes(id)));
    while ((await applied()) > base) await page.keyboard.press(`${mod}+z`);
  }
  check("undoing the drags returns to the first project", shape(await project(page)) === shape(first));

  // trim an end handle far past the start: the clip stops at the minimum length
  await fit();
  await page.evaluate(() => window.__or.editor.select([window.__or.editor.project.tracks.find(t => t.main).items[0].id]));
  let c = await clipBox(page, 0);
  await page.mouse.move(c.x + c.width - 2, c.y + 25);
  await page.mouse.down();
  await page.mouse.move(c.x - 100, c.y + 25, { steps: 10 });
  await page.mouse.up();
  let p = await project(page);
  check("trim end far left stops at the minimum", main(p)[0].duration === MIN, String(main(p)[0].duration));
  check("later clips followed the trim", main(p)[1].start === MIN);
  await sound(page, "tiny trim is sound");

  // the start handle of the tiny clip dragged far right: nothing breaks, nothing grows past the source
  const afterEnd = await applied();
  c = await clipBox(page, 0);
  await page.mouse.move(c.x + 1, c.y + 25);
  await page.mouse.down();
  await page.mouse.move(c.x + 300, c.y + 25, { steps: 10 });
  await page.mouse.up();
  await sound(page, "start handle dragged past the end is sound");
  check("that drag is not an edit when nothing could move", (await applied()) === afterEnd || main(await project(page))[0].duration >= MIN);
  while ((await applied()) > base) await page.keyboard.press(`${mod}+z`);
  check("undoing the trims returns to the first project", shape(await project(page)) === shape(first));

  // split exactly on an edit point and a frame inside it
  await page.evaluate(() => window.__or.editor.seek(60e6));
  await page.keyboard.press("s");
  p = await project(page);
  check("split on an edit point does nothing", main(p).length === 3, String(main(p).length));
  await page.evaluate(() => window.__or.editor.seek(60e6 + 33_333));
  await page.keyboard.press("s");
  p = await project(page);
  check("split a frame inside a clip is refused", main(p).length === 3, String(main(p).length));
  await page.evaluate(() => window.__or.editor.seek(30e6));
  await page.keyboard.press("s");
  p = await project(page);
  check("split in the middle works", main(p).length === 4);
  await sound(page, "split is sound");

  // undo and redo storm
  for (let n = 0; n < 6; n++) {
    await page.evaluate(n => window.__or.editor.seek((5 + n * 7) * 1e6), n);
    await page.keyboard.press("s");
  }
  const top = shape(await project(page));
  const depth = (await applied()) - base;
  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < depth; n++) await page.keyboard.press(`${mod}+z`);
    check(`storm ${round + 1}: undo lands on the first project`, shape(await project(page)) === shape(first));
    for (let n = 0; n < depth; n++) await page.keyboard.press(`${mod}+Shift+z`);
    check(`storm ${round + 1}: redo lands on the last project`, shape(await project(page)) === top);
  }
  await sound(page, "after the storm");

  // analysis finishing in the middle of a drag must survive the drop
  await fit();
  const mid = main(await project(page))[0];
  c = await clipBox(page, 0);
  await page.evaluate(id => window.__or.editor.select([id]), mid.id);
  await page.mouse.move(c.x + c.width - 2, c.y + 25);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width - 60, c.y + 25, { steps: 6 });
  await page.evaluate(id => window.__or.editor.annotateMedia(id, { bpm: 97 }), mid.mediaId);
  await page.mouse.move(c.x + c.width - 80, c.y + 25, { steps: 3 });
  await page.mouse.up();
  p = await project(page);
  check("the drag landed", main(p)[0].duration < mid.duration);
  check("analysis that arrived mid drag is kept", p.media[mid.mediaId].bpm === 97, String(p.media[mid.mediaId].bpm));

  // selection after delete
  const ids =main(await project(page)).map(i => i.id);
  await page.evaluate(id => window.__or.editor.select([id]), ids[1]);
  await page.keyboard.press("Delete");
  check("delete clears the selection", (await selection(page)).length === 0);
  await sound(page, "after delete");
  await page.keyboard.press(`${mod}+z`);
  check("undo delete brings the clip back", main(await project(page)).some(i => i.id === ids[1]));
  check("undo does not select anything stale", (await selection(page)).every(id => ids.includes(id)));

  // keyboard while a text field has focus
  await page.evaluate(() => window.__or.editor.select([window.__or.editor.project.tracks.find(t => t.main).items[0].id]));
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "qa-field";
    document.body.appendChild(input);
    input.focus();
  });
  const count = main(await project(page)).length;
  await page.evaluate(() => window.__or.editor.seek(5e6));
  await page.keyboard.type("sdw");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press(`${mod}+z`);
  p = await project(page);
  check("typing in a field never edits the timeline", main(p).length === count);
  await page.evaluate(() => document.getElementById("qa-field").remove());
  await shot("tl-stress");
}
