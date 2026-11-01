// Export reliability: exact frame count, cancel, an existing file, two exports to one name, an unwritable folder.
// Run with OPENROLL_QA_OUT=<folder> so the save dialog is skipped:
//   OPENROLL_QA_OUT=/tmp/orx node qa/launch.mjs qa/export-safety.mjs
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "./lib.mjs";

const OUT = process.env.OPENROLL_QA_OUT;
const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
const bin = name => process.env[name.toUpperCase()] ?? join("resources/ffmpeg", `${os}-${process.arch}`, process.platform === "win32" ? `${name}.exe` : name);

/** Ten black and white blocks across the picture spell the frame number in binary; a click opens every second. */
function makeClip(file, seconds) {
  const r = spawnSync(bin("ffmpeg"), [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=320x180:r=30:d=${seconds},format=yuv420p,geq=lum='16+219*mod(floor(N/pow(2,floor(X/32))),2)':cb=128:cr=128`,
    "-f", "lavfi", "-i", `aevalsrc='if(lt(mod(t,1),0.02),0.8*sin(2*PI*1000*t),0)':s=48000:d=${seconds}`,
    "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", file,
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

function frameNumbers(file) {
  const r = spawnSync(bin("ffmpeg"), ["-v", "error", "-i", file, "-an", "-vf", "scale=10:1:flags=area,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const out = [];
  for (let i = 0; i + 10 <= r.stdout.length; i += 10) {
    let n = 0;
    for (let k = 0; k < 10; k++) if (r.stdout[i + k] > 127) n |= 1 << k;
    out.push(n);
  }
  return out;
}

const countFrames = file => Number(spawnSync(bin("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim());
const listing = () => readdirSync(OUT).sort();

export default async function ({ page }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const media = mkdtempSync(join(tmpdir(), "openroll-safety-"));
  const clip = join(media, "codes.mp4");
  makeClip(clip, 20);

  await page.waitForSelector(".home");
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [clip]);
  const open = async trim => {
    await page.evaluate(i => window.__or.newProject([i]), info);
    await page.waitForSelector(".clip");
    await page.waitForTimeout(1200);
    if (trim) await page.evaluate(d => window.__or.editor.apply("qa trim", p => {
      const n = structuredClone(p);
      n.tracks[0].items[0].duration = d;
      return n;
    }), trim);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
  };
  const closeDialog = async () => {
    await page.click(".modal-head .iconbtn");
    await page.waitForSelector(".modal", { state: "detached" });
  };
  const doneCount = () => page.locator(".job .modal-done").count();
  const finished = async n => page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n || document.querySelector(".job .modal-warn"), n, { timeout: 240000 });

  // 1. Sound that ends part way through the last frame must not take that frame with it.
  await open(1_010_000);
  await page.click('.modal .seg button:has-text("ProRes 422"), .modal [role=radio]:has-text("ProRes 422")');
  await page.click(".modal .export");
  await finished(1);
  const mov = join(OUT, "Untitled.mov");
  check("ProRes with audio keeps all 31 frames", countFrames(mov) === 31, String(countFrames(mov)));
  const reported = (await page.locator(".job .modal-done").first().innerText()).match(/Saved ([\d.]+) (KB|MB|GB)/);
  const real = statSync(mov).size;
  const shown = reported ? Number(reported[1]) * { KB: 1e3, MB: 1e6, GB: 1e9 }[reported[2]] : 0;
  check("the size shown is the size of the file", shown > real * 0.8 && shown < real * 1.25, `${shown} vs ${real}`);
  await closeDialog();

  // 2. A normal MP4 is frame exact from first to last.
  await open(4_000_000);
  await page.click(".modal .export");
  await finished(2);
  const nums = frameNumbers(join(OUT, "Untitled.mp4"));
  check("MP4 has 120 frames in order", nums.length === 120 && nums.every((n, i) => n === i), `${nums.length} first ${nums[0]} last ${nums.at(-1)}`);
  check("no temp files after a finished export", !listing().some(f => f.endsWith(".openroll-part")), listing().join(", "));
  await closeDialog();

  // 3. Stopping an export leaves the file that was there and no temp file.
  writeFileSync(join(OUT, "Untitled.mp4"), "previous export");
  await open();
  const listed = await page.locator(".job").count();
  await page.click(".modal .export");
  await page.waitForSelector(".job .progress");
  await page.waitForTimeout(800);
  await page.click('.job:has(.progress) button:has-text("Stop")');
  await page.waitForFunction(n => document.querySelectorAll(".job").length === n, listed, { timeout: 60000 });
  await page.waitForTimeout(500);
  check("a stopped export keeps the old file", readFileSync(join(OUT, "Untitled.mp4"), "utf8") === "previous export");
  check("a stopped export leaves no temp file", !listing().some(f => f.endsWith(".openroll-part")), listing().join(", "));
  await closeDialog();

  // 4. Two exports queued to the same name each finish; the file at the end is whole.
  rmSync(join(OUT, "Untitled.mp4"));
  await open(3_000_000);
  const before = await doneCount();
  await page.click(".modal .export");
  await page.waitForTimeout(100);
  await page.click(".modal .export");
  await page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length >= n || document.querySelector(".job .modal-warn"), before + 2, { timeout: 240000 });
  check("two exports to one name both finish", (await page.locator(".job .modal-warn").count()) === 0);
  const twice = frameNumbers(join(OUT, "Untitled.mp4"));
  check("the file they share is whole", twice.length === 90 && twice.every((n, i) => n === i), String(twice.length));
  check("no temp files after queued exports", !listing().some(f => f.endsWith(".openroll-part")), listing().join(", "));

  // 5. A folder that cannot be written says so in the dialog instead of doing nothing.
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    chmodSync(OUT, 0o555);
    try {
      await page.click(".modal .export");
      await page.waitForSelector(".modal-warn:has-text('could not be created')", { timeout: 10000 });
      check("an unwritable folder is reported", true);
      check("the export button is usable again", await page.locator(".modal .export").isEnabled());
    } catch {
      check("an unwritable folder is reported", false);
    } finally {
      chmodSync(OUT, 0o755);
    }
  }
  rmSync(media, { recursive: true, force: true });
  if (existsSync(join(OUT, "Untitled.mov"))) rmSync(join(OUT, "Untitled.mov"));
}
