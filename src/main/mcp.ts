// `OpenRoll --mcp`: the app started as an MCP server on stdin and stdout, for Claude Code,
// Codex, Cursor and other AI tools. It holds no editor of its own; it finds the running app
// (starting it when needed) and passes calls through the private control socket.

import { app } from "electron";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GUIDE, GUIDE_TOPICS, PLAYBOOK } from "../shared/agent-guide";
import type { Method, Reply } from "../shared/agent-protocol";
import { controlAddress, tokenFile } from "./control";
import { launcherPath } from "./launch-target";

class Link {
  private socket: Socket | null = null;
  private buffer = "";
  private nextId = 1;
  private waiting = new Map<number, (r: Reply) => void>();
  private ready: Promise<void> | null = null;
  clientName = "An AI tool";

  call(method: Method, params: unknown = {}): Promise<unknown> {
    return this.connect().then(
      () =>
        new Promise((resolve, reject) => {
          const id = this.nextId++;
          this.waiting.set(id, r => (r.error ? reject(new Error(r.error.message)) : resolve(r.result)));
          this.socket!.write(JSON.stringify({ id, method, params }) + "\n");
        }),
    );
  }

  private connect(): Promise<void> {
    this.ready ??= this.open().catch(err => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async open(): Promise<void> {
    let socket = await tryConnect();
    if (!socket) {
      launchApp();
      for (let i = 0; i < 60 && !socket; i++) {
        await new Promise(r => setTimeout(r, 500));
        socket = await tryConnect();
      }
    }
    if (!socket) throw new Error("Could not reach OpenRoll. Open the app and try again.");
    const token = (await readFile(tokenFile(), "utf8")).trim();
    socket.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      const first = (chunk: string) => {
        this.buffer += chunk;
        const nl = this.buffer.indexOf("\n");
        if (nl < 0) return;
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        socket!.off("data", first);
        const msg = JSON.parse(line) as { ok?: boolean; error?: { message: string } };
        if (msg.ok) resolve();
        else reject(new Error(msg.error?.message ?? "OpenRoll refused the connection."));
      };
      socket!.on("data", first);
      socket!.write(JSON.stringify({ hello: { token, client: { name: this.clientName } } }) + "\n");
    });
    socket.on("data", chunk => this.receive(chunk as unknown as string));
    socket.on("close", () => {
      this.socket = null;
      this.ready = null;
      for (const [, w] of this.waiting) w({ id: 0, error: { message: "OpenRoll closed the connection." } });
      this.waiting.clear();
    });
    this.socket = socket;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const reply = JSON.parse(this.buffer.slice(0, nl)) as Reply;
      this.buffer = this.buffer.slice(nl + 1);
      this.waiting.get(reply.id)?.(reply);
      this.waiting.delete(reply.id);
    }
  }
}

function tryConnect(): Promise<Socket | null> {
  return new Promise(resolve => {
    const s = connect(controlAddress());
    s.once("connect", () => resolve(s));
    s.once("error", () => resolve(null));
  });
}

function launchApp(): void {
  const passThrough = process.argv.filter(a => a.startsWith("--user-data-dir="));
  const args = app.isPackaged ? passThrough : [app.getAppPath(), ...passThrough];
  const child = spawn(launcherPath(process.execPath, process.env), args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });
const image = (r: unknown) => {
  const v = r as { data: string; mimeType: string; note?: string };
  return { content: [{ type: "image" as const, data: v.data, mimeType: v.mimeType }, ...(v.note ? [{ type: "text" as const, text: v.note }] : [])] };
};
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (err as Error).message }] });

