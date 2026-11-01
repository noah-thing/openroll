// Export every format from a short project, queue two jobs, edit while one renders, then check the
// files with ffprobe. Run with OPENROLL_QA_OUT=<folder> so the save dialog is skipped.
import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { check } from "./lib.mjs";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-testmedia"));
const OUT = process.env.OPENROLL_QA_OUT;
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

const probe = file => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(OUT, file)], { encoding: "utf8" }));

export default async function ({ page, shot }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await page.waitForSelector(".home");
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [join(DIR, "speech_video_en.mp4")]);
  await page.evaluate(i => window.__or.newProject([i]), info);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  // keep three seconds
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.seek(3_000_000);
    e.select([e.project.tracks.find(t => t.main).items[0].id]);
  });
  await page.keyboard.press("s");
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.select([e.project.tracks.find(t => t.main).items[1].id]);
  });
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__or.editor.seek(1_000_000));

  const open = async () => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
  };
  const done = n => page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n || document.querySelector(".job .modal-warn"), n, { timeout: 240000 });
  const pickKind = label => page.click(`.modal .seg button:has-text("${label}"), .modal [role=radio]:has-text("${label}")`);
  let finished = 0;
  const run = async (kind, format, file) => {
    await pickKind(kind);
    if (format) await pickKind(format);
    const t0 = Date.now();
    await page.click(".modal .export");
    await done(++finished);
    const warn = await page.locator(".job .modal-warn").count();
    check(`${kind} ${format ?? ""} finished`, !warn, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return file;
  };

  await open();
  await shot("export-dialog");
  await run("Video", "MP4");
  await run("Video", "WebM VP9");
  await run("Video", "ProRes 422");
  await run("Video", "ProRes 4444");
  await run("Video", "GIF");
  await run("Audio", "M4A");
  await run("Audio", "WAV");
  await run("Still frame");
  await shot("export-done");

  const files = readdirSync(OUT).filter(f => !f.endsWith(".openroll-part"));
  console.log(files.join(", "));
  const get = ext => files.filter(f => f.endsWith(ext));
  const streams = f => probe(f).streams.map(s => `${s.codec_name}${s.pix_fmt ? "/" + s.pix_fmt : ""}${s.width ? " " + s.width + "x" + s.height : ""}`).join(" + ");
  for (const f of files) console.log(f.padEnd(28), streams(f), `${Number(probe(f).format.duration).toFixed(2)} s`);
  check("mp4 has h264 and aac", /h264/.test(streams(get(".mp4")[0])) && /aac/.test(streams(get(".mp4")[0])));
  check("webm is vp9", /vp9/.test(streams(get(".webm")[0])));
  check("mov files exist", get(".mov").length >= 1);
  check("gif is gif", /gif/.test(streams(get(".gif")[0])));
  check("m4a has aac only", /^aac/.test(streams(get(".m4a")[0])) && !/h264/.test(streams(get(".m4a")[0])));
  check("wav is pcm", /pcm_s16le/.test(streams(get(".wav")[0])));
  check("png exists", get(".png").length === 1);
}
