// Between the MCP bridge (or any local client) and the running app: newline separated JSON
// over a private socket. The first line is a hello with the token from the user's profile.

export interface Hello {
  hello: { token: string; client: { name: string; version?: string } };
}

export interface Request {
  id: number;
  method: string;
  params?: unknown;
}

export interface Reply {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export interface AgentClient {
  id: number;
  name: string;
  since: number;
}

/** Methods the app answers. Long ones (export, transcribe) have no timeout. */
export const METHODS = [
  "status",
  "project.get",
  "projects.list",
  "projects.open",
  "projects.new",
  "media.import",
  "media.analyze",
  "speech.transcribe",
  "edit.apply",
  "captions.generate",
  "smartcut",
  "ai.reframe",
  "catalog",
  "render.frame",
  "render.sheet",
  "history.undo",
  "history.redo",
  "player.seek",
  "export.run",
  "export.subtitles",
] as const;

export type Method = (typeof METHODS)[number];

export const LONG_METHODS: Method[] = ["export.run", "speech.transcribe", "captions.generate", "smartcut", "ai.reframe", "media.analyze", "media.import"];
