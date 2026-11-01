// A long clip still gets a filmstrip, and its sheet stays inside what a canvas can hold.
// Needs a clip of a few minutes: OPENROLL_LONG=/path/to/long.mp4
import { check } from "./lib.mjs";

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const [info] = await page.evaluate(paths => window.openroll.qa.allow(paths), [process.env.OPENROLL_LONG]);
  const warnings = [];
  page.on("console", m => m.type() === "warning" && warnings.push(m.text()));
  await page.evaluate(i => window.__or.newProject([i]), info);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(20000);
  const failed = warnings.filter(w => w.includes("filmstrip failed"));
  console.log(failed.length ? failed[0] : "no filmstrip warning");
  await shot("filmstrip-long");
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector(".clip canvas");
    const g = canvas.getContext("2d");
    const data = g.getImageData(0, 0, canvas.width, Math.min(canvas.height, 20)).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i + 3];
    return sum;
  });
  check("long clip shows a filmstrip", failed.length === 0 && painted > 0, `painted ${painted}`);
}