export async function runMcp(): Promise<void> {
  if (process.platform === "darwin") app.dock?.hide();
  const link = new Link();
  const server = new McpServer({ name: "openroll", version: app.getVersion() }, { instructions: PLAYBOOK });
  const run = (method: Method, shape: (r: unknown) => ReturnType<typeof text> | ReturnType<typeof image> = text) => async (params: unknown) => {
    try {
      return shape(await link.call(method, params));
    } catch (err) {
      return fail(err);
    }
  };

  const seconds = z.number().describe("seconds");
  server.registerTool("get_project", {
    description: "The open project: frame, media library, tracks with every clip (ids, times in seconds, settings that differ from default), markers. Call this first.",
    inputSchema: { words: z.boolean().optional().describe("include word timing for captions") },
    annotations: { readOnlyHint: true },
  }, run("project.get"));

  server.registerTool("list_projects", { description: "Projects in the OpenRoll projects folder, newest first.", annotations: { readOnlyHint: true } }, run("projects.list"));

  server.registerTool("open_project", { description: "Open a project file in the editor.", inputSchema: { path: z.string() } }, run("projects.open"));

  server.registerTool("new_project", {
    description: "Start a new, empty project and open it.",
    inputSchema: { name: z.string().optional(), ratio: z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"]).optional(), fps: z.number().optional() },
  }, run("projects.new"));

  server.registerTool("import_media", {
    description: "Add video, audio or image files (absolute paths) to the project. place \"append\" also puts them at the end of the timeline in order. Returns media ids, and with \"append\" the clip ids and times it placed. The first clip into an empty project sets its frame shape, unless new_project was given a ratio.",
    inputSchema: { paths: z.array(z.string()).min(1), place: z.enum(["library", "append"]).optional() },
  }, run("media.import"));

  server.registerTool("analyze_media", {
    description: "What is in a media file: duration, size, fps, loudness, speech ranges, beats and tempo for music. Use before cutting to rhythm or speech.",
    inputSchema: { media: z.string().describe("media id") },
    annotations: { readOnlyHint: true },
  }, run("media.analyze"));

  server.registerTool("transcribe", {
    description: "Speech to text with word times, on this computer, for a clip on the timeline. Word times are timeline seconds, so they can go straight into split, trim and remove_range. Takes a few seconds per minute of audio.",
    inputSchema: { clip: z.string().describe("clip id from get_project"), language: z.string().optional().describe("two letter code, or omit to detect") },
  }, run("speech.transcribe"));

  server.registerTool("edit", {
    description:
      "Apply a batch of edit operations in one step (all or nothing, one undo for the person). Operations: add_clip {media, at?, track?, in?, duration?, as?}, add_text {text, at, duration?, style?, x?, y?, as?}, add_color {color, at, duration}, move {id, at, track?}, trim {id, in?, duration?}, split {at, ids?}, delete {ids}, remove_range {from, to}, set {id, props}, keyframe {id, prop, at, value, ease?}, transition {id, kind, duration?}, filter {id, filter, amount?}, effect {id, kind, amount?, speed?, style?}, marker {at, label?}, track {id, muted?, hidden?, locked?, name?}, add_track {kind, name?, as?}, project {ratio?, width?, height?, fps?, background?, name?}, add_shape {kind, sticker?, at, duration?, color?, x?, y?, scale?}, layout {id, layout}, cut_to_beat {clips, music, every?}. Name results with as and use them as \"$name\". The catalog tool lists every kind and property.",
    inputSchema: { ops: z.array(z.record(z.string(), z.unknown())).min(1), label: z.string().optional().describe("short name shown in Undo") },
  }, run("edit.apply"));

  server.registerTool("captions", {
    description: "Transcribe the timeline's speech and place styled captions, replacing earlier ones in the same span. Returns the caption ids and how many were added; says so when it heard no speech.",
    inputSchema: {
      style: z.string().optional().describe("caption style id from the catalog"),
      highlight: z.boolean().optional().describe("colour the word being spoken"),
      position: z.enum(["top", "middle", "lower"]).optional(),
      language: z.string().optional(),
    },
  }, run("captions.generate"));

  server.registerTool("smart_cut", {
    description: "Remove silences and/or filler words (um, uh, eh, like) from a talking clip on the timeline, as one undoable edit. Returns how much was removed.",
    inputSchema: { clip: z.string().describe("clip id"), remove: z.array(z.enum(["silences", "fillers"])).min(1), minSilence: seconds.optional() },
  }, run("smartcut"));

  server.registerTool("make_vertical", {
    description: "Reframe a clip on its subject with keyframes so it fills the current frame shape (use after the project is 9:16). Can take up to a minute the first time, and says when it found nobody and centred the clip.",
    inputSchema: { clip: z.string() },
  }, run("ai.reframe"));

  server.registerTool("catalog", {
    description: "Everything you can use: operations and their fields, clip properties with ranges, transitions, filters, effects, text and caption styles, animations, voice effects, blend modes, mask shapes.",
    annotations: { readOnlyHint: true },
  }, run("catalog"));

  server.registerTool("render_frame", {
    description: "See the edit: one frame of the timeline as an image.",
    inputSchema: { at: seconds, width: z.number().int().min(160).max(1920).optional() },
    annotations: { readOnlyHint: true },
  }, run("render.frame", image));

  server.registerTool("contact_sheet", {
    description: "See a stretch of the edit at a glance: a grid of frames with their times.",
    inputSchema: { from: seconds.optional(), to: seconds.optional(), count: z.number().int().min(2).max(36).optional() },
    annotations: { readOnlyHint: true },
  }, run("render.sheet", image));

  server.registerTool("undo", { description: "Undo the last steps.", inputSchema: { steps: z.number().int().min(1).max(50).optional() } }, run("history.undo"));
  server.registerTool("redo", { description: "Redo steps.", inputSchema: { steps: z.number().int().min(1).max(50).optional() } }, run("history.redo"));

  server.registerTool("show", {
    description: "Move the playhead so the person sees a moment, optionally playing from there.",
    inputSchema: { at: seconds, play: z.boolean().optional() },
  }, run("player.seek"));

  server.registerTool("export", {
    description: "Render the finished video. Waits until done and returns the file, size and time taken.",
    inputSchema: {
      path: z.string().optional().describe("absolute .mp4 path; omit for the Videos folder"),
      resolution: z.enum(["720", "1080", "1440", "2160"]).optional().describe("size of the short side, so 1080 is 1080x1920 for a vertical project"),
      quality: z.enum(["small", "balanced", "best"]).optional(),
      codec: z.enum(["h264", "hevc"]).optional(),
    },
  }, run("export.run"));

  server.registerTool("export_subtitles", {
    description: "Write the captions as an SRT or VTT file.",
    inputSchema: { path: z.string().optional(), format: z.enum(["srt", "vtt"]).optional() },
  }, run("export.subtitles"));

  server.registerTool("guide", {
    description: `Editing recipes and reference. Topics: ${GUIDE_TOPICS.join(", ")}.`,
    inputSchema: { topic: z.enum(GUIDE_TOPICS as [string, ...string[]]) },
    annotations: { readOnlyHint: true },
  }, async ({ topic }: { topic: string }) => {
    if (topic === "reference") return run("catalog")({});
    return text(GUIDE[topic]);
  });

  server.server.oninitialized = () => {
    const info = server.server.getClientVersion();
    if (info?.name) link.clientName = prettyClient(info.name);
  };

  // On Windows, Electron's process.stdin ends at once with nothing read, while the raw handles
  // carry the client's pipe fine (checked on a GitHub Windows runner, qa/probe-stdin).
  const win = process.platform === "win32";
  const input = win ? createReadStream("", { fd: 0, autoClose: false }) : process.stdin;
  const output = win ? createWriteStream("", { fd: 1, autoClose: false }) : process.stdout;
  const transport = new StdioServerTransport(input, output);
  transport.onclose = () => app.exit(0);
  await server.connect(transport);
  input.on("end", () => app.exit(0));
}

function prettyClient(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("claude")) return "Claude Code";
  if (n.includes("codex")) return "Codex";
  if (n.includes("cursor")) return "Cursor";
  if (n.includes("gemini")) return "Gemini";
  return name.slice(0, 40);
}
