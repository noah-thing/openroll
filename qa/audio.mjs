// Audio checks: analysis of speech and music, cleanup, ducking, then an export that is
// measured with ffmpeg. Needs macOS `say`, ffmpeg and ffprobe on the PATH.
// usage: OPENROLL_QA_OUT=/some/dir node qa/launch.mjs qa/audio.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.env.OPENROLL_QA_OUT;
if (!out) throw new Error("set OPENROLL_QA_OUT to a folder for the export");
mkdirSync(out, { recursive: true });
const dir = join(tmpdir(), "openroll-audio-qa");
mkdirSync(dir, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ff = (...args) => run("ffmpeg", ["-loglevel", "error", "-y", ...args]);

/** ffmpeg prints its measurements on stderr. */
const filterLog = (file, trim, filter) =>
  spawnSync("ffmpeg", ["-nostats", ...trim, "-i", file, "-af", filter, "-f", "null", "-"], { encoding: "utf8" }).stderr;

/** Integrated loudness and true peak of a stretch of a file, measured with ffmpeg. */
function measure(file, from, to) {
  const trim = from === undefined ? [] : ["-ss", String(from), "-t", String(to - from)];
  const text = filterLog(file, trim, "ebur128=peak=true");
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(text.slice(text.lastIndexOf("Summary")))?.[1];
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(text.slice(text.lastIndexOf("Summary")))?.[1];
  return { lufs: Number(lufs), peak: Number(peak) };
}

function rmsDb(file, from, to) {
  const r = filterLog(file, ["-ss", String(from), "-t", String(to - from)], "astats");
  const all = [...r.matchAll(/RMS level dB:\s+(-?[\d.inf]+)/g)];
  return Number(all.at(-1)?.[1]);
}

function makeAssets() {
  const say = join(dir, "s.aiff");
  run("say", ["-o", say, "This is a test of the voice cleanup. The quick brown fox jumps over the lazy dog. Noise reduction should remove the hiss behind me, and the loudness should end up near sixteen."]);
  ff("-i", say, "-ar", "48000", "-ac", "1", join(dir, "speech.wav"));
  ff("-i", join(dir, "speech.wav"), "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.03:sample_rate=48000", "-filter_complex", "[0:a]volume=0.5[a];[a][1:a]amix=inputs=2:duration=first:normalize=0", "-ac", "1", join(dir, "noisy.wav"));
  // a 124 BPM loop: kick on the beat, hat between, a soft pad
  const py = `
import wave, struct, math, random
rate=48000; secs=24; bpm=124; off=0.21; n=rate*secs; buf=[0.0]*n; random.seed(3); period=60.0/bpm; t=off
while t < secs-0.5:
    i=int(t*rate)
    for j in range(int(0.18*rate)):
        buf[i+j]+=0.8*math.sin(2*math.pi*(120*math.exp(-j/(0.04*rate))+45)*j/rate)*math.exp(-j/(0.07*rate))
    h=i+int(period/2*rate)
    for j in range(int(0.05*rate)):
        if h+j<n: buf[h+j]+=0.25*(random.random()*2-1)*math.exp(-j/(0.012*rate))
    t+=period
for i in range(n): buf[i]+=0.07*math.sin(2*math.pi*220*i/rate)+0.05*math.sin(2*math.pi*330*i/rate)
w=wave.open(${JSON.stringify(join(dir, "beat.wav"))},"wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
w.writeframes(b"".join(struct.pack("<h",int(max(-1,min(1,v*0.8))*32767)) for v in buf)); w.close()`;
  writeFileSync(join(dir, "mkbeat.py"), py);
  run("python3", [join(dir, "mkbeat.py")]);
}

export default async function ({ page, shot }) {
  makeAssets();
  await page.waitForSelector(".home");
  const infos = await page.evaluate(paths => window.openroll.qa.allow(paths), [join(dir, "noisy.wav"), join(dir, "beat.wav")]);
  await page.evaluate(i => window.__or.newProject(i), infos);
  await page.waitForSelector(".clip");

  // analysis lands on the media without any user action
  await page.waitForFunction(() => Object.values(window.__or.editor.project.media).every(m => m.loudness !== undefined), null, { timeout: 30000 });
  const media = await page.evaluate(() => Object.values(window.__or.editor.project.media).map(m => ({ name: m.name, lufs: m.loudness, bpm: m.bpm, beats: m.beats?.slice(0, 8), speech: m.speech })));
  const voice = media.find(m => m.name === "noisy.wav"), music = media.find(m => m.name === "beat.wav");
  console.log("voice analysis:", JSON.stringify({ lufs: voice.lufs, speech: voice.speech }));
  console.log("music analysis:", JSON.stringify({ lufs: music.lufs, bpm: music.bpm, beats: music.beats }));
  const kick = (k) => 0.21 + (k * 60) / 124;
  const worst = Math.max(...music.beats.slice(0, 8).map((b, k) => Math.min(...[0, 1, 2, 3, 4].map(j => Math.abs(b / 1e6 - kick(k + j))))));
  console.log("beat error vs kicks:", (worst * 1000).toFixed(0), "ms");

  const ids = await page.evaluate(() => {
    const e = window.__or.editor;
    const items = e.project.tracks.flatMap(t => t.items);
    const byName = n => items.find(i => e.project.media[i.mediaId].name === n);
    return { voice: byName("noisy.wav").id, music: byName("beat.wav").id };
  });

  /** Edit both items in one undo step; `fn(voice, music)` mutates plain copies. */
  const mix = (label, fn) =>
    page.evaluate(({ voice, music, fnSrc, label }) => {
      const edit = new Function("v", "m", "next", fnSrc);
      window.__or.editor.apply("QA " + label, p => {
        const next = structuredClone(p);
        const items = next.tracks.flatMap(t => t.items);
        edit(items.find(i => i.id === voice), items.find(i => i.id === music), next);
        return next;
      });
    }, { ...ids, fnSrc: fn, label });

  async function exportNow(name) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
    await page.waitForSelector(".modal");
    const t0 = Date.now();
    await page.click(".modal .export");
    await page.waitForSelector(".modal-done, .modal-warn", { timeout: 300000 });
    const seconds = (Date.now() - t0) / 1000;
    const file = (await page.locator(".modal-path").first().innerText()).trim();
    const copy = join(out, name + ".mp4");
    ff("-i", file, "-c", "copy", copy);
    await page.click('.modal [aria-label="Close"]');
    await page.waitForSelector(".modal", { state: "detached" });
    console.log(`export ${name}: ${seconds.toFixed(1)} s`);
    return copy;
  }

  // A. voice alone, nothing applied
  await mix("voice only", `m.volume = 0; m.duration = 1_000_000; v.audio = undefined;`);
  const plain = await exportNow("voice-plain");
  // B. one cleanup at a time, then all of them
  await page.evaluate(id => window.__or.editor.select([id]), ids.voice);
  await page.click(".rail button:nth-child(5)");
  await page.waitForTimeout(500);
  await shot("audio-panel");
  const gap = [1.95, 2.5];
  const row = (label, f) => console.log(`${label.padEnd(18)} ${measure(f).lufs.toFixed(1).padStart(6)} LUFS  speech ${rmsDb(f, 0.2, 1.8).toFixed(1).padStart(6)} dB  pause ${rmsDb(f, ...gap).toFixed(1).padStart(6)} dB`);
  row("plain", plain);
  for (const [name, audio] of [
    ["denoise", "{ denoise: 1 }"],
    ["enhance voice", "{ voice: true }"],
    ["normalise", "{ normalize: true }"],
    ["all three", "{ denoise: 1, voice: true, normalize: true }"],
  ]) {
    await mix(name, `v.audio = ${audio};`);
    if (name === "all three") {
      await page.click('.tabs [role="tab"]:has-text("Audio")').catch(() => {});
      await page.waitForTimeout(400);
      await shot("audio-inspector");
      // live playback through the same graph, worklet included; errors would print above
      await page.evaluate(() => window.__or.editor.seek(0));
      await page.evaluate(() => window.__or.editor.player.play());
      await page.waitForTimeout(2500);
      const live = await page.evaluate(() => ({ playing: window.__or.editor.player.playing, t: window.__or.editor.player.time / 1e6 }));
      console.log("live playback with cleanup:", JSON.stringify(live));
      await page.evaluate(() => window.__or.editor.player.pause());
    }
    row(name, await exportNow("voice-" + name.replace(/ /g, "-")));
  }

  // C. ducking: the voice is nearly silent but still counts as speech, so the mix is music
  //    alone and its level shows the dip
  await mix("duck", `v.audio = undefined; v.volume = 0.001; m.volume = 1; m.audio = { duckUnder: true }; m.duration = 14_000_000; m.start = 0;
    for (const t of next.tracks) t.items = t.items.filter(i => i.id !== m.id);
    next.tracks.push({ id: "t-music", kind: "audio", name: "Music", items: [m] });
    next.settings.autoBeat = true;`);
  await page.evaluate(id => window.__or.editor.select([id]), ids.music);
  await page.waitForTimeout(600);
  await shot("audio-timeline-beats");
  const ducked = await exportNow("music-ducked");
  await mix("no duck", `m.audio = undefined;`);
  const flat = await exportNow("music-flat");
  const under = rmsDb(ducked, 3, 4.5), free = rmsDb(ducked, 12.5, 13.5), flatUnder = rmsDb(flat, 3, 4.5);
  console.log(`music level while speech plays: ${under.toFixed(1)} dB, after speech: ${free.toFixed(1)} dB, without ducking while speech would play: ${flatUnder.toFixed(1)} dB`);
  console.log("dip:", (flatUnder - under).toFixed(1), "dB");
  await shot("audio-export-done");
}
