// Speed curves in the real app. A clip whose frames are numbered in binary gets a curve
// (preset, then an edit dragged on the graph), and the exported file is read back with
// ffmpeg: every output frame must show the source frame an independent integration of the
// same curve says it should, the preview must show the same frame the export did, the
// one second clicks in the sound must land where the curve puts them, and playback must hold
// its frame rate.
//   OPENROLL_QA_OUT=/tmp/orramp node qa/launch.mjs qa/speed-ramp.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { check } from "./lib.mjs";

const OUT = process.env.OPENROLL_QA_OUT;
const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
const bin = name => process.env[name.toUpperCase()] ?? join("resources/ffmpeg", `${os}-${process.arch}`, process.platform === "win32" ? `${name}.exe` : name);
const FPS = 30;
/** The time the exporter draws output frame i at. */
const at = i => Math.round((i / FPS) * 1e6);
const SECONDS = 12;

/** Ten black and white blocks spell the frame number in binary; a 1 kHz click opens every second. */
function makeClip(file) {
  const r = spawnSync(bin("ffmpeg"), [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=320x180:r=${FPS}:d=${SECONDS},format=yuv420p,geq=lum='16+219*mod(floor(N/pow(2,floor(X/32))),2)':cb=128:cr=128`,
    "-f", "lavfi", "-i", `aevalsrc='if(lt(mod(t,1),0.02),0.8*sin(2*PI*1000*t),0)':s=48000:d=${SECONDS}`,
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

function audioSamples(file) {
  const r = spawnSync(bin("ffmpeg"), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 29 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
}

// ---- an independent model of a curve: no code from the app, just the definition ----

const smooth = f => f * f * (3 - 2 * f);
const SHAPES = { linear: f => f, ease: smooth, easeIn: f => f ** 3, easeOut: f => 1 - (1 - f) ** 3 };

function speedAt(keys, x) {
  if (x <= keys[0].x) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i].x) {
      const a = keys[i - 1], b = keys[i];
      const e = a.ease ?? "ease";
      if (e === "hold") return x >= b.x ? b.v : a.v;
      if (typeof e !== "string") throw new Error("the checker only knows the named easings");
      return a.v + (b.v - a.v) * SHAPES[e]((x - a.x) / (b.x - a.x));
    }
  }
  return keys.at(-1).v;
}

/** Walk the footage with small steps of dx/dn = speed / span, and return source offset by clip time. */
function walker(keys, span, duration) {
  const dn = 500;
  const ns = [0], xs = [0];
  let x = 0, n = 0;
  while (x < 1 && n < 1e9) {
    const k1 = speedAt(keys, x) / span;
    const k2 = speedAt(keys, Math.min(1, x + (k1 * dn) / 2)) / span;
    const k3 = speedAt(keys, Math.min(1, x + (k2 * dn) / 2)) / span;
    const k4 = speedAt(keys, Math.min(1, x + k3 * dn)) / span;
    x += (dn * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
    n += dn;
    ns.push(n);
    xs.push(Math.min(1, x));
  }
  const natural = ns.at(-1);
  const atNatural = q => {
    let lo = 0, hi = ns.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ns[mid] <= q) lo = mid;
      else hi = mid;
    }
    return xs[lo] + ((xs[hi] - xs[lo]) * (q - ns[lo])) / (ns[hi] - ns[lo]);
  };
  return {
    natural,
    /** Source micros played after `local` micros of the clip. */
    played: local => span * atNatural(Math.min(natural, (local * natural) / duration)),
    /** Clip micros at which `played` micros of source have gone by. */
    localAt: played => {
      const target = Math.min(1, played / span);
      let lo = 0, hi = duration;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (atNatural(Math.min(natural, (mid * natural) / duration)) < target) lo = mid;
        else hi = mid;
      }
      return lo;
    },
  };
}

const readItem = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__or.editor.project.tracks[0].items[0])));

export default async function ({ page }) {
  if (!OUT) throw new Error("set OPENROLL_QA_OUT");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const media = mkdtempSync(join(tmpdir(), "openroll-ramp-"));
  const clip = join(media, "codes.mp4");
  makeClip(clip);

  await page.waitForSelector(".home");
  const [info] = await page.evaluate(p => window.openroll.qa.allow(p), [clip]);
  const openClip = async () => {
    await page.evaluate(i => window.__or.newProject([i]), info);
    await page.waitForSelector(".clip");
    await page.waitForTimeout(1200);
    await page.click(".clip");
    await page.click('[role=tab]:has-text("Speed")');
  };
  const choose = async label => {
    await page.click(`button.chip:has-text("${label}")`);
    await page.waitForTimeout(400);
  };
  const exportNow = async name => {
    rmSync(join(OUT, "Untitled.mp4"), { force: true });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
    const done = await page.locator(".job .modal-done").count();
    await page.click(".modal .export");
    await page.waitForFunction(n => document.querySelectorAll(".job .modal-done").length > n || document.querySelector(".job .modal-warn"), done, { timeout: 240000 });
    check(`${name}: the export finished without a warning`, (await page.locator(".job .modal-warn").count()) === 0);
    await page.click(".modal-head .iconbtn");
    await page.waitForSelector(".modal", { state: "detached" });
    return join(OUT, "Untitled.mp4");
  };

  // ---- a preset, then a point dragged on the graph ----
  await openClip();
  const before = await readItem(page);
  check("the clip starts at a steady speed", !before.ramp && before.speed === 1 && before.duration === SECONDS * 1e6, `${before.duration}`);

  await choose("Montage");
  let item = await readItem(page);
  check("Montage puts a curve on the clip", item.ramp?.preset === "montage" && item.ramp.keys.length === 3);
  check("the footage it shows is unchanged", item.ramp.span === SECONDS * 1e6 && item.in === 0, `span ${item.ramp.span}`);
  check("the length follows the curve", item.duration > 4e6 && item.duration < 30e6, `${(item.duration / 1e6).toFixed(2)} s`);
  check("undo calls it by name", (await page.evaluate(() => window.__or.editor.history.undoLabel)) === "Speed curve, Montage", await page.evaluate(() => String(window.__or.editor.history.undoLabel)));

  const dragged = async () => {
    const dot = page.locator("circle.sc-point").nth(1);
    const b = await dot.boundingBox();
    const g = await page.locator("svg.sc-graph").boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - g.width * 0.08, b.y + b.height / 2 + g.height * 0.1, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  await dragged();
  item = await readItem(page);
  check("dragging a point changes the curve and clears the preset", !item.ramp.preset && item.ramp.keys[1].x < 0.5 && item.ramp.keys[1].v < 3, JSON.stringify(item.ramp.keys[1]));
  check("the drag is named for undo", (await page.evaluate(() => window.__or.editor.history.undoLabel)) === "Edit speed curve");
  check("a drag is one undo step", await page.evaluate(() => {
    const e = window.__or.editor;
    const d = e.project.tracks[0].items[0].duration;
    e.undo();
    const back = e.project.tracks[0].items[0];
    const ok = back.ramp?.preset === "montage";
    e.redo();
    return ok && e.project.tracks[0].items[0].duration === d;
  }));
  item = await readItem(page);
  console.log("curve under test:", JSON.stringify(item.ramp.keys), `length ${(item.duration / 1e6).toFixed(3)} s`);

  // ---- export and read the frames back ----
  const keys = item.ramp.keys;
  const model = walker(keys, item.ramp.span, item.duration);
  check("the length matches an independent integration of the curve", Math.abs(model.natural - item.duration) < 3000, `${model.natural} against ${item.duration}`);

  const file = await exportNow("curve");
  const frames = frameNumbers(file);
  const expectedCount = Math.ceil((item.duration / 1e6) * FPS);
  check("the export has the frames the length asks for", Math.abs(frames.length - expectedCount) <= 1, `${frames.length} against ${expectedCount}`);
  let wrong = 0, off = 0, worst = 0;
  frames.forEach((got, i) => {
    const src = (item.in + model.played(at(i))) / 1e6;
    const exact = src * FPS;
    const want = Math.floor(exact + 1e-9);
    const nearEdge = Math.min(exact - Math.floor(exact), Math.ceil(exact) - exact) < 0.02;
    if (got !== want) {
      worst = Math.max(worst, Math.abs(got - want));
      if (!nearEdge || Math.abs(got - want) > 1) wrong++;
      else off++;
    }
  });
  check("every exported frame is the source frame the curve says", wrong === 0, `${wrong} wrong, ${off} on a frame edge, worst ${worst}`);
  const sorted = frames.every((n, i) => i === 0 || n >= frames[i - 1]);
  check("frames never go backwards", sorted);
  const steps = frames.slice(1).map((n, i) => n - frames[i]);
  console.log(`frame steps run from ${Math.min(...steps)} to ${Math.max(...steps)}`);

  // ---- preview against export ----
  const sample = [];
  for (let i = 0; i < frames.length; i += 11) sample.push(i);
  const previewed = await page.evaluate(async times => {
    const out = [];
    for (const t of times) {
      const img = await window.__or.editor.player.snapshot(t, undefined, { settle: true, width: 320 });
      let n = 0;
      for (let k = 0; k < 10; k++) {
        const x = Math.floor(((k + 0.5) * img.width) / 10), y = Math.floor(img.height / 2);
        if (img.data[(y * img.width + x) * 4] > 127) n |= 1 << k;
      }
      out.push(n);
    }
    return out;
  }, sample.map(at));
  // A source time a hair after a frame edge can still show the earlier frame in a snapshot, with a steady speed too, so those are counted apart.
  const position = i => ((item.in + model.played(at(i))) / 1e6) * FPS;
  const mismatched = sample.filter((i, k) => previewed[k] !== frames[i]);
  const grazing = mismatched.filter(i => Math.min(position(i) % 1, 1 - (position(i) % 1)) < 0.01);
  check("the preview shows the frame the export has, at every sampled time", mismatched.length === grazing.length, `${mismatched.length - grazing.length} differ away from a frame edge, ${grazing.length} on one, of ${sample.length}`);

  // ---- sound: the click at each source second must land where the curve puts it ----
  const pcm = audioSamples(file);
  const onsets = [];
  let quiet = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > 0.15) {
      if (quiet > 0.25 * 48000 || onsets.length === 0) onsets.push(i / 48000);
      quiet = 0;
    } else quiet++;
  }
  const wanted = [];
  for (let s = 0; s < SECONDS; s++) wanted.push(model.localAt(s * 1e6) / 1e6);
  const lateBy = wanted.map((w, k) => (onsets[k] === undefined ? NaN : onsets[k] - w));
  check("the sound follows the curve (every click within 40 ms)", onsets.length >= SECONDS - 1 && lateBy.every(d => Math.abs(d) < 0.04), `${onsets.length} clicks, off by ${lateBy.map(d => (d * 1000).toFixed(0)).join(" ")} ms`);

  // ---- a curve that leaves the range sound can follow stays quiet ----
  await choose("Bullet");
  const bullet = await readItem(page);
  check("Bullet is on the clip", bullet.ramp?.preset === "bullet");
  const loud = await exportNow("bullet");
  const quietPcm = audioSamples(loud);
  let peak = 0;
  for (const v of quietPcm) peak = Math.max(peak, Math.abs(v));
  check("a curve outside 0.25x to 4x exports without sound", peak < 0.01, `peak ${peak.toFixed(4)}`);

  // ---- a steady speed again ----
  await page.click('button.chip:has-text("2×")');
  await page.waitForTimeout(300);
  item = await readItem(page);
  check("a steady speed replaces the curve", !item.ramp && item.speed === 2 && item.duration === (SECONDS * 1e6) / 2);

  // ---- split keeps both halves on the curve ----
  await choose("Hero");
  const hero = await readItem(page);
  await page.evaluate(t => {
    window.__or.editor.seek(t);
    window.__or.editor.splitAtPlayhead();
  }, Math.round(hero.duration * 0.41));
  await page.waitForTimeout(400);
  const halves = await page.evaluate(() => JSON.parse(JSON.stringify(window.__or.editor.project.tracks[0].items)));
  check("a split gives two clips that keep the footage and the curve", halves.length === 2 && halves[0].ramp && halves[1].ramp && halves[0].ramp.span + halves[1].ramp.span === hero.ramp.span && halves[0].duration + halves[1].duration === hero.duration, JSON.stringify(halves.map(h => [h.duration, h.ramp?.span])));
  const splitFile = await exportNow("split");
  const joined = frameNumbers(splitFile);
  check("the split export has its frames", joined.length > 100, `${joined.length} frames in ${readdirSync(OUT).join(", ")}`);
  const heroModel = walker(hero.ramp.keys, hero.ramp.span, hero.duration);
  let splitWrong = 0;
  joined.forEach((got, i) => {
    const exact = ((heroModel.played(at(i)) + 0) / 1e6) * FPS;
    const nearEdge = Math.min(exact - Math.floor(exact), Math.ceil(exact) - exact) < 0.03;
    if (Math.abs(got - Math.floor(exact + 1e-9)) > (nearEdge ? 1 : 0)) splitWrong++;
  });
  check("the split clip exports the same frames the unsplit one would", splitWrong === 0, `${splitWrong} of ${joined.length} differ`);

  // ---- playback holds its frame rate ----
  const perf = async label => {
    await page.evaluate(() => window.__or.editor.seek(0));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__or.editor.player.play());
    await page.waitForTimeout(3600);
    const s = await page.evaluate(() => ({ ...window.__or.editor.player.stats }));
    await page.evaluate(() => window.__or.editor.player.pause());
    console.log(`${label.padEnd(26)} ${s.fps} fps, ${s.late} late frames, worst ${s.worstMs} ms`);
    return s;
  };
  await page.click(".mark");
  await page.waitForSelector(".home");
  const [big] = await page.evaluate(p => window.openroll.qa.allow(p), [join(homedir(), "openroll-testmedia", "h264_1080p30_60s.mp4")]);
  await page.evaluate(i => window.__or.newProject([i]), big);
  await page.waitForSelector(".clip");
  await page.waitForTimeout(1500);
  await page.click(".clip");
  await page.click('[role=tab]:has-text("Speed")');
  const steady = await perf("1080p steady speed");
  const results = {};
  for (const label of ["Montage", "Jump cut", "Flash in"]) {
    await choose(label);
    results[label] = await perf(`1080p ${label}`);
  }
  // The preview skips frames that would look the same as the last one, so a slow stretch of a
  // curve draws fewer frames on purpose. Stutter shows up as late frames, not as a lower count.
  const late = Math.max(...Object.values(results).map(r => r.late));
  const slowest = Math.max(...Object.values(results).map(r => r.worstMs));
  check("playback on curves has no late frames", late === 0 && steady.late === 0, `steady ${steady.late} late, worst on a curve ${late}`);
  check("no frame on a curve takes longer than one display refresh", slowest < 16.7, `worst ${slowest} ms`);
}
