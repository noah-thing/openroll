// Three jobs an editor would hand to Claude, done through the MCP tools only, and judged on
// what the tools say back: ids the next call needs, errors that say how to fix, call times.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import electron from "electron";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MEDIA = process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia");

export default async function ({ page, userData, shot }) {
  let failed = 0;
  const check = (name, ok, extra = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  };
  await page.waitForSelector(".home");
  const transport = new StdioClientTransport({ command: electron, args: [resolve("."), "--mcp", `--user-data-dir=${userData}`], stderr: "ignore" });
  const client = new Client({ name: "claude-code", version: "qa" });
  await client.connect(transport);

  const slow = [];
  const call = async (name, args = {}) => {
    const t0 = Date.now();
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 });
    const ms = Date.now() - t0;
    if (ms > 1500) slow.push(`${name} ${ms} ms`);
    const text = r.content.find(c => c.type === "text")?.text;
    if (r.isError) return { error: text, content: r.content };
    let value = text;
    try { value = JSON.parse(text); } catch {}
    return { value, content: r.content };
  };
  const saveImage = (r, file) => {
    const img = r.content.find(c => c.type === "image");
    if (img) writeFileSync(`qa/shots/${file}`, Buffer.from(img.data, "base64"));
  };

  // Job 1: a vertical short with captions from a talking clip.
  await call("new_project", { name: "Short", ratio: "9:16" });
  await page.waitForSelector(".editor");
  const imp = (await call("import_media", { paths: [join(MEDIA, "speech_video_en.mp4")], place: "append" })).value;
  const talk = imp.media[0];
  check("import with place append says where the clip went", imp.placed?.[0]?.start === 0, JSON.stringify(imp).slice(0, 240));
  let proj = (await call("get_project")).value;
  const clip = proj.tracks.find(t => t.main).items[0];
  const tr = await call("transcribe", { clip: clip.id });
  check("transcript", !tr.error && tr.value.words?.length > 5, tr.error ?? `${tr.value.words?.length} words, keys ${Object.keys(tr.value)}`);
  const vert = await call("make_vertical", { clip: clip.id });
  check("make_vertical", !vert.error, vert.error ?? JSON.stringify(vert.value).slice(0, 200));
  const cap = await call("captions", { style: "outline", highlight: true, position: "middle" });
  check("captions", !cap.error && cap.value.captions > 3, cap.error ?? JSON.stringify(cap.value).slice(0, 200));
  const hook = await call("edit", {
    label: "Hook title",
    ops: [
      { op: "add_text", text: "Wait for it", at: 0, duration: 1.5, y: -500, style: { size: 120 }, as: "hook" },
      { op: "set", id: "$hook", props: { animationIn: { kind: "pop", duration: 0.3 } } },
    ],
  });
  check("title added", !hook.error, hook.error);
  const total = (await call("get_project")).value;
  check("vertical frame", total.frame.width === 1080 && total.frame.height === 1920, JSON.stringify(total.frame));
  const sheet = await call("contact_sheet", { count: 6 });
  saveImage(sheet, "mcp-agent-short.jpg");
  const ex = await call("export", { path: join(userData, "short.mp4"), resolution: "1080" });
  check("export short", !ex.error, ex.error ?? JSON.stringify(ex.value));

  // Job 2: a music montage cut to the beat with titles.
  await call("new_project", { name: "Montage", ratio: "16:9" });
  await page.waitForTimeout(300);
  const m = (await call("import_media", { paths: ["ferry.jpg", "coffee.jpg", "forest.jpg", "tone_90s.mp3", "h264_1080p30_60s.mp4"].map(n => join(MEDIA, n)) })).value;
  const mid = n => m.media.find(x => x.name.startsWith(n)).id;
  const flat = await call("analyze_media", { media: mid("tone") });
  check("a track with no beat says so", /No steady beat/.test(flat.value?.note ?? ""), flat.value?.note);
  // The synthetic tone has no beat; give it one the way detection would.
  await page.evaluate(id => window.__or.editor.annotateMedia(id, { beats: Array.from({ length: 170 }, (_, i) => Math.round((0.4 + i * 0.5) * 1e6)), bpm: 120 }), mid("tone"));
  const build = await call("edit", {
    label: "Montage",
    ops: [
      { op: "add_clip", media: mid("ferry"), duration: 4, as: "a" },
      { op: "add_clip", media: mid("coffee"), duration: 4, as: "b" },
      { op: "add_clip", media: mid("forest"), duration: 4, as: "c" },
      { op: "add_clip", media: mid("h264"), duration: 8, as: "d" },
      { op: "add_clip", media: mid("tone"), at: 0, as: "song" },
      { op: "cut_to_beat", clips: ["$a", "$b", "$c", "$d"], music: "$song", every: 2 },
    ],
  });
  check("cut to beat", !build.error, build.error ?? JSON.stringify(build.value).slice(0, 300));
  proj = (await call("get_project")).value;
  const main = proj.tracks.find(t => t.main);
  check("after cut_to_beat the project lists the pieces", main.items.length > 4, `${main.items.length} clips, duration ${proj.duration}`);
  const second = main.items[1];
  const titles = await call("edit", {
    label: "Titles",
    ops: [
      { op: "add_text", text: "Summer, in pieces", at: 0.3, duration: 2.5, as: "t1" },
      { op: "set", id: "$t1", props: { animationIn: { kind: "slide-up", duration: 0.4 }, animationOut: { kind: "fade", duration: 0.3 } } },
      { op: "transition", id: second.id, kind: "dissolve", duration: 0.2 },
      { op: "set", id: main.items.at(-1).id, props: { fadeOut: 1 } },
    ],
  });
  check("titles and a transition on a cut piece", !titles.error, titles.error);
  const song = proj.tracks.find(t => t.kind === "audio")?.items[0];
  const fix = await call("edit", { ops: [{ op: "trim", id: song.id, duration: proj.duration }, { op: "set", id: song.id, props: { fadeOut: 2 } }] });
  check("music trimmed to the picture", !fix.error, fix.error);
  saveImage(await call("contact_sheet", { count: 8 }), "mcp-agent-montage.jpg");

  // Job 3: tidy a messy timeline from the notes.
  await call("new_project", { name: "Messy", ratio: "16:9" });
  await page.waitForTimeout(300);
  const x = (await call("import_media", { paths: ["ferry.jpg", "coffee.jpg", "tone_90s.mp3"].map(n => join(MEDIA, n)) })).value;
  const xid = n => x.media.find(i => i.name.startsWith(n)).id;
  const mess = await call("edit", {
    label: "Make a mess",
    ops: [
      { op: "add_clip", media: xid("ferry"), duration: 3, as: "a" },
      { op: "add_clip", media: xid("coffee"), duration: 3, as: "b" },
      { op: "add_clip", media: xid("tone"), at: 0, as: "song" },
      { op: "add_text", text: "Off to the side", at: 1, duration: 2, x: 900, y: 0, as: "lost" },
      { op: "add_track", kind: "video", as: "over" },
      { op: "add_color", color: "#202020", at: 9, duration: 1, track: "$over", as: "late" },
    ],
  });
  check("messy timeline built", !mess.error, mess.error);
  const messy = (await call("get_project")).value;
  console.log("   notes:", JSON.stringify(messy.notes, null, 1));
  check("notes name each problem", messy.notes.length >= 3, `${messy.notes.length} notes`);
  check("notes say how to fix", messy.notes.every(n => /(Trim|Move|Remove|remove_range|set|delete)/i.test(n)), "");
  const gap = await call("edit", { label: "Close the gap", ops: [{ op: "remove_range", from: 6, to: 9 }] });
  check("remove_range closes a gap", !gap.error, gap.error ?? JSON.stringify(gap.value).slice(0, 200));
  const lostId = messy.tracks.flatMap(t => t.items).find(i => i.text === "Off to the side").id;
  const song2 = messy.tracks.flatMap(t => t.items).find(i => i.type === "media" && i.end > 60).id;
  const tidy = await call("edit", { label: "Tidy", ops: [{ op: "set", id: lostId, props: { x: 0, y: 300 } }, { op: "trim", id: song2, duration: 6 }, { op: "set", id: song2, props: { fadeOut: 1.5 } }] });
  check("tidy edit", !tidy.error, tidy.error);
  const after = (await call("get_project")).value;
  console.log("   notes after:", JSON.stringify(after.notes));

  // Errors an AI will hit.
  for (const [what, name, args] of [
    ["unknown clip id", "edit", { ops: [{ op: "set", id: "i_zzz", props: { volume: 1 } }] }],
    ["unknown property", "edit", { ops: [{ op: "set", id: song2, props: { loudness: 3 } }] }],
    ["unknown op", "edit", { ops: [{ op: "ripple_delete", id: song2 }] }],
    ["transcribe a clip without speech", "transcribe", { clip: lostId }],
    ["captions with nothing to hear", "captions", {}],
    ["smart_cut on a still", "smart_cut", { clip: main.items[0].id, remove: ["silences"] }],
    ["import missing file", "import_media", { paths: ["/nope.mp4"] }],
    ["render_frame past the end", "render_frame", { at: 999 }],
    ["analyze unknown media", "analyze_media", { media: "m_nope" }],
    ["open missing project", "open_project", { path: "/nope.openroll" }],
  ]) {
    const r = await call(name, args);
    console.log(`   ${what}: ${r.error ?? JSON.stringify(r.value).slice(0, 160)}`);
  }

  console.log("slow calls:", slow.join(", ") || "none");
  await shot("mcp-agent-end");
  await client.close();
  console.log(failed ? `${failed} checks failed` : "all checks passed");
}
