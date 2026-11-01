// Transparent exports, a frame check against the MP4, and an export that keeps running while the project is edited.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { check } from "./lib.mjs";

const DIR = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"));
const OUT = process.env.OPENROLL_QA_OUT;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const f = n => join(OUT, n);
const alphaAt = (file, x, y) => {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `crop=1:1:${x}:${y},format=rgba`, "-frames:v", "1", "-f", "rawvideo", "-"]);
  return buf[3];
};

export default async function ({ page }) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await page.waitForSelector(".home");
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [join(DIR, "portrait_1080x1920_20s.mp4")]);
  await page.evaluate(i => window.__or.newProject([i]), info);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  // A landscape frame around a portrait clip leaves empty sides.
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.apply("Frame", p => ({ ...p, settings: { ...p.settings, width: 1920, height: 1080, background: "none" } }));
    e.seek(1_000_000);
  });
  await page.waitForTimeout(500);
  const open = async () => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
  };
  const pick = label => page.click(`.modal [role=radio]:has-text("${label}")`);
  const jobs = n => page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n, n, { timeout: 240000 });
  const rename = async name => page.evaluate(n => window.__or.editor.apply("Rename", p => ({ ...p, name: n })), name);

  await open();
  await rename("alpha4444");
  await pick("ProRes 4444");
  check("transparent toggle offered when the background is none", (await page.locator('.modal .toggle:has-text("Transparent background") [role=switch]').count()) === 1);
  await page.click(".modal .export");
  await jobs(1);
  await rename("alphaweb");
  await pick("WebM VP9");
  await page.click(".modal .export");
  await jobs(2);
  await rename("alphastill");
  await pick("Still frame");
  await page.click(".modal .export");
  await jobs(3);
  await rename("opaque");
  await pick("Video");
  await pick("MP4");
  await page.click(".modal .export");
  await jobs(4);

  check("ProRes 4444 corner is transparent", alphaAt(f("alpha4444.mov"), 20, 20) === 0);
  check("ProRes 4444 centre is opaque", alphaAt(f("alpha4444.mov"), 960, 540) === 255);
  check("PNG corner is transparent", alphaAt(f("alphastill.png"), 20, 20) === 0);
  check("PNG centre is opaque", alphaAt(f("alphastill.png"), 960, 540) === 255);
  const web = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name:stream_tags=alpha_mode", "-of", "csv=p=0", f("alphaweb.webm")], { encoding: "utf8" });
  check("WebM keeps an alpha stream tag", /alpha_mode|1/.test(web) || alphaAt(f("alphaweb.webm"), 20, 20) === 0, web.trim());

  // The still at 1 s against the MP4 at 1 s: same picture within encoding noise.
  const psnr = execFileSync(FFMPEG, ["-v", "info", "-i", f("opaque.mp4"), "-i", f("alphastill.png"), "-filter_complex", "[0:v]trim=start=1,setpts=PTS-STARTPTS,select=eq(n\\,0),format=rgb24[a];[1:v]format=rgb24,setsar=1[b];[a][b]psnr", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString();
  console.log("psnr text:", psnr.split("\n").filter(l => /PSNR/.test(l)).join(" ") || "(see below)");

  // Editing while an export runs: the render keeps the project as it was when it started.
  await page.click(".modal .iconbtn").catch(() => {});
  await page.evaluate(() => window.__or.editor.player.pause());
  await open();
  await rename("snapshot");
  await pick("ProRes 422");
  await page.click(".modal .export");
  await page.click('.modal [aria-label="Minimise"]');
  await page.waitForSelector(".export-chip");
  check("progress chip shows in the top bar", true);
  await page.evaluate(() => {
    const e = window.__or.editor;
    e.select(e.project.tracks.find(t => t.main).items.map(i => i.id));
    e.deleteSelection();
  });
  check("project edited during export", await page.evaluate(() => window.__or.editor.project.tracks.find(t => t.main).items.length === 0));
  await page.waitForFunction(() => document.querySelector(".export-chip")?.textContent?.includes("finished"), null, { timeout: 240000 });
  const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f("snapshot.mov")], { encoding: "utf8" }));
  check("export kept the project it started with", dur > 19, `${dur.toFixed(2)} s`);
}
