// Scrolling a zoomed in timeline: how many clip canvases are reallocated and how long frames take.
import { check, openProject } from "./lib.mjs";

export default async function ({ page }) {
  await openProject(page, ["h264_1080p30_60s.mp4", "portrait_1080x1920_20s.mp4"]);
  const box = await page.locator(".tl-scroll").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  // zoom in around the start
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -30);
  await page.keyboard.down("Control");
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -30);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);

  const result = await page.evaluate(async () => {
    const el = document.querySelector(".tl-scroll");
    let resizes = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
    Object.defineProperty(HTMLCanvasElement.prototype, "width", { ...desc, set(v) { resizes++; desc.set.call(this, v); } });
    el.scrollLeft = 0;
    await new Promise(r => requestAnimationFrame(r));
    const frames = [];
    let last = performance.now();
    for (let i = 0; i < 180; i++) {
      el.scrollLeft += 14;
      await new Promise(r => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    Object.defineProperty(HTMLCanvasElement.prototype, "width", desc);
    frames.sort((a, b) => a - b);
    return { resizes, scrolled: el.scrollLeft, p50: frames[90], p95: frames[171], worst: frames[179] };
  });
  console.log(`scrolled ${Math.round(result.scrolled)} px in 180 frames: ${result.resizes} canvas resizes, frame p50 ${result.p50.toFixed(1)} ms p95 ${result.p95.toFixed(1)} ms worst ${result.worst.toFixed(1)} ms`);
  check("scrolling does not reallocate a canvas per frame", result.resizes < 60, String(result.resizes));
}
