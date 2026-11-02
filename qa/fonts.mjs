// Pick a font for a title, check the preview changes, then export a still and an MP4 and check
// the text in both files is drawn in that font. White text on a black frame makes the ink
// easy to measure: its width must match what the browser measures for the same font.
// Run with OPENROLL_QA_OUT=<folder> and FFPROBE=<path to ffprobe> (ffmpeg is read from next to it).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { check } from "./lib.mjs";

const OUT = process.env.OPENROLL_QA_OUT;
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const FFMPEG = join(dirname(FFPROBE), FFPROBE.endsWith(".exe") ? "ffmpeg.exe" : "ffmpeg");
const TEXT = "Łódź Åäö Sunday";
const FRAME_W = 1920;

/** Bounding box of bright pixels in a PNG, as fractions of the image width, measured in the page. */
async function ink(page, png) {
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, img.width, img.height);
    let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1, count = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] > 330) {
          count++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return { width: (x1 - x0 + 1) / img.width, height: (y1 - y0 + 1) / img.width, count: count / (img.width * img.width) };
  }, png.toString("base64"));
}

/** Width of the text as a fraction of the frame, from the browser's own measuring of the bundled face. */
const expectedWidth = (page, family, weight, size, spacing) =>
  page.evaluate(
    async ([family, weight, size, spacing, text, frame]) => {
      await document.fonts.load(`${weight} ${size}px "${family}"`, text);
      const g = new OffscreenCanvas(10, 10).getContext("2d");
      g.font = `${weight} ${size}px "${family}"`;
      g.letterSpacing = `${spacing}px`;
      return g.measureText(text).width / frame;
    },
    [family, weight, size, spacing, TEXT, FRAME_W],
  );

