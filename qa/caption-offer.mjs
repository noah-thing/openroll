// Bring in a clip with speech, accept the captions prompt, and check captions appear. Then bring in
// another clip, decline, and check it is never asked about again. Needs the speech model, which
// downloads on first use. Run with OPENROLL_TESTMEDIA pointing at a folder with speech_video_en.mp4 and speech_en.m4a.
import { join } from "node:path";
import { homedir } from "node:os";
import { check } from "./lib.mjs";

const DIR = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia");
const PROMPT = '.toast:has-text("Add captions?")';

const captions = page => page.evaluate(() => window.__or.editor.project.tracks.flatMap(t => t.items).filter(i => i.type === "caption").length);

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const [video] = await page.evaluate(p => window.openroll.qa.allow(p), [join(DIR, "speech_video_en.mp4")]);
  await page.evaluate(i => window.__or.newProject([i]), video);
  await page.waitForSelector(".clip");

  await page.waitForSelector(PROMPT, { timeout: 60000 });
  check("prompt says the clip has speech", (await page.locator(PROMPT).innerText()).includes("This clip has speech"));
  check("it is a toast, not a modal", (await page.locator(".modal").count()) === 0);
  check("the file is marked as asked", await page.evaluate(() => Object.values(window.__or.editor.project.media).every(m => m.captionsAsked)));
  await shot("offer-01-prompt");

  await page.click(`${PROMPT} button:has-text("Add captions")`);
  check("prompt closes on answer", (await page.locator(PROMPT).count()) === 0);
  const t0 = Date.now();
  while ((await captions(page)) === 0 && Date.now() - t0 < 10 * 60_000) await page.waitForTimeout(500);
  const n = await captions(page);
  check("captions were added", n > 0, `${n} captions in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.waitForTimeout(800);
  await shot("offer-02-captions");
  await page.waitForTimeout(2500);
  check("no second prompt for the same file", (await page.locator(PROMPT).count()) === 0);

  // Decline on a second file, then bring it in again.
  const [audio] = await page.evaluate(p => window.openroll.qa.allow(p), [join(DIR, "speech_en.m4a")]);
  await page.evaluate(i => window.__or.importFiles(window.__or.editor, [i], { at: 200_000_000 }), audio);
  await page.waitForSelector(PROMPT, { timeout: 60000 });
  await shot("offer-03-second");
  await page.click(`${PROMPT} button:has-text("Not now")`);
  const before = await captions(page);
  await page.waitForTimeout(1500);
  check("Not now adds nothing", (await captions(page)) === before);
  await page.evaluate(i => window.__or.importFiles(window.__or.editor, [i], { at: 200_000_000 }), audio);
  await page.waitForTimeout(3000);
  check("a declined file is not asked about again", (await page.locator(PROMPT).count()) === 0);

  // The setting turns the question off for good.
  const [again] = await page.evaluate(p => window.openroll.qa.allow(p), [join(DIR, "speech_sv.m4a")]);
  await page.evaluate(() => window.openroll.settings.set({ offerCaptions: false }));
  await page.waitForTimeout(500);
  await page.evaluate(i => window.__or.importFiles(window.__or.editor, [i], { at: 200_000_000 }), again);
  await page.waitForTimeout(6000);
  check("nothing is asked when the setting is off", (await page.locator(PROMPT).count()) === 0);
}
