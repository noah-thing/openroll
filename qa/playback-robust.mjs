// The preview survives a lost graphics device and a throwing frame.
import { check, openProject } from "./lib.mjs";

export default async function ({ page }) {
  await openProject(page, ["h264_1080p30_60s.mp4"]);
  const worker = page.workers().find(w => w.url().includes("preview.worker"));
  const settle = ms => page.waitForTimeout(ms);
  const brightness = () =>
    page.evaluate(async () => {
      // a dead preview never answers
      const i = await Promise.race([window.__or.editor.player.snapshot(1_000_000, undefined, { settle: true }), new Promise(r => setTimeout(r, 4000))]);
      if (!i) return -1;
      let sum = 0;
      for (let k = 0; k < i.data.length; k += 4) sum += i.data[k] + i.data[k + 1] + i.data[k + 2];
      return sum / (i.width * i.height * 3);
    });

  check("picture before", (await brightness()) > 5);

  // the page cannot reach the worker's context, so take it from the next draw call
  await worker.evaluate(() => {
    const proto = WebGL2RenderingContext.prototype;
    const clear = proto.clear;
    proto.clear = function (...a) {
      self.__gl = this;
      proto.clear = clear;
      return clear.apply(this, a);
    };
  });
  await page.evaluate(() => window.__or.editor.seek(500_000));
  await settle(300);

  await page.evaluate(() => window.__or.editor.seek(2_000_000));
  await settle(300);
  await worker.evaluate(() => {
    const ext = self.__gl.getExtension("WEBGL_lose_context");
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 400);
  });
  await settle(1500);
  await page.evaluate(() => window.__or.editor.seek(3_000_000));
  await settle(800);
  check("picture after the device is lost and restored", (await brightness()) > 5);

  // a frame that throws must not stop the loop
  await worker.evaluate(() => {
    const proto = WebGL2RenderingContext.prototype;
    const draw = proto.drawArrays;
    let left = 3;
    proto.drawArrays = function (...a) {
      if (left-- > 0) throw new Error("boom");
      proto.drawArrays = draw;
      return draw.apply(this, a);
    };
  });
  await page.evaluate(() => window.__or.editor.seek(4_000_000));
  await settle(300);
  await page.evaluate(() => window.__or.editor.seek(5_000_000));
  await settle(800);
  check("picture after throwing frames", (await brightness()) > 5);
}