export default async function ({ page, shot }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await page.waitForSelector(".home");
  await page.evaluate(() => window.__or.newProject([]));
  await page.waitForSelector(".editor");
  await page.click('.rail button:has-text("Text")');
  await page.click('.text-card:has-text("Title")');
  await page.waitForSelector(".font-trigger");
  const fill = page.locator(".text-input");
  await fill.fill(TEXT);
  await page.evaluate(() => window.__or.editor.seek(1_500_000));
  await page.waitForTimeout(500);

  const model = () => page.evaluate(() => window.__or.editor.project.tracks.flatMap(t => t.items).find(i => i.type === "text").style);
  const itemId = await page.evaluate(() => window.__or.editor.project.tracks.flatMap(t => t.items).find(i => i.type === "text").id);

  // The overlay handles would count as ink, so look at the frame with nothing selected.
  const preview = async () => {
    await page.evaluate(() => window.__or.editor.select([]));
    let result;
    // The first frame after a change can still be on its way to the screen.
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForTimeout(400);
      result = await ink(page, await page.locator(".viewer-canvas").screenshot());
      if (result.count > 0) break;
    }
    await page.evaluate(id => window.__or.editor.select([id]), itemId);
    await page.waitForSelector(".font-trigger");
    return result;
  };

  const first = await preview();
  const size = (await model()).size;
  const spacing = (await model()).letterSpacing;
  const familjen = await expectedWidth(page, "Familjen Grotesk", 700, size, spacing);
  check("starts in Familjen Grotesk", (await model()).font === "Familjen Grotesk");
  check("preview text matches the browser's width for Familjen Grotesk", Math.abs(first.width - familjen) < 0.012, `${first.width.toFixed(3)} vs ${familjen.toFixed(3)}`);
  await shot("fonts-01-default");

  // Keyboard: open with the arrow key, move, Escape leaves the font alone and returns focus.
  await page.focus(".font-trigger");
  await page.keyboard.press("ArrowDown");
  await page.waitForSelector(".font-list");
  check("list opens with the keyboard and focuses itself", await page.evaluate(() => document.activeElement?.classList.contains("font-list")));
  check("each option is drawn in its own face", await page.evaluate(() => [...document.querySelectorAll(".font-name")].every(n => getComputedStyle(n).fontFamily.includes(n.textContent))));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await shot("fonts-02-list");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".font-list", { state: "detached" });
  check("Escape closes without changing the font", (await model()).font === "Familjen Grotesk");
  check("focus goes back to the button", await page.evaluate(() => document.activeElement?.classList.contains("font-trigger")));

  // Pick Anton by typing its name.
  await page.keyboard.press("Enter");
  await page.waitForSelector(".font-list");
  await page.keyboard.type("anton");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".font-list", { state: "detached" });
  await page.waitForTimeout(300);
  const anton = await model();
  check("typing a name and Enter picks it", anton.font === "Anton");
  check("a one weight font snaps the weight", anton.weight === 400);
  check("the inspector says the font has one weight", (await page.locator(".field-note").innerText()).includes("one weight"));
  const second = await preview();
  await shot("fonts-03-anton");
  const antonW = await expectedWidth(page, "Anton", 400, size, spacing);
  check("the preview pixels changed", Math.abs(second.width - first.width) > 0.05 && Math.abs(second.height - first.height) > 0.005, `width ${first.width.toFixed(3)} to ${second.width.toFixed(3)}`);
  check("preview text matches the browser's width for Anton", Math.abs(second.width - antonW) < 0.012, `${second.width.toFixed(3)} vs ${antonW.toFixed(3)}`);

  // A font with a range gets a weight slider again, and undo brings the old font back.
  await page.click(".font-trigger");
  await page.waitForSelector(".font-list");
  await page.click('.font-option:has-text("Inter")');
  await page.waitForTimeout(200);
  check("a font with weights shows the slider", (await page.locator(".field-note").count()) === 0 && (await page.locator('.field:has-text("Weight") .slider').count()) === 1);
  await page.evaluate(() => window.__or.editor.undo());
  await page.waitForTimeout(200);
  check("undo restores the previous font", (await model()).font === "Anton");

  // A space typed inside a name keeps searching; it does not pick the highlighted font.
  await page.click(".font-trigger");
  await page.waitForSelector(".font-list");
  await page.keyboard.type("archivo b");
  check("a space while typing does not close the list", (await page.locator(".font-list").count()) === 1);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".font-list", { state: "detached" });
  check("typing a name with a space finds it", (await model()).font === "Archivo Black");
  await page.evaluate(() => window.__or.editor.undo());
  await page.waitForTimeout(200);
  check("undo goes back to Anton again", (await model()).font === "Anton");

  // Export both ways and measure the text in the files.
  const open = async () => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
  };
  const done = n => page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n || document.querySelector(".job .modal-warn"), n, { timeout: 240000 });
  const pick = label => page.click(`.modal .seg button:has-text("${label}"), .modal [role=radio]:has-text("${label}")`);
  await page.evaluate(() => window.__or.editor.select([]));
  await open();
  await pick("Still frame");
  await page.click(".modal .export");
  await done(1);
  check("still frame exported", (await page.locator(".job .modal-warn").count()) === 0);
  await pick("Video");
  await pick("MP4");
  await page.click(".modal .export");
  await done(2);
  check("mp4 exported", (await page.locator(".job .modal-warn").count()) === 0);
  await shot("fonts-04-exports");

  const files = readdirSync(OUT).filter(f => !f.endsWith(".openroll-part"));
  const png = files.find(f => f.endsWith(".png"));
  const mp4 = files.find(f => f.endsWith(".mp4"));
  check("both files exist", !!png && !!mp4, files.join(", "));
  const frame = join(OUT, "frame-from-mp4.png");
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", "1.5", "-i", join(OUT, mp4), "-frames:v", "1", frame]);

  const still = await ink(page, readFileSync(join(OUT, png)));
  const video = await ink(page, readFileSync(frame));
  console.log("ink width: preview", second.width.toFixed(3), "still", still.width.toFixed(3), "mp4", video.width.toFixed(3), "expected", antonW.toFixed(3));
  check("PNG still draws the text in Anton", Math.abs(still.width - antonW) < 0.012, `${still.width.toFixed(3)} vs ${antonW.toFixed(3)}`);
  check("MP4 draws the text in Anton", Math.abs(video.width - antonW) < 0.015, `${video.width.toFixed(3)} vs ${antonW.toFixed(3)}`);
  check("export matches the preview", Math.abs(still.width - second.width) < 0.012 && Math.abs(still.height - second.height) < 0.008);
  check("accented letters are drawn, not blank boxes", still.count > 0.004);
}
