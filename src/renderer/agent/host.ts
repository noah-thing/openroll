import { allCaptions, cuesFromCaptions, toSrt, toVtt } from "../../core/captions";
import { readProject } from "../../core/load";
import { applyOps, OpError, type Op } from "../../core/agent/ops";
import { summarize } from "../../core/agent/summary";
import { buildScene } from "../../core/scene";
import { applyCuts, describePlan, planCuts } from "../../core/smartcut";
import { createProject, findItem, itemEnd, projectDuration, type Project } from "../../core/project";
import { CAPTION_PRESETS } from "../../core/caption-styles";
import { hasExtension } from "../../engine/export-formats";
import { aiFor } from "../state/ai";
import { captionService, listenTargets } from "../state/captions";
import type { Editor } from "../state/editor";
import { exportQueue } from "../state/export-queue";
import { importFiles } from "../state/importer";
import type { MediaCache } from "../state/media-cache";
import { buildCatalog } from "./catalog";
import { templateStore, templateSummaries } from "../state/templates";

/** What the host needs from the rest of the app; filled in by App and EditorView. */
export const agentContext = {
  editor: null as Editor | null,
  cache: null as MediaCache | null,
  open: null as ((p: Project, path: string | null) => void) | null,
};

/** Projects whose frame the AI chose on purpose; importing must not reshape them. */
const framed = new WeakSet<Editor>();

type Handler = (params: Record<string, unknown>, client: string) => Promise<unknown>;

const sec = (us: number) => Math.round(us / 1000) / 1000;
const S = 1_000_000;

function editor(): Editor {
  const e = agentContext.editor;
  if (!e) throw new Error("No project is open. Call open_project or new_project first.");
  return e;
}

async function waitFor<T>(get: () => T | null | undefined, ms: number, what: string): Promise<T> {
  const until = performance.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (performance.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(r => setTimeout(r, 60));
  }
}

async function openProject(p: Project, path: string | null): Promise<Editor> {
  if (!agentContext.open) throw new Error("OpenRoll is still starting.");
  const previous = agentContext.editor;
  if (previous) await previous.save();
  agentContext.open(p, path);
  return waitFor(() => (agentContext.editor && agentContext.editor !== previous && agentContext.editor.player ? agentContext.editor : null), 10_000, "the editor to open");
}

