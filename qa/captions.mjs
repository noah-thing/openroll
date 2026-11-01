// Generate captions from real speech, edit them, cut pauses, export and re-import SRT.
// Needs speech_video_en.mp4 in ~/openroll-testmedia.
// Run with OPENROLL_QA_OUT=/some/dir so the subtitle writer skips the save dialog.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));
const OUT = process.env.OPENROLL_QA_OUT;

const captions = page =>
  page.evaluate(() =>
    window.__or.editor.project.tracks.flatMap(t => t.items.filter(i => i.type === "caption").map(i => ({ start: i.start, duration: i.duration, text: i.words.map(w => w.text).join(" "), words: i.words }))),
  );

export default async function ({ page, shot }) {
  await page.waitForSelector(".home");
  const hf = [];
  page.context().on("request", r => /huggingface|hf\.co/.test(r.url()) && hf.push(r.url().split("/").pop()));
  page.context().on("response", r => /huggingface|hf\.co/.test(r.url()) && r.status() >= 400 && console.log("  http", r.status(), r.url().slice(0, 100)));
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(DIR, process.env.SPEECH_FILE ?? "speech_video_en.mp4")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);

  await page.click('.rail button:has-text("Captions")');
  await page.waitForSelector(".cap-gen");
  if (process.env.SPEECH_DEVICE) await page.evaluate(d => (window.__orDevice = d), process.env.SPEECH_DEVICE);
  await shot("cap-01-panel");

  if (process.env.SPEECH_LANG) await page.selectOption(".cap-select select", process.env.SPEECH_LANG);
  if (process.env.SPEECH_MODEL === "small") await page.click('.cap-model button:has-text("Small")');

  await page.evaluate(() => {
    window.__gap = { max: 0, frames: 0 };
    let last = performance.now();
    const tick = now => {
      window.__gap.max = Math.max(window.__gap.max, now - last);
      window.__gap.frames++;
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await page.click(".cap-go");
  await page.waitForSelector(".cap-progress");
  let shotTaken = false;
  const seen = new Set();
  while (await page.locator(".cap-progress").count()) {
    const label = await page.locator(".cap-progress .progress-meta span").first().innerText().catch(() => "");
    const key = label.replace(/\d+/g, "#");
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s]`, label);
      if (!shotTaken && /Listening/.test(label)) {
        await shot("cap-02-listening");
        shotTaken = true;
      }
    }
    await page.waitForTimeout(250);
    if (Date.now() - t0 > 20 * 60_000) throw new Error("timed out");
  }
  console.log("UI frame gaps while listening:", JSON.stringify(await page.evaluate(() => window.__gap)));
  console.log("network requests to Hugging Face:", hf.length, hf.slice(0, 6));
  console.log("browser cache:", JSON.stringify(await page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length;
    return out;
  })));
  console.log("generate finished after", ((Date.now() - t0) / 1000).toFixed(1), "s wall clock");
  console.log("service stats:", JSON.stringify(await page.evaluate(() => window.__orSpeech)));
  console.log("summary:", await page.locator(".cap-summary, .cap-error").innerText().catch(() => "(none)"));

  const caps = await captions(page);
  console.log(`${caps.length} captions`);
  for (const c of caps.slice(0, 12)) console.log(`  ${(c.start / 1e6).toFixed(2)}s +${(c.duration / 1e6).toFixed(2)}s  ${c.text}`);
  await page.waitForTimeout(500);
  await shot("cap-03-generated");

  // look at the frame with a highlighted word
  if (caps.length) {
    const w = caps[0].words[Math.min(1, caps[0].words.length - 1)];
    await page.evaluate(t => window.__or.editor.seek(t), caps[0].start + w.start + 50_000);
    await page.waitForTimeout(700);
    await shot("cap-04-frame");
  }

  // style presets and highlight
  await page.click('.cap-card:has-text("Block")');
  await page.waitForTimeout(500);
  await shot("cap-05-block");
  await page.hover('.cap-card:has-text("Marker")');
  await page.waitForTimeout(500);
  await shot("cap-06-specimen-hover");
  await page.click('.cap-card:has-text("Loud")');
  await page.waitForTimeout(300);

  // transcript
  await page.click('.cap-views button:has-text("Transcript")');
  await page.waitForSelector(".cap-row");
  await shot("cap-07-transcript");
  const first = page.locator(".cap-row input").first();
  await first.click();
  await first.fill("Edited first words here");
  await first.press("Enter");
  await page.waitForTimeout(300);
  const after = await captions(page);
  console.log("edited caption:", JSON.stringify(after[0].words.map(w => [w.text, w.start, w.end])));
  await page.evaluate(() => window.__or.editor.undo());
  await page.waitForTimeout(200);
  console.log("after undo:", (await captions(page))[0].text);

  // inspector for a caption
  await page.evaluate(() => {
    const e = window.__or.editor;
    const c = e.project.tracks.flatMap(t => t.items).find(i => i.type === "caption");
    e.select([c.id]);
  });
  await page.waitForTimeout(400);
  await shot("cap-08-inspector");

  // export and import
  if (OUT) {
    await page.click('.cap-files button:has-text("Export SRT")');
    await page.waitForTimeout(800);
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(OUT).filter(f => f.includes(".srt"));
    console.log("exported:", files);
    if (files[0]) console.log(readFileSync(join(OUT, files[0]), "utf8").split("\n").slice(0, 9).join("\n"));
    await page.click('.cap-files button:has-text("Export VTT")');
    await page.waitForTimeout(800);
    const vtt = readdirSync(OUT).filter(f => f.includes(".vtt"));
    if (vtt[0]) console.log(readFileSync(join(OUT, vtt[0]), "utf8").split("\n").slice(0, 6).join("\n"));
    if (files[0]) {
      await page.evaluate(() => {
        const e = window.__or.editor;
        const ids = e.project.tracks.flatMap(t => t.items.filter(i => i.type === "caption").map(i => i.id));
        e.select(ids);
        e.deleteSelection();
      });
      console.log("captions after delete:", (await captions(page)).length);
      await page.setInputFiles('input[type="file"]', join(OUT, files[0]));
      await page.waitForTimeout(600);
      console.log("captions after import:", (await captions(page)).length);
      await shot("cap-09-imported");
    }
  }

  // smart cut
  await page.click('.cap-views button:has-text("Smart cut")');
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.select([e.project.tracks.find(t => t.main).items[0].id]);
  });
  await page.waitForTimeout(400);
  await shot("cap-10-smartcut");
  const plan = await page.locator(".cap-plan").innerText().catch(() => "(no plan)");
  console.log("plan:", plan);
  const before = await page.evaluate(() => window.__or.editor.player.duration / 1e6);
  if (await page.locator(".cap-go:has-text('Remove from clip')").isEnabled().catch(() => false)) {
    await page.click(".cap-go:has-text('Remove from clip')");
    await page.waitForTimeout(600);
    const afterDur = await page.evaluate(() => window.__or.editor.player.duration / 1e6);
    console.log(`duration ${before.toFixed(2)} s -> ${afterDur.toFixed(2)} s`);
    console.log("main clips:", await page.evaluate(() => window.__or.editor.project.tracks.find(t => t.main).items.length));
    await shot("cap-11-after-cut");
    await page.evaluate(() => window.__or.editor.undo());
    await page.waitForTimeout(300);
    console.log("after one undo:", (await page.evaluate(() => window.__or.editor.player.duration / 1e6)).toFixed(2), "s");
  }
  await page.waitForTimeout(1500);
}
