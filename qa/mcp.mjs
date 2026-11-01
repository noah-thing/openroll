// An MCP client drives the running app through `OpenRoll --mcp`, the way Claude Code would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import electron from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MEDIA = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll-research/testmedia"));
const STILLS = (process.env.OPENROLL_TESTMEDIA ?? join(homedir(), "openroll/design/directions/footage"));

export default async function ({ page, userData, shot }) {
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  await page.waitForSelector(".home");

  const transport = new StdioClientTransport({ command: electron, args: [resolve("."), "--mcp", `--user-data-dir=${userData}`, ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : [])], stderr: process.env.CI ? "inherit" : "ignore", env: { ...process.env } });
  const client = new Client({ name: "claude-code", version: "qa" });
  const t0 = Date.now();
  await client.connect(transport);
  check("connects over stdio", true, `${Date.now() - t0} ms`);
  check("playbook arrives with the connection", (client.getInstructions() ?? "").includes("How to work well"));
  const tools = (await client.listTools()).tools.map(t => t.name);
  check("tools listed", tools.length >= 18, tools.join(" "));

  const call = async (name, args = {}) => {
    // Exports on a slow CI runner can take minutes.
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 });
    const text = r.content.find(c => c.type === "text")?.text;
    if (r.isError) return { error: text };
    let value = text;
    try { value = JSON.parse(text); } catch {}
    return { value, content: r.content };
  };

  await call("new_project", { name: "MCP edit", ratio: "16:9" });
  await page.waitForSelector(".editor");
  const imported = (await call("import_media", { paths: [join(STILLS, "ferry.jpg"), join(STILLS, "forest.jpg"), join(MEDIA, "speech_video_en.mp4"), join(MEDIA, "tone_90s.mp3"), "/nope/missing.mp4"] })).value;
  check("import returns media ids and what was missing", imported.media?.length === 4 && imported.notFound?.length === 1, imported.media?.map(m => m.kind).join(","));
  const id = n => imported.media.find(m => m.name.startsWith(n)).id;

  const catalog = (await call("catalog")).value;
  check("catalog explains choices", catalog.effects.every(e => e.use) && catalog.transitions.every(t => t.use) && !console.log("   undescribed:", catalog.effects.filter(e => !e.use).map(e => e.kind).join(" "), catalog.transitions.filter(t => !t.use).map(t => t.kind).join(" ")), `${catalog.effects.length} effects, ${catalog.filters.length} filters`);

  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa/shots/mcp-00-before.png" });
  const edit = await call("edit", {
    label: "First cut",
    ops: [
      { op: "add_clip", media: id("ferry"), duration: 3, as: "ferry" },
      { op: "add_clip", media: id("speech"), as: "talk" },
      { op: "add_clip", media: id("forest"), duration: 3, as: "forest" },
      { op: "transition", id: "$talk", kind: "dissolve", duration: 0.5 },
      { op: "transition", id: "$forest", kind: "dip-black", duration: 0.6 },
      { op: "add_text", text: "A day on the water", at: 0.3, duration: 2.4, style: { size: 110 }, y: -320, as: "title" },
      { op: "set", id: "$title", props: { animationIn: { kind: "slide-up", duration: 0.4 } } },
      { op: "keyframe", id: "$ferry", prop: "transform.scale", at: 0, value: 1 },
      { op: "keyframe", id: "$ferry", prop: "transform.scale", at: 3, value: 1.12 },
      { op: "filter", id: "$ferry", filter: "harbour", amount: 0.6 },
      { op: "filter", id: "$forest", filter: "harbour", amount: 0.6 },
      { op: "add_clip", media: id("tone"), at: 0, as: "music" },
      { op: "set", id: "$music", props: { volume: 0.4, fadeOut: 1.5, audio: { duckUnder: true } } },
    ],
  });
  check("one call builds the cut", !edit.error && edit.value.results.length === 13, edit.error ?? `duration ${edit.value.duration} s, added ${edit.value.changed.added.length}`);
  const undoLabel = await page.evaluate(() => window.__or.editor.history.undoLabel);
  check("the person sees one labelled undo step", undoLabel === "Claude Code: First cut", undoLabel);

  const bad = await call("edit", { ops: [{ op: "add_text", text: "x", at: 1 }, { op: "effect", id: "nope", kind: "thump" }] });
  check("a bad batch explains itself and changes nothing", !!bad.error && /operation 2/.test(bad.error) && /Nothing was changed/.test(bad.error), bad.error);

  const proj = (await call("get_project")).value;
  const main = proj.tracks.find(t => t.main);
  check("project reads in seconds", main.items.length === 3 && main.items[0].end === 3, JSON.stringify(main.items.map(i => [i.start, i.end])));

  const frame = await call("render_frame", { at: 1, width: 640 });
  const img = frame.content.find(c => c.type === "image");
  check("sees a frame", !!img && img.mimeType === "image/jpeg", frame.content.find(c => c.type === "text")?.text);
  writeFileSync("qa/shots/mcp-frame.jpg", Buffer.from(img.data, "base64"));

  const talk = main.items[1].id;
  const analysis = (await call("analyze_media", { media: id("speech") })).value;
  check("hears where speech is", analysis.speech?.length > 0, `${analysis.speech?.length} stretches, ${analysis.loudness}`);
  const tr = await call("transcribe", { clip: talk });
  if (tr.error) console.log("   transcribe error:", tr.error);
  const words = tr.value ?? {};
  check("transcribes with word times", words.words?.length > 10, words.words?.slice(0, 6).map(w => w[0]).join(" "));
  const sc = await call("smart_cut", { clip: talk, remove: ["silences", "fillers"] });
  if (sc.error) console.log("   smart cut error:", sc.error);
  const cut = sc.value ?? {};
  check("smart cut", typeof cut.summary === "string", cut.summary ?? JSON.stringify(cut));
  const cr = await call("captions", { style: "outline", highlight: true });
  if (cr.error) console.log("   captions error:", cr.error);
  const caps = cr.value ?? {};
  check("captions placed", caps.captions > 3, `${caps.captions} captions, "${caps.first?.[0]?.text}"`);

  const sheet = await call("contact_sheet", { count: 9 });
  const sheetImg = sheet.content.find(c => c.type === "image");
  writeFileSync("qa/shots/mcp-sheet.jpg", Buffer.from(sheetImg.data, "base64"));
  check("contact sheet", !!sheetImg, sheet.content.find(c => c.type === "text")?.text);

  await call("show", { at: 1 });
  await page.waitForTimeout(800);
  await shot("mcp-01-editor");

  const out = join(userData, "mcp-export.mp4");
  const ex = await call("export", { path: out, resolution: "720" });
  check("exports", !ex.error && existsSync(out), ex.error ?? `${ex.value.megabytes} MB in ${ex.value.seconds} s`);
  if (existsSync(out)) console.log("   ffprobe:", execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", out]).toString().trim().replace(/\n/g, " | "));

  const undo = (await call("undo", { steps: 1 })).value;
  check("undo by the AI", undo.undone.length === 1, undo.undone.join(", "));
  await client.close();
}