const handlers: Record<string, Handler> = {
  async status() {
    const e = agentContext.editor;
    return { version: window.openroll.versions.app, platform: window.openroll.platform, project: e ? { name: e.project.name, path: e.path, duration: sec(projectDuration(e.project)) } : null };
  },

  async "project.get"(params) {
    const e = editor();
    return { ...summarize(e.project, { words: !!params.words }), path: e.path, playhead: sec(e.time), selection: e.selection };
  },

  async "projects.list"() {
    return (await window.openroll.projects.list()).map(p => ({ name: p.name, path: p.path, modified: new Date(p.modified).toISOString() }));
  },

  async "projects.open"(params) {
    const path = String(params.path ?? "");
    const text = await window.openroll.projects.load(path);
    if (!text) throw new Error(`Could not read ${path}.`);
    const read = readProject(text);
    if (!read.ok) throw new Error(`${path} could not be opened. ${read.error}`);
    const e = await openProject(read.project, path);
    return summarize(e.project);
  },

  async "projects.new"(params) {
    const ratios: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "4:3": [1440, 1080], "21:9": [2560, 1080] };
    const [width, height] = ratios[String(params.ratio ?? "16:9")] ?? ratios["16:9"];
    const fps = typeof params.fps === "number" ? params.fps : 30;
    const p = createProject(String(params.name ?? "Untitled"), { width, height, fps: Number.isInteger(fps) ? { num: fps, den: 1 } : { num: Math.round(fps * 1001), den: 1001 } });
    const e = await openProject(p, null);
    if (params.ratio || params.fps) framed.add(e);
    return { name: e.project.name, frame: { width, height, fps } };
  },

  async "media.import"(params) {
    const e = editor();
    const paths = Array.isArray(params.paths) ? params.paths.map(String) : [];
    const files = await window.openroll.agent.allow(paths);
    const missing = paths.filter(p => !files.some(f => f.path === p));
    const append = params.place === "append";
    const before = e.project;
    const refs = await importFiles(e, files, { place: append, keepFrame: framed.has(e), ...(append ? { at: projectDuration(e.project) } : {}) });
    const known = new Set(before.tracks.flatMap(t => t.items.map(i => i.id)));
    const placed = e.project.tracks.flatMap(t => t.items.filter(i => i.type === "media" && !known.has(i.id)).map(i => ({ id: i.id, media: i.type === "media" ? i.mediaId : "", start: sec(i.start), end: sec(itemEnd(i)), track: t.id })));
    const s = e.project.settings;
    return {
      ...(append || placed.length ? { placed } : {}),
      ...(s.width !== before.settings.width || s.height !== before.settings.height ? { frame: `${s.width}x${s.height}`, note: "The empty project took the shape of the first clip. Use the project op to change it." } : {}),
      media: refs.map(r => ({ id: r.id, name: r.name, kind: r.kind, duration: sec(r.duration), ...(r.width ? { size: `${r.width}x${r.height}` } : {}), path: r.path })),
      ...(missing.length ? { notFound: missing } : {}),
    };
  },

  async "media.analyze"(params) {
    const e = editor();
    const m = e.project.media[String(params.media)];
    if (!m) throw new Error(`No media ${params.media}. Media ids come from import_media or get_project.`);
    const cache = agentContext.cache;
    const analysis = m.hasAudio && cache ? await waitFor(() => cache.analysis(m), 120_000, "the audio analysis") : null;
    // cut_to_beat reads the beats off the media; do not leave that to the effect that follows the cache.
    if (analysis && m.loudness === undefined) e.annotateMedia(m.id, { loudness: analysis.lufs ?? -70, speech: analysis.speech, beats: analysis.beats, bpm: analysis.bpm ?? undefined });
    const speech: [number, number][] = [];
    if (analysis) for (let i = 0; i + 1 < analysis.speech.length; i += 2) speech.push([sec(analysis.speech[i]), sec(analysis.speech[i + 1])]);
    return {
      id: m.id, name: m.name, kind: m.kind, duration: sec(m.duration),
      ...(m.width ? { size: `${m.width}x${m.height}`, fps: m.fps } : {}),
      ...(m.kind === "audio" && analysis && !analysis.beats.length ? { note: "No steady beat found, so cut_to_beat will not work on this. Cut by hand on the loudest moments or at even steps." } : {}),
      ...(analysis ? { loudness: analysis.lufs === null ? "silent" : `${analysis.lufs.toFixed(1)} LUFS`, speech, bpm: analysis.bpm, beats: analysis.beats.map(sec) } : {}),
    };
  },

  async "speech.transcribe"(params) {
    const e = editor();
    const id = String(params.clip ?? params.media ?? "");
    const found = findItem(e.project, id);
    const target = found ? listenTargets(e.project, [found.item.id])[0] : undefined;
    if (!target) throw new Error(`${id || "No id"} is not a clip with sound on the timeline. Pass a video or audio clip id from get_project.`);
    const words = await captionService(e).listen([target], { language: typeof params.language === "string" ? params.language : null, model: "base" });
    if (!words) throw new Error("Transcription stopped.");
    return { clip: target.item.id, words: (words.get(target.item.id) ?? []).map(w => [w.text, sec(w.start), sec(w.end)]), note: "Word times are on the timeline, in seconds." };
  },

  async "edit.apply"(params, client) {
    const e = editor();
    const ops = (Array.isArray(params.ops) ? params.ops : []) as Op[];
    // Paths in add_clip are imported first, so one call can go from files to a cut.
    const paths = [...new Set(ops.flatMap(o => (o.op === "add_clip" && /[\\/]/.test(o.media) && !e.project.media[o.media] ? [o.media] : [])))];
    if (paths.length) {
      const files = await window.openroll.agent.allow(paths);
      await importFiles(e, files, { place: false, keepFrame: framed.has(e) });
    }
    const before = e.project;
    let out: ReturnType<typeof applyOps>;
    try {
      await templateStore.start();
      out = applyOps(before, ops, { template: key => templateStore.find(key)?.template ?? null });
    } catch (err) {
      if (err instanceof OpError) throw new Error(`${err.message}. Nothing was changed.`);
      throw err;
    }
    const label = `${client}: ${String(params.label ?? describeOps(ops)).slice(0, 60)}`;
    e.apply(label, () => out.project);
    return { results: out.results, changed: diff(before, out.project), duration: sec(projectDuration(out.project)) };
  },

  async "captions.generate"(params) {
    const e = editor();
    const before = allCaptions(e.project).length;
    const style = CAPTION_PRESETS.find(c => c.id === params.style)?.id ?? "outline";
    await captionService(e).generate(null, { language: typeof params.language === "string" ? params.language : null, model: "base" }, {
      preset: style,
      highlight: params.highlight === false ? null : (CAPTION_PRESETS.find(c => c.id === style)?.highlight ?? "#f2c23a"),
      position: (["top", "middle", "lower"].includes(String(params.position)) ? params.position : "lower") as "top" | "middle" | "lower",
    });
    const after = allCaptions(e.project);
    if (after.length === before) return { captions: after.length, added: 0, note: "No speech was found on the timeline, so nothing was added. Check that a clip with talking is on it." };
    return { captions: after.length, added: after.length - before, first: after.slice(0, 3).map(c => ({ id: c.id, at: sec(c.start), text: c.words.map(w => w.text).join(" ") })) };
  },

  async smartcut(params, client) {
    const e = editor();
    const found = findItem(e.project, String(params.clip));
    if (!found || found.item.type !== "media") throw new Error("smart_cut needs the id of a video clip with speech; get_project lists them.");
    const item = found.item;
    const service = captionService(e);
    let words = service.heard(item) ?? service.fromCaptions(item);
    if (!words) {
      const target = listenTargets(e.project, [item.id])[0];
      if (!target) throw new Error("That clip has no sound to listen to.");
      words = (await service.listen([target], { language: null, model: "base" }))?.get(item.id) ?? null;
    }
    if (!words) throw new Error("Could not hear the clip.");
    const remove = Array.isArray(params.remove) ? params.remove.map(String) : ["silences", "fillers"];
    const plan = planCuts(words, { from: item.start, to: itemEnd(item) }, {
      pauses: remove.includes("silences"),
      fillers: remove.includes("fillers"),
      ...(typeof params.minSilence === "number" ? { minPause: Math.round(params.minSilence * S) } : {}),
      language: service.spokenLanguage(item) ?? undefined,
    });
    if (!plan.ranges.length) return { removed: 0, note: "Nothing to remove." };
    e.apply(`${client}: remove pauses and fillers`, p => applyCuts(p, plan.ranges));
    return { summary: describePlan(plan), ranges: plan.ranges.map(r => [sec(r.from), sec(r.to)]), duration: sec(projectDuration(e.project)) };
  },

  async "ai.reframe"(params) {
    const e = editor();
    const r = await aiFor(e).reframe(String(params.clip));
    return { followedSubject: r.found, note: r.found ? "Reframed on the subject with keyframes." : "No person found; the clip is centred." };
  },

  async "templates.list"() {
    await templateStore.start();
    return templateSummaries();
  },

  async catalog() {
    return buildCatalog();
  },

  async "render.frame"(params) {
    const e = editor();
    const t = Math.round(Number(params.at ?? 0) * S);
    if (t > projectDuration(e.project)) throw new Error(`${params.at} s is past the end of the project, which is ${sec(projectDuration(e.project))} s long.`);
    const width = Math.min(1920, Math.max(160, Number(params.width ?? 960)));
    const data = await frameJpeg(e, t, width, 0.86);
    const on = buildScene(e.project, t).flatMap(n => (n.kind === "visual" ? [n.visual] : [n.a, n.b]));
    const names = on.map(v => (v.kind === "media" ? `${v.item.id} (${v.media.name})` : v.kind === "text" ? `${v.item.id} (text "${v.text.slice(0, 30)}")` : `${v.item.id} (${v.kind})`));
    return { data, mimeType: "image/jpeg", note: `${sec(t)} s. Visible bottom to top: ${names.join(", ") || "nothing"}.` };
  },

  async "render.sheet"(params) {
    const e = editor();
    const total = projectDuration(e.project);
    if (!total) throw new Error("The timeline is empty.");
    const from = Math.max(0, Math.round(Number(params.from ?? 0) * S));
    const to = Math.min(total, Math.round(Number(params.to ?? total / S) * S));
    const count = Math.min(36, Math.max(2, Number(params.count ?? 12)));
    const cols = Math.ceil(Math.sqrt(count * (e.project.settings.height / e.project.settings.width) * 1.6));
    const tileW = Math.round(Math.min(360, 1800 / cols));
    const tileH = Math.round((tileW * e.project.settings.height) / e.project.settings.width);
    const rows = Math.ceil(count / cols);
    const sheet = new OffscreenCanvas(cols * tileW, rows * (tileH + 22));
    const g = sheet.getContext("2d")!;
    g.fillStyle = "#141415";
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = "600 14px -apple-system, Segoe UI, sans-serif";
    for (let i = 0; i < count; i++) {
      const t = Math.round(from + ((to - from) * (i + 0.5)) / count);
      const img = await frame(e, t, tileW);
      const x = (i % cols) * tileW, y = Math.floor(i / cols) * (tileH + 22);
      g.drawImage(img, x, y, tileW, tileH);
      g.fillStyle = "#ececee";
      g.fillText(`${sec(t).toFixed(1)} s`, x + 6, y + tileH + 16);
    }
    const blob = await sheet.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    return { data: await base64(blob), mimeType: "image/jpeg", note: `${count} frames from ${sec(from)} s to ${sec(to)} s, left to right, top to bottom.` };
  },

  async "history.undo"(params) {
    const e = editor();
    const steps = Math.min(50, Math.max(1, Number(params.steps ?? 1)));
    const undone: string[] = [];
    for (let i = 0; i < steps; i++) {
      const label = e.history.undoLabel;
      if (!label) break;
      e.undo();
      undone.push(label);
    }
    return { undone };
  },

  async "history.redo"(params) {
    const e = editor();
    const steps = Math.min(50, Math.max(1, Number(params.steps ?? 1)));
    const redone: string[] = [];
    for (let i = 0; i < steps; i++) {
      const label = e.history.redoLabel;
      if (!label) break;
      e.redo();
      redone.push(label);
    }
    return { redone };
  },

  async "player.seek"(params) {
    const e = editor();
    e.seek(Math.round(Number(params.at ?? 0) * S));
    if (params.play) void e.player?.play();
    return { playhead: sec(e.time) };
  },

  async "export.run"(params) {
    const e = editor();
    const p = e.project;
    const total = projectDuration(p);
    if (!total) throw new Error("The timeline is empty.");
    const short = Math.min(p.settings.width, p.settings.height);
    const target = Number(params.resolution ?? Math.min(1080, short));
    const k = target / short;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const width = even(p.settings.width * k), height = even(p.settings.height * k);
    const fps = p.settings.fps.num / p.settings.fps.den;
    const bpp = { small: 0.06, balanced: 0.1, best: 0.16 }[String(params.quality ?? "balanced") as "small"] ?? 0.1;
    const codec = params.codec === "hevc" ? "hevc" : "avc";
    const path = typeof params.path === "string" && params.path ? params.path : null;
    if (path && !hasExtension(path, "mp4")) throw new Error("The export is an MP4, so the path has to end in .mp4.");
    const writer = await window.openroll.agent.writerAt(path, p.name);
    const ai = aiFor(e);
    const id = exportQueue.add({
      name: p.name,
      label: "MP4",
      project: p,
      urls: e.exportUrls(p),
      settings: { format: "mp4", width, height, fps, codec, bitrate: Math.round(width * height * fps * bpp * (codec === "hevc" ? 0.6 : 1)), encoder: "hardware", audio: true, transparent: false, at: e.time },
      writer,
      prepare: async onProgress => {
        await ai.prepareForExport(onProgress);
        return ai.snapshot();
      },
    });
    const job = await exportQueue.whenDone(id);
    if (job.status !== "done") throw new Error(`The export stopped: ${job.error ?? "unknown reason"}`);
    return { path: job.path, megabytes: Math.round(job.bytes / 1e5) / 10, seconds: Math.round(job.seconds * 10) / 10, size: `${width}x${height}`, duration: sec(total) };
  },

  async "export.subtitles"(params) {
    const e = editor();
    const caps = allCaptions(e.project);
    if (!caps.length) throw new Error("There are no captions. Call captions first.");
    const format = params.format === "vtt" ? "vtt" : "srt";
    const text = format === "vtt" ? toVtt(cuesFromCaptions(caps)) : toSrt(cuesFromCaptions(caps));
    const path = typeof params.path === "string" && params.path ? params.path : null;
    if (path && !hasExtension(path, format)) throw new Error(`The captions are written as ${format.toUpperCase()}, so the path has to end in .${format}.`);
    const writer = await window.openroll.agent.writerAt(path, `${e.project.name}.${format}`);
    await window.openroll.write(writer.id, 0, new TextEncoder().encode(text));
    await window.openroll.closeWriter(writer.id);
    return { path: writer.path, cues: caps.length };
  },
};

async function frame(e: Editor, t: number, width: number): Promise<OffscreenCanvas> {
  const player = e.player;
  if (!player) throw new Error("The preview is not ready yet.");
  const img = await player.snapshot(t, undefined, { settle: true, width });
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext("2d")!;
  // the snapshot is the layers alone; put the project background behind them
  g.fillStyle = e.project.settings.background || "#000000";
  g.fillRect(0, 0, c.width, c.height);
  const layer = new OffscreenCanvas(img.width, img.height);
  layer.getContext("2d")!.putImageData(img, 0, 0);
  g.drawImage(layer, 0, 0);
  return c;
}

async function frameJpeg(e: Editor, t: number, width: number, quality: number): Promise<string> {
  const c = await frame(e, t, width);
  return base64(await c.convertToBlob({ type: "image/jpeg", quality }));
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function describeOps(ops: Op[]): string {
  const kinds = [...new Set(ops.map(o => o.op))];
  return kinds.length === 1 ? kinds[0].replace(/_/g, " ") : `${ops.length} edits`;
}

/** Clips that appeared, disappeared or changed, so the model knows what its call did. */
function diff(before: Project, after: Project) {
  const index = (p: Project) => new Map(p.tracks.flatMap(t => t.items.map(i => [i.id, JSON.stringify(i)] as const)));
  const a = index(before), b = index(after);
  const added = [...b.keys()].filter(id => !a.has(id));
  const removed = [...a.keys()].filter(id => !b.has(id));
  const modified = [...b.keys()].filter(id => a.has(id) && a.get(id) !== b.get(id));
  return { added, removed, modified, ...(before.settings.width !== after.settings.width || before.settings.height !== after.settings.height ? { frame: `${after.settings.width}x${after.settings.height}` } : {}) };
}

let started = false;

export function startAgentHost(): void {
  if (started) return;
  started = true;
  window.openroll.agent.onCall(async ({ callId, method, params, client }) => {
    const handler = handlers[method];
    try {
      if (!handler) throw new Error(`OpenRoll does not know ${method}.`);
      const result = await handler((params ?? {}) as Record<string, unknown>, client);
      window.openroll.agent.reply(callId, { id: callId, result });
    } catch (err) {
      window.openroll.agent.reply(callId, { id: callId, error: { message: (err as Error).message || String(err) } });
    }
  });
}
